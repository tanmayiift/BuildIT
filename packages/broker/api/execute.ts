import { S3Client } from "@aws-sdk/client-s3";
import { fromWebToken } from "@aws-sdk/credential-providers";
import { ArtifactBroker, S3GrantConsumer } from "../src/artifacts.js";
import { handleExecution } from "../src/execution-http.js";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error("execution_broker_configuration_missing"); return value; }
async function route(request: Request) {
  try {
    const region = "eu-west-1", oidcToken = request.headers.get("x-vercel-oidc-token") ?? process.env.VERCEL_OIDC_TOKEN;
    if (!oidcToken) throw new Error("execution_broker_configuration_missing");
    const credentials = fromWebToken({ roleArn: required("AWS_ROLE_ARN"), webIdentityToken: oidcToken, roleSessionName: `buildit-execution-${Date.now()}`, clientConfig: { region } });
    const s3 = new S3Client({ region, credentials }), bucket = required("AWS_ARTIFACT_BUCKET"), kmsKeyId = required("AWS_KMS_KEY_ID"), consume = new S3GrantConsumer({ bucket, kmsKeyId, s3: s3 as never });
    const artifactBroker = new ArtifactBroker({ bucket, kmsKeyId, region, s3: s3 as never, grantSecret: Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url"), consumeGrant: (id, expiresAt) => consume.consume(id, expiresAt) });
    return await handleExecution(request, { artifactBroker, grantSecret: Buffer.from(required("EXECUTION_GRANT_SECRET"), "base64url"), consume: (id, expiresAt) => consume.consume(id, expiresAt) });
  } catch { return Response.json({ error: "execution_broker_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
export const POST = route;
import { registerBrokerTelemetry } from "../src/instrumentation.js";

registerBrokerTelemetry();
