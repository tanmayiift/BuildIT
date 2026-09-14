import { S3Client } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { AwsKmsClient } from "@buildit/security";
import { S3GrantConsumer } from "../src/artifacts.js";
import { observedBrokerRoute, registerBrokerTelemetry } from "../src/instrumentation.js";
import { TrackerOAuthBroker } from "../src/tracker-oauth.js";
import { handleTrackerOAuth } from "../src/tracker-oauth-http.js";
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error("tracker_oauth_configuration_missing"); return value; };
async function route(request: Request) {
  try {
    const region = "eu-west-1", credentials = awsCredentialsProvider({ roleArn: required("AWS_ROLE_ARN"), roleSessionName: `buildit-tracker-oauth-${Date.now()}`, clientConfig: { region } });
    const kmsKeyId = required("AWS_KMS_KEY_ID"), kms = new AwsKmsClient({ config: { region, credentials } });
    const replay = new S3GrantConsumer({ bucket: required("AWS_ARTIFACT_BUCKET"), kmsKeyId, s3: new S3Client({ region, credentials }) as never });
    const linear = process.env.LINEAR_CLIENT_ID && process.env.LINEAR_CLIENT_SECRET ? { clientId: process.env.LINEAR_CLIENT_ID, clientSecret: process.env.LINEAR_CLIENT_SECRET } : undefined;
    const jira = process.env.JIRA_CLIENT_ID && process.env.JIRA_CLIENT_SECRET ? { clientId: process.env.JIRA_CLIENT_ID, clientSecret: process.env.JIRA_CLIENT_SECRET } : undefined;
    const broker = new TrackerOAuthBroker({ webOrigin: required("BUILDIT_WEB_ORIGIN"), ...(linear ? { linear } : {}), ...(jira ? { jira } : {}) }, kms, kmsKeyId);
    return await handleTrackerOAuth(request, { broker, grantSecret: Buffer.from(required("TRACKER_GRANT_SECRET"), "base64url"), consume: (id, expiresAt) => replay.consume(id, expiresAt) });
  } catch { return Response.json({ error: "tracker_oauth_configuration_missing" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
registerBrokerTelemetry();
export const POST = observedBrokerRoute("tracker.oauth", route);
