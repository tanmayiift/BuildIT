import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { assertConvexProductionTarget, convexProductionEnvironment, convexProductionTarget, verifyConvexProductionTarget } from "../../scripts/lib/convex-production-target.mjs";
import { runCoordinatedDeployment } from "../../scripts/deploy-buildit-production.mjs";

describe("dedicated Convex production release target", () => {
  it("isolates the production CLI from local and inherited deployment selectors", () => {
    expect(convexProductionEnvironment({ PATH: "/bin", VERCEL_TOKEN: "fake-vercel", CONVEX_DEPLOYMENT: "dev:another-project",
      CONVEX_SELF_HOSTED_URL: "http://localhost:3218", CONVEX_SELF_HOSTED_ADMIN_KEY: "fake-admin",
      CONVEX_PROVISION_HOST: "https://example.invalid", CONVEX_OVERRIDE_ACCESS_TOKEN: "fake-override",
      NEXT_PUBLIC_CONVEX_URL: "https://example.invalid" })).toEqual({ PATH: "/bin", VERCEL_TOKEN: "fake-vercel",
      CONVEX_DEPLOYMENT: "prod:judicious-barracuda-968", NEXT_PUBLIC_CONVEX_URL: convexProductionTarget.url });
    expect(readFileSync("scripts/buildit-production.env", "utf8").split("\n").filter(line => line && !line.startsWith("#")))
      .toEqual(["CONVEX_DEPLOYMENT=prod:judicious-barracuda-968"]);
  });
  it("rejects wrong, dev, preview and ambiguous deployment keys without showing a key", () => {
    for (const key of ["prod:unrelated|fake-secret", "dev:judicious-barracuda-968|fake-secret", "preview:team:project|fake-secret", "opaque-secret"]) {
      expect(() => convexProductionEnvironment({ CONVEX_DEPLOY_KEY: key })).toThrow("buildit_convex_deploy_key_target_refused");
    }
    expect(() => convexProductionEnvironment({ CONVEX_DEPLOY_KEY: "prod:judicious-barracuda-968|a", CONVEX_DEPLOYMENT_TOKEN: "prod:judicious-barracuda-968|b" }))
      .toThrow("buildit_convex_deploy_key_target_refused");
  });
  it("verifies exact server deployment name, type and URL", () => {
    expect(assertConvexProductionTarget(convexProductionTarget)).toEqual(convexProductionTarget);
    for (const change of [{ deploymentName: "other" }, { deploymentType: "dev" }, { url: "https://other.convex.cloud" }, { url: "https://judicious-barracuda-968.convex.cloud.attacker.invalid" }]) {
      expect(() => assertConvexProductionTarget({ ...convexProductionTarget, ...change })).toThrow("buildit_convex_production_target_refused");
    }
  });
  it("uses the pinned existing-session endpoint and returns no session credential", async () => {
    const request = vi.fn(async () => Response.json({ ...convexProductionTarget, adminKey: "never-return-this" }));
    expect(await verifyConvexProductionTarget({ env: {}, request, readAuth: () => "fake-session" })).toEqual(convexProductionTarget);
    expect(request).toHaveBeenCalledWith("https://api.convex.dev/api/deployment/authorize_prod", expect.objectContaining({ method: "POST", redirect: "error",
      body: JSON.stringify({ deploymentName: "judicious-barracuda-968" }) }));
  });
  it("verifies a correctly named deploy key's server URL without reading CLI credentials", async () => {
    const readAuth = vi.fn(), request = vi.fn(async () => Response.json(convexProductionTarget.url));
    expect(await verifyConvexProductionTarget({ env: { CONVEX_DEPLOYMENT_TOKEN: "prod:judicious-barracuda-968|fake" }, request, readAuth })).toEqual(convexProductionTarget);
    expect(readAuth).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("https://api.convex.dev/api/deployment/url_for_key", expect.objectContaining({ redirect: "error" }));
  });
  it("fails on missing credentials, invalid response, and request failure without leaking provider text", async () => {
    await expect(verifyConvexProductionTarget({ env: {}, readAuth: () => undefined })).rejects.toThrow("buildit_convex_existing_authorization_required");
    for (const request of [async () => { throw new Error("private response secret"); }, async () => new Response("private response secret", { status: 403 }), async () => new Response("private response secret")]) {
      try { await verifyConvexProductionTarget({ env: {}, readAuth: () => "fake", request }); throw new Error("expected rejection"); }
      catch (error) { expect(String(error)).toMatch(/buildit_convex_production_target_(unavailable|invalid)/); expect(String(error)).not.toContain("private response secret"); }
    }
  });
  it("stops before the broker when server production selection differs", async () => {
    const runStep = vi.fn();
    await expect(runCoordinatedDeployment({ runStep, verifyBroker: vi.fn(), verifyConvex: async () => { throw new Error("wrong production"); } })).rejects.toThrow("wrong production");
    expect(runStep).not.toHaveBeenCalled();
  });
  it("rechecks immediately before Convex and stops if the default changed during broker release", async () => {
    const completed: string[] = [];
    let attempts = 0;
    await expect(runCoordinatedDeployment({ runStep: async (step: { name: string }) => { completed.push(step.name); }, verifyBroker: async () => { completed.push("broker-verified"); },
      verifyConvex: async () => { attempts++; if (attempts === 2) throw new Error("production changed"); } })).rejects.toThrow("production changed");
    expect(completed).toEqual(["broker", "broker-verified"]);
    expect(attempts).toBe(2);
  });
});
