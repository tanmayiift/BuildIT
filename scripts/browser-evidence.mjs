#!/usr/bin/env node
// Signed-in and two-user browser evidence, run on demand: `pnpm evidence:browser`.
//
// CI cannot hold a BuildIT login. Refresh tokens are single-use - Convex Auth invalidates a session
// when one is replayed after ten seconds - so a login saved into a repository secret survives one
// refresh, and every later run would be signed out. Accounts that sign in to GitHub through Google
// cannot sign in inside a Playwright-launched browser at all. So this opens two ordinary Chrome
// windows with throwaway profiles, the account owners sign in by hand, and the existing specs run
// inside those windows over a loopback debugging port (tests/live-browser.ts). No login is read,
// printed or written anywhere: both sessions are signed out and both profiles deleted at the end.
//
// The result is written to docs/evidence/browser-evidence-<UTC date>.md; CI warns when the newest
// one is older than 14 days.
/* global localStorage -- read only inside page.evaluate, which runs in the browser */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

const baseURL = process.env.BUILDIT_E2E_BASE_URL ?? "https://buildit-agentic-review.vercel.app";
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// The two fixture identities and what each owns, as proven on 4 Oct 2026
// (docs/evidence/two-user-isolation-2026-10-04.md). Each can be overridden from the environment.
const fixture = {
  BUILDIT_E2E_USER_A_LOGIN: "tanmayiift",
  BUILDIT_E2E_USER_B_LOGIN: "smratipahwa",
  BUILDIT_E2E_USER_A_ORG: "tanmayiift's workspace",
  BUILDIT_E2E_USER_B_ORG: "smratipahwa's workspace",
  BUILDIT_E2E_USER_A_MARKER: "tanmayiift/buildit-demo-p-queue",
  BUILDIT_E2E_USER_B_MARKER: "smratipahwa/buildit-isolation-fixture-b",
  BUILDIT_E2E_USER_A_REVIEW: "/reviews/nx77xcxdqv34j1k309hsy7t1818fnzwf",
  BUILDIT_E2E_USER_B_REVIEW: "/reviews/nx7ebsdbr9hdh4q6pb946hrm2n8djhk0",
};
const env = Object.fromEntries(Object.entries(fixture).map(([name, value]) => [name, process.env[name] ?? value]));
const login = { a: env.BUILDIT_E2E_USER_A_LOGIN, b: env.BUILDIT_E2E_USER_B_LOGIN };

if (!baseURL.startsWith("https://")) throw new Error("https_target_required");
if (!existsSync(chromePath)) throw new Error(`chrome_not_found: set CHROME_PATH (looked in ${chromePath})`);

function openWindow(label) {
  const profile = mkdtempSync(join(tmpdir(), `buildit-evidence-${label}-`));
  const child = spawn(chromePath, [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--no-first-run",
    "--no-default-browser-check", `${baseURL}/sign-in`], { stdio: "ignore" });
  return { label, profile, child };
}

async function endpointOf(window) {
  // Chrome writes the port it chose to DevToolsActivePort in the profile it was given.
  const file = join(window.profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 150; attempt++) {
    if (existsSync(file)) {
      const port = readFileSync(file, "utf8").split("\n")[0]?.trim();
      if (port && /^\d+$/.test(port)) return `http://127.0.0.1:${port}`;
    }
    await sleep(100);
  }
  throw new Error(`chrome_debugging_port_missing_${window.label}`);
}

// Whether a window holds a BuildIT session, by the presence of the auth key - never its value.
async function signedIn(endpoint) {
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const page = browser.contexts()[0]?.pages().find(candidate => candidate.url().startsWith(baseURL));
    return page ? await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("__convexAuthJWT_"))) : false;
  } finally { await browser.close(); }
}

async function signOut(endpoint) {
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const page = await browser.contexts()[0].newPage();
    await page.goto(`${baseURL}/account`);
    await page.getByRole("button", { name: "Sign out this browser" }).click({ timeout: 15_000 });
    await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith("__convexAuthJWT_")), undefined, { timeout: 15_000 });
    return true;
  } catch { return false; } finally { await browser.close(); }
}

function runSuite(config, extra) {
  const output = join(tmpdir(), `buildit-evidence-${process.pid}-${config.replace(/\W/g, "")}.json`);
  const result = spawnSync("npx", ["playwright", "test", "--config", config, "--reporter=json"], {
    env: { ...process.env, ...env, ...extra, BUILDIT_E2E_BASE_URL: baseURL, PLAYWRIGHT_JSON_OUTPUT_NAME: output },
    encoding: "utf8", stdio: ["ignore", "ignore", "inherit"],
  });
  const rows = [];
  if (existsSync(output)) {
    const walk = suite => {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1);
        rows.push({ title: spec.title, project: test.projectName, status: last?.status ?? "not_run",
          error: last?.error?.message?.split("\n")[0]?.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 200) });
      }
      for (const child of suite.suites ?? []) walk(child);
    };
    for (const suite of JSON.parse(readFileSync(output, "utf8")).suites ?? []) walk(suite);
    rmSync(output, { force: true });
  }
  return { exitCode: result.status, rows };
}

const windows = [openWindow("a"), openWindow("b")];
let exitCode = 1;
try {
  const [endpointA, endpointB] = [await endpointOf(windows[0]), await endpointOf(windows[1])];
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\nTwo Chrome windows opened on ${baseURL}/sign-in, each with a fresh profile.`);
  console.log(`  Window 1: sign in as ${login.a}.  Window 2: sign in as ${login.b}.`);
  console.log("Wait until each shows its own review queue, then press Enter here.");
  await prompt.question("");
  prompt.close();
  for (const [endpoint, name] of [[endpointA, login.a], [endpointB, login.b]]) {
    if (!(await signedIn(endpoint))) throw new Error(`not_signed_in: the window for ${name} has no BuildIT session`);
  }

  const startedAt = new Date();
  const isolation = runSuite("playwright.tenant.config.ts", { BUILDIT_E2E_USER_A_CDP: endpointA, BUILDIT_E2E_USER_B_CDP: endpointB });
  const journey = runSuite("playwright.session.config.ts", { BUILDIT_E2E_SESSION_CDP: endpointA, BUILDIT_E2E_SESSION_LOGIN: login.a });
  const rows = [...isolation.rows, ...journey.rows];
  const ran = rows.filter(row => row.status !== "skipped");
  const passed = ran.length >= 3 && ran.every(row => row.status === "passed") && isolation.exitCode === 0 && journey.exitCode === 0;

  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const day = startedAt.toISOString().slice(0, 10);
  const lines = [
    `# Browser evidence, ${day}`,
    "",
    `Produced by \`pnpm evidence:browser\` against ${baseURL}, started ${startedAt.toISOString()} from checkout \`${commit}\`.`,
    `Two real identities, each signed in by its owner in its own Chrome profile: \`${login.a}\` and \`${login.b}\`.`,
    "Both sessions were signed out and both profiles deleted afterwards.",
    "",
    `**Result: ${passed ? "passed" : "FAILED"}.**`,
    "",
    "| Suite | Identity | Test | Result |",
    "|---|---|---|---|",
    ...rows.map(row => `| ${row.project === "session" ? "signed-in journey" : "two-user isolation"} | ${row.project} | ${row.title} | ${row.status}${row.error ? ` - ${row.error.replaceAll("|", "\\|")}` : ""} |`),
    "",
  ];
  const path = `docs/evidence/browser-evidence-${day}.md`;
  writeFileSync(path, lines.join("\n"));
  console.log(`\n${passed ? "Passed" : "FAILED"}: ${ran.filter(row => row.status === "passed").length} of ${ran.length} tests. Written to ${path}.`);
  exitCode = passed ? 0 : 1;
} finally {
  for (const window of windows) {
    const endpoint = await endpointOf(window).catch(() => undefined);
    const out = endpoint ? await signOut(endpoint) : false;
    if (!out) console.log(`Could not sign out window ${window.label}; its session expires after 7 days without use.`);
    window.child.kill();
  }
  await sleep(1_000);
  for (const window of windows) rmSync(window.profile, { recursive: true, force: true });
}
process.exit(exitCode);
