#!/usr/bin/env node

const rawBase = process.env.BUILDIT_BROKER_URL ?? process.argv[2];
if (!rawBase) throw new Error("usage: BUILDIT_BROKER_URL=https://deployment.vercel.app node scripts/verify-broker-boundary.mjs");
const base = new URL(rawBase);
if (base.protocol !== "https:" || !/^buildit-content-broker(?:-[a-z0-9-]+)?\.vercel\.app$/.test(base.hostname)) throw new Error("broker_target_invalid");
base.pathname = base.pathname.replace(/\/$/, "");

const request = async (path, init = {}) => {
  const response = await fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(15_000), redirect: "error" });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  return { response, body, text };
};
const requireTrue = (condition, code) => { if (!condition) throw new Error(code); };
const safeHeaders = (response) => {
  requireTrue(response.headers.get("cache-control")?.includes("no-store"), "broker_cache_control_missing");
  requireTrue(response.headers.get("x-content-type-options") === "nosniff", "broker_nosniff_missing");
};

const health = await request("/health.json");
requireTrue(health.response.status === 200, "broker_health_failed");
requireTrue(health.body?.service === "buildit-content-broker" && health.body?.status === "available", "broker_health_contract_invalid");

const unauthorized = [
  ["artifact", "/api/artifacts", { method: "GET" }],
  ["model", "/api/model", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ["execution", "/api/execute", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
];
const results = [];
for (const [name, path, init] of unauthorized) {
  const result = await request(path, init);
  requireTrue(result.response.status === 401, `${name}_authentication_boundary_failed`);
  requireTrue(result.body?.error === "authentication_required", `${name}_safe_error_failed`);
  safeHeaders(result.response);
  results.push({ name, status: result.response.status, error: result.body.error });
}

const credential = await request("/api/credentials", {
  method: "POST",
  headers: { origin: "https://untrusted.invalid", "content-type": "application/json" },
  body: JSON.stringify({ organizationId: "probe-organization", provider: "gemini", apiKey: "never-a-real-provider-key" }),
});
requireTrue(credential.response.status === 403 && credential.body?.error === "origin_not_allowed", "credential_origin_boundary_failed");
safeHeaders(credential.response);
results.push({ name: "credential", status: credential.response.status, error: credential.body.error });

process.stdout.write(`${JSON.stringify({ status: "passed", target: base.hostname, health: health.body, boundaries: results })}\n`);
