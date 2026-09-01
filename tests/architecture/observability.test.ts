import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("observability release assets", () => {
  it("ships a valid source-free dashboard", () => {
    const dashboard = JSON.parse(read("observability/grafana/dashboards/buildit-overview.json")) as {
      panels: Array<{ title: string; datasource?: { uid?: string } }>;
      templating?: { list?: Array<{ name?: string; type?: string; query?: string; current?: { value?: string } }> };
    };
    expect(dashboard.panels.map(panel => panel.title)).toEqual(expect.arrayContaining([
      "Failure ratio", "p95 latency by operation", "Activation funnel", "Human decisions",
      "Provider and runner failures", "Artifact deletion backlog", "GitHub delivery",
      "Queue and capacity", "Hourly provider cost", "Effective LOC delivered",
      "Accuracy evidence unavailable",
    ]));
    const datasource = dashboard.templating?.list?.find(item => item.name === "buildit_prometheus");
    expect(datasource).toMatchObject({ type: "datasource", query: "prometheus" });
    expect(datasource?.current?.value).toBe("grafanacloud-prom");
    expect(dashboard.panels.filter(panel => panel.datasource).every(panel => panel.datasource?.uid === "$buildit_prometheus")).toBe(true);
    expect(read("observability/grafana/dashboards/buildit-overview.json")).not.toContain('"uid": "buildit-prometheus"');
  });

  it("alerts on every required production failure mode", () => {
    const rules = read("observability/alerts.yml");
    for (const alert of [
      "BuildITHighFailureRate", "BuildITP95LatencyHigh", "BuildITTelemetrySilent",
      "BuildITQueueDepthHigh", "BuildITProviderFailure", "BuildITRunnerFailure",
      "BuildITArtifactDeletionBacklog", "BuildITWebhookSignatureSpike",
      "BuildITLoopGuardTrip", "BuildITStaleCheck", "BuildITBudgetExhaustionSpike",
    ]) expect(rules).toContain(`alert: ${alert}`);
  });

  it("does not put forbidden customer fields in telemetry configuration", () => {
    const assets = ["observability/alerts.yml", "observability/otel-collector.yaml", "observability/grafana/dashboards/buildit-overview.json"].map(read).join("\n");
    expect(assets).not.toMatch(/api.?key|authorization|credential|email|github.?token|repo.?name|source.?code/i);
  });
});
