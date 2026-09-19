// Signed-out server responses only. Passing this does not prove browser hydration or controls.
import { request } from "node:http";
import { writeFileSync } from "node:fs";

const cases = ["/", "/sign-in", "/account", "/data-handling", "/pricing", "/features", "/proof", "/scan", "/usage", "/metrics", "/history", "/reviews", "/repositories", "/policies", "/members", "/notifications", "/audit", "/integrations", "/setup/install", "/setup/repository", "/setup/model", "/setup/health", "/setup/tracker", "/setup/review"].map(path => ({ path, expectedStatus: 200 }));
cases.push(...["/settings", "/setup", "/setup/github", "/setup/run", "/audit-nonexistent-route", "/audit-nonexistent-route/child", "/_not-found", "/setup/model/extra", "/reviews/example/extra"].map(path => ({ path, expectedStatus: 404 })),
  { path: "/audit-nonexistent-route", method: "HEAD", expectedStatus: 404 },
  { path: "/api/audit-auth?as=A", expectedStatus: 200 }, { path: "/api/audit-auth?as=A", host: "not-local.invalid", expectedStatus: 403 });
const checks = [];
for (const item of cases) {
  const started = Date.now();
  const result = await new Promise(resolve => {
    // Connect to loopback regardless of the Host-header test. Discard bodies, which may include
    // a test JWT on the local-only sign-in endpoint; no token is logged or stored as evidence.
    const req = request({ hostname: "127.0.0.1", port: 3107, path: item.path, method: item.method ?? "GET", headers: { host: item.host ?? "127.0.0.1:3107" } }, response => {
      let body = "", bytes = 0;
      response.on("data", chunk => { bytes += chunk.length; if (item.expectedStatus === 404 && bytes < 10_000) body += chunk.toString(); });
      response.on("end", () => {
        const missingPage = item.expectedStatus === 404;
        const bodyCorrect = !missingPage || (item.method === "HEAD" ? bytes === 0 : body.includes("That page does not exist") && body.includes('href="/reviews"') && body.includes('href="/"'));
        const protectedResponse = !missingPage || Boolean(response.headers["content-security-policy"]) && response.headers["cache-control"] === "no-store";
        resolve({ status: response.statusCode, ok: response.statusCode === item.expectedStatus && bodyCorrect && protectedResponse, ...(missingPage ? { bodyCorrect, protectedResponse, bytes } : {}) });
      });
    });
    req.setTimeout(5_000, () => req.destroy(new Error("response_timeout")));
    req.on("error", error => resolve({ ok: false, error: error.message }));
    req.end();
  });
  checks.push({ ...item, ...result, elapsedMs: Date.now() - started });
  console.log(JSON.stringify(checks.at(-1)));
}
const evidence = { checkedAt: new Date().toISOString(), runtime: process.version, scope: "Signed-out HTTP routing and complete responses; no browser hydration or layout verification", checks, passed: checks.filter(check => check.ok).length, total: checks.length };
writeFileSync(new URL("../../audit/evidence/local-browser-http-proof.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
console.log(`${evidence.passed}/${evidence.total} local HTTP checks passed`);
process.exitCode = evidence.passed === evidence.total ? 0 : 1;
