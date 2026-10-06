// pnpm eval:production plan                      pins, projected cost and sandbox time (default)
// pnpm eval:production post --label R0 --runs 3 --cpu-hours-left <n>
// pnpm eval:production score <runs.json> [--policy published|critical-high]
//
// Runs the historical set against production exactly as a user would: a `@buildit review` comment
// on each pull request, then the report BuildIT published, cross-checked against what it stored.
// It holds no API key. It uses `gh` as the signed-in maintainer and a read-only production query.
//
// `post` writes after every run and skips runs already settled, so an interrupted benchmark resumes.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { historicalCases, historicalLabelDigest, historicalSetVersion, type HistoricalCase } from "./historicalCases.js";
import {
  completedStatuses, crossCheck, parseReportFindings, platformEndStatuses, recordFinding, runIsSettled, scoreRuns,
  type BlockingPolicy, type RunRecord, type RunsFile,
} from "./productionBenchmark.js";

const run = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const checkName = "BuildIT / review";
const appSlug = "buildit-agentic-review";

type StoredRow = {
  id: string; missing?: boolean; status: string; reason?: string; mode: string; trigger: string; createdAt: number;
  created: number; completed?: number; contextDone?: number; validationDone?: number;
  model: string; calls: Array<{ input: number; cached: number; costMicros: number }>;
  stageRuns: Array<{ stage: string; promptVersion: string; attempt: number }>;
  findings: Array<{ severity: string; blocking: boolean; resolution: string; lines: [number?, number?] }>;
};
type Reader = (selector: { githubRepositoryId: number; prNumber: number; since: number }) => Promise<StoredRow[]>;

// The shared read lives with the scripts that use it (scripts/lib), outside this package's build.
async function reader(): Promise<Reader> {
  const module = await import(pathToFileURL(resolve(repoRoot, "scripts/lib/production-review-read.mjs")).href) as { readProductionReviewsAsync: Reader };
  return module.readProductionReviewsAsync;
}

function flag(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function target(item: HistoricalCase) {
  const match = /^https:\/\/github\.com\/([\w-]+\/[\w.-]+)\/pull\/(\d+)$/.exec(item.url);
  if (!match) throw new Error(`eval_production_url_invalid:${item.id}`);
  return { repository: match[1]!, prNumber: Number(match[2]) };
}

async function gh(args: string[]) {
  const { stdout } = await run("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function pins(item: HistoricalCase) {
  const view = JSON.parse(await gh(["pr", "view", item.url, "--json", "headRefOid,baseRefOid,state"])) as { headRefOid: string; baseRefOid: string; state: string };
  const problems = [
    view.state !== "OPEN" ? `state ${view.state}` : "",
    view.headRefOid !== item.headSha ? `head moved to ${view.headRefOid.slice(0, 12)}` : "",
    view.baseRefOid !== item.baseSha ? `base moved to ${view.baseRefOid.slice(0, 12)}` : "",
  ].filter(Boolean);
  return problems;
}

const repositoryIds = new Map<string, number>();
async function githubRepositoryId(repository: string) {
  if (!repositoryIds.has(repository)) repositoryIds.set(repository, Number(await gh(["api", `repos/${repository}`, "--jq", ".id"])));
  return repositoryIds.get(repository)!;
}

const selected = () => {
  const ids = flag("cases")?.split(",");
  const cases = ids ? historicalCases.filter(item => ids.includes(item.id)) : historicalCases;
  if (ids && cases.length !== ids.length) throw new Error("eval_production_case_unknown");
  return cases;
};

const seconds = (from?: number, to?: number) => from && to ? Math.round((to - from) / 100) / 10 : undefined;
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

async function plan() {
  const cases = selected();
  const runs = Number(flag("runs") ?? 3);
  const read = await reader();
  let moved = 0;
  const recent: StoredRow[] = [];
  for (const item of cases) {
    const problems = await pins(item);
    if (problems.length) moved += 1;
    console.log(`${problems.length ? "MOVED" : "ok   "} ${item.id.padEnd(40)} ${problems.join("; ")}`);
    const { repository, prNumber } = target(item);
    const rows = await read({ githubRepositoryId: await githubRepositoryId(repository), prNumber, since: Date.now() - 30 * 86_400_000 });
    recent.push(...rows.filter(row => row.mode === "review" && completedStatuses.has(row.status) && row.calls.length));
  }
  const last = recent.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const cost = mean(last.map(row => row.calls.reduce((sum, call) => sum + call.costMicros, 0) / 1e6));
  // Wall-clock from context done to validation done, times the sandbox's 2 vCPUs: an upper bound on
  // active CPU, which bills only time the CPU was busy.
  const sandboxSeconds = mean(last.map(row => seconds(row.contextDone, row.validationDone) ?? 0));
  const verdictSeconds = mean(last.map(row => seconds(row.created, row.completed) ?? 0));
  const reviews = cases.length * runs;
  console.log("");
  console.log(`From the last ${last.length} completed reviews of these pull requests:`);
  console.log(`  model cost      $${cost.toFixed(3)} a review → $${(cost * reviews).toFixed(2)} for ${reviews} reviews`);
  console.log(`  sandbox CPU     ≤ ${(sandboxSeconds * 2 * reviews / 3600).toFixed(2)} CPU-hours (${sandboxSeconds.toFixed(0)} s × 2 vCPU a review)`);
  console.log(`  wall clock      ~${Math.round(verdictSeconds * runs / 60)} min a case, run in sequence on one pull request`);
  if (moved) {
    console.log(`\n${moved} pull request(s) moved from their pinned commits. Benchmark them only after re-pinning in a new set version.`);
    process.exitCode = 1;
  }
}

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

async function waitForReview(read: Reader, item: HistoricalCase, before: Set<string>, since: number) {
  const { repository, prNumber } = target(item);
  const id = await githubRepositoryId(repository);
  const started = Date.now();
  for (;;) {
    const rows = await read({ githubRepositoryId: id, prNumber, since });
    const review = rows.find(row => !before.has(row.id) && row.mode === "review" && row.trigger === "github_comment");
    if (review && (completedStatuses.has(review.status) || platformEndStatuses.has(review.status))) return review;
    // A comment no review answered within three minutes was never picked up.
    if (!review && Date.now() - started > 3 * 60_000) return undefined;
    if (Date.now() - started > 30 * 60_000) return review ? { ...review, status: "timed_out" } : undefined;
    await sleep(15_000);
  }
}

async function publishedSummary(item: HistoricalCase, reviewId: string) {
  const { repository } = target(item);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = JSON.parse(await gh(["api", `repos/${repository}/commits/${item.headSha}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=latest`])) as
      { check_runs: Array<{ status: string; details_url?: string; app?: { slug?: string }; output?: { summary?: string } }> };
    const check = response.check_runs.find(entry => entry.app?.slug === appSlug);
    if (check?.status === "completed" && check.details_url?.endsWith(`/reviews/${reviewId}`) && check.output?.summary) return check.output.summary;
    await sleep(15_000);
  }
  return undefined;
}

async function oneRun(read: Reader, item: HistoricalCase, number: number, attempt: number, provider: string, label: string): Promise<RunRecord> {
  const base = { caseId: item.id, run: number, attempt, at: new Date().toISOString() };
  const problems = await pins(item);
  // A moved head is a different case. Refuse rather than record it under this one's name.
  if (problems.length) throw new Error(`eval_production_pin_moved:${item.id}:${problems.join(";")}`);
  const { repository, prNumber } = target(item);
  const since = Date.now() - 60_000;
  const before = new Set((await read({ githubRepositoryId: await githubRepositoryId(repository), prNumber, since })).map(row => row.id));
  await gh(["pr", "comment", item.url, "--body", `@buildit review provider=${provider}`]);
  const review = await waitForReview(read, item, before, since);
  if (!review) return { ...base, validity: "invalid_platform", because: "no review started" };

  const calls = review.calls;
  const stages = Object.fromEntries([...review.stageRuns].sort((a, b) => a.attempt - b.attempt).map(stage => [stage.stage, stage.promptVersion]));
  const measured = {
    reviewId: review.id, status: review.status, ...(review.reason ? { reason: review.reason } : {}),
    promptVersions: stages, model: review.model,
    costUsd: Math.round(calls.reduce((sum, call) => sum + call.costMicros, 0)) / 1e6,
    inputTokens: calls.reduce((sum, call) => sum + call.input, 0),
    cachedInputTokens: calls.reduce((sum, call) => sum + call.cached, 0),
    ...(seconds(review.created, review.completed) !== undefined ? { consentToVerdictSeconds: seconds(review.created, review.completed)! } : {}),
  };
  if (!completedStatuses.has(review.status)) return { ...base, ...measured, validity: "invalid_platform", because: `review ended ${review.status}${review.reason ? `/${review.reason}` : ""}` };

  const summary = await publishedSummary(item, review.id);
  if (!summary) return { ...base, ...measured, validity: "invalid_platform", because: "report not published to the check run" };
  // The raw report stays out of the tree: it is model prose about someone else's code, and the run
  // file keeps only what scoring needs.
  const rawDir = resolve(repoRoot, ".eval-runs", label);
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(resolve(rawDir, `${item.id}-${number}-${attempt}.md`), summary);

  let published;
  try { published = parseReportFindings(summary); } catch (error) {
    return { ...base, ...measured, validity: "invalid_parse", because: (error as Error).message };
  }
  const [stored] = await read({ githubRepositoryId: await githubRepositoryId(repository), prNumber, since }).then(rows => rows.filter(row => row.id === review.id));
  const disagreement = stored ? crossCheck(published, stored) : "stored review unreadable";
  if (disagreement) return { ...base, ...measured, validity: "invalid_parse", because: disagreement };
  return { ...base, ...measured, validity: "valid", findings: published.findings.map(finding => recordFinding(item, finding)) };
}

async function post() {
  const label = flag("label");
  if (!label || !/^[A-Za-z0-9-]{1,32}$/.test(label)) throw new Error("usage: --label <R0|R1|…>");
  const runs = Number(flag("runs") ?? 3);
  const provider = flag("provider") ?? "openai";
  const cpuLeft = Number(flag("cpu-hours-left"));
  // The sandbox plan's CPU is the one budget this cannot see. The operator reads it off the usage
  // page and states it; `plan` prints what the run needs.
  if (!Number.isFinite(cpuLeft)) throw new Error("usage: --cpu-hours-left <hours remaining on the sandbox plan> (see `plan`)");
  const cases = selected();
  const date = new Date().toISOString().slice(0, 10);
  const out = resolve(repoRoot, flag("out") ?? `docs/evidence/${historicalSetVersion}-${label}-runs-${date}.json`);
  const file: RunsFile = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) as RunsFile : {
    kind: "buildit-production-benchmark-runs", setVersion: historicalSetVersion, labelDigest: historicalLabelDigest(),
    label, provider, runsPerCase: runs, startedAt: new Date().toISOString(), runs: [],
  };
  if (file.labelDigest !== historicalLabelDigest() || file.label !== label) throw new Error("eval_production_resume_mismatch");
  const save = () => writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
  save();
  const read = await reader();
  const concurrency = Number(flag("concurrency") ?? 3);
  const queue = [...cases];
  // Cases run side by side; runs of one case run in sequence, because a second comment on the same
  // commit while a review is in flight joins that review instead of starting one.
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      for (let number = 1; number <= runs; number += 1) {
        while (!runIsSettled(file.runs, item.id, number)) {
          const attempt = file.runs.filter(entry => entry.caseId === item.id && entry.run === number).length + 1;
          const record = await oneRun(read, item, number, attempt, provider, label);
          file.runs.push(record);
          save();
          console.log(`${record.validity.padEnd(16)} ${item.id} run ${number}.${attempt} ${record.status ?? ""} ${record.because ?? ""} ${record.costUsd !== undefined ? `$${record.costUsd}` : ""}`);
        }
      }
    }
  }));
  console.log(`\nwrote ${out}`);
}

function score() {
  const path = process.argv[3];
  if (!path || path.startsWith("--")) throw new Error("usage: pnpm eval:production score <runs.json> [--policy published|critical-high]");
  const policy = (flag("policy") ?? "published") as BlockingPolicy;
  if (policy !== "published" && policy !== "critical-high") throw new Error("eval_production_policy_invalid");
  const scored = scoreRuns(JSON.parse(readFileSync(resolve(path), "utf8")) as RunsFile, policy);
  const out = resolve(flag("out") ?? path.replace(/-runs-/, `-${policy}-`));
  if (out === resolve(path)) throw new Error("eval_production_out_would_overwrite_runs");
  writeFileSync(out, `${JSON.stringify(scored, null, 2)}\n`);
  for (const item of scored.details) console.log(`  ${(item.outcome ?? "not scored").padEnd(15)} ${item.caseId.padEnd(40)} ${item.because}${item.invalidPlatform ? ` · ${item.invalidPlatform} platform failure(s)` : ""}${item.invalidParse ? ` · ${item.invalidParse} unparsed` : ""}`);
  const defects = scored.details.filter(item => item.kind === "defect" && item.outcome);
  console.log(`\n${scored.promptVersion} under ${policy}: detected ${defects.filter(item => item.outcome === "detected").length} of ${defects.length} defects; clean control ${scored.details.find(item => item.kind === "clean")?.outcome ?? "not scored"}; $${scored.totals.costUsd} over ${scored.totals.reviews} reviews`);
  console.log(`wrote ${out}`);
}

const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "plan";
const commands: Record<string, () => unknown> = { plan, post, score };
if (!commands[command]) {
  console.error("usage: pnpm eval:production [plan|post|score] …");
  process.exit(2);
}
Promise.resolve(commands[command]!()).catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
