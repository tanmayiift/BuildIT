// The trust page said "nine reviews across two repositories" long after it was 102 across five.
// A number typed into prose goes stale the moment the thing it describes moves, and a stale number
// on a trust page is worse than no number: it is a measurable claim that is measurably wrong.
//
// So the number has one home. This reads production, writes docs/evidence/track-record.json, and
// both pages render from that file. Regenerating is one command; nothing is hand-typed.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const query = `
import { query } from "convex:/_system/repl/wrappers.js";
export default query(async (ctx) => {
  const reviews = await ctx.db.query("reviews").order("desc").take(1000);
  const decisive = new Set(["checks_passed", "changes_requested", "delivered"]);
  const failed = reviews.filter(r => r.status === "platform_failed");
  const last = failed[0];
  const since = last ? reviews.filter(r => r._creationTime > last._creationTime) : reviews;
  return [JSON.stringify({
    repositories: new Set(reviews.map(r => String(r.repositoryId))).size,
    reviews: reviews.length,
    decisive: reviews.filter(r => decisive.has(r.status)).length,
    platformFailed: failed.length,
    sinceLastPlatformFailure: since.length,
    lastPlatformFailureAt: last ? new Date(last._creationTime).toISOString().slice(0, 10) : null,
  })];
});`;

const raw = execFileSync("pnpm", ["exec", "convex", "run", "--prod", "--inline-query", query], { encoding: "utf8" });
const payload = JSON.parse(raw.slice(raw.indexOf("[")).match(/"(\{.*\})"/)[1].replace(/\\"/g, '"'));
writeFileSync("apps/web/src/app/track-record.json", `${JSON.stringify({ ...payload, generatedAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
console.log(JSON.stringify(payload));
