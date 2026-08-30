import { fromWebToken } from "@aws-sdk/credential-providers";
import { AwsKmsClient } from "@buildit/security";
import { ConvexCredentialGateway, CredentialBroker, handleCredentialSave } from "../src/index.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error("broker_configuration_missing");
  return value;
}

async function route(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "unauthenticated-request";
    const region = "eu-west-1";
    const gateway = new ConvexCredentialGateway(required("CONVEX_URL"), token);
    const credentials = fromWebToken({ roleArn: required("AWS_ROLE_ARN"), webIdentityToken: required("VERCEL_OIDC_TOKEN"),
      roleSessionName: `buildit-broker-${Date.now()}`, clientConfig: { region } });
    const broker = new CredentialBroker(gateway, new AwsKmsClient({ config: { region, credentials } }), required("AWS_KMS_KEY_ID"));
    return await handleCredentialSave(request, { allowedOrigin: required("BUILDIT_WEB_ORIGIN"), authorize: gateway.authorize, broker });
  } catch {
    return Response.json({ error: "broker_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export const POST = route;
export const OPTIONS = route;
