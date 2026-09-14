import { builditNotificationSettings, grafanaRuleMatches, grafanaRuleFingerprint, hasBuilditNotificationContact } from "./grafana-verification.mjs";

// Grafana's converter defaults query errors to OK and cannot override that state by header.
// Keep its native graph, then explicitly save and read back the runtime error/delivery settings.
function savedRuleMatches(candidate, saved) {
  const expected = { ...candidate }, actual = { ...saved };
  // Grafana refreshes its edit timestamp and provisioning provenance on an API write.
  // Every other returned field must match, including windows, graph nodes and routing timings.
  for (const field of ["updated", "provenance"]) { delete expected[field]; delete actual[field]; }
  return grafanaRuleFingerprint(expected) === grafanaRuleFingerprint(actual);
}

export async function provisionGrafanaAlerts({ source, desired, token, base, request = fetch }) {
  if (base.origin !== "https://peacefulbumblebee2324.grafana.net" || base.pathname !== "/" || base.search || base.hash || base.username || base.password) throw new Error("buildit_grafana_stack_refused");
  if (!token) throw new Error("buildit_grafana_service_account_required");
  async function call(path, method = "GET", body, extraHeaders = {}) {
    let response;
    try {
      response = await request(new URL(path, base), { method, redirect: "error", signal: globalThis.AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${token}`, accept: "application/json", ...extraHeaders }, ...(body === undefined ? {} : { body }) });
    } catch { throw new Error("buildit_grafana_request_unavailable"); }
    if (!response.ok) throw new Error(`buildit_grafana_request_failed:${response.status}`);
    if (method === "POST") return;
    try { return await response.json(); } catch { throw new Error("buildit_grafana_response_invalid"); }
  }
  const [folders, contacts] = await Promise.all([call("/api/folders?limit=1000"), call("/api/v1/provisioning/contact-points")]);
  if (!hasBuilditNotificationContact(contacts)) throw new Error("buildit_grafana_notification_contact_required");
  const matches = Array.isArray(folders) ? folders.filter(folder => folder.title === "buildit") : [];
  if (matches.length !== 1 || !matches[0].uid) throw new Error("buildit_grafana_folder_ambiguous");
  const folderUID = matches[0].uid;
  const inScope = rule => rule.folderUID === folderUID && rule.ruleGroup === "buildit-release";
  const uniqueCurrent = deployed => {
    if (!Array.isArray(deployed)) throw new Error("buildit_grafana_inventory_invalid");
    const current = deployed.filter(inScope);
    if (current.length !== desired.length || new Set(current.map(rule => rule.uid)).size !== current.length ||
      desired.some(want => current.filter(rule => rule.title === want.alert).length !== 1)) throw new Error("buildit_grafana_managed_inventory_differs");
    return current;
  };
  // This repair only operates on the already reviewed managed group; it does not initialize
  // an unknown stack or delete an unexpected rule while converting the source file.
  uniqueCurrent(await call("/api/v1/provisioning/alert-rules"));
  await call("/api/convert/prometheus/config/v1/rules/buildit", "POST", source, {
    "content-type": "application/yaml", "x-disable-provenance": "true", "x-grafana-alerting-datasource-uid": "grafanacloud-prom",
    "x-grafana-alerting-notification-settings": JSON.stringify(builditNotificationSettings),
  });
  const converted = uniqueCurrent(await call("/api/v1/provisioning/alert-rules"));
  if (desired.some(want => !grafanaRuleMatches(want, converted.find(rule => rule.title === want.alert), false))) throw new Error("buildit_grafana_converted_definition_differs");
  const candidates = new Map();
  for (const want of desired) {
    const captured = converted.find(rule => rule.title === want.alert);
    const path = `/api/v1/provisioning/alert-rules/${encodeURIComponent(captured.uid)}`;
    const current = await call(path);
    // Re-read before each edit. Any concurrent native change must be reviewed again.
    if (grafanaRuleFingerprint(current) !== grafanaRuleFingerprint(captured)) throw new Error("buildit_grafana_rule_changed_before_update");
    const candidate = { ...current, noDataState: "OK", execErrState: "Error", notification_settings: { ...builditNotificationSettings } };
    await call(path, "PUT", JSON.stringify(candidate), { "content-type": "application/json", "x-disable-provenance": "true" });
    const saved = await call(path);
    if (saved.uid !== captured.uid || !inScope(saved) || !grafanaRuleMatches(want, saved) || !savedRuleMatches(candidate, saved)) throw new Error("buildit_grafana_rule_readback_failed");
    candidates.set(candidate.uid, candidate);
  }
  const final = uniqueCurrent(await call("/api/v1/provisioning/alert-rules"));
  if (desired.some(want => !grafanaRuleMatches(want, final.find(rule => rule.title === want.alert))) || final.some(rule => !savedRuleMatches(candidates.get(rule.uid), rule))) throw new Error("buildit_grafana_final_readback_failed");
  return { rules: final.length, receiver: builditNotificationSettings.receiver, errorState: "Error", deliveryTested: false };
}
