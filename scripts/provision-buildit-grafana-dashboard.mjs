// observability/grafana/dashboards/buildit-overview.json describes 14 panels and had no way at all
// to reach the stack. The alert rules at least had a script nobody ran; the dashboard had nothing -
// grep the repository for "api/dashboards" and you get zero hits. The only provisioning file that
// mentions it mounts a directory into the local docker-compose Grafana, and every panel pins the
// hosted datasource uid, so it renders "No data" there too.
//
// So the dashboard a stranger opens at the public URL is whatever was hand-built in the UI, and the
// architecture test that pins these 14 panel titles has been asserting the contents of a file that
// no automated process has ever deployed. That is the same trap as the alerts, one stage worse.
//
//   pnpm dashboard:check        validate the file without touching the stack
//   pnpm dashboard:provision    apply it, with BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN set
import { readFile } from "node:fs/promises";

const expectedHost = "peacefulbumblebee2324.grafana.net";
const base = new URL(process.env.BUILDIT_GRAFANA_URL ?? `https://${expectedHost}`);
// Same stack guard the alert script uses. A token can write any dashboard in any stack it belongs
// to, so the destination is pinned here rather than taken from the environment unchecked.
if (base.protocol !== "https:" || base.hostname !== expectedHost || base.username || base.password) {
  throw new Error("buildit_grafana_stack_refused");
}

const source = await readFile(new URL("../observability/grafana/dashboards/buildit-overview.json", import.meta.url), "utf8");
const dashboard = JSON.parse(source);

// The uid the hosted stack serves. Every panel must name it explicitly: a public dashboard does not
// resolve template variables, so a panel that inherits its datasource from a picker renders empty
// for the one audience this dashboard exists for.
const datasourceUid = process.env.BUILDIT_GRAFANA_DATASOURCE_UID ?? "grafanacloud-prom";

if (!dashboard.uid || !dashboard.title) throw new Error("buildit_dashboard_identity_missing");
if (!Array.isArray(dashboard.panels) || !dashboard.panels.length) throw new Error("buildit_dashboard_panels_empty");
if (dashboard.templating && Array.isArray(dashboard.templating.list) && dashboard.templating.list.length) {
  throw new Error("buildit_dashboard_templating_forbidden");
}
const wrongDatasource = dashboard.panels
  .filter(panel => panel.datasource && panel.datasource.uid !== datasourceUid)
  .map(panel => `${panel.title ?? "(untitled)"}:${panel.datasource.uid}`);
if (wrongDatasource.length) throw new Error(`buildit_dashboard_datasource_mismatch:${wrongDatasource.join(",")}`);
const untitled = dashboard.panels.filter(panel => !panel.title && panel.type !== "row").length;
if (untitled) throw new Error(`buildit_dashboard_panel_untitled:${untitled}`);

if (process.argv.includes("--dry-run")) {
  console.log(`buildit_dashboard_valid uid=${dashboard.uid} panels=${dashboard.panels.length}`);
  process.exit(0);
}

const secret = process.env.BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN;
if (!secret) {
  // Loud, and not a failure, for the same reason the alert gate warns rather than fails: a missing
  // credential is a setup task no commit can fix, and a build that is red for that teaches people
  // to stop reading red builds.
  console.warn("buildit_dashboard_not_provisioned: BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN is not set, so the dashboard was NOT deployed.");
  console.warn("  The public dashboard is whatever was last built by hand. Set the token and run `pnpm dashboard:provision`.");
  process.exit(0);
}

// overwrite: true because the uid is fixed and this file is the source. Without it Grafana refuses
// the second push of the same uid, which would make the script work exactly once.
const response = await fetch(new URL("/api/dashboards/db", base), {
  method: "POST",
  headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
  body: JSON.stringify({ dashboard: { ...dashboard, id: null }, overwrite: true, message: "provisioned from observability/grafana/dashboards/buildit-overview.json" }),
});
if (!response.ok) {
  throw new Error(`buildit_dashboard_failed:${response.status}:${(await response.text()).slice(0, 300)}`);
}
const result = await response.json();
console.log(`buildit_dashboard_provisioned uid=${result.uid ?? dashboard.uid} version=${result.version ?? "?"} panels=${dashboard.panels.length}`);
