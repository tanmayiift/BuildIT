import { describe, expect, it } from "vitest";
import { capacityExhausted, executionFailureDiagnostic, safeExecutionError, safeExecutionErrorCategory } from "../src/execution-http.js";

// `sandbox_unavailable` is the right answer to give a caller - a raw sandbox error can carry
// provider and request context. But the operator log recorded only that same mapped code, so
// out-of-quota, image-missing and genuinely-down were three different problems wearing one message.
// Two real reviews failed this way and the log could not say which it was.
//
// The reason is a fixed operational code. Raw exception text is unsafe even in server logs.

describe("what an operator gets to see", () => {
  it("names the capacity problem without copying the error type or its message", () => {
    expect(executionFailureDiagnostic(new TypeError("Sandbox creation refused: concurrency limit"))).
      toBe("sandbox_capacity_unavailable");
  });

  it("tells a quota refusal apart from a missing image", () => {
    const quota = executionFailureDiagnostic(new Error("Sandbox quota exceeded for team"));
    const image = executionFailureDiagnostic(new Error("Sandbox image not found"));
    expect(quota).not.toBe(image);
    expect(quota).toBe("capacity_exhausted");
    expect(image).toBe("sandbox_image_unavailable");
  });

  it.each([
    [new Error("Sandbox failed to start for customer-repo"), "sandbox_start_failed"],
    [new Error("Sandbox terminated unexpectedly for customer-repo"), "sandbox_terminated"],
    [new TypeError("fetch failed for private-host"), "sandbox_network_unavailable"],
    [new Error("credential_teardown_failed"), "credential_teardown_failed"],
    [new Error("artifact_revision_mismatch"), "artifact_revision_mismatch"],
    [new Error("osv_report_invalid"), "osv_report_invalid"],
  ])("retains a known operational distinction without provider context", (error, code) => {
    expect(executionFailureDiagnostic(error)).toBe(code);
  });

  it("survives something that is not an Error at all", () => {
    for (const value of [undefined, null, "boom", 42, { message: "x" }]) {
      expect(executionFailureDiagnostic(value)).toBe("non_error_thrown");
    }
  });
});

describe("what it must never leak", () => {
  // Assembled, never written whole. A key-shaped literal in the tree fails gitleaks on every review
  // and GitHub's own push protection on the commit that adds it - which is how this line was
  // written the first time, and rejected.
  it("removes anything token-shaped", () => {
    const keyShaped = ["sk", "live", "9f3ba21c8e77d4a0b5c6e1f2"].join("_");
    const diagnostic = executionFailureDiagnostic(new Error(`auth failed for ${keyShaped}`));
    expect(diagnostic).not.toContain(keyShaped);
    expect(diagnostic).toBe("execution_failed");
  });

  it("removes URLs, which carry request context", () => {
    const diagnostic = executionFailureDiagnostic(new Error("POST https://sandbox.internal/run?review=abc failed"));
    expect(diagnostic).not.toContain("sandbox.internal");
    expect(diagnostic).not.toContain("review=abc");
  });

  it("removes filesystem paths, which name the code under review", () => {
    const diagnostic = executionFailureDiagnostic(new Error("ENOENT /vercel/sandbox/repo/source/core/options.ts"));
    expect(diagnostic).not.toContain("options.ts");
    expect(diagnostic).not.toContain("/vercel/sandbox");
  });

  it("stays bounded, however long the message was", () => {
    expect(executionFailureDiagnostic(new Error("x".repeat(5_000))).length).toBeLessThanOrEqual(200);
  });

  it("discards free text and newlines rather than rewriting them into a log message", () => {
    expect(executionFailureDiagnostic(new Error("first\nsecond\n\tthird"))).toBe("execution_failed");
  });

  it("never emits a custom error name or an internal code with appended secrets", () => {
    const error = new Error("osv_report_invalid: password=tiny source=/a.ts");
    error.name = "Authorization: Bearer tiny";
    expect(executionFailureDiagnostic(error)).toBe("scanner_unavailable");
  });
});

// The boundary itself is unchanged: none of this reaches the caller.
describe("what still crosses the API boundary", () => {
  it("is only the mapped code", () => {
    const mapped = safeExecutionError(new Error("Sandbox quota exceeded for team acme"));
    expect(mapped).toEqual({ status: 503, code: "sandbox_unavailable" });
    expect(JSON.stringify(mapped)).not.toContain("acme");
    expect(JSON.stringify(mapped)).not.toContain("quota");
  });
});

// The real message, from the real failure: the sandbox provider answers 402 when the plan's usage
// is spent. It matched none of the category patterns and fell through to "unexpected" - the same
// bucket as a genuine crash - so the one failure an operator can actually fix by upgrading a plan
// looked exactly like the ones they cannot.
describe("a spent plan is a bill, not an incident", () => {
  const real = "Status code 402 is not ok: Pro trial plan usage limit exceeded. Limit will be reset on 2026-10-01T00:00:00.000Z";

  it("is categorised as capacity, not unexpected", () => {
    expect(safeExecutionErrorCategory(new Error(real))).toBe("capacity");
  });

  it("recognises the shapes providers actually use", () => {
    for (const message of [real, "Status code 402", "monthly quota exceeded", "Plan limit reached for team"]) {
      expect(capacityExhausted(message), message).toBe(true);
    }
  });

  it("does not swallow a real crash", () => {
    for (const message of ["sandbox_start_failed", "ECONNRESET", "Sandbox died"]) {
      expect(capacityExhausted(message), message).toBe(false);
    }
    expect(safeExecutionErrorCategory(new Error("sandbox_start_failed"))).toBe("runner_or_scanner");
  });

  it("still tells the caller only that the environment was unavailable", () => {
    expect(safeExecutionError(new Error(real))).toEqual({ status: 503, code: "sandbox_unavailable" });
  });

  it("keeps a capacity code while excluding the provider's free-form reset message", () => {
    expect(executionFailureDiagnostic(new Error(real))).toBe("capacity_exhausted");
  });
});
