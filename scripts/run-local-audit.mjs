#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, importPKCS8 } from "jose";
import { localAuditWebPolicy } from "./lib/local-audit-web.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(root, ".local/audit-runtime");
const project = join(root, ".local/audit-project");
const cloud = "http://127.0.0.1:3218", site = "http://127.0.0.1:3219", web = "http://127.0.0.1:3107";
const instance = "buildit-local-audit";
const binary = join(runtime, "convex-local-backend");
const secretFile = join(runtime, "secrets.json");
const envFile = join(runtime, "cli.env");
const childEnv = { PATH: process.env.PATH ?? "", TMPDIR: process.env.TMPDIR ?? "/tmp", DISABLE_BEACON: "true", CONVEX_SELF_HOSTED_URL: cloud, DO_NOT_TRACK: "1", NEXT_TELEMETRY_DISABLED: "1" };
function privateFile(path, value) { writeFileSync(path, value, { mode: 0o600 }); chmodSync(path, 0o600); }
function secrets() {
  if (!existsSync(secretFile)) {
    const instanceSecret = randomBytes(32).toString("hex");
    const key = spawnSync(binary, ["keygen", "admin-key", "--instance-name", instance, "--instance-secret", instanceSecret], { encoding: "utf8", env: childEnv });
    if (key.status !== 0) throw new Error("local_admin_key_generation_failed");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    privateFile(secretFile, JSON.stringify({ instanceSecret, adminKey: key.stdout.trim(), privateKey: privateKey.export({ type: "pkcs8", format: "pem" }), jwks: { keys: [{ ...publicKey.export({ format: "jwk" }), use: "sig", alg: "RS256" }] } }));
  }
  return JSON.parse(readFileSync(secretFile, "utf8"));
}
async function adminRequest(path, body) {
  const response = await fetch(new URL(path, cloud), { method: "POST", headers: { authorization: `Convex ${secrets().adminKey}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: globalThis.AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`local_backend_request_failed:${path}:${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
function copyProject() {
  mkdirSync(project, { recursive: true });
  rmSync(join(project, "convex"), { recursive: true, force: true });
  cpSync(join(root, "convex"), join(project, "convex"), { recursive: true, filter: source => !/\.test\.tsx?$/.test(source) && !source.endsWith("/testing") });
  for (const name of ["node_modules", "packages"]) if (!existsSync(join(project, name))) symlinkSync(join(root, name), join(project, name));
  cpSync(join(root, "package.json"), join(project, "package.json"));
  cpSync(join(root, "tsconfig.base.json"), join(project, "tsconfig.base.json"));
  // The test-only function and empty cron list exist only in the ignored isolated copy.
  cpSync(join(root, "tests/e2e-local/seed.fixture.txt"), join(project, "convex/auditSeed.ts"));
  writeFileSync(join(project, "convex/crons.ts"), 'import { cronJobs } from "convex/server";\nexport default cronJobs();\n');
  privateFile(envFile, `CONVEX_SELF_HOSTED_URL=${cloud}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${secrets().adminKey}\n`);
}
function nodeRuntime() {
  return process.env.BUILDIT_AUDIT_NODE ?? (existsSync(join(runtime, "node24-path.txt")) ? readFileSync(join(runtime, "node24-path.txt"), "utf8").trim() : process.execPath);
}
function copyWeb() {
  const target = join(project, "apps/web");
  rmSync(target, { recursive: true, force: true });
  cpSync(join(root, "apps/web"), target, { recursive: true, filter: source => ![".next", "node_modules"].includes(source.split("/").at(-1)) && !source.split("/").at(-1).startsWith(".env") && !/\.(?:test|spec)\.tsx?$/.test(source) });
  if (!existsSync(join(target, "node_modules"))) symlinkSync(join(root, "apps/web/node_modules"), join(target, "node_modules"));
  const securityPolicy = join(target, "src/security-policy.ts");
  writeFileSync(securityPolicy, localAuditWebPolicy(readFileSync(securityPolicy, "utf8")));
  const config = join(target, "next.config.ts");
  writeFileSync(config, readFileSync(config, "utf8").replace("const config: NextConfig = {", `const config: NextConfig = {\n  turbopack: { root: ${JSON.stringify(root)} },\n  outputFileTracingRoot: ${JSON.stringify(root)},`));
  const authRoute = join(target, "src/app/api/audit-auth");
  mkdirSync(authRoute, { recursive: true });
  writeFileSync(join(authRoute, "route.ts"), `import { readFileSync } from "node:fs";
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get("host") !== "127.0.0.1:3107" || url.protocol !== "http:" || process.env.NEXT_PUBLIC_CONVEX_URL !== "${cloud}") return new Response("Local audit only", {status:403});
  const name = url.searchParams.get("as");
  if (name !== "A" && name !== "B") return new Response('<h1>Isolated BuildIT test users</h1><a href="?as=A">Sign in as simulated owner A</a><br><a href="?as=B">Sign in as simulated viewer B</a>', {headers:{"content-type":"text/html","cache-control":"no-store"}});
  const fixture = JSON.parse(readFileSync(${JSON.stringify(join(runtime, "fixtures.json"))}, "utf8"))[name];
  const {adminKey} = JSON.parse(readFileSync(${JSON.stringify(secretFile)}, "utf8"));
  const refreshed = await fetch("${cloud}/api/mutation", {method:"POST",headers:{authorization:"Convex " + adminKey,"content-type":"application/json"},body:JSON.stringify({path:"auditSeed:browserSession",args:{userId:fixture.userId,sessionId:fixture.sessionId},format:"json"}),signal:AbortSignal.timeout(5000)});
  if (!refreshed.ok) return new Response("Local sign-in unavailable", {status:503});
  const session = await refreshed.json();
  if (session.status !== "success" || typeof session.value?.refreshToken !== "string") return new Response("Local sign-in unavailable", {status:503});
  return new Response('<script>localStorage.setItem("__convexAuthJWT_http1270013218",' + JSON.stringify(fixture.token) + ');localStorage.setItem("__convexAuthRefreshToken_http1270013218",' + JSON.stringify(session.value.refreshToken) + ');location.replace("/usage");</script>', {headers:{"content-type":"text/html","cache-control":"no-store"}});
}
`);
  return target;
}
mkdirSync(runtime, { recursive: true });
const command = process.argv[2];
if (command === "prepare") {
  secrets(); copyProject();
  console.log("Isolated BuildIT project prepared; credentials saved privately.");
} else if (command === "backend") {
  const engineEnv = { ...childEnv, PATH: `${dirname(nodeRuntime())}:${childEnv.PATH}` };
  const child = spawn(binary, ["--interface", "127.0.0.1", "--port", "3218", "--site-proxy-port", "3219", "--instance-name", instance, "--instance-secret", secrets().instanceSecret, "--local-storage", join(runtime, "storage"), "--disable-beacon", join(runtime, "backend.sqlite3")], { env: engineEnv, stdio: ["ignore", "inherit", "inherit"] });
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  child.on("exit", code => { process.exitCode = code ?? 1; });
} else if (command === "deploy") {
  copyProject();
  const local = secrets();
  await adminRequest("/api/update_environment_variables", { changes: Object.entries({
    SITE_URL: web, JWT_PRIVATE_KEY: local.privateKey, JWKS: JSON.stringify(local.jwks), AUTH_GITHUB_ID: "local-only-unused", AUTH_GITHUB_SECRET: "local-only-unused", BUILDIT_UNTRUSTED_EXECUTION_ENABLED: "false",
  }).map(([name, value]) => ({ name, value })) });
  const child = spawnSync(nodeRuntime(), [join(root, "node_modules/convex/bin/main.js"), "deploy", "--env-file", envFile, "--typecheck", "disable", "--codegen", "enable"], { cwd: project, env: childEnv, encoding: "utf8" });
  // The CLI must never print the private admin key. Scrub defensively before emitting diagnostics.
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`.split(local.adminKey).join("[redacted]");
  process.stdout.write(output);
  if (child.status !== 0) process.exitCode = child.status ?? 1;
} else if (command === "seed" || command === "renew-auth") {
  const result = command === "seed"
    ? await adminRequest("/api/mutation", { path: "auditSeed:seed", args: {}, format: "json" })
    : { status: "success", value: Object.values(JSON.parse(readFileSync(join(runtime, "fixtures.json"), "utf8"))) };
  if (result.status !== "success") throw new Error("local_seed_failed");
  const privateKey = await importPKCS8(secrets().privateKey, "RS256");
  const fixtures = {};
  for (const user of result.value) {
    if (command === "renew-auth") {
      const renewed = await adminRequest("/api/mutation", { path: "auditSeed:renewSession", args: { userId: user.userId, sessionId: user.sessionId }, format: "json" });
      if (renewed.status !== "success") throw new Error("local_session_refresh_failed");
      user.sessionId = renewed.value.sessionId;
    }
    const token = await new SignJWT({ sub: `${user.userId}|${user.sessionId}` }).setProtectedHeader({ alg: "RS256" }).setIssuedAt().setIssuer(site).setAudience("convex").setExpirationTime("8h").sign(privateKey);
    fixtures[user.name] = { ...user, token };
  }
  privateFile(join(runtime, "fixtures.json"), JSON.stringify(fixtures));
  console.log(command === "seed" ? "Two simulated users seeded in the local database; tokens saved privately." : "Local test sessions renewed; tokens saved privately.");
} else if (command === "build-web") {
  const child = spawnSync(nodeRuntime(), [join(root, "apps/web/node_modules/next/dist/bin/next"), "build"], { cwd: copyWeb(), env: { ...childEnv, NEXT_PUBLIC_CONVEX_URL: cloud, NEXT_PUBLIC_BUILDIT_E2E: "1" }, stdio: ["ignore", "inherit", "inherit"] });
  process.exitCode = child.status ?? 1;
} else if (command === "web") {
  const child = spawn(nodeRuntime(), [join(root, "apps/web/node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3107"], { cwd: join(project, "apps/web"), env: { ...childEnv, NEXT_PUBLIC_CONVEX_URL: cloud, NEXT_PUBLIC_BUILDIT_E2E: "1" }, stdio: ["ignore", "inherit", "inherit"] });
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  child.on("exit", code => { process.exitCode = code ?? 1; });
} else throw new Error("Choose prepare, backend, deploy, seed, renew-auth, build-web, or web.");
