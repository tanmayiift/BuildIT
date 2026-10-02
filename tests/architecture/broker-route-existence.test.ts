import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `convex/sandboxReclaimWorker.ts` posted to `${brokerUrl}/api/sandboxes` from the day it was
// written. The broker had no such function, so Vercel answered 404 - and the worker read that 404
// as "the broker looked and there is no such sandbox", marked the job released, and let both
// sandboxes keep running and billing by the minute. Nothing failed, nothing logged, and the attempt
// counter meant to surface an unreclaimable sandbox never got past one.
//
// Types could not catch it: the call is a string in a fetch, and the far side is a file's existence
// on disk. So the contract is asserted here instead - every broker path a caller names must be a
// route that ships, and every shipped route must be deployable.

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function callerPaths() {
  const found = new Map<string, string>();
  const walk = (directory: string) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) { if (!["node_modules", "dist", "_generated", ".next"].includes(entry.name)) walk(path); continue; }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      for (const match of read(path).matchAll(/brokerUrl[^`"']*[`"']?\/api\/([a-z-]+)/gi)) found.set(match[1]!, path);
    }
  };
  for (const directory of ["convex", "apps/web/src", "packages/orchestrator/src"]) walk(directory);
  return found;
}

describe("every broker path a caller names is a route that ships", () => {
  it("has a file and a vercel.json entry for each", () => {
    const routes = new Set(readdirSync(join(root, "packages/broker/api")).filter(name => name.endsWith(".ts")).map(name => name.replace(/\.ts$/, "")));
    const declared = new Set(Object.keys((JSON.parse(read("packages/broker/vercel.json")) as { functions: Record<string, unknown> }).functions).map(key => key.replace(/^api\//, "").replace(/\.ts$/, "")));
    const missing: string[] = [];
    for (const [route, caller] of callerPaths()) {
      if (!routes.has(route)) missing.push(`${caller} calls /api/${route}, which has no file`);
      else if (!declared.has(route)) missing.push(`/api/${route} exists but is absent from vercel.json, so it does not deploy`);
    }
    expect(missing, "a caller naming a route that does not ship gets a 404 from Vercel, not from the broker").toEqual([]);
  });

  // The caller scan above matches a variable literally named brokerUrl, which left two live routes
  // unchecked: convex/trackerOAuth.ts builds `${url.origin}/api/tracker-oauth` and the telemetry
  // workers build `${broker}/api/telemetry`. Widening the pattern to match any "/api/<name>" string
  // is worse - it picks up the web app's own Next routes, which have nothing to do with the broker.
  //
  // So assert it from the side that has no ambiguity: every file in packages/broker/api is a route
  // somebody wrote intending it to ship. A route absent from the functions map still deploys - Vercel
  // picks up everything under api/ - but it runs on default limits rather than the ones chosen for
  // it, which for /api/execute would be the difference between finishing a segment and being killed
  // mid-sandbox. Two routes were in that state, telemetry and tracker-oauth, and the caller scan
  // could not see either. No heuristic, no false positives, no blind spot.
  it("declares every broker route it ships, whatever the caller named its base variable", () => {
    const routes = readdirSync(join(root, "packages/broker/api")).filter(name => name.endsWith(".ts")).map(name => name.replace(/\.ts$/, ""));
    const declared = new Set(Object.keys((JSON.parse(read("packages/broker/vercel.json")) as { functions: Record<string, unknown> }).functions)
      .map(key => key.replace(/^api\//, "").replace(/\.ts$/, "")));
    expect(routes.length, "an empty sweep must not pass as a clean one").toBeGreaterThan(5);
    expect(routes.filter(route => !declared.has(route)),
      "a route absent from the functions map runs on default limits, not the ones chosen for it").toEqual([]);
  });

  // The other half of the same bug. A 404 is what a missing route returns, so no caller may read it
  // as a statement about the thing it asked for.
  it("never treats a bare 404 as a successful outcome", () => {
    const worker = read("convex/sandboxReclaimWorker.ts");
    expect(worker, "404 must not mean released - that is the status an absent route returns").not.toMatch(/status\s*===\s*404\s*\)\s*ok\s*=\s*true/);
  });
});
