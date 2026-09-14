import { describe, expect, it, vi } from "vitest";
// @ts-expect-error - executable script does not need a TypeScript build.
import { productionSurfaces, verifyWiring } from "../../scripts/verify-production-wiring.mjs";
const host = "judicious-barracuda-968.convex.cloud";
const env = { BUILDIT_EXPECTED_CONVEX_URL: `https://${host}` };
function liveResponses(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (url: string) => Response.json(url.endsWith("/api/query")
    ? { status: "success", value: { completed: 1 } }
    : { status: "available", service: url.includes("agentic-review") ? "buildit-web" : "buildit-content-broker", convexHost: host, ...overrides }));
}
describe("production wiring release gate", () => {
  it("does not treat three matching declarations as proof of live wiring", async () => {
    const invented = "https://invented-buildit-test.convex.cloud";
    const request = liveResponses();
    await expect(verifyWiring({ env: { BUILDIT_EXPECTED_CONVEX_URL: invented, BUILDIT_WEB_CONVEX_URL: invented, BUILDIT_BROKER_CONVEX_URL: invented }, request }))
      .rejects.toThrow("buildit_wiring_deployments_differ:web");
    expect(request).toHaveBeenCalledOnce();
  });
  it("reads both pinned BuildIT surfaces and checks the backend API before passing", async () => {
    const request = liveResponses();
    await expect(verifyWiring({ env, request })).resolves.toEqual({ web: host, broker: host, expected: host });
    expect(request.mock.calls.map(call => call[0])).toEqual([
      "https://buildit-agentic-review.vercel.app/api/health",
      "https://buildit-content-broker.vercel.app/api/health", `https://${host}/api/query`,
    ]);
    expect(productionSurfaces).toHaveLength(2);
  });
  it("rejects missing and unsafe configuration without echoing it or making requests", async () => {
    const request = liveResponses();
    for (const value of ["", "https://user:secret@example.com/path?token=hidden", "http://localhost", "https://evilconvex.cloud"]) {
      await expect(verifyWiring({ env: { BUILDIT_EXPECTED_CONVEX_URL: value }, request })).rejects.toThrow(/^buildit_wiring_expected_deployment_/);
    }
    expect(request).not.toHaveBeenCalled();
  });
  it("refuses stale health schemas, wrong services, errors, and unavailable backends", async () => {
    for (const overrides of [{ convexHost: undefined }, { service: "another-project" }, { status: "misconfigured" }]) {
      await expect(verifyWiring({ env, request: liveResponses(overrides) })).rejects.toThrow("buildit_wiring_probe_invalid:web");
    }
    await expect(verifyWiring({ env, request: vi.fn(async () => new Response("down", { status: 503 })) })).rejects.toThrow("buildit_wiring_probe_failed:web:503");
    const request = liveResponses();
    request.mockImplementationOnce(async () => Response.json({ status: "available", service: "buildit-web", convexHost: host }));
    request.mockImplementationOnce(async () => Response.json({ status: "available", service: "buildit-content-broker", convexHost: host }));
    request.mockImplementationOnce(async () => Response.json({ status: "error" }));
    await expect(verifyWiring({ env, request })).rejects.toThrow("buildit_wiring_backend_unverified");
  });
});
