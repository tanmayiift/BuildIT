import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../..", import.meta.url));
function provision(options: Record<string, boolean> = {}) {
  const code = `
    import { readFileSync } from 'node:fs';
    import { createHash } from 'node:crypto';
    const options = ${JSON.stringify(options)};
    const group = JSON.parse(readFileSync('tests/fixtures/grafana-current-group-2026-09-14.json','utf8')).groups[0];
    let native = group.rules.map(r => ({ ...r, for:r.for??'0s', folderUID:'managed', ruleGroup:group.name }));
    const unrelated = { ...native[0], uid:'unrelated', folderUID:'other', ruleGroup:'other', title:'Other project' };
    const calls=[];
    process.env.BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN='isolated-test-token';
    process.env.BUILDIT_GRAFANA_URL='https://peacefulbumblebee2324.grafana.net';
    delete process.env.BUILDIT_GRAFANA_DATASOURCE_UID;
    const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
    globalThis.fetch=async (value,init={})=>{
      const url=new URL(value);const method=init.method??'GET';
      if(url.origin!=='https://peacefulbumblebee2324.grafana.net')throw new Error('unexpected_test_origin');
      const body=init.body&&init.headers?.['content-type']==='application/json'?JSON.parse(init.body):undefined;
      calls.push({method,path:url.pathname,redirect:init.redirect,receiverHeader:init.headers?.['x-grafana-alerting-notification-settings'],...(body?{uid:body.uid,title:body.title,execErrState:body.execErrState,noDataState:body.noDataState,receiver:body.notification_settings?.receiver,graphHash:digest(body.data),for:body.for}: {})});
      if(method==='GET'&&url.pathname==='/api/folders')return Response.json([{uid:'managed',title:'buildit'},{uid:'legacy',title:'BuildIT'}]);
      if(method==='GET'&&url.pathname==='/api/v1/provisioning/contact-points')return Response.json(options.missingContact?[]:[{name:'BuildIT alerts (Tanmay)',type:'email',settings:{addresses:'operator@example.invalid'},disableResolveMessage:false}]);
      if(method==='POST'&&url.pathname==='/api/convert/prometheus/config/v1/rules/buildit')return Response.json({}, {status:202});
      if(method==='GET'&&url.pathname==='/api/v1/provisioning/alert-rules')return Response.json([...native,unrelated]);
      const uid=decodeURIComponent(url.pathname.split('/').at(-1));
      const index=native.findIndex(r=>r.uid===uid);
      if(index>=0&&method==='GET')return Response.json(native[index]);
      if(index>=0&&method==='PUT'){
        if(!options.staleReadback)native[index]=body;
        return Response.json(body);
      }
      throw new Error('unexpected_test_request');
    };
    try { await import('./scripts/provision-buildit-grafana-alerts.mjs'); }
    catch(error){process.exitCode=1;console.error(error.message);}
    console.log(JSON.stringify({calls,original:group.rules.map(r=>({uid:r.uid,graphHash:digest(r.data),for:r.for??'0s'}))}));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: root, encoding: "utf8", maxBuffer: 2_000_000 });
  const evidence = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
  return { result, evidence };
}
function pauseLegacy() {
  const code = `
    import { readFileSync } from 'node:fs';
    const group = JSON.parse(readFileSync('tests/fixtures/grafana-legacy-group-2026-09-14.json','utf8')).groups[0];
    let rules = group.rules.map(r => ({ ...r, folderUID:'legacy', ruleGroup:'BuildIT release', isPaused:false }));
    const calls=[];
    process.env.BUILDIT_GRAFANA_SERVICE_ACCOUNT_TOKEN='isolated-test-token';
    process.env.BUILDIT_GRAFANA_URL='https://peacefulbumblebee2324.grafana.net';
    globalThis.fetch=async (value,init={})=>{
      const url=new URL(value);const method=init.method??'GET';
      if(url.origin!=='https://peacefulbumblebee2324.grafana.net')throw new Error('unexpected_test_origin');
      const body=init.body?JSON.parse(init.body):undefined;
      calls.push({method,path:url.pathname,uid:body?.uid,isPaused:body?.isPaused});
      if(method==='GET'&&url.pathname==='/api/folders')return Response.json([{uid:'legacy',title:'BuildIT'}]);
      if(method==='GET'&&url.pathname==='/api/v1/provisioning/alert-rules')return Response.json(rules);
      const uid=decodeURIComponent(url.pathname.split('/').at(-1));
      const index=rules.findIndex(r=>r.uid===uid);
      if(index>=0&&method==='GET')return Response.json(rules[index]);
      if(index>=0&&method==='PUT'){rules[index]=body;return Response.json(body);}
      throw new Error('unexpected_test_request');
    };
    try { await import('./scripts/pause-buildit-grafana-legacy.mjs'); }
    catch(error){process.exitCode=1;console.error(error.message);}
    console.log(JSON.stringify({calls,rules:rules.map(r=>({uid:r.uid,isPaused:r.isPaused}))}));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: root, encoding: "utf8", maxBuffer: 2_000_000 });
  const evidence = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
  return { result, evidence };
}
describe("Grafana provisioning keeps failures visible and routed", () => {
  it("repairs converter defaults for exactly the 14 current rules and checks the saved result", () => {
    const { result, evidence } = provision();
    expect(result.status, result.stderr).toBe(0);
    const writes = evidence.calls.filter((call: { method: string }) => call.method === "PUT");
    expect(writes).toHaveLength(14);
    for (const write of writes) {
      expect(write).toMatchObject({ execErrState: "Error", noDataState: "OK", receiver: "BuildIT alerts (Tanmay)", redirect: "error" });
      expect(evidence.original.find((rule: { uid: string }) => rule.uid === write.uid)).toMatchObject({ graphHash: write.graphHash, for: write.for });
      expect(write.uid).not.toBe("unrelated");
    }
    expect(result.stdout).toContain("buildit_grafana_alerts_provisioned");
  });
  it("refuses to change rules when the existing BuildIT recipient is missing", () => {
    const { result, evidence } = provision({ missingContact: true });
    expect(result.status).toBe(1);
    expect(evidence.calls.some((call: { method: string }) => call.method !== "GET")).toBe(false);
    expect(result.stdout).not.toContain("buildit_grafana_alerts_provisioned");
  });
  it("does not report success when readback still silently ignores query failures", () => {
    const { result } = provision({ staleReadback: true });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("buildit_grafana_alerts_provisioned");
  });
});
describe("Grafana legacy pause is exact and read back", () => {
  it("writes isPaused only for the eight reviewed duplicate UIDs", () => {
    const { result, evidence } = pauseLegacy();
    expect(result.status, result.stderr).toBe(0);
    const writes = evidence.calls.filter((call: { method: string }) => call.method === "PUT");
    expect(writes.map((call: { uid: string }) => call.uid).sort()).toEqual([
      "buildit-artifact-backlog", "buildit-budget-exhaustion", "buildit-loop-guard", "buildit-queue-depth-high",
      "buildit-stale-check", "buildit-webhook-signature", "dfwt2f4rivshsb", "efwt2f5a94dtsb",
    ]);
    expect(writes.every((call: { isPaused: boolean }) => call.isPaused === true)).toBe(true);
    expect(evidence.rules.filter((rule: { isPaused: boolean }) => rule.isPaused)).toHaveLength(8);
    expect(result.stdout).toContain("buildit_grafana_legacy_paused");
  });
});
