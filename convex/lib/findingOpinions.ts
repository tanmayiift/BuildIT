import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// One current opinion per person; the most recent person's explicit decision determines the
// finding's current feedback classification. Counts never multiply one finding by its voters.
export function distinctFindingOpinions(rows: Doc<"findingFeedback">[]) {
  const latest = new Map<string, Doc<"findingFeedback">>();
  for (const row of rows) {
    const key = String(row.findingId ?? `${row.reviewId}:${row.fingerprintHmac}`);
    const prior = latest.get(key);
    if (!prior || row.occurredAt > prior.occurredAt || (row.occurredAt === prior.occurredAt && row._creationTime > prior._creationTime)) latest.set(key, row);
  }
  return [...latest.values()];
}

export async function recordFindingOpinion(ctx: MutationCtx, finding: Doc<"findings">, review: Doc<"reviews">, input: { verdict: "accepted" | "dismissed"; actorHash: string; now: number }) {
  if (finding.organizationId !== review.organizationId || finding.reviewId !== review._id) throw new Error("not_found_or_forbidden");
  const previous = await ctx.db.query("findingFeedback").withIndex("by_finding_actor", q => q.eq("findingId", finding._id).eq("actorHash", input.actorHash)).unique();
  if (previous && previous.occurredAt > input.now) return;
  if (previous) await ctx.db.patch(previous._id, { verdict: input.verdict, occurredAt: input.now });
  else await ctx.db.insert("findingFeedback", { organizationId: review.organizationId, repositoryId: review.repositoryId, reviewId: review._id, findingId: finding._id, fingerprintHmac: finding.fingerprintHmac, ruleKey: finding.ruleId ?? finding.category, pathPrefixHmac: finding.pathHmac, verdict: input.verdict, actorHash: input.actorHash, occurredAt: input.now });
  // Late deliveries must not undo a newer decision. Acceptance says the finding is valid and
  // still needs action; it is not evidence that a fix was applied.
  if (input.now >= finding.updatedAt && finding.resolution !== "fixed") await ctx.db.patch(finding._id, { resolution: input.verdict === "dismissed" ? "dismissed" : "open", updatedAt: input.now });
}
