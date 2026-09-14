import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const convexProductionTarget = Object.freeze({
  deploymentName: "judicious-barracuda-968", deploymentType: "prod",
  url: "https://judicious-barracuda-968.convex.cloud",
});

// The CLI deploy command resolves a project's default production deployment. An ambient
// dev project, deploy key or self-hosted selector must never redirect this release.
export function convexProductionEnvironment(source = process.env) {
  const keys = [source.CONVEX_DEPLOY_KEY, source.CONVEX_DEPLOYMENT_TOKEN].filter(Boolean);
  if (keys.some(key => !/^prod:judicious-barracuda-968\|[^\s|]+$/.test(key)) || new Set(keys).size > 1) {
    throw new Error("buildit_convex_deploy_key_target_refused");
  }
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith("CONVEX_")));
  env.CONVEX_DEPLOYMENT = `prod:${convexProductionTarget.deploymentName}`;
  env.NEXT_PUBLIC_CONVEX_URL = convexProductionTarget.url;
  if (keys[0]) env.CONVEX_DEPLOY_KEY = keys[0];
  return env;
}

export function assertConvexProductionTarget(value) {
  if (value?.deploymentName !== convexProductionTarget.deploymentName || value?.deploymentType !== "prod" || value?.url !== convexProductionTarget.url) {
    throw new Error("buildit_convex_production_target_refused");
  }
  return convexProductionTarget;
}

function readExistingCliAuth() {
  try { return JSON.parse(readFileSync(join(homedir(), ".convex", "config.json"), "utf8")).accessToken; }
  catch { throw new Error("buildit_convex_existing_authorization_required"); }
}

// Uses the same existing-session authorization endpoint as the installed Convex CLI.
// It creates no dashboard deploy key, returns no credential, and never logs response bodies.
export async function verifyConvexProductionTarget({ env = process.env, request = fetch, readAuth = readExistingCliAuth } = {}) {
  const selected = convexProductionEnvironment(env), deployKey = selected.CONVEX_DEPLOY_KEY;
  const token = deployKey || readAuth();
  if (!token || typeof token !== "string") throw new Error("buildit_convex_existing_authorization_required");
  const path = deployKey ? "deployment/url_for_key" : "deployment/authorize_prod";
  let response, result;
  try {
    response = await request(`https://api.convex.dev/api/${path}`, { method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(deployKey ? { deployKey } : { deploymentName: convexProductionTarget.deploymentName }),
      signal: globalThis.AbortSignal.timeout(15_000) });
  } catch { throw new Error("buildit_convex_production_target_unavailable"); }
  if (!response.ok) throw new Error(`buildit_convex_production_target_unavailable:${response.status}`);
  try { result = await response.json(); } catch { throw new Error("buildit_convex_production_target_invalid"); }
  return assertConvexProductionTarget(deployKey ? { ...convexProductionTarget, url: result } : result);
}
