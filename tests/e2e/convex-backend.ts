// Which Convex deployment the browser suite talks to is decided by NEXT_PUBLIC_CONVEX_URL, baked
// into the Next build before a single test runs. Nothing tracked in this repository sets it: CI and
// the release workflow set it at job level, `scripts/deploy-buildit-web.mjs` defaults it, and a
// developer's machine gets it from `apps/web/.env.local` - a gitignored file the repository had
// never described. So a green CI run said nothing about a local one, and /proof - the only public
// page that reads live data - quietly talked to whatever backend that file happened to name.
//
// This module resolves that URL the same way the build will and asks the deployment whether it
// actually serves the query /proof needs, so the answer is a sentence about the environment instead
// of a red assertion about the page. It is imported by tests/e2e/onboarding.spec.ts and run once as
// a preflight by playwright.config.ts's webServer command:
//
//   pnpm exec tsx tests/e2e/convex-backend.ts --preflight
//
// Not a *.spec.ts / *.test.ts name on purpose: Playwright and Vitest both collect by that suffix,
// and this is a helper, not a case.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const PROOF_QUERY = "publicProof:summary";

// The deployment CI, the release workflow and the deploy script all point at. Named here only so
// the failure message can tell a developer where the functions do exist; nothing in this file ever
// selects it, because defaulting a local build to production would point `pnpm dev` - every read
// and every write of every other page - at the production database.
const CI_DEPLOYMENT = "https://judicious-barracuda-968.convex.cloud";

// Next loads env files from the app directory (apps/web), never from the repository root, and never
// overwrites a variable already present in the shell. That precedence is the entire reason CI is
// green while a local run is not.
const ENV_FILES = [".env.production.local", ".env.local", ".env.production", ".env"] as const;

function repositoryRoot(): string {
  let directory = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(process.cwd());
    directory = parent;
  }
}

// Enough of dotenv to read one unquoted or quoted assignment. Deliberately not a dependency: this
// runs before `next build` and must not be able to fail for a reason of its own.
function readEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!existsSync(file)) return values;
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) value = value.slice(1, -1);
    else value = value.split(" #")[0]!.trim();
    values[key] = value;
  }
  return values;
}

export function resolveConvexUrl(): { url?: string; source?: string } {
  const shell = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (shell) return { url: shell, source: "NEXT_PUBLIC_CONVEX_URL in the shell environment" };
  const webRoot = join(repositoryRoot(), "apps", "web");
  for (const name of ENV_FILES) {
    const value = readEnvFile(join(webRoot, name)).NEXT_PUBLIC_CONVEX_URL?.trim();
    if (value) return { url: value, source: `apps/web/${name}` };
  }
  return {};
}

export type ProofBackend =
  | { state: "unconfigured" }
  | { state: "serving"; url: string; source: string; reviews: number }
  | { state: "not-deployed"; url: string; source: string; message: string }
  | { state: "query-failed"; url: string; source: string; message: string }
  | { state: "unreachable"; url: string; source: string; message: string };

export async function probeProofBackend(timeoutMs = 15_000): Promise<ProofBackend> {
  const { url, source } = resolveConvexUrl();
  if (!url || !source) return { state: "unconfigured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/query", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: PROOF_QUERY, args: {}, format: "json" }),
      signal: controller.signal,
    });
    if (!response.ok) return { state: "unreachable", url, source, message: `HTTP ${response.status} from ${url}/api/query` };
    const body = (await response.json()) as { status?: string; errorMessage?: string; value?: { reviews?: { counted?: number } } };
    if (body.status === "success") return { state: "serving", url, source, reviews: body.value?.reviews?.counted ?? 0 };
    const message = (body.errorMessage ?? "the deployment returned an error carrying no message").trim().replace(/\s+/g, " ");
    // The distinction the skip in onboarding.spec.ts rests on. Convex answers a call for a function
    // it has never been given with this exact sentence and nothing else; a query that IS deployed
    // and genuinely broken answers with its own error. Only the first is the environment's fault,
    // so only the first may excuse a test.
    if (/could not find public function/i.test(message)) return { state: "not-deployed", url, source, message };
    return { state: "query-failed", url, source, message };
  } catch (error) {
    return { state: "unreachable", url, source, message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

// One probe per process. Playwright gives each worker its own process, so this costs one request
// per worker rather than one per test.
let pending: Promise<ProofBackend> | undefined;
export function proofBackend(): Promise<ProofBackend> {
  pending ??= probeProofBackend();
  return pending;
}

export function describeProofBackend(backend: ProofBackend): string {
  const rule = "-".repeat(78);
  const block = (title: string, lines: string[]) => [rule, `BuildIT e2e | ${title}`, ...lines, rule].join("\n");

  switch (backend.state) {
    case "unconfigured":
      return block("NEXT_PUBLIC_CONVEX_URL is not set", [
        "  No shell variable and no apps/web/.env file supplies it, so `next build` cannot run:",
        "  apps/web/src/app/convex-client-provider.tsx throws without it, and the browser suite has",
        "  nothing to test. Note the path - Next reads apps/web/.env.local, not the root .env.local.",
        "",
        "    printf 'NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud\\n' > apps/web/.env.local",
        "",
        `  /proof additionally needs a deployment that serves ${PROOF_QUERY}. CI uses`,
        `  ${CI_DEPLOYMENT}; see .env.example.`,
      ]);
    case "serving":
      return `BuildIT e2e | ${backend.url} serves ${PROOF_QUERY} (${backend.reviews} reviews, via ${backend.source}). /proof assertions will run.`;
    case "not-deployed":
      return block(`this deployment does not serve ${PROOF_QUERY}`, [
        `  configured by: ${backend.source}`,
        `  deployment:    ${backend.url}`,
        `  it answered:   ${backend.message}`,
        "",
        "  /proof renders its error boundary against this backend, in `pnpm dev` as well as here, so",
        "  the onboarding journey's live-number assertions are SKIPPED rather than reported as a",
        "  product failure. The page is fine; the environment does not carry the query it reads.",
        "",
        "  To get that coverage back, either push the functions to the deployment this checkout",
        "  already names (`npx convex dev --once`, which deploys to CONVEX_DEPLOYMENT from the root",
        "  .env.local - note it starts empty, and /proof reports zero rather than inventing a",
        `  figure), or set NEXT_PUBLIC_CONVEX_URL in apps/web/.env.local to ${CI_DEPLOYMENT},`,
        "  which is what CI builds against. The second is not the default here on purpose: it points",
        "  every other local page, and every `pnpm dev` session, at the production database.",
      ]);
    case "query-failed":
      return block(`${PROOF_QUERY} is deployed and returned an error`, [
        `  configured by: ${backend.source}`,
        `  deployment:    ${backend.url}`,
        `  it answered:   ${backend.message}`,
        "",
        "  The function exists, so this is the query failing rather than the environment lacking it.",
        "  Nothing is skipped: /proof assertions run and are allowed to fail.",
      ]);
    case "unreachable":
      return block("the configured Convex deployment could not be reached", [
        `  configured by: ${backend.source}`,
        `  deployment:    ${backend.url}`,
        `  the attempt:   ${backend.message}`,
        "",
        "  Unreachable is not the same as 'the function is missing', and this suite refuses to guess",
        "  which. Nothing is skipped: /proof assertions run and are allowed to fail.",
      ]);
  }
}

// `--preflight` rather than a main-module check: Playwright compiles this file to CommonJS when the
// spec imports it, so import.meta is not available, and an explicit flag cannot misfire.
if (process.argv.includes("--preflight")) {
  void (async () => {
    const backend = await probeProofBackend();
    // stderr, and webServer.stderr is "pipe": Playwright forwards it, so this prints on every run
    // whatever reporter is in use, which is the point. A skip counted in a summary is not telling
    // anybody anything.
    process.stderr.write(`\n${describeProofBackend(backend)}\n\n`);
    // The only state worth stopping for. Without the variable the build throws, and the developer
    // would otherwise wait out a 120-second webServer timeout to be told "Timed out".
    if (backend.state === "unconfigured") process.exit(1);
  })();
}
