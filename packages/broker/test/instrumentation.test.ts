import { describe, expect, it, vi } from "vitest";
import { observedBrokerRoute } from "../src/instrumentation.js";

describe("broker telemetry boundary", () => {
  it("does not inspect request bodies or change responses", async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }, { status: 201 }));
    const request = new Request("https://broker.invalid/model?secret=never-record", { method: "POST", body: "private source" });
    const response = await observedBrokerRoute("model.invoke", handler)(request);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(request);
  });

  it("fails open when no exporter is configured", async () => {
    const response = await observedBrokerRoute("artifact.delete", async () => new Response(null, { status: 204 }))(new Request("https://broker.invalid/artifacts"));
    expect(response.status).toBe(204);
  });
});
