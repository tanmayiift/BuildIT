import { readFile } from "node:fs/promises";

const expectedHost = "peacefulbumblebee2324.grafana.net";
const base = new URL(process.env.BUILDIT_GRAFANA_URL ?? `https://${expectedHost}`);
if (base.protocol !== "https:" || base.hostname !== expectedHost || base.username || base.password) throw new Error("buildit_grafana_stack_refused");

const template = await readFile(new URL("../observability/grafana/notification-templates/buildit-operator-v1.tmpl", import.meta.url), "utf8");
if (process.argv.includes("--dry-run")) {
  if (!template.includes('define "buildit.operator.subject.v1"') || !template.includes('define "buildit.operator.body.v1"')) throw new Error("buildit_grafana_template_invalid");
  console.log("BuildIT Grafana template is valid for the approved stack.");
  process.exit(0);
}

const secret = process.env.BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN;
if (!secret) throw new Error("buildit_grafana_service_account_required");
const endpoint = new URL("/api/v1/provisioning/templates/buildit-operator-v1", base);
const response = await fetch(endpoint, { method: "PUT", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ template }) });
if (!response.ok) throw new Error(`buildit_grafana_template_failed:${response.status}`);
console.log("BuildIT Grafana template v1 was accepted by the approved stack.");
