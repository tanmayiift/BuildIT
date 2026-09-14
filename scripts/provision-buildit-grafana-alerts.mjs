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
import { readGrafanaEvidence } from "./lib/grafana-verification.mjs";
import { provisionGrafanaAlerts } from "./lib/grafana-provisioning.mjs";

const expectedHost = "peacefulbumblebee2324.grafana.net";
const base = new URL(process.env.BUILDIT_GRAFANA_URL ?? `https://${expectedHost}`);
// The same stack guard the template script uses. A token is enough to write alert rules, so the
// destination is pinned rather than taken from the environment unchecked.
if (base.protocol !== "https:" || base.hostname !== expectedHost || base.username || base.password || base.port || base.pathname !== "/" || base.search || base.hash) {
  throw new Error("buildit_grafana_stack_refused");
}

const source = await readFile(new URL("../observability/alerts.yml", import.meta.url), "utf8");

// The uid the hosted stack actually serves, and the one all 14 dashboard panels already render
// through. Two other spellings were in the repository - buildit-prometheus for the local
// docker-compose datasource, and a longer grafanacloud-peacefulbumblebee2324-prom that was this
// script's default - and none had ever been falsified, because nothing was ever pushed. Attaching
// rules to a datasource that does not exist fails silently: they simply never fire.


// Read as text rather than through a YAML parser. js-yaml is a workspace dependency, not a root
// one, and pulling it up here would touch the lockfile - which the dependency audit gate then has
// to re-clear - for a file this regular. tests/architecture/observability.test.ts reads it the same
// way, so the two agree about what a rule is.
const blocks = source.split(/^ {6}- alert: /m).slice(1);
const field = (block, name) => block.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
const rules = blocks.map(block => ({
  alert: block.split("\n")[0].trim(),
  expr: field(block, "expr"),
  for: field(block, "for"),
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
if (process.argv.includes("--verify") || process.argv.includes("--report") || process.argv.includes("--require")) {
  const token = process.env.BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN;
  if (!token) {
    const required = process.argv.includes("--require") || process.argv.includes("--report");
    const message = "no Grafana read credential is configured; deployed alert rules were NOT checked against observability/alerts.yml.";
    if (required) {
      console.error(`buildit_grafana_verification_required: ${message}`);
      process.exit(2);
    }
    console.log(`::warning title=Grafana rules unverified::${message} Set BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN to turn this into a real gate.`);
    console.log("buildit_grafana_verification_skipped: offline definition validation still ran via alerts:check.");
    process.exit(0);
  }
  const report = await readGrafanaEvidence({ desired: rules, token, base });
  if (process.argv.includes("--report")) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.verified ? 0 : 1);
  }
  for (const drift of report.drift) console.error(`  ${drift}`);
  if (!report.telemetry.fresh) console.error("buildit_grafana_telemetry_stale_or_missing");
  if (!report.notifications.configured) console.error("buildit_grafana_notification_contact_required");
  if (report.legacyCandidates.length || report.unrecognizedLegacyCount) {
    console.error(`buildit_grafana_legacy_rules_remain matched=${report.legacyCandidates.length} unrecognized=${report.unrecognizedLegacyCount}`);
    console.error("Generate a read-only --report and review the exact legacy UIDs before cleanup. Provisioning replacements does not remove legacy rules.");
  }
  if (!report.verified) process.exit(1);
  console.log(`buildit_grafana_alerts_match rules=${rules.length} telemetry=fresh legacy=0`);
  process.exit(0);
}

const secret = process.env.BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN;
if (!secret) throw new Error("buildit_grafana_service_account_required");

const applied = await provisionGrafanaAlerts({ source, desired: rules, token: secret, base });
console.log(`buildit_grafana_alerts_provisioned groups=${groupNames.length} rules=${applied.rules} error_state=${applied.errorState} delivery=not_tested`);
