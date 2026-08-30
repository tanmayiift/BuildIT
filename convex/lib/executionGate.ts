export const EXECUTION_GATE_ENV = "BUILDIT_UNTRUSTED_EXECUTION_ENABLED";

export function executionEnabled(value = process.env[EXECUTION_GATE_ENV]) {
  return value === "true";
}

export function requireExecutionEnabled(value = process.env[EXECUTION_GATE_ENV]) {
  if (!executionEnabled(value)) throw new Error("repository_execution_safety_blocked");
}
