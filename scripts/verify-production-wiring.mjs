#!/usr/bin/env node

const required = [
  "BUILDIT_WEB_CONVEX_URL",
  "BUILDIT_BROKER_CONVEX_URL",
  "BUILDIT_EXPECTED_CONVEX_URL",
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`BuildIT wiring check failed: missing ${missing.join(", ")}.`);
  process.exit(2);
}

function deploymentHost(name) {
  const value = process.env[name];
  let url;
  try {
    url = new URL(value);
  } catch {
    console.error(`BuildIT wiring check failed: ${name} is not a URL.`);
    process.exit(2);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    console.error(`BuildIT wiring check failed: ${name} must be a plain HTTPS deployment origin.`);
    process.exit(2);
  }
  if (!url.hostname.endsWith(".convex.cloud")) {
    console.error(`BuildIT wiring check failed: ${name} is not a Convex deployment host.`);
    process.exit(2);
  }
  return url.hostname;
}

const webHost = deploymentHost("BUILDIT_WEB_CONVEX_URL");
const brokerHost = deploymentHost("BUILDIT_BROKER_CONVEX_URL");
const expectedHost = deploymentHost("BUILDIT_EXPECTED_CONVEX_URL");

console.log(`web=${webHost}`);
console.log(`broker=${brokerHost}`);
console.log(`expected=${expectedHost}`);

if (new Set([webHost, brokerHost, expectedHost]).size !== 1) {
  console.error("BuildIT wiring check failed: web, broker, and expected production deployments differ.");
  process.exit(1);
}

console.log("BuildIT production wiring matches.");
