import { describe, expect, it } from "vitest";
import { safeTelemetryError } from "./telemetryWorker";
import { sideEffectTelemetry } from "./reviewPublicationData";
import { webhookTelemetryOutcome } from "./githubWebhookData";

describe("durable telemetry error boundary", () => {
  it("maps worker failures to a finite safe taxonomy", () => {
    expect(safeTelemetryError(new Error("context artifact contains private source"))).toBe("UnknownError");
    expect(safeTelemetryError(new Error("stale_head"))).toBe("stale_head");
    expect(safeTelemetryError(new Error("autofix_repeated_patch"))).toBe("loop_guard");
    expect(safeTelemetryError(new Error("validation_execution_503"))).toBe("runner_error");
  });
});

describe("durable delivery telemetry", () => {
  it("maps GitHub side effects without repository or request identifiers", () => {
    expect(sideEffectTelemetry("check_update", "completed")).toEqual({ operation: "github.check", stage: "delivery", outcome: "succeeded" });
    expect(sideEffectTelemetry("stacked_pr_create", "failed")).toEqual({ operation: "github.stacked_pr", stage: "delivery", outcome: "failed" });
    expect(sideEffectTelemetry("token_revoke", "reconciled")).toEqual({ operation: "credential.revoke", stage: "delivery", outcome: "succeeded" });
  });

  it("maps webhook terminal states without a delivery identifier", () => {
    expect(webhookTelemetryOutcome("processed", "enqueued")).toEqual({ operation: "webhook.process", stage: "context", outcome: "succeeded" });
    expect(webhookTelemetryOutcome("rejected", "completed")).toEqual({ operation: "webhook.process", stage: "context", outcome: "blocked" });
    expect(webhookTelemetryOutcome("processed", "failed")).toEqual({ operation: "webhook.process", stage: "context", outcome: "failed" });
  });
});
