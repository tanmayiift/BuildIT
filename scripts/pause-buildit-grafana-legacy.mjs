// Pause only the eight exact legacy duplicates reviewed for BuildIT on 2026-09-14.
// The UI cannot edit provisioned rules, so this uses Grafana's provisioning API. It refuses
// every other stack, folder, group, title, or UID and reads each rule back after the write.
//
//   read -rs BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN && export BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN
//   pnpm alerts:pause-legacy --dry-run
//   pnpm alerts:pause-legacy

const expectedHost = "peacefulbumblebee2324.grafana.net";
const base = new URL(process.env.BUILDIT_GRAFANA_URL ?? `https://${expectedHost}`);
if (base.protocol !== "https:" || base.hostname !== expectedHost || base.username || base.password || base.port || base.pathname !== "/" || base.search || base.hash) {
  throw new Error("buildit_grafana_stack_refused");
}
const token = process.env.BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN;
if (!token) throw new Error("buildit_grafana_service_account_required");

const exact = new Map([
  ["dfwt2f4rivshsb", "BuildIT p95 latency high"],
  ["efwt2f5a94dtsb", "BuildIT critical boundary failure"],
  ["buildit-queue-depth-high", "BuildIT queue depth high"],
  ["buildit-artifact-backlog", "BuildIT artifact deletion backlog"],
  ["buildit-webhook-signature", "BuildIT webhook signature spike"],
  ["buildit-loop-guard", "BuildIT loop guard trip"],
  ["buildit-stale-check", "BuildIT stale check"],
  ["buildit-budget-exhaustion", "BuildIT budget exhaustion spike"],
]);

async function call(path, method = "GET", body) {
  let response;
  try {
    response = await fetch(new URL(path, base), {
      method, redirect: "error", signal: globalThis.AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { throw new Error("buildit_grafana_request_unavailable"); }
  if (!response.ok) throw new Error(`buildit_grafana_request_failed:${response.status}`);
  if (method === "PUT") return response.json();
  try { return await response.json(); } catch { throw new Error("buildit_grafana_response_invalid"); }
}

const folders = await call("/api/folders?limit=1000");
const folder = Array.isArray(folders) ? folders.filter(item => item.title === "BuildIT") : [];
if (folder.length !== 1 || !folder[0].uid) throw new Error("buildit_grafana_legacy_folder_ambiguous");
const deployed = await call("/api/v1/provisioning/alert-rules");
if (!Array.isArray(deployed)) throw new Error("buildit_grafana_inventory_invalid");
const scoped = deployed.filter(rule => rule.folderUID === folder[0].uid && rule.ruleGroup === "BuildIT release");
const candidates = [...exact].map(([uid, title]) => {
  const matches = scoped.filter(rule => rule.uid === uid && rule.title === title);
  if (matches.length !== 1) throw new Error(`buildit_grafana_legacy_rule_mismatch:${uid}`);
  return matches[0];
});
if (candidates.length !== exact.size) throw new Error("buildit_grafana_legacy_rule_count_mismatch");

if (process.argv.includes("--dry-run")) {
  console.log(`buildit_grafana_legacy_pause_ready folder=${folder[0].uid} rules=${candidates.length} writes=0`);
  process.exit(0);
}

for (const candidate of candidates) {
  const path = `/api/v1/provisioning/alert-rules/${encodeURIComponent(candidate.uid)}`;
  const current = await call(path);
  if (current.folderUID !== folder[0].uid || current.ruleGroup !== "BuildIT release" || current.title !== exact.get(candidate.uid)) throw new Error(`buildit_grafana_legacy_rule_changed:${candidate.uid}`);
  if (current.isPaused === true) continue;
  const saved = await call(path, "PUT", { ...current, isPaused: true });
  if (saved.uid !== candidate.uid || saved.isPaused !== true) throw new Error(`buildit_grafana_legacy_pause_readback_failed:${candidate.uid}`);
}

const final = await call("/api/v1/provisioning/alert-rules");
const paused = final.filter(rule => exact.has(rule.uid) && rule.folderUID === folder[0].uid && rule.ruleGroup === "BuildIT release" && rule.isPaused === true);
if (paused.length !== exact.size) throw new Error(`buildit_grafana_legacy_pause_count_failed:${paused.length}`);
console.log(`buildit_grafana_legacy_paused folder=${folder[0].uid} rules=${paused.length}`);
