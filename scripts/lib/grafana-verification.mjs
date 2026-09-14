import { createHash } from "node:crypto";

const stackOrigin = "https://peacefulbumblebee2324.grafana.net";
const datasourceUid = "grafanacloud-prom";
export const builditNotificationSettings = Object.freeze({ receiver: "BuildIT alerts (Tanmay)" });
const unquote = value => String(value ?? "").replace(/^"(.*)"$/, "$1");
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const grafanaRuleFingerprint = value => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
// Exact identities observed in the 2026-09-14 native BuildIT export. Do not infer a
// replacement by removing spaces, folding case, or accepting a familiar title at another UID.
const legacyReplacements = new Map([
  ["afwt2cuzwjf9cd", ["BuildIT telemetry silent", "BuildITTelemetrySilent"]],
  ["ffwt2e95zmfpcc", ["BuildIT high failure rate", "BuildITHighFailureRate"]],
  ["dfwt2f4rivshsb", ["BuildIT p95 latency high", "BuildITP95LatencyHigh"]],
  ["efwt2f5a94dtsb", ["BuildIT critical boundary failure", "BuildITCriticalBoundaryFailure"]],
  ["buildit-queue-depth-high", ["BuildIT queue depth high", "BuildITQueueDepthHigh"]],
  ["buildit-provider-failure", ["BuildIT provider failure", "BuildITProviderFailure"]],
  ["buildit-runner-failure", ["BuildIT runner failure", "BuildITRunnerFailure"]],
  ["buildit-artifact-backlog", ["BuildIT artifact deletion backlog", "BuildITArtifactDeletionBacklog"]],
  ["buildit-webhook-signature", ["BuildIT webhook signature spike", "BuildITWebhookSignatureSpike"]],
  ["buildit-loop-guard", ["BuildIT loop guard trip", "BuildITLoopGuardTrip"]],
  ["buildit-stale-check", ["BuildIT stale check", "BuildITStaleCheck"]],
  ["buildit-budget-exhaustion", ["BuildIT budget exhaustion spike", "BuildITBudgetExhaustionSpike"]],
]);
function durationSeconds(value) {
  const units = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  const matches = [...String(value ?? "").matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d|w)/g)];
  if (!matches.length || matches.map(match => match[0]).join("") !== value) return NaN;
  return matches.reduce((sum, match) => sum + Number(match[1]) * units[match[2]], 0);
}
// Grafana's Prometheus converter uses these three nodes. Checking only the query text
// misses a condition changed to a constant or disconnected from the query entirely.
function convertedConditionMatches(rule, query) {
  const math = rule.data?.find(item => item.refId === "prometheus_math");
  const threshold = rule.data?.find(item => item.refId === "threshold");
  const evaluator = threshold?.model?.conditions?.[0]?.evaluator;
  return rule.condition === "threshold" && query.refId === "query" && query.model.instant === true && query.model.range === false &&
    math?.datasourceUid === "__expr__" && math.model?.type === "math" &&
    math.model.expression === "is_number($query) || is_nan($query) || is_inf($query)" &&
    threshold?.datasourceUid === "__expr__" && threshold.model?.type === "threshold" &&
    threshold.model.expression === "prometheus_math" && threshold.model.conditions?.length === 1 &&
    evaluator?.type === "gt" && evaluator.params?.length === 1 && evaluator.params[0] === 0;
}

export function grafanaRuleMatches(want, have, checkRuntime = true) {
  const query = have.data?.find(query => query.model?.expr === want.expr && query.datasourceUid === datasourceUid);
  return Boolean(query && convertedConditionMatches(have, query) && have.isPaused !== true && durationSeconds(have.for ?? "0s") === durationSeconds(want.for) &&
    have.labels?.severity === want.severity && have.labels?.service === "buildit" &&
    have.annotations?.summary === unquote(want.summary) && have.annotations?.action === unquote(want.action) &&
    have.annotations?.runbook_url === unquote(want.runbook) && (!checkRuntime ||
      (have.execErrState === "Error" && have.noDataState === "OK" && have.notification_settings?.receiver === builditNotificationSettings.receiver)));
}

export function hasBuilditNotificationContact(contactPoints) {
  return Array.isArray(contactPoints) && contactPoints.some(contact => contact.name === builditNotificationSettings.receiver &&
    contact.type === "email" && typeof contact.settings?.addresses === "string" && contact.settings.addresses.trim().length > 0 && contact.disableResolveMessage !== true);
}

export function compareGrafanaRules({ desired, deployed, folders, nowSeconds, snapshot, contactPoints }) {
  if (!Array.isArray(deployed) || !Array.isArray(folders)) throw new Error("buildit_grafana_inventory_invalid");
  const currentFolder = folders.filter(folder => folder.title === "buildit");
  const legacyFolder = folders.filter(folder => folder.title === "BuildIT");
  if (currentFolder.length !== 1 || legacyFolder.length > 1 || !currentFolder[0]?.uid || (legacyFolder.length === 1 && (!legacyFolder[0].uid || currentFolder[0].uid === legacyFolder[0].uid))) throw new Error("buildit_grafana_folder_ambiguous");
  const current = deployed.filter(rule => rule.folderUID === currentFolder[0].uid && rule.ruleGroup === "buildit-release");
  const legacy = deployed.filter(rule => legacyFolder.length === 1 && rule.folderUID === legacyFolder[0].uid && rule.ruleGroup === "BuildIT release");
  const drift = [], verified = new Set(), wanted = new Set(desired.map(rule => rule.alert));
  for (const want of desired) {
    const matches = current.filter(rule => rule.title === want.alert);
    if (matches.length !== 1) { drift.push(`inventory differs: ${want.alert}`); continue; }
    const have = matches[0];
    const matchesDefinition = grafanaRuleMatches(want, have);
    if (!matchesDefinition) drift.push(`definition differs: ${want.alert}`);
    else verified.add(want.alert);
  }
  for (const rule of current) if (!wanted.has(rule.title)) drift.push("unrecognized rule in the BuildIT managed group");
  const values = snapshot?.status === "success" && snapshot.data?.resultType === "vector" ? snapshot.data.result : [];
  const timestamp = values?.length === 1 ? Number(values[0]?.value?.[1]) : NaN;
  const ageSeconds = nowSeconds - timestamp;
  const fresh = Number.isFinite(timestamp) && timestamp > 0 && ageSeconds >= -60 && ageSeconds <= 900;
  const uidCounts = new Map();
  for (const rule of deployed) uidCounts.set(rule.uid, (uidCounts.get(rule.uid) ?? 0) + 1);
  const candidates = legacy.flatMap(rule => {
    const replacement = legacyReplacements.get(rule.uid);
    if (!replacement || replacement[0] !== rule.title || !wanted.has(replacement[1]) || uidCounts.get(rule.uid) !== 1) return [];
    return [{ uid: rule.uid, title: rule.title, folderUID: rule.folderUID, ruleGroup: rule.ruleGroup,
      fingerprint: grafanaRuleFingerprint(rule), replacementTitle: replacement[1],
      replacementUid: current.find(item => item.title === replacement[1])?.uid ?? null,
      replacementVerified: verified.has(replacement[1]), approvalRequired: true }];
  });
  const unrecognizedLegacyCount = legacy.length - candidates.length;
  const notificationReady = hasBuilditNotificationContact(contactPoints);
  return {
    readOnly: true, managedRuleCount: current.length, drift,
    telemetry: { fresh, ageSeconds: Number.isFinite(ageSeconds) ? Math.round(ageSeconds) : null },
    notifications: { receiver: builditNotificationSettings.receiver, configured: notificationReady, status: contactPoints === undefined ? "not_queried" : notificationReady ? "configured" : "missing_or_invalid", deliveryTested: false },
    legacyCandidates: candidates, unrecognizedLegacyCount,
    readyForReviewedCleanup: drift.length === 0 && fresh && notificationReady && candidates.length > 0 && unrecognizedLegacyCount === 0 && candidates.every(rule => rule.replacementVerified),
    // Legacy duplicates are still active even when every replacement matches.
    verified: drift.length === 0 && fresh && notificationReady && legacy.length === 0,
  };
}

// UI group exports contain native graphs but not folder UIDs, the complete folder inventory,
// or telemetry samples. Their fingerprints describe exported rule objects, not API responses.
export function compareGrafanaExportGroups({ desired, currentExport, legacyExport }) {
  function group(document, folder, name) {
    const matches = document?.groups?.filter(item => item.folder === folder && item.name === name);
    if (!Array.isArray(matches) || matches.length !== 1 || !Array.isArray(matches[0].rules)) throw new Error("buildit_grafana_export_group_ambiguous");
    return matches[0];
  }
  const current = group(currentExport, "buildit", "buildit-release"), legacy = group(legacyExport, "BuildIT", "BuildIT release");
  const asNative = (exported, folderUID) => exported.rules.map(rule => ({ ...rule, for: rule.for ?? "0s", folderUID, ruleGroup: exported.name }));
  const report = compareGrafanaRules({ desired, deployed: [...asNative(current, "export-current"), ...asNative(legacy, "export-legacy")],
    folders: [{ uid: "export-current", title: "buildit" }, { uid: "export-legacy", title: "BuildIT" }], nowSeconds: NaN });
  return { readOnly: true, evidenceKind: "native_ui_group_exports", managedRuleCount: report.managedRuleCount,
    drift: report.drift, currentDefinitionsMatch: report.drift.length === 0,
    telemetry: { status: "not_queried", fresh: null, ageSeconds: null },
    notifications: report.notifications,
    folderUIDsVerified: false, fullStackInventoryVerified: false,
    legacyCandidates: report.legacyCandidates.map(candidate => ({ uid: candidate.uid, title: candidate.title,
      folderTitle: legacy.folder, ruleGroup: legacy.name, replacementTitle: candidate.replacementTitle,
      replacementUid: candidate.replacementUid, replacementDefinitionMatchesExport: candidate.replacementVerified,
      exportFingerprint: grafanaRuleFingerprint(legacy.rules.find(rule => rule.uid === candidate.uid)),
      fingerprintFormat: "sha256-canonical-grafana-ui-export-rule-v1", approvalRequired: true })),
    unrecognizedLegacyCount: report.unrecognizedLegacyCount, readyForReviewedCleanup: false, verified: false };
}

export async function readGrafanaEvidence({ desired, token, base = new URL(stackOrigin), request = fetch, nowSeconds = Date.now() / 1000 }) {
  if (base.origin !== stackOrigin || base.pathname !== "/" || base.search || base.hash || base.username || base.password) {
    throw new Error("buildit_grafana_stack_refused");
  }
  if (!token) throw new Error("buildit_grafana_verification_required");
  async function read(path) {
    let response;
    try {
      response = await request(new URL(path, base), {
        method: "GET", redirect: "error", headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: globalThis.AbortSignal.timeout(15_000),
      });
    } catch { throw new Error("buildit_grafana_read_unavailable"); }
    if (!response.ok) throw new Error(`buildit_grafana_read_failed:${response.status}`);
    try { return await response.json(); } catch { throw new Error("buildit_grafana_response_invalid"); }
  }
  const [deployed, folders, snapshot, contactPoints] = await Promise.all([
    read("/api/v1/provisioning/alert-rules"),
    read("/api/folders?limit=1000"),
    read(`/api/datasources/proxy/uid/${datasourceUid}/api/v1/query?query=${encodeURIComponent("max(timestamp(buildit_snapshot))")}`),
    read("/api/v1/provisioning/contact-points"),
  ]);
  return compareGrafanaRules({ desired, deployed, folders, nowSeconds, snapshot, contactPoints });
}
