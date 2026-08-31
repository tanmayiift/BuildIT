import { S3Client } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { AwsKmsClient } from "@buildit/security";
import { CredentialBroker, type StoredCredential } from "../src/index.js";
import { S3GrantConsumer } from "../src/artifacts.js";
import { handleModelInvocation } from "../src/model-http.js";
import { observedBrokerRoute, registerBrokerTelemetry } from "../src/instrumentation.js";

registerBrokerTelemetry();

function required(name: string) { const value = process.env[name]; if (!value) throw new Error("model_broker_configuration_missing"); return value; }
function report(error: unknown) { const raw = error instanceof Error ? error.name : "Unknown", allowed = new Set(["CredentialsProviderError", "AccessDenied", "AccessDeniedException", "KMSInvalidStateException", "NoSuchBucket", "Error"]); const status = (error as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode; console.error(JSON.stringify({ event: "model_broker_unavailable", errorClass: allowed.has(raw) ? raw : "Other", ...(typeof status === "number" ? { status } : {}) })); }

async function route(request: Request) {
  try {
    const region = "eu-west-1";
    const credentials = awsCredentialsProvider({ roleArn: required("AWS_ROLE_ARN"), roleSessionName: `buildit-model-${Date.now()}`, clientConfig: { region } });
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

export const POST = observedBrokerRoute("model.invoke", route);
