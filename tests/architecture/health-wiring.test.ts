import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as webHealth } from "../../apps/web/src/app/api/health/route";
import { GET as brokerHealth } from "../../packages/broker/api/health";
afterEach(() => vi.unstubAllEnvs());
describe("source-free live wiring health", () => {
  for (const [name, variable, route] of [["web", "NEXT_PUBLIC_CONVEX_URL", webHealth], ["broker", "CONVEX_URL", brokerHealth]] as const) {
    it(`${name} reports only its configured public backend hostname`, async () => {
      vi.stubEnv(variable, "https://buildit-test.convex.cloud");
      const response = route();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ convexHost: "buildit-test.convex.cloud" });
    });
    it(`${name} refuses unsafe metadata rather than echoing credentials`, async () => {
      for (const value of ["", "https://secret:password@buildit-test.convex.cloud", "https://buildit-test.convex.cloud?token=hidden"]) {
        vi.stubEnv(variable, value);
        const response = route();
        expect(response.status).toBe(503);
        expect(await response.text()).not.toMatch(/secret|password|hidden|convexHost/);
      }
    });
  }
});
