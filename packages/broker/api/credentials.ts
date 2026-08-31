import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { AwsKmsClient } from "@buildit/security";
import { ConvexCredentialGateway } from "../src/convex-gateway.js";
import { CredentialBroker } from "../src/index.js";
import { handleCredentialSave } from "../src/http.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error("broker_configuration_missing");
  return value;
}

// Keep production diagnostics useful without ever recording a customer key,
// bearer token, source text, or an upstream error message.
function report(error: unknown) {
  const messages: string[] = [], seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) { seen.add(current); messages.push(current.message); current = current.cause; }
  const stage = messages.find(message => /^credential_(?:authorization|provider_validation|kms_encryption|store_write|persistence)_failed$/.test(message));
  const cause = error instanceof Error && error.cause ? error.cause : error;
  const raw = cause instanceof Error ? cause.name : typeof (cause as { name?: unknown })?.name === "string"
    ? String((cause as { name: string }).name) : "Unknown";
  const allowed = new Set(["CredentialsProviderError", "AccessDenied", "AccessDeniedException", "KMSInvalidStateException", "Error"]);
  const candidate = messages.find(message => new Set(["broker_configuration_missing", "credential_gateway_configuration_invalid", "credential_store_unavailable", "invalid_key", "recent_reauthentication_required", "rate_limited", "credential_scope_already_exists"]).has(message)
    || /^credential_store_(?:401|403|404|429|5xx|invalid_result|invalid_response|network_unavailable)$/.test(message));
  const code = stage ?? candidate;
  const status = (cause as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode;
  console.error(JSON.stringify({ event: "credential_broker_unavailable", errorClass: allowed.has(raw) ? raw : "Other", ...(code ? { code } : {}), ...(typeof status === "number" ? { status } : {}) }));
}

async function route(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "unauthenticated-request";
  let runtime: Promise<{ gateway: ConvexCredentialGateway; broker: CredentialBroker }> | undefined;
  const load = () => runtime ??= Promise.resolve().then(() => {
    const region = "eu-west-1", gateway = new ConvexCredentialGateway(required("CONVEX_URL"), token);
    const credentials = awsCredentialsProvider({ roleArn: required("AWS_ROLE_ARN"),
      roleSessionName: `buildit-broker-${Date.now()}`, clientConfig: { region } });
    return { gateway, broker: new CredentialBroker(gateway, new AwsKmsClient({ config: { region, credentials } }), required("AWS_KMS_KEY_ID")) };
  });
  try {
    return await handleCredentialSave(request, { allowedOrigin: required("BUILDIT_WEB_ORIGIN"),
      authorize: async input => (await load()).gateway.authorize(input),
      broker: { save: async input => (await load()).broker.save(input) } as CredentialBroker,
      onFailure: report });
  } catch (error) {
    report(error);
    return Response.json({ error: "broker_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

import { observedBrokerRoute, registerBrokerTelemetry } from "../src/instrumentation.js";

registerBrokerTelemetry();
export const POST = observedBrokerRoute("credential.save", route);
export const OPTIONS = observedBrokerRoute("credential.preflight", route);
