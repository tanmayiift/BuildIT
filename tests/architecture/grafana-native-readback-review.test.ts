import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { provisionGrafanaAlerts } from "../../scripts/lib/grafana-provisioning.mjs";

const group = JSON.parse(readFileSync(new URL("../fixtures/grafana-current-group-2026-09-14.json", import.meta.url), "utf8")).groups[0];
const source = readFileSync(new URL("../../observability/alerts.yml", import.meta.url), "utf8");
const desired = source.split(/^ {6}- alert: /m).slice(1).map(block => {
  const field = (name: string) => block.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
  return { alert: block.split("\n")[0]!.trim(), expr: field("expr"), for: field("for"), severity: block.match(/severity:\s*([a-z]+)/)?.[1],
    summary: field("summary"), action: field("action"), runbook: field("runbook_url") };
});

describe("independent native Grafana readback review", () => {
  it.each(["immediate", "final"])("refuses %s readback when the query lookback silently changes", async phase => {
    const native = structuredClone(group.rules).map((rule: Record<string, unknown>) => ({ ...rule, for: rule.for ?? "0s", folderUID: "managed", ruleGroup: "buildit-release" }));
    let inventoryReads = 0;
    const request = async (url: URL, init: RequestInit = {}) => {
      if (url.origin !== "https://peacefulbumblebee2324.grafana.net") throw new Error("unexpected_test_destination");
      const method = init.method ?? "GET";
      if (url.pathname === "/api/folders") return Response.json([{ uid: "managed", title: "buildit" }]);
      if (url.pathname === "/api/v1/provisioning/contact-points") return Response.json([
        { name: "BuildIT alerts (Tanmay)", type: "email", settings: { addresses: "operator@example.invalid" } },
      ]);
      if (method === "POST") return Response.json({}, { status: 202 });
      if (url.pathname === "/api/v1/provisioning/alert-rules") {
        if (++inventoryReads === 3 && phase === "final") native[0].data[0].relativeTimeRange.to = 300;
        return Response.json(native);
      }
      const index = native.findIndex((rule: { uid: string }) => rule.uid === decodeURIComponent(url.pathname.split("/").at(-1)!));
      if (index < 0) throw new Error("unexpected_test_rule");
      if (method === "PUT") {
        native[index] = JSON.parse(String(init.body));
        if (phase === "immediate") native[index].data[0].relativeTimeRange.to = 300;
      }
      return Response.json(native[index]);
    };
    await expect(provisionGrafanaAlerts({ source, desired, token: "isolated-test-token", base: new URL("https://peacefulbumblebee2324.grafana.net"), request })).rejects.toThrow(/readback/);
  });
});
