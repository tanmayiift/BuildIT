import { S3Client } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { ArtifactBroker, S3GrantConsumer } from "../src/artifacts.js";
import { handleExecution, safeExecutionErrorCategory } from "../src/execution-http.js";
import type { SandboxCredentials } from "@buildit/runner";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error("execution_broker_configuration_missing"); return value; }
function sandboxCredentials(request: Request): SandboxCredentials {
  const token = request.headers.get("x-vercel-oidc-token");
  if (!token || token.length > 16_384) throw new Error("sandbox_oidc_unavailable");
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { owner_id?: unknown; project_id?: unknown };
    if (typeof payload.owner_id !== "string" || typeof payload.project_id !== "string" || !payload.owner_id || !payload.project_id) throw new Error("invalid_claims");
    // A console.log of owner_id, project_id and iss stood here to diagnose "Hobby plan usage limit
    // exceeded" while the owning team was believed to be on Pro. Those are BuildIT's own Vercel
    // identifiers rather than customer data, so it was never a disclosure - but it was the one
    // logging site in the broker writing raw object fields outside safeLog, and the question it
    // answered is settled. Removed rather than left as precedent: the next diagnostic goes through
    // safeLog, which bounds its own field names.
    return { token, teamId: payload.owner_id, projectId: payload.project_id };
  } catch {
    throw new Error("sandbox_oidc_unavailable");
  }
}
async function route(request: Request) {
  try {
    const region = "eu-west-1";
    const credentials = awsCredentialsProvider({ roleArn: required("AWS_ROLE_ARN"), roleSessionName: `buildit-execution-${Date.now()}`, clientConfig: { region } });
    const s3 = new S3Client({ region, credentials }), bucket = required("AWS_ARTIFACT_BUCKET"), kmsKeyId = required("AWS_KMS_KEY_ID"), consume = new S3GrantConsumer({ bucket, kmsKeyId, s3: s3 as never });
    const artifactBroker = new ArtifactBroker({ bucket, kmsKeyId, region, s3: s3 as never, grantSecret: Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url"), consumeGrant: (id, expiresAt) => consume.consume(id, expiresAt) });
    return await handleExecution(request, { artifactBroker, grantSecret: Buffer.from(required("EXECUTION_GRANT_SECRET"), "base64url"), consume: (id, expiresAt) => consume.consume(id, expiresAt), sandboxCredentials: sandboxCredentials(request) });
  } catch (error) {
    console.error("buildit_execute_broker_failure", { category: safeExecutionErrorCategory(error) });
    return Response.json({ error: "execution_broker_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
import { observedBrokerRoute, registerBrokerTelemetry } from "../src/instrumentation.js";

registerBrokerTelemetry();
export const POST = observedBrokerRoute("sandbox.execute", route);
