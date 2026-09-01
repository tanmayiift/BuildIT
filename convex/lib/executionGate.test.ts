import { describe, expect, it } from "vitest";
import { executionEnabled, requireExecutionEnabled, reviewRuntimeReady } from "./executionGate";

describe("repository execution release gate", () => {
  it("fails closed unless the exact reviewed value is true", () => {
    for (const value of [undefined, "", "false", "TRUE", "1"]) expect(executionEnabled(value)).toBe(false);
    expect(executionEnabled("true")).toBe(true);
    expect(() => requireExecutionEnabled()).toThrow("repository_execution_safety_blocked");
    expect(() => requireExecutionEnabled("false")).toThrow("repository_execution_safety_blocked");
    const completeRuntime = { GITHUB_APP_ID: "x", GITHUB_APP_PRIVATE_KEY: "x", BUILDIT_BROKER_URL: "x", ARTIFACT_GRANT_SECRET: "x", TRACKER_GRANT_SECRET: "x", EXECUTION_GRANT_SECRET: "x", MODEL_GRANT_SECRET: "x", FINDING_FINGERPRINT_SECRET: "x" };
    expect(reviewRuntimeReady(completeRuntime)).toBe(true);
    expect(reviewRuntimeReady({})).toBe(false);
    expect(() => requireExecutionEnabled("true", {})).toThrow("review_runtime_configuration_missing");
    expect(() => requireExecutionEnabled("true", completeRuntime)).not.toThrow();
  });
});
