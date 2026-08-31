import { describe, expect, it } from "vitest";
import { safeTelemetryError } from "./telemetryWorker";

describe("durable telemetry error boundary", () => {
  it("maps worker failures to a finite safe taxonomy", () => {
    expect(safeTelemetryError(new Error("context artifact contains private source"))).toBe("UnknownError");
    expect(safeTelemetryError(new Error("stale_head"))).toBe("stale_head");
    expect(safeTelemetryError(new Error("autofix_repeated_patch"))).toBe("loop_guard");
    expect(safeTelemetryError(new Error("validation_execution_503"))).toBe("runner_error");
  });
});
