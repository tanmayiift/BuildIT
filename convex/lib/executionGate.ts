export const EXECUTION_GATE_ENV = "BUILDIT_UNTRUSTED_EXECUTION_ENABLED";
export const REVIEW_RUNTIME_ENV = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "BUILDIT_BROKER_URL",
  "ARTIFACT_GRANT_SECRET",
  "TRACKER_GRANT_SECRET",
  "EXECUTION_GRANT_SECRET",
  "MODEL_GRANT_SECRET",
  "FINDING_FINGERPRINT_SECRET",
] as const;

export function executionEnabled(value = process.env[EXECUTION_GATE_ENV]) {
  return value === "true";
}

export function reviewRuntimeReady(environment: Record<string, string | undefined> = process.env) {
  return REVIEW_RUNTIME_ENV.every(name => {
    const value = environment[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function requireExecutionEnabled(value = process.env[EXECUTION_GATE_ENV], environment: Record<string, string | undefined> = process.env) {
  if (!executionEnabled(value)) throw new Error("repository_execution_safety_blocked");
  if (!reviewRuntimeReady(environment)) throw new Error("review_runtime_configuration_missing");
}
