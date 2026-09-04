// The deployed Grafana rules and observability/alerts.yml have never agreed. The runbook recorded
// the drift and asked someone to reconcile it by hand, which meant every alert fix committed here
// was inert: BuildITTelemetrySilent kept paging on a metric that only moves when somebody reviews a
// pull request, and BuildITHighFailureRate kept paging on a ratio that reads 1.0 when a single
// operation fails. Thirty-two emails and four pages, none of them about anything wrong.
//
// A file nobody can apply is a wish. This makes alerts.yml the source: it reads the rules from that
// file and writes them to the stack through Grafana's provisioning API, so the next fix is one
// command rather than an afternoon of clicking.
//
//   pnpm alerts:check        validate the file without touching the stack
//   pnpm alerts:provision    apply it, with BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN set
import { readFile } from "node:fs/promises";

const expectedHost = "peacefulbumblebee2324.grafana.net";
const base = new URL(process.env.BUILDIT_GRAFANA_URL ?? `https://${expectedHost}`);
// The same stack guard the template script uses. A token is enough to write alert rules, so the
// destination is pinned rather than taken from the environment unchecked.
if (base.protocol !== "https:" || base.hostname !== expectedHost || base.username || base.password) {
  throw new Error("buildit_grafana_stack_refused");
}

const source = await readFile(new URL("../observability/alerts.yml", import.meta.url), "utf8");

// Read as text rather than through a YAML parser. js-yaml is a workspace dependency, not a root
// one, and pulling it up here would touch the lockfile - which the dependency audit gate then has
// to re-clear - for a file this regular. tests/architecture/observability.test.ts reads it the same
// way, so the two agree about what a rule is.
const blocks = source.split(/^ {6}- alert: /m).slice(1);
const field = (block, name) => block.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
const rules = blocks.map(block => ({
  alert: block.split("\n")[0].trim(),
  expr: field(block, "expr"),
  severity: block.match(/severity:\s*([a-z]+)/)?.[1],
  summary: field(block, "summary"),
  action: field(block, "action"),
  runbook: field(block, "runbook_url"),
}));
if (!rules.length) throw new Error("buildit_grafana_rules_empty");
const groupNames = [...source.matchAll(/^ {2}- name: (.+)$/gm)].map(match => match[1].trim());
if (!groupNames.length) throw new Error("buildit_grafana_groups_empty");

// Every rule must carry what an operator needs at 3am, because the whole point of the file is that
// the deployed alert says something useful. A rule without a runbook is worse than no rule: it
// wakes someone and then abandons them.
const runbookSections = new Set(
  (await readFile(new URL("../docs/operations/alert-runbooks.md", import.meta.url), "utf8"))
    .match(/^## (.+)$/gm)?.map(heading => heading.replace(/^## /, "").toLowerCase().replace(/[^a-z0-9]/g, "")) ?? [],
);
// page wakes someone, ticket is triaged in hours, info is a signal worth seeing and not acting on -
// a rising retry rate that the retries are still absorbing is the reason the third tier exists.
const severities = new Set(["page", "ticket", "info"]);
for (const rule of rules) {
  const where = rule.alert || "(unnamed)";
  if (!rule.alert || !rule.expr) throw new Error(`buildit_grafana_rule_incomplete:${where}`);
  if (!severities.has(rule.severity)) throw new Error(`buildit_grafana_rule_severity_invalid:${where}`);
  if (!rule.summary || !rule.action) throw new Error(`buildit_grafana_rule_unactionable:${where}`);
  const anchor = String(rule.runbook ?? "").replace(/"/g, "").split("#")[1];
  if (!anchor || !runbookSections.has(anchor)) throw new Error(`buildit_grafana_rule_runbook_missing:${where}`);
}

if (process.argv.includes("--dry-run")) {
  console.log(`buildit_grafana_alerts_valid rules=${rules.length}`);
  process.exit(0);
}

const secret = process.env.BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN;
if (!secret) throw new Error("buildit_grafana_service_account_required");

// Grafana's own conversion endpoint takes Prometheus rule groups verbatim, so the file that
// prometheus.yml already loads is the file the stack gets - no second encoding of the same rules to
// drift out of step with the first.
const endpoint = new URL("/api/convert/prometheus/config/v1/rules/buildit", base);
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    "content-type": "application/yaml",
    "x-disable-provenance": "true",
    "x-grafana-alerting-datasource-uid": process.env.BUILDIT_GRAFANA_DATASOURCE_UID ?? "grafanacloud-peacefulbumblebee2324-prom",
  },
  // The file goes up verbatim. Re-encoding the rules here would be a second description of them,
  // free to drift from the one prometheus.yml already loads.
  body: source,
});
if (!response.ok) {
  throw new Error(`buildit_grafana_alerts_failed:${response.status}:${(await response.text()).slice(0, 300)}`);
}
console.log(`buildit_grafana_alerts_provisioned groups=${groupNames.length} rules=${rules.length}`);
