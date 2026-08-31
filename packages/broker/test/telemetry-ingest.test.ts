import { describe, expect, it, vi } from "vitest";
import { handleTelemetryIngest, parseTelemetryEvent, signTelemetryEvent, verifyTelemetrySignature } from "../src/telemetry-ingest.js";

describe("signed telemetry ingest boundary", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ operation: "review.context", outcome: "succeeded", stage: "context", reviewMode: "review" });

  it("accepts only a signed allow-listed source-free event", async () => {
    const response = await handleTelemetryIngest(new Request("https://broker.invalid/telemetry", { method: "POST", headers: { "x-buildit-telemetry-signature": signTelemetryEvent(secret, body), "content-type": "application/json" }, body }), secret);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
  });

  it("accepts activation and decision events without customer identifiers", () => {
    expect(parseTelemetryEvent({ operation: "activation.preview", outcome: "succeeded", stage: "activation" })).toEqual({ operation: "activation.preview", outcome: "succeeded", stage: "activation" });
    expect(parseTelemetryEvent({ operation: "review.decision", outcome: "succeeded", stage: "decision" })).toEqual({ operation: "review.decision", outcome: "succeeded", stage: "decision" });
  });

  it("rejects altered bodies, source-like fields, and unknown labels", async () => {
    expect(verifyTelemetrySignature(secret, `${body}x`, signTelemetryEvent(secret, body))).toBe(false);
    expect(parseTelemetryEvent({ operation: "review.context", outcome: "succeeded", source: "never" })).toBeUndefined();
    expect(parseTelemetryEvent({ operation: "review.context", outcome: "succeeded", errorCode: "private_failure" })).toBeUndefined();
    const response = await handleTelemetryIngest(new Request("https://broker.invalid/telemetry", { method: "POST", headers: { "content-type": "application/json" }, body }), secret);
    expect(response.status).toBe(401);
  });

  it("never reads a request body before authenticating it", async () => {
    const text = vi.fn(async () => "{\"source\":\"private\"}");
    const request = { method: "POST", headers: new Headers(), text } as unknown as Request;
    const response = await handleTelemetryIngest(request, secret);
    expect(response.status).toBe(401);
    expect(text).not.toHaveBeenCalled();
  });
});
