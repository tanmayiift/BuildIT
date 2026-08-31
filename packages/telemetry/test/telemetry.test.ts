import { describe, expect, it, vi } from "vitest";
import { safeAttributes, safeLog, traced } from "../src/index.js";
import { parseOtlpHeaders } from "../src/register.js";

describe("source-free telemetry", () => {
  it("only retains bounded allowlisted attributes", () => {
    const result = safeAttributes({ stage: "tests", outcome: "failed", errorCode: "x".repeat(200), secret: "no" } as never);
    expect(result).toEqual({ "buildit.stage": "tests", "buildit.outcome": "failed", "buildit.error_code": "other" });
    expect(JSON.stringify(result)).not.toContain("no");
  });

  it("collapses unknown operations to prevent customer-controlled metric labels", () => {
    expect(safeAttributes({ operation: "customer/repository/name" } as never)).toEqual({ "buildit.operation": "other" });
  });

  it("logs only safe fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    safeLog("review.started", { provider: "gemini", repositoryVisibility: "private" });
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]?.[0]).not.toContain("owner");
    info.mockRestore();
  });

  it("preserves task errors", async () => {
    await expect(traced("review.test", { stage: "tests" }, async () => { throw new TypeError("private value"); })).rejects.toThrow("private value");
  });

  it("preserves padded Basic-auth values required by OTLP gateways", () => {
    expect(parseOtlpHeaders("Authorization=Basic aWQ6dG9rZW4=,x-scope-orgid=42")).toEqual({
      Authorization: "Basic aWQ6dG9rZW4=",
      "x-scope-orgid": "42",
    });
  });
});
