import { S3Client } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { S3GrantConsumer } from "../src/artifacts.js";
import { handleSandboxReclaim, safeExecutionErrorCategory } from "../src/execution-http.js";
import type { SandboxCredentials } from "@buildit/runner";

// The far side of a contract that has existed, unanswered, since sandboxReclaimWorker was written.
// Vercel returned 404 for this path because the function was never created, and the worker reads a
// 404 as "there is no such sandbox" - so every reclaim reported success while both sandboxes kept
// running. The operation is `sandbox.cleanup`, which is also the telemetry name three alert rules
// were already watching and nothing had ever emitted.

function required(name: string) { const value = process.env[name]; if (!value) throw new Error("execution_broker_configuration_missing"); return value; }
function sandboxCredentials(request: Request): SandboxCredentials {
  const token = request.headers.get("x-vercel-oidc-token");
  if (!token || token.length > 16_384) throw new Error("sandbox_oidc_unavailable");
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { owner_id?: unknown; project_id?: unknown };
    if (typeof payload.owner_id !== "string" || typeof payload.project_id !== "string" || !payload.owner_id || !payload.project_id) throw new Error("invalid_claims");
    return { token, teamId: payload.owner_id, projectId: payload.project_id };
  } catch {
    throw new Error("sandbox_oidc_unavailable");
  }
}

async function route(request: Request) {
  try {
    const region = "eu-west-1";
    const credentials = awsCredentialsProvider({ roleArn: required("AWS_ROLE_ARN"), roleSessionName: `buildit-reclaim-${Date.now()}`, clientConfig: { region } });
    const s3 = new S3Client({ region, credentials }), bucket = required("AWS_ARTIFACT_BUCKET"), kmsKeyId = required("AWS_KMS_KEY_ID");
    const consume = new S3GrantConsumer({ bucket, kmsKeyId, s3: s3 as never });
    return await handleSandboxReclaim(request, { grantSecret: Buffer.from(required("EXECUTION_GRANT_SECRET"), "base64url"), consume: (id, expiresAt) => consume.consume(id, expiresAt), sandboxCredentials: sandboxCredentials(request) });
  } catch (error) {
    console.error("buildit_reclaim_broker_failure", { category: safeExecutionErrorCategory(error) });
    return Response.json({ error: "execution_broker_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

import { observedBrokerRoute, registerBrokerTelemetry } from "../src/instrumentation.js";

registerBrokerTelemetry();
export const POST = observedBrokerRoute("sandbox.cleanup", route);
