import { describe, expect, it } from "vitest";
import { executionEnabled, requireExecutionEnabled } from "./executionGate";

describe("repository execution release gate", () => {
  it("fails closed unless the exact reviewed value is true", () => {
    for (const value of [undefined, "", "false", "TRUE", "1"]) expect(executionEnabled(value)).toBe(false);
    expect(executionEnabled("true")).toBe(true);
    expect(() => requireExecutionEnabled()).toThrow("repository_execution_safety_blocked");
    expect(() => requireExecutionEnabled("false")).toThrow("repository_execution_safety_blocked");
    expect(() => requireExecutionEnabled("true")).not.toThrow();
  });
});
