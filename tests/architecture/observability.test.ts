import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("observability release assets", () => {
  it("ships a valid source-free dashboard", () => {
    const dashboard = JSON.parse(read("observability/grafana/dashboards/buildit-overview.json")) as { panels: Array<{ title: string }> };
    expect(dashboard.panels.map(panel => panel.title)).toEqual(expect.arrayContaining([
      "Failure ratio", "p95 latency by operation", "Activation funnel", "Human decisions",
      "Provider and runner failures", "Artifact deletion backlog", "GitHub delivery",
      "Queue and capacity", "Hourly provider cost", "Effective LOC delivered",
      "Accuracy evidence unavailable",
    ]));
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
