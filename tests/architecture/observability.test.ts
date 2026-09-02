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
      "Service failure ratio", "p95 latency by operation", "Activation funnel", "Human decisions",
      "Provider and runner failures", "Artifact deletion backlog", "GitHub delivery",
      "Queue and capacity", "Hourly provider cost", "Effective LOC delivered",
      "Accuracy evidence unavailable",
    ]));
    const datasource = dashboard.templating?.list?.find(item => item.name === "buildit_prometheus");
    expect(datasource).toMatchObject({ type: "datasource", query: "prometheus" });
    expect(datasource?.current?.value).toBe("grafanacloud-prom");
    expect(dashboard.panels.filter(panel => panel.datasource).every(panel => panel.datasource?.uid === "$buildit_prometheus")).toBe(true);
    expect(read("observability/grafana/dashboards/buildit-overview.json")).not.toContain('"uid": "buildit-prometheus"');
    const failurePanel = dashboard.panels.find(panel => panel.title === "Service failure ratio") as { description?: string; targets?: Array<{ expr?: string }> } | undefined;
    expect(failurePanel?.description).toContain("Intentional blocked requests");
    expect(failurePanel?.targets?.[0]?.expr).toContain('buildit_failures_total{buildit_outcome="failed"}');
    expect(failurePanel?.targets?.[0]?.expr).toContain('buildit_operations_total{buildit_outcome=~"succeeded|failed"}');
    expect(failurePanel?.targets?.[0]?.expr).toContain("or vector(0)");
  });

  it("alerts on every required production failure mode", () => {
    const rules = read("observability/alerts.yml");
    for (const alert of [
      "BuildITHighFailureRate", "BuildITP95LatencyHigh", "BuildITTelemetrySilent",
      "BuildITQueueDepthHigh", "BuildITProviderFailure", "BuildITRunnerFailure",
      "BuildITArtifactDeletionBacklog", "BuildITWebhookSignatureSpike",
      "BuildITLoopGuardTrip", "BuildITStaleCheck", "BuildITBudgetExhaustionSpike",
    ]) expect(rules).toContain(`alert: ${alert}`);
    expect((rules.match(/service: buildit/g) ?? [])).toHaveLength(12);
    expect((rules.match(/runbook_url:/g) ?? [])).toHaveLength(12);
    expect((rules.match(/action:/g) ?? [])).toHaveLength(12);
    expect(rules).toContain('buildit_failures_total{buildit_outcome="failed"}');
    expect(rules).toContain('buildit_operations_total{buildit_outcome=~"succeeded|failed"}');
    expect(rules).toContain("or vector(0)");
    expect(rules).toContain("max(absent_over_time(buildit_operations_total[15m]) or vector(0)) > 0.5");
    expect(rules).toContain('buildit_failures_total{buildit_operation="webhook.verify"}');
  });

  it("ships one versioned, source-free BuildIT operator notification template", () => {
    const template = read("observability/grafana/notification-templates/buildit-operator-v1.tmpl");
    expect(template).toContain('define "buildit.operator.subject.v1"');
    expect(template).toContain('define "buildit.operator.body.v1"');
    for (const field of [".Status", ".CommonLabels.severity", ".CommonAnnotations.summary", ".CommonAnnotations.action", ".CommonAnnotations.runbook_url"]) expect(template).toContain(field);
    expect(template).toContain("Environment: production");
    expect(template).toContain(".Alerts.Firing");
    expect(template).toContain(".StartsAt");
    expect(template).not.toMatch(/\.Labels|\.ValueString|\.GeneratorURL|organization|workspace|repository|pull request|review id|member|customer|source|prompt|finding|credential|token/i);
    const runbooks = read("docs/operations/alert-runbooks.md");
    for (const alert of ["BuildITHighFailureRate", "BuildITP95LatencyHigh", "BuildITTelemetrySilent", "BuildITCriticalBoundaryFailure", "BuildITQueueDepthHigh", "BuildITProviderFailure", "BuildITRunnerFailure", "BuildITArtifactDeletionBacklog", "BuildITWebhookSignatureSpike", "BuildITLoopGuardTrip", "BuildITStaleCheck", "BuildITBudgetExhaustionSpike"]) expect(runbooks).toContain(`## ${alert}`);
  });

  // Operators read these at 3am from India. The scheduler emits UTC instants, so the offset is
  // applied in the template; a raw .StartsAt would print a UTC wall clock five and a half hours
  // behind the reader, plus a Go monotonic-clock suffix.
  it("renders alert times in India Standard Time, not the scheduler's UTC", () => {
    const template = read("observability/grafana/notification-templates/buildit-operator-v1.tmpl");
    expect(template).toContain('define "buildit.time.ist"');
    expect(template).toContain("19800000000000");
    expect(template).toContain("IST");
    // Add() shifts the instant without relabelling the location, so a zone token would print
    // UTC beside an IST clock. The layout must not contain one.
    const layout = template.match(/\.Format "([^"]+)"/)?.[1] ?? "";
    expect(layout.length).toBeGreaterThan(0);
    for (const zoneToken of ["MST", "Z07", "-0700", "UTC"]) expect(layout).not.toContain(zoneToken);
    expect(template).not.toMatch(/Started: \{\{ \.StartsAt \}\}/);
    for (const field of ["Alert: {{ .CommonLabels.alertname }}", "Next action", "Runbook"]) expect(template).toContain(field);
  });

  // The template existed but nothing referenced it, so Grafana used its stock layout and the
  // action and runbook_url annotations every rule carries never reached an operator.
  it("wires the operator template to the contact point that sends the alert", () => {
    const provisioning = read("observability/grafana/provisioning/alerting/notification-templates.yml");
    expect(provisioning).toContain("buildit-operator-v1");
    expect(provisioning).toContain('{{ template "buildit.operator.subject.v1" . }}');
    expect(provisioning).toContain('{{ template "buildit.operator.body.v1" . }}');
    // A contact point that names no template silently falls back to the stock layout.
    expect(provisioning).toMatch(/contactPoints:/);
    expect(provisioning).toMatch(/subject:/);
    expect(provisioning).toMatch(/message:/);
  });

  it("provisions only the BuildIT template name on the approved stack", () => {
    const script = read("scripts/provision-buildit-grafana-template.mjs");
    expect(script).toContain("peacefulbumblebee2324.grafana.net");
    expect(script).toContain("/api/v1/provisioning/templates/buildit-operator-v1");
    expect(script).not.toMatch(/notification\/policies|dashboards|contact-points|Orbit/i);
  });

  it("does not put forbidden customer fields in telemetry configuration", () => {
    const assets = ["observability/alerts.yml", "observability/otel-collector.yaml", "observability/grafana/dashboards/buildit-overview.json"].map(read).join("\n");
    expect(assets).not.toMatch(/api.?key|authorization|credential|email|github.?token|repo.?name|source.?code/i);
    expect(assets).not.toMatch(/buildit_(?:organization|tenant|workspace|repository|repo|review_id|pr_number|user|member|email|owner|source|prompt|finding|credential|token)/i);
    expect(read("observability/alerts.yml")).not.toMatch(/annotations:[^\n]*\{\{[^}]+\}\}/i);
  });
});
