// One read of a production review's numbers, shared by every script that judges reviews by them:
// measure-review.mjs (cost and latency) and the production benchmark (cross-checking what a review
// published against what it stored). Two copies of this query would drift the way two copies of a
// verdict did.
//
// Read-only (`convex run --prod --inline-query`). It returns counts, durations, hashes and codes
// only: no source, no finding text, no model output.
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

// The selector is spliced into the query source, so it is validated to a shape that cannot carry
// anything but ids and integers.
function selectorSource(selector) {
  if (Array.isArray(selector.ids)) {
    if (!selector.ids.length || selector.ids.some(id => typeof id !== "string" || !/^[a-z0-9]{20,40}$/.test(id))) throw new Error("review_read_ids_invalid");
    return `const ids = ${JSON.stringify(selector.ids)}; const reviews = []; for (const id of ids) reviews.push((await ctx.db.get(id)) ?? { _id: id, missing: true });`;
  }
  const { githubRepositoryId, prNumber, since } = selector;
  if (![githubRepositoryId, prNumber, since].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("review_read_selector_invalid");
  return `const repositories = await ctx.db.query("repositories").withIndex("by_github_id", q => q.eq("githubRepositoryId", ${githubRepositoryId})).collect();
    const reviews = [];
    for (const repository of repositories) {
      reviews.push(...await ctx.db.query("reviews").withIndex("by_repo_pr_created", q => q.eq("repositoryId", repository._id).eq("prNumber", ${prNumber}).gte("createdAt", ${since})).collect());
    }`;
}

function reviewQuery(selector) {
  return `
import { query } from "convex:/_system/repl/wrappers.js";
export default query(async (ctx) => {
  ${selectorSource(selector)}
  const rows = [];
  for (const review of reviews) {
    if (review.missing) { rows.push({ id: review._id, missing: true }); continue; }
    const calls = await ctx.db.query("modelInvocations").withIndex("by_review_status", q => q.eq("reviewId", review._id)).collect();
    const stages = await ctx.db.query("modelStageRuns").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const events = await ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const findings = await ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", review._id)).collect();
    const runs = await ctx.db.query("runState").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const analysis = runs.find(run => run.stage === "analysis");
    const validation = runs.find(run => run.stage === "validation");
    const at = type => events.filter(event => event.type === type).map(event => event._creationTime);
    const stageDone = name => events.find(event => event.type === "stage_completed" && event.stage === name)?._creationTime;
    rows.push({
      id: review._id, provider: review.provider, model: review.model, promptVersion: review.promptVersion,
      mode: review.mode, trigger: review.trigger, prNumber: review.prNumber, headSha: review.headSha,
      status: review.status, reason: review.statusReasonCode,
      created: review._creationTime, createdAt: review.createdAt,
      contextDone: stageDone("context"), validationDone: stageDone("validation"), analysisDone: stageDone("analysis"),
      completed: Math.max(...at("status_changed"), 0) || undefined,
      validationMs: validation?.durationMs,
      calls: calls.filter(call => call.status !== "not_charged").map(call => ({ stage: call.stage, model: call.model, status: call.status,
        input: call.inputTokens ?? 0, output: call.outputTokens ?? 0, cached: call.cachedInputTokens ?? 0, costMicros: call.costMicros ?? 0 })),
      stageRuns: stages.map(run => ({ stage: run.stage, promptVersion: run.promptVersion, attempt: run.attempt, outcome: run.outcome, durationMs: run.durationMs ?? 0 })),
      analysis: analysis ? { durationMs: analysis.durationMs, plannedStages: analysis.plannedStages, skippedStages: analysis.skippedStages,
        coverage: analysis.coverage, coverageGap: analysis.coverageGap, filesSelected: analysis.filesSelected, filesChanged: analysis.filesChanged } : null,
      findings: findings.map(item => ({ pathHmac: item.pathHmac.slice(0, 12), category: item.category, severity: item.severity,
        lines: [item.startLine, item.endLine], blocking: item.blocking, resolution: item.resolution, reason: item.resolutionReason })),
    });
  }
  return [JSON.stringify(rows)];
});`;
}

const rowsOf = raw => JSON.parse(JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1))[0]);
const command = selector => ["exec", "convex", "run", "--prod", "--inline-query", reviewQuery(selector)];

export function readProductionReviews(selector) {
  return rowsOf(execFileSync("pnpm", command(selector), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
}

// The benchmark polls several pull requests at once; a synchronous read would stall all of them.
export async function readProductionReviewsAsync(selector) {
  const { stdout } = await promisify(execFile)("pnpm", command(selector), { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return rowsOf(stdout);
}
