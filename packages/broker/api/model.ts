import { S3Client } from "@aws-sdk/client-s3";
import { fromWebToken } from "@aws-sdk/credential-providers";
import { AwsKmsClient } from "@buildit/security";
import { CredentialBroker, type StoredCredential } from "../src/index.js";
import { S3GrantConsumer } from "../src/artifacts.js";
import { handleModelInvocation } from "../src/model-http.js";
import { registerBrokerTelemetry } from "../src/instrumentation.js";

registerBrokerTelemetry();

function required(name: string) { const value = process.env[name]; if (!value) throw new Error("model_broker_configuration_missing"); return value; }
function report(error: unknown) { const raw = error instanceof Error ? error.name : "Unknown", allowed = new Set(["CredentialsProviderError", "AccessDenied", "AccessDeniedException", "KMSInvalidStateException", "NoSuchBucket", "Error"]); const status = (error as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode; console.error(JSON.stringify({ event: "model_broker_unavailable", errorClass: allowed.has(raw) ? raw : "Other", ...(typeof status === "number" ? { status } : {}) })); }

async function route(request: Request) {
  try {
    const region = "eu-west-1", oidcToken = request.headers.get("x-vercel-oidc-token") ?? process.env.VERCEL_OIDC_TOKEN;
    if (!oidcToken) throw new Error("model_broker_configuration_missing");
    const credentials = fromWebToken({ roleArn: required("AWS_ROLE_ARN"), webIdentityToken: oidcToken, roleSessionName: `buildit-model-${Date.now()}`, clientConfig: { region } });
    const bucket = required("AWS_ARTIFACT_BUCKET"), kmsKeyId = required("AWS_KMS_KEY_ID"), s3 = new S3Client({ region, credentials });
    const replay = new S3GrantConsumer({ bucket, kmsKeyId, s3: s3 as never });
    const kms = new AwsKmsClient({ config: { region, credentials } });
    const broker = (supplied: StoredCredential) => new CredentialBroker({ insert: async () => undefined,
      get: async (id: string) => supplied.id === id ? supplied : null, markUsed: async () => undefined, revoke: async () => undefined }, kms, kmsKeyId);
    return await handleModelInvocation(request, { grantSecret: Buffer.from(required("MODEL_GRANT_SECRET"), "base64url"), consume: (id, expiresAt) => replay.consume(id, expiresAt), broker });
  } catch (error) {
    report(error);
    return Response.json({ error: "model_broker_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export const POST = route;
