import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Both the usage and metrics summaries re-verified every row's parents with two or three
// ctx.db.get calls per row. One ledger row is written per model stage run, so a busy month is
// tens of thousands of rows and three times as many reads - past Convex's per-query read limit,
// where the query does not degrade but hard-fails, on a live dashboard subscription.
//
// The check itself is worth keeping: it catches a row whose repositoryId or reviewId points into
// another organization. It just does not need repeating per row. Distinct parents are verified
// once and remembered, so the reads scale with the number of repositories and reviews a tenant
// has rather than with the number of ledger rows.
export const summaryRowCeiling = 20_000;
// db.get also consumes an index range. Reserve headroom beneath Convex's 4,096 range limit
// for authorization, the source query, and the monthly accounting snapshot.
export const summaryParentReadCeiling = 3_000;

export function parentScopeChecker(ctx: QueryCtx, organizationId: Id<"organizations">) {
  const repositories = new Map<string, { organizationId: Id<"organizations"> }>();
  const reviews = new Map<string, { organizationId: Id<"organizations">; repositoryId: Id<"repositories"> }>();
  const rounds = new Map<string, { organizationId: Id<"organizations">; reviewId: Id<"reviews"> }>();
  let parentReads = 0;

  function canCheck(row: { repositoryId?: Id<"repositories">; reviewId?: Id<"reviews">; roundId?: Id<"autofixRounds"> }) {
    const review = row.reviewId ? reviews.get(row.reviewId) : undefined;
    const repositoryId = row.repositoryId ?? review?.repositoryId;
    const newReviewReads = row.reviewId && !review ? 1 : 0;
    const newRepositoryReads = repositoryId ? Number(!repositories.has(repositoryId)) : newReviewReads;
    const newRoundReads = row.roundId ? Number(!rounds.has(row.roundId)) : 0;
    return parentReads + newReviewReads + newRepositoryReads + newRoundReads <= summaryParentReadCeiling;
  }

  async function repository(id: Id<"repositories">) {
    const cached = repositories.get(id);
    if (cached) return cached;
    const row = await ctx.db.get(id);
    parentReads++;
    if (!row || row.organizationId !== organizationId) throw new Error("not_found_or_forbidden");
    repositories.set(id, row);
    return row;
  }

  async function review(id: Id<"reviews">) {
    const cached = reviews.get(id);
    if (cached) return cached;
    const row = await ctx.db.get(id);
    parentReads++;
    if (!row || row.organizationId !== organizationId) throw new Error("not_found_or_forbidden");
    reviews.set(id, row);
    return row;
  }

  async function round(id: Id<"autofixRounds">, reviewId: Id<"reviews">) {
    const cached = rounds.get(id) ?? await (async () => {
      const row = await ctx.db.get(id);
      parentReads++;
      if (!row || row.organizationId !== organizationId) throw new Error("not_found_or_forbidden");
      rounds.set(id, row);
      return row;
    })();
    if (cached.reviewId !== reviewId) throw new Error("not_found_or_forbidden");
    return cached;
  }

  return { repository, review, round, canCheck };
}
