import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { AwsKmsClient } from "@buildit/security";
import { ConvexCredentialGateway } from "../src/convex-gateway.js";
import { TrackerCredentialBroker } from "../src/tracker-credentials.js";
import { handleTrackerCredentialSave } from "../src/tracker-credential-http.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error("broker_configuration_missing");
  return value;
}

async function route(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "unauthenticated-request";
  try {
    const region = "eu-west-1";
    const credentials = awsCredentialsProvider({ roleArn: required("AWS_ROLE_ARN"), roleSessionName: `buildit-tracker-save-${Date.now()}`, clientConfig: { region } });
    const gateway = new ConvexCredentialGateway(required("CONVEX_URL"), token);
    const broker = new TrackerCredentialBroker(gateway, new AwsKmsClient({ config: { region, credentials } }), required("AWS_KMS_KEY_ID"));
    return handleTrackerCredentialSave(request, { allowedOrigin: required("BUILDIT_WEB_ORIGIN"), authorize: gateway.authorize, broker });
  } catch {
    return Response.json({ error: "broker_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export const POST = route;
export const OPTIONS = route;
import { observedBrokerRoute, registerBrokerTelemetry } from "../src/instrumentation.js";

registerBrokerTelemetry();
// The compact handler above remains the sole implementation; wrap exports in the next formatting pass.
