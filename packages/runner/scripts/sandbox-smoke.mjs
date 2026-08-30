import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Sandbox } from "@vercel/sandbox";

if (!process.env.VERCEL_OIDC_TOKEN) {
  const path = fileURLToPath(new URL("../../../.env.local", import.meta.url));
  const line = readFileSync(path, "utf8").split(/\r?\n/).find(value => value.startsWith("VERCEL_OIDC_TOKEN="));
  if (!line) throw new Error("vercel_oidc_token_missing");
  process.env.VERCEL_OIDC_TOKEN = line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "");
}

const probe = String.raw`
const dns=require("node:dns/promises"),fs=require("node:fs"),cp=require("node:child_process");
const blocked=async fn=>{try{await fn();return false}catch{return true}};
(async()=>{
  const dnsBlocked=await blocked(()=>dns.lookup("example.com"));
  const httpsBlocked=await blocked(()=>fetch("https://example.com",{signal:AbortSignal.timeout(3000)}));
  const metadataBlocked=await blocked(()=>fetch("http://169.254.169.254/latest/meta-data/",{signal:AbortSignal.timeout(3000)}));
  let gitCredentialAbsent=false;
  try{cp.execFileSync("git",["config","--global","--get","credential.helper"],{stdio:"pipe"})}catch{gitCredentialAbsent=true}
  const pattern=/(GITHUB|CONVEX|ANTHROPIC|OPENAI|GEMINI|VERCEL_OIDC|AWS_ACCESS_KEY|AWS_SECRET|AWS_SESSION)/;
  const ownSecretNames=Object.keys(process.env).filter(key=>pattern.test(key));
  let parentSecretNames=[];
  try{parentSecretNames=fs.readFileSync("/proc/1/environ").toString().split("\0").map(value=>value.split("=")[0]).filter(key=>pattern.test(key))}catch{}
  console.log(JSON.stringify({dnsBlocked,httpsBlocked,metadataBlocked,gitCredentialAbsent,ownSecretNames,parentSecretNames}));
})()`;

const sandbox = await Sandbox.create({ runtime: "node22", timeout: 60_000, resources: { vcpus: 2 }, networkPolicy: "deny-all", env: { CI: "true" }, region: "cdg1", persistent: false });
try {
  const result = await sandbox.runCommand({ cmd: "node", args: ["-e", probe], timeoutMs: 15_000 });
  const evidence = JSON.parse(await result.stdout());
  if (result.exitCode !== 0 || !evidence.dnsBlocked || !evidence.httpsBlocked || !evidence.metadataBlocked || !evidence.gitCredentialAbsent || evidence.ownSecretNames.length || evidence.parentSecretNames.length) throw new Error("sandbox_exfiltration_probe_failed");
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  await sandbox.stop();
}
