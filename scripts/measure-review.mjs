// What one review cost and how long it took, read from production - and the same for two groups of
// reviews side by side, so a change to the model pipeline is judged by numbers, not by impression.
//
//   node scripts/measure-review.mjs <reviewId> [...]
//   node scripts/measure-review.mjs --compare <before…> -- <after…>
//
// Read-only (`convex run --prod --inline-query`). It prints counts, durations, hashes and verdict
// codes only: no source, no finding text, no model output.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const compare = args[0] === "--compare";
const ids = (compare ? args.slice(1) : args).filter(value => value !== "--");
if (!ids.length || ids.some(id => !/^[a-z0-9]{20,40}$/.test(id))) {
  console.error("usage: node scripts/measure-review.mjs <reviewId> [...] | --compare <before…> -- <after…>");
  process.exit(2);
}

const query = `
import { query } from "convex:/_system/repl/wrappers.js";
export default query(async (ctx) => {
  const ids = ${JSON.stringify(ids)};
  const rows = [];
  for (const id of ids) {
    const review = await ctx.db.get(id);
    if (!review) { rows.push({ id, missing: true }); continue; }
    const calls = await ctx.db.query("modelInvocations").withIndex("by_review_status", q => q.eq("reviewId", review._id)).collect();
    const stages = await ctx.db.query("modelStageRuns").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const events = await ctx.db.query("reviewEvents").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const findings = await ctx.db.query("findings").withIndex("by_review_severity", q => q.eq("reviewId", review._id)).collect();
    const runs = await ctx.db.query("runState").withIndex("by_review", q => q.eq("reviewId", review._id)).collect();
    const analysis = runs.find(run => run.stage === "analysis");
    const at = type => events.filter(event => event.type === type).map(event => event._creationTime);
    const stageDone = name => events.find(event => event.type === "stage_completed" && event.stage === name)?._creationTime;
    rows.push({
      id, provider: review.provider, model: review.model, status: review.status, reason: review.statusReasonCode,
      created: review._creationTime,
      contextDone: stageDone("context"), validationDone: stageDone("validation"), analysisDone: stageDone("analysis"),
      completed: Math.max(...at("status_changed"), 0) || undefined,
      calls: calls.filter(call => call.status !== "not_charged").map(call => ({ stage: call.stage, model: call.model, status: call.status,
        input: call.inputTokens ?? 0, output: call.outputTokens ?? 0, cached: call.cachedInputTokens ?? 0, costMicros: call.costMicros ?? 0 })),
      stageRuns: stages.map(run => ({ stage: run.stage, promptVersion: run.promptVersion, attempt: run.attempt, outcome: run.outcome, durationMs: run.durationMs ?? 0 })),
      analysis: analysis ? { durationMs: analysis.durationMs, plannedStages: analysis.plannedStages, skippedStages: analysis.skippedStages,
        coverage: analysis.coverage, coverageGap: analysis.coverageGap, filesSelected: analysis.filesSelected, filesChanged: analysis.filesChanged } : null,
      findings: findings.map(item => ({ pathHmac: item.pathHmac.slice(0, 12), category: item.category, severity: item.severity,
        lines: [item.startLine, item.endLine], blocking: item.blocking, resolution: item.resolution })),
    });
  }
  return [JSON.stringify(rows)];
});`;

const raw = execFileSync("pnpm", ["exec", "convex", "run", "--prod", "--inline-query", query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const rows = JSON.parse(JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1))[0]);

const seconds = (from, to) => from && to ? Math.round((to - from) / 100) / 10 : undefined;
function summary(row) {
  if (row.missing) return { id: row.id, missing: true };
  const input = row.calls.reduce((sum, call) => sum + call.input, 0), output = row.calls.reduce((sum, call) => sum + call.output, 0);
  return {
    id: row.id, provider: row.provider, verdict: `${row.status}/${row.reason}`,
    calls: row.calls.length, inputTokens: input, outputTokens: output, cachedTokens: row.calls.reduce((sum, call) => sum + call.cached, 0),
    costUsd: Math.round(row.calls.reduce((sum, call) => sum + call.costMicros, 0)) / 1e6,
    modelSeconds: Math.round(row.stageRuns.reduce((sum, run) => sum + run.durationMs, 0) / 100) / 10,
    analysisSeconds: seconds(row.validationDone, row.analysisDone), consentToVerdictSeconds: seconds(row.created, row.completed),
    stages: row.calls.map(call => `${call.stage}:${call.model}:${Math.round(call.input / 1000)}k`),
    coverage: row.analysis ? `${row.analysis.coverage ?? "?"}${row.analysis.coverageGap ? ` (${row.analysis.coverageGap})` : ""}` : "?",
    skipped: (row.analysis?.skippedStages ?? []).map(item => item.stage),
    findings: row.findings.map(item => `${item.pathHmac}:${item.lines.join("-")}:${item.category}:${item.severity}:${item.resolution}${item.blocking ? ":blocking" : ""}`),
  };
}

const summaries = rows.map(summary);
if (!compare) {
  console.log(JSON.stringify(summaries, null, 2));
} else {
  const split = args.indexOf("--", 1), before = summaries.slice(0, split - 1), after = summaries.slice(split - 1);
  const mean = (group, key) => { const values = group.map(item => item[key]).filter(value => typeof value === "number"); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined; };
  const metrics = ["calls", "inputTokens", "outputTokens", "cachedTokens", "costUsd", "modelSeconds", "analysisSeconds", "consentToVerdictSeconds"];
  const table = Object.fromEntries(metrics.map(key => {
    const a = mean(before, key), b = mean(after, key);
    return [key, { before: a, after: b, change: a && b !== undefined ? `${Math.round(((b - a) / a) * 1000) / 10}%` : undefined }];
  }));
  console.log(JSON.stringify({ before: before.map(item => item.id), after: after.map(item => item.id),
    verdicts: { before: before.map(item => item.verdict), after: after.map(item => item.verdict) },
    findings: { before: before.map(item => item.findings), after: after.map(item => item.findings) }, metrics: table }, null, 2));
}
