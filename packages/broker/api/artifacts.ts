import { S3Client } from "@aws-sdk/client-s3";
import { fromWebToken } from "@aws-sdk/credential-providers";
import { ArtifactBroker, handleArtifactRequest, S3GrantConsumer } from "../src/index.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error("artifact_broker_configuration_missing");
  return value;
}
function report(error: unknown) { const raw = error instanceof Error ? error.name : "Unknown", allowed = new Set(["CredentialsProviderError", "AccessDenied", "AccessDeniedException", "KMSInvalidStateException", "NoSuchBucket", "Error"]); const status = (error as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode; console.error(JSON.stringify({ event: "artifact_broker_unavailable", errorClass: allowed.has(raw) ? raw : "Other", ...(typeof status === "number" ? { status } : {}) })); }

async function route(request: Request) {
  try {
    const region = "eu-west-1";
    const oidcToken = request.headers.get("x-vercel-oidc-token") ?? process.env.VERCEL_OIDC_TOKEN;
    if (!oidcToken) throw new Error("artifact_broker_configuration_missing");
    const credentials = fromWebToken({ roleArn: required("AWS_ROLE_ARN"), webIdentityToken: oidcToken,
      roleSessionName: `buildit-artifact-${Date.now()}`, clientConfig: { region } });
    const s3 = new S3Client({ region, credentials });
    const bucket = required("AWS_ARTIFACT_BUCKET"), kmsKeyId = required("AWS_KMS_KEY_ID");
    const replay = new S3GrantConsumer({ bucket, kmsKeyId, s3: s3 as never });
    const broker = new ArtifactBroker({ bucket, kmsKeyId, region, s3: s3 as never,
      grantSecret: Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url"),
      consumeGrant: (grantId, expiresAt) => replay.consume(grantId, expiresAt) });
    return await handleArtifactRequest(request, broker);
  } catch (error) {
    report(error);
    return Response.json({ error: "artifact_broker_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export const GET = route;
export const PUT = route;
export const DELETE = route;
