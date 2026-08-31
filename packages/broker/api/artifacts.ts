import { S3Client } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { ArtifactBroker, S3GrantConsumer } from "../src/artifacts.js";
import { handleArtifactRequest } from "../src/artifact-http.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error("artifact_broker_configuration_missing");
  return value;
}
function report(error: unknown) { const cause = error instanceof Error && error.cause ? error.cause : error, raw = cause instanceof Error ? cause.name : typeof (cause as { name?: unknown })?.name === "string" ? String((cause as { name: string }).name) : "Unknown", allowed = new Set(["CredentialsProviderError", "AccessDenied", "AccessDeniedException", "KMSInvalidStateException", "NoSuchBucket", "PreconditionFailed", "Error"]); const status = (cause as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode; console.error(JSON.stringify({ event: "artifact_broker_unavailable", errorClass: allowed.has(raw) ? raw : "Other", ...(typeof status === "number" ? { status } : {}) })); }

async function route(request: Request) {
  try {
    const region = "eu-west-1";
    const credentials = awsCredentialsProvider({ roleArn: required("AWS_ROLE_ARN"),
      roleSessionName: `buildit-artifact-${Date.now()}`, clientConfig: { region } });
    const s3 = new S3Client({ region, credentials });
    const bucket = required("AWS_ARTIFACT_BUCKET"), kmsKeyId = required("AWS_KMS_KEY_ID");
    const replay = new S3GrantConsumer({ bucket, kmsKeyId, s3: s3 as never });
    const broker = new ArtifactBroker({ bucket, kmsKeyId, region, s3: s3 as never,
      grantSecret: Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url"),
      consumeGrant: (grantId, expiresAt) => replay.consume(grantId, expiresAt) });
    return await handleArtifactRequest(request, broker, 25_000_000, report);
  } catch (error) {
    report(error);
    return Response.json({ error: "artifact_broker_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

import { observedBrokerRoute, registerBrokerTelemetry } from "../src/instrumentation.js";

registerBrokerTelemetry();
export const GET = observedBrokerRoute("artifact.get", route);
export const PUT = observedBrokerRoute("artifact.put", route);
export const DELETE = observedBrokerRoute("artifact.delete", route);
