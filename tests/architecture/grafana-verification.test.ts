import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-expect-error - executable scripts do not need a build.
import { compareGrafanaRules, compareGrafanaExportGroups, readGrafanaEvidence } from "../../scripts/lib/grafana-verification.mjs";
const desired = [{ alert: "BuildITTelemetrySilent", expr: "max(absent_over_time(buildit_snapshot[15m]) or vector(0)) > 0.5", for: "5m", severity: "ticket", summary: '"No snapshots"', action: '"Check the cron"', runbook: '"https://example.invalid/runbook"' }];
const current = { noDataState: "OK", execErrState: "Error", notification_settings: { receiver: "BuildIT alerts (Tanmay)" }, uid: "current", folderUID: "managed", ruleGroup: "buildit-release", title: "BuildITTelemetrySilent", for: "5m", labels: { severity: "ticket", service: "buildit" }, annotations: { summary: "No snapshots", action: "Check the cron", runbook_url: "https://example.invalid/runbook" }, condition: "threshold", data: [
  { refId: "query", datasourceUid: "grafanacloud-prom", model: { expr: desired[0]!.expr, instant: true, range: false } },
  { refId: "prometheus_math", datasourceUid: "__expr__", model: { type: "math", expression: "is_number($query) || is_nan($query) || is_inf($query)" } },
  { refId: "threshold", datasourceUid: "__expr__", model: { type: "threshold", expression: "prometheus_math", conditions: [{ evaluator: { type: "gt", params: [0] } }] } },
] };
const legacy = { ...current, uid: "afwt2cuzwjf9cd", title: "BuildIT telemetry silent", folderUID: "legacy", ruleGroup: "BuildIT release" };
const folders = [{ uid: "managed", title: "buildit" }, { uid: "legacy", title: "BuildIT" }];
const nowSeconds = 2000;
const snapshot = { status: "success", data: { resultType: "vector", result: [{ value: [2000, "1800"] }] } };
const contactPoints = [{ name: "BuildIT alerts (Tanmay)", type: "email", settings: { addresses: "operator@example.invalid" } }];
const input = { desired, folders, deployed: [current], nowSeconds, snapshot, contactPoints };
const capturedLegacy = JSON.parse(readFileSync(new URL("../fixtures/grafana-legacy-group-2026-09-14.json", import.meta.url), "utf8")).groups[0];
const capturedCurrent = JSON.parse(readFileSync(new URL("../fixtures/grafana-current-group-2026-09-14.json", import.meta.url), "utf8")).groups[0];
const alertSource = readFileSync(new URL("../../observability/alerts.yml", import.meta.url), "utf8");
const capturedDesired = alertSource.split(/^ {6}- alert: /m).slice(1).map(block => {
  const field = (name: string) => block.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
  return { alert: block.split("\n")[0]!.trim(), expr: field("expr"), for: field("for"), severity: block.match(/severity:\s*([a-z]+)/)?.[1], summary: field("summary"), action: field("action"), runbook: field("runbook_url") };
});
const capturedRules = (group: { name: string; rules: Array<Record<string, unknown>> }, folderUID: string) => group.rules.map(rule => ({ ...rule, for: rule.for ?? "0s", folderUID, ruleGroup: group.name }));
const repairedCurrent = { ...capturedCurrent, rules: capturedCurrent.rules.map((rule: Record<string, unknown>) => ({ ...rule, noDataState: "OK", execErrState: "Error", notification_settings: { receiver: "BuildIT alerts (Tanmay)" } })) };
describe("BuildIT Grafana reconciliation evidence", () => {
  it("requires fresh scheduled telemetry and matching complete rule definitions", () => {
    expect(compareGrafanaRules(input)).toMatchObject({ verified: true, telemetry: { fresh: true, ageSeconds: 200 } });
    expect(compareGrafanaRules({ ...input, deployed: [{ ...current, for: "5m0s" }] }).verified).toBe(true);
    for (const change of [{ isPaused: true }, { condition: "query" }, { for: "1h" }, { labels: { severity: "page" } }, { annotations: { summary: "wrong" } }, { data: [] }]) {
      expect(compareGrafanaRules({ ...input, deployed: [{ ...current, ...change }] }).verified).toBe(false);
    }
  });
  it("rejects silent query errors and unrouted notifications in the real native export", () => {
    const deployed = capturedRules(capturedCurrent, "managed");
    expect(deployed).toHaveLength(14);
    expect(deployed.every(rule => rule.execErrState === "OK")).toBe(true);
    const report = compareGrafanaRules({ ...input, desired: capturedDesired, deployed });
    expect(report.verified).toBe(false);
    expect(report.drift).toHaveLength(14);
    const repaired = deployed.map(rule => ({ ...rule, noDataState: "OK", execErrState: "Error", notification_settings: { receiver: "BuildIT alerts (Tanmay)" } }));
    expect(compareGrafanaRules({ ...input, desired: capturedDesired, deployed: repaired }).verified).toBe(true);
    for (const change of [{ execErrState: "OK" }, { execErrState: undefined }, { notification_settings: undefined }, { notification_settings: { receiver: "empty-default" } }, { noDataState: "Alerting" }]) {
      expect(compareGrafanaRules({ ...input, desired: capturedDesired, deployed: [{ ...repaired[0], ...change }, ...repaired.slice(1)] }).verified).toBe(false);
    }
  });
  it("requires a configured existing BuildIT email integration without claiming delivery", () => {
    for (const contacts of [undefined, [], [{ name: "BuildIT alerts (Tanmay)", type: "email", settings: {} }], [{ ...contactPoints[0], disableResolveMessage: true }]]) {
      expect(compareGrafanaRules({ ...input, contactPoints: contacts }).verified).toBe(false);
      expect(compareGrafanaRules({ ...input, deployed: [current, legacy], contactPoints: contacts }).readyForReviewedCleanup).toBe(false);
    }
    expect(compareGrafanaRules(input).notifications).toMatchObject({ configured: true, deliveryTested: false });
  });
  it("does not accept missing, stale, future or malformed telemetry as healthy", () => {
    for (const value of ["0", "100", "3000", "NaN"]) {
      expect(compareGrafanaRules({ ...input, snapshot: { ...snapshot, data: { ...snapshot.data, result: [{ value: [2000, value] }] } } }).verified).toBe(false);
    }
    expect(compareGrafanaRules({ ...input, snapshot: {} }).verified).toBe(false);
  });
  it("reports an explicitly scoped legacy duplicate even when current rules match", () => {
    const report = compareGrafanaRules({ ...input, deployed: [current, legacy] });
    expect(report.verified).toBe(false);
    expect(report.readyForReviewedCleanup).toBe(true);
    expect(report.legacyCandidates).toEqual([expect.objectContaining({ uid: "afwt2cuzwjf9cd", approvalRequired: true, replacementVerified: true, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
  });
  it("leaves other projects, folders, groups and unknown legacy titles out of cleanup candidates", () => {
    const report = compareGrafanaRules({ ...input, deployed: [current,
      { ...legacy, title: "Unknown" }, { ...legacy, folderUID: "another-project" }, { ...legacy, ruleGroup: "another-group" },
    ] });
    expect(report.legacyCandidates).toEqual([]);
    expect(report.unrecognizedLegacyCount).toBe(1);
    expect(report.verified).toBe(false);
    expect(report.readyForReviewedCleanup).toBe(false);
  });
  it("recognizes the twelve observed legacy UID/title pairs from the sanitized native exports", () => {
    const report = compareGrafanaRules({ ...input, desired: capturedDesired, deployed: [...capturedRules(repairedCurrent, "managed"), ...capturedRules(capturedLegacy, "legacy")] });
    expect(report.drift).toEqual([]);
    expect(report.legacyCandidates).toHaveLength(12);
    expect(report.unrecognizedLegacyCount).toBe(0);
    expect(report.legacyCandidates.find((rule: { uid: string }) => rule.uid === "afwt2cuzwjf9cd")).toMatchObject({ title: "BuildIT telemetry silent", replacementTitle: "BuildITTelemetrySilent", replacementVerified: true });
    expect(report.readyForReviewedCleanup).toBe(true);
    expect(report.verified).toBe(false);
  });
  it("never infers a legacy replacement from a familiar title or similar spelling", () => {
    for (const change of [{ uid: "another-rule" }, { title: "BuildITTelemetrySilent" }, { title: "BuildIT Telemetry Silent" }, { title: "BuildIT telemetry silent " }]) {
      const report = compareGrafanaRules({ ...input, deployed: [current, { ...legacy, ...change }] });
      expect(report.legacyCandidates).toEqual([]);
      expect(report.unrecognizedLegacyCount).toBe(1);
      expect(report.readyForReviewedCleanup).toBe(false);
    }
  });
  it("does not call a partially recognized legacy group ready for cleanup", () => {
    const report = compareGrafanaRules({ ...input, deployed: [current, legacy, { ...legacy, uid: "unrecognized", title: "Custom BuildIT rule" }] });
    expect(report.legacyCandidates).toHaveLength(1);
    expect(report.unrecognizedLegacyCount).toBe(1);
    expect(report.readyForReviewedCleanup).toBe(false);
    expect(compareGrafanaRules(input).readyForReviewedCleanup).toBe(false);
  });
  it("refuses ambiguous identities and includes every changed native rule field in the fingerprint", () => {
    const duplicate = compareGrafanaRules({ ...input, deployed: [current, legacy, { ...legacy }] });
    expect(duplicate.legacyCandidates).toEqual([]);
    expect(duplicate.readyForReviewedCleanup).toBe(false);
    for (const ambiguous of [[...folders, { uid: "legacy-two", title: "BuildIT" }], [{ uid: "same", title: "buildit" }, { uid: "same", title: "BuildIT" }]]) {
      expect(() => compareGrafanaRules({ ...input, folders: ambiguous })).toThrow("buildit_grafana_folder_ambiguous");
    }
    const original = compareGrafanaRules({ ...input, deployed: [current, legacy] }).legacyCandidates[0].fingerprint;
    const reordered = Object.fromEntries(Object.entries(legacy).reverse());
    expect(compareGrafanaRules({ ...input, deployed: [current, reordered] }).legacyCandidates[0].fingerprint).toBe(original);
    expect(compareGrafanaRules({ ...input, deployed: [current, { ...legacy, isPaused: true }] }).legacyCandidates[0].fingerprint).not.toBe(original);
  });
  it("requires a verified replacement and a fresh snapshot even for a known legacy identity", () => {
    for (const changes of [{ deployed: [{ ...current, isPaused: true }, legacy] }, { deployed: [current, legacy], snapshot: {} }]) {
      expect(compareGrafanaRules({ ...input, ...changes }).readyForReviewedCleanup).toBe(false);
    }
  });
  it("reports native UI export definitions and fingerprints without inventing freshness or folder UIDs", () => {
    const report = compareGrafanaExportGroups({ desired: capturedDesired, currentExport: { groups: [repairedCurrent] }, legacyExport: { groups: [capturedLegacy] } });
    expect(report).toMatchObject({ currentDefinitionsMatch: true, managedRuleCount: 14, drift: [], unrecognizedLegacyCount: 0,
      telemetry: { status: "not_queried", fresh: null, ageSeconds: null }, folderUIDsVerified: false, fullStackInventoryVerified: false, readyForReviewedCleanup: false, verified: false });
    expect(report.legacyCandidates).toHaveLength(12);
    for (const candidate of report.legacyCandidates) {
      expect(candidate).toMatchObject({ folderTitle: "BuildIT", ruleGroup: "BuildIT release", replacementDefinitionMatchesExport: true,
        exportFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), fingerprintFormat: "sha256-canonical-grafana-ui-export-rule-v1", approvalRequired: true });
      expect(candidate).not.toHaveProperty("folderUID");
      expect(candidate).not.toHaveProperty("fingerprint");
    }
    expect(() => compareGrafanaExportGroups({ desired: capturedDesired, currentExport: { groups: [capturedCurrent, capturedCurrent] }, legacyExport: { groups: [capturedLegacy] } })).toThrow("buildit_grafana_export_group_ambiguous");
  });
  it("keeps the offline export command separate from a passing live gate", () => {
    const result = spawnSync(process.execPath, ["scripts/report-buildit-grafana-exports.mjs",
      "tests/fixtures/grafana-current-group-2026-09-14.json", "tests/fixtures/grafana-legacy-group-2026-09-14.json"],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ currentDefinitionsMatch: false, readyForReviewedCleanup: false, verified: false,
      telemetry: { fresh: null }, sources: { current: { path: "tests/fixtures/grafana-current-group-2026-09-14.json", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
    expect(report.legacyCandidates).toHaveLength(12);
  });
  it("never writes to Grafana, redirects credentials, or uses another stack", async () => {
    const request = vi.fn(async (url: URL) => Response.json(url.pathname.includes("alert-rules") ? [current] : url.pathname === "/api/folders" ? folders : url.pathname.includes("contact-points") ? contactPoints : snapshot));
    await expect(readGrafanaEvidence({ desired, token: "fake-test-token", request, nowSeconds })).resolves.toMatchObject({ verified: true });
    expect(request).toHaveBeenCalledTimes(4);
    for (const [url, options] of request.mock.calls as unknown as [URL, RequestInit][]) {
      expect(url.origin).toBe("https://peacefulbumblebee2324.grafana.net");
      expect(options.method).toBe("GET");
      expect(options.redirect).toBe("error");
    }
    request.mockClear();
    await expect(readGrafanaEvidence({ desired, token: "fake-test-token", base: new URL("https://another.grafana.net"), request })).rejects.toThrow("buildit_grafana_stack_refused");
    await expect(readGrafanaEvidence({ desired, token: "", request })).rejects.toThrow("buildit_grafana_verification_required");
    expect(request).not.toHaveBeenCalled();
  });
});
