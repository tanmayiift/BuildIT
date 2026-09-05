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

// The uid the hosted stack actually serves, and the one all 14 dashboard panels already render
// through. Two other spellings were in the repository - buildit-prometheus for the local
// docker-compose datasource, and a longer grafanacloud-peacefulbumblebee2324-prom that was this
// script's default - and none had ever been falsified, because nothing was ever pushed. Attaching
// rules to a datasource that does not exist fails silently: they simply never fire.
const datasourceUid = "grafanacloud-prom";

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

// --verify is the half that was missing, and its absence is the whole story of this file. CI ran
// --dry-run on every push, the file passed, and nobody was pushing it anywhere: the deployed rules
// were still the ones hand-built in the UI months earlier. Three of them - telemetry silence
// watching a counter that only moves when somebody reviews a pull request, runner failure paging on
// a spent sandbox plan, failure rate with no volume floor - sent 54 emails in a single night while
// the corrected versions sat in this repository, validated and green.
//
// Validation that cannot see the running system is a spell-check. This reads the rules back and
// refuses to pass when they differ from the file, including when no token is configured at all -
// because "we could not check" and "it matches" are not the same answer, and only one of them
// deserves a green build.
if (process.argv.includes("--verify")) {
  const token = process.env.BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN;
  if (!token) {
    console.error("buildit_grafana_alerts_unverified: BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN is not set, so the deployed rules could not be read.");
    console.error("  Set it and run `pnpm alerts:provision` once; this gate stays red until the stack matches observability/alerts.yml.");
    process.exit(1);
  }
  const response = await fetch(new URL("/api/convert/prometheus/config/v1/rules/buildit", base), {
    headers: { authorization: `Bearer ${token}`, accept: "application/yaml" },
  });
  if (!response.ok) throw new Error(`buildit_grafana_alerts_read_failed:${response.status}:${(await response.text()).slice(0, 300)}`);
  const deployed = await response.text();
  // Compare the rule inventory and each expression, not the whole document: Grafana echoes back its
  // own field ordering and adds defaults, so a byte diff would be red forever and teach everyone to
  // ignore it. What must not drift is which alerts exist and what each one actually fires on.
  const shape = text => new Map([...text.split(/^ {6}- alert: /m).slice(1)]
    .map(block => [block.split("\n")[0].trim(), (block.match(/^\s*expr:\s*(.+)$/m)?.[1] ?? "").trim()]));
  const want = shape(source), have = shape(deployed);
  const drift = [];
  for (const [name, expr] of want) {
    if (!have.has(name)) drift.push(`missing from the stack: ${name}`);
    else if (have.get(name) !== expr) drift.push(`expression differs: ${name}`);
  }
  for (const name of have.keys()) if (!want.has(name)) drift.push(`on the stack but not in the file: ${name}`);
  if (drift.length) {
    console.error(`buildit_grafana_alerts_drifted rules=${want.size} deployed=${have.size}`);
    for (const line of drift) console.error(`  ${line}`);
    console.error("  Run `pnpm alerts:provision` to make the stack match observability/alerts.yml.");
    process.exit(1);
  }
  console.log(`buildit_grafana_alerts_match rules=${want.size}`);
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
    "x-grafana-alerting-datasource-uid": process.env.BUILDIT_GRAFANA_DATASOURCE_UID ?? datasourceUid,
  },
  // The file goes up verbatim. Re-encoding the rules here would be a second description of them,
  // free to drift from the one prometheus.yml already loads.
  body: source,
});
if (!response.ok) {
  throw new Error(`buildit_grafana_alerts_failed:${response.status}:${(await response.text()).slice(0, 300)}`);
}
console.log(`buildit_grafana_alerts_provisioned groups=${groupNames.length} rules=${rules.length}`);
