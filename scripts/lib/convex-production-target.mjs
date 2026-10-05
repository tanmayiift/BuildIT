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
  // Surrounding whitespace is dropped first: a key pasted into a repository secret with its trailing
  // newline would otherwise be refused outright. The first GitHub release (5 Oct 2026) was refused
  // here with no reason given, which is why the refusal below now names one.
  const keys = [source.CONVEX_DEPLOY_KEY, source.CONVEX_DEPLOYMENT_TOKEN].map(key => key?.trim()).filter(Boolean);
  // The refusal names which rule failed - never any part of the key - so whoever holds the key knows
  // whether to fix how it was pasted or to issue a production key for this deployment.
  if (new Set(keys).size > 1) throw new Error("buildit_convex_deploy_key_target_refused:two_different_keys");
  for (const key of keys) {
    if (/^prod:judicious-barracuda-968\|[^\s|]+$/.test(key)) continue;
    const reason = !key.startsWith("prod:") ? "not_a_production_deploy_key"
      : !key.startsWith(`prod:${convexProductionTarget.deploymentName}|`) ? "key_for_another_deployment" : "malformed_key";
    throw new Error(`buildit_convex_deploy_key_target_refused:${reason}`);
  }
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith("CONVEX_")));
  env.NEXT_PUBLIC_CONVEX_URL = convexProductionTarget.url;
  // With a deploy key the key is the selector - it names exactly one deployment, checked above. Also
  // setting CONVEX_DEPLOYMENT made the CLI look that deployment up as a signed-in user, which on a
  // GitHub runner has no login: the first push release got `401 MissingAccessToken` from
  // team_and_project after the broker had already shipped. Without a key, a local release keeps the
  // explicit selector and the operator's own login.
  if (keys[0]) env.CONVEX_DEPLOY_KEY = keys[0];
  else env.CONVEX_DEPLOYMENT = `prod:${convexProductionTarget.deploymentName}`;
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
