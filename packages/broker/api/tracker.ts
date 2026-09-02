import { S3Client } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { AwsKmsClient } from "@buildit/security";
import { S3GrantConsumer } from "../src/artifacts.js";
import { handleTrackerFetch } from "../src/tracker-http.js";
import { observedBrokerRoute, registerBrokerTelemetry } from "../src/instrumentation.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error("tracker_broker_configuration_missing");
  return value;
}

const route = async (request: Request) => {
  try {
    const region = "eu-west-1";
    const credentials = awsCredentialsProvider({ roleArn: required("AWS_ROLE_ARN"), roleSessionName: `buildit-tracker-${Date.now()}`, clientConfig: { region } });
    const bucket = required("AWS_ARTIFACT_BUCKET"), kmsKeyId = required("AWS_KMS_KEY_ID");
    const s3 = new S3Client({ region, credentials });
    const replay = new S3GrantConsumer({ bucket, kmsKeyId, s3: s3 as never });
    const kms = new AwsKmsClient({ config: { region, credentials } });
    return handleTrackerFetch(request, { grantSecret: Buffer.from(required("TRACKER_GRANT_SECRET"), "base64url"), consume: (id, expiresAt) => replay.consume(id, expiresAt), kms, kmsKeyId });
  } catch {
    return Response.json({ error: "tracker_broker_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
};
registerBrokerTelemetry();
export const POST = observedBrokerRoute("tracker.fetch", route);
