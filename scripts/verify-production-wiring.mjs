#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Only BuildIT production surfaces: declared environment values cannot supply the answer.
export const productionSurfaces = Object.freeze([
  { name: "web", service: "buildit-web", url: "https://buildit-agentic-review.vercel.app/api/health" },
  { name: "broker", service: "buildit-content-broker", url: "https://buildit-content-broker.vercel.app/api/health" },
]);
function deploymentHost(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
        url.pathname === "/" && !url.search && !url.hash &&
        /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.convex\.cloud$/.test(url.hostname)) return url.hostname;
  } catch {}
  throw new Error("buildit_wiring_expected_deployment_invalid");
}
export async function verifyWiring({ env = process.env, request = fetch } = {}) {
  if (!env.BUILDIT_EXPECTED_CONVEX_URL) throw new Error("buildit_wiring_expected_deployment_required");
  const expectedHost = deploymentHost(env.BUILDIT_EXPECTED_CONVEX_URL);
  const observed = {};
  for (const surface of productionSurfaces) {
    let response;
    try {
      response = await request(surface.url, { redirect: "error", cache: "no-store", signal: globalThis.AbortSignal.timeout(8_000) });
    } catch { throw new Error(`buildit_wiring_probe_unavailable:${surface.name}`); }
    if (!response.ok) throw new Error(`buildit_wiring_probe_failed:${surface.name}:${response.status}`);
    const body = await response.json().catch(() => undefined);
    if (body?.service !== surface.service || body?.status !== "available" || typeof body.convexHost !== "string") {
      throw new Error(`buildit_wiring_probe_invalid:${surface.name}`);
    }
    if (body.convexHost !== expectedHost) throw new Error(`buildit_wiring_deployments_differ:${surface.name}`);
    observed[surface.name] = body.convexHost;
  }
  // Health proves configuration; a read-only query proves this backend serves the public API.
  let response;
  try {
    response = await request(`https://${expectedHost}/api/query`, {
      method: "POST", redirect: "error", signal: globalThis.AbortSignal.timeout(8_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "publicProof:summary", args: {}, format: "json" }),
    });
  } catch { throw new Error("buildit_wiring_backend_unavailable"); }
  const body = await response.json().catch(() => undefined);
  if (!response.ok || body?.status !== "success" || !body.value || typeof body.value !== "object") {
    throw new Error("buildit_wiring_backend_unverified");
  }
  return { ...observed, expected: expectedHost };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  verifyWiring().then(result => {
    for (const [name, host] of Object.entries(result)) console.log(`${name}=${host}`);
    console.log("BuildIT live production wiring matches.");
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
