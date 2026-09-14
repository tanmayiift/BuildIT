import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareGrafanaRepairExports } from "../../scripts/lib/grafana-export-repair-diff.mjs";

const before = JSON.parse(readFileSync(new URL("../fixtures/grafana-current-group-2026-09-14.json", import.meta.url), "utf8"));
function repaired() {
  const result = structuredClone(before);
  for (const rule of result.groups[0].rules) {
    rule.execErrState = "Error";
    rule.notification_settings = { receiver: "BuildIT alerts (Tanmay)" };
  }
  return result;
}

describe("independent native Grafana repair export comparison", () => {
  it("accepts only the two approved settings on all 14 original rules without claiming delivery", () => {
    const report = compareGrafanaRepairExports(before, repaired());
    expect(report.repairMatches).toBe(true);
    expect(report.ruleCount).toBe(14);
    expect(report.actualDifferences).toHaveLength(28);
    expect(report.unexpectedDifferences).toEqual([]);
    expect(report).toMatchObject({ evidenceKind: "native_ui_export_diff", readOnly: true, deliveryTested: false, folderUIDsVerified: false });
  });

  it("reports all unfinished rules when only telemetry has been repaired", () => {
    const partial = structuredClone(before);
    Object.assign(partial.groups[0].rules.find((rule: { title: string }) => rule.title === "BuildITTelemetrySilent"), {
      execErrState: "Error", notification_settings: { receiver: "BuildIT alerts (Tanmay)" },
    });
    const report = compareGrafanaRepairExports(before, partial);
    expect(report.repairMatches).toBe(false);
    expect(report.requirementFailures).toHaveLength(26);
  });

  it.each([
    ["query", (rule: typeof before) => { rule.data[0].model.expr = "vector(1)"; }],
    ["threshold", (rule: typeof before) => { rule.data[2].model.conditions[0].evaluator.params = [1]; }],
    ["evaluation lag", (rule: typeof before) => { rule.data[0].relativeTimeRange.to = 0; }],
    ["pending duration", (rule: typeof before) => { rule.for = "0s"; }],
    ["missing data state", (rule: typeof before) => { rule.noDataState = "Alerting"; }],
    ["labels", (rule: typeof before) => { rule.labels.severity = "info"; }],
    ["annotation", (rule: typeof before) => { rule.annotations.summary = "changed"; }],
    ["receiver", (rule: typeof before) => { rule.notification_settings.receiver = "Orbit"; }],
    ["extra timing", (rule: typeof before) => { rule.notification_settings.group_wait = "30s"; }],
    ["cosmetic model metadata", (rule: typeof before) => { rule.data[0].model.editorMode = "code"; }],
  ] as const)("reports unexpected %s changes rather than normalizing them away", (_name, mutate) => {
    const changed = repaired();
    mutate(changed.groups[0].rules[0]);
    const report = compareGrafanaRepairExports(before, changed);
    expect(report.repairMatches).toBe(false);
    expect(report.unexpectedDifferences.length).toBeGreaterThan(0);
    expect(report.actualDifferences.length).toBeGreaterThanOrEqual(28);
  });

  it("rejects changed scope, replacement UIDs, missing rules, duplicate UIDs and extra groups", () => {
    for (const change of [
      (document: typeof before) => { document.groups[0].folder = "BuildIT"; },
      (document: typeof before) => { document.groups[0].name = "another-group"; },
      (document: typeof before) => { document.groups[0].rules[0].uid = "replacement"; },
      (document: typeof before) => { document.groups[0].rules.pop(); },
      (document: typeof before) => { document.groups[0].rules[0].uid = document.groups[0].rules[1].uid; },
      (document: typeof before) => { document.groups.push(structuredClone(document.groups[0])); },
    ]) {
      const after = repaired();
      change(after);
      expect(compareGrafanaRepairExports(before, after).repairMatches).toBe(false);
    }
  });

  it("ignores JSON object key ordering but reports rule order changes", () => {
    const reorderKeys = JSON.parse(JSON.stringify(repaired(), (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value));
    expect(compareGrafanaRepairExports(before, reorderKeys).repairMatches).toBe(true);
    const reorderRules = repaired();
    reorderRules.groups[0].rules.reverse();
    expect(compareGrafanaRepairExports(before, reorderRules).unexpectedDifferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/groups/0/ruleOrder" }),
    ]));
  });
});
