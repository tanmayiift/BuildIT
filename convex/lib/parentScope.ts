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

export function parentScopeChecker(ctx: QueryCtx, organizationId: Id<"organizations">) {
  const repositories = new Map<string, { organizationId: Id<"organizations"> }>();
  const reviews = new Map<string, { organizationId: Id<"organizations">; repositoryId: Id<"repositories"> }>();
  const rounds = new Map<string, { organizationId: Id<"organizations">; reviewId: Id<"reviews"> }>();

  async function repository(id: Id<"repositories">) {
    const cached = repositories.get(id);
    if (cached) return cached;
    const row = await ctx.db.get(id);
    if (!row || row.organizationId !== organizationId) throw new Error("not_found_or_forbidden");
    repositories.set(id, row);
    return row;
  }

  async function review(id: Id<"reviews">) {
    const cached = reviews.get(id);
    if (cached) return cached;
    const row = await ctx.db.get(id);
    if (!row || row.organizationId !== organizationId) throw new Error("not_found_or_forbidden");
    reviews.set(id, row);
    return row;
  }

  async function round(id: Id<"autofixRounds">, reviewId: Id<"reviews">) {
    const cached = rounds.get(id) ?? await (async () => {
      const row = await ctx.db.get(id);
      if (!row || row.organizationId !== organizationId) throw new Error("not_found_or_forbidden");
      rounds.set(id, row);
      return row;
    })();
    if (cached.reviewId !== reviewId) throw new Error("not_found_or_forbidden");
    return cached;
  }

  return { repository, review, round };
}
