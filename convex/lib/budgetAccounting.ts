import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { rowCostUsd, toMicros } from "./usageCost";
import { monthKey } from "./monthlySpend";
import { monthStart } from "./tenantLimits";

const maxReviewFamilySize = 16;
const maxOutstandingCallsPerReview = 100;

// A provider fallback is another attempt at the original consent, not another allowance.
// Keep each attempt's receipts/consumption separate and sum the complete family at admission.
// Indexed child reads also catch sibling reservations atomically under Convex transactions.
// Explicitly requested new reviews have no parent and retain their separately chosen budget.
export async function getReviewBudgetSnapshot(ctx: Pick<QueryCtx, "db">, review: Doc<"reviews">) {
  const invalid = () => { throw new ConvexError("review_budget_family_invalid"); };
  const assertMember = (member: Doc<"reviews"> | null): Doc<"reviews"> => {
    if (!member || member.organizationId !== review.organizationId || member.repositoryId !== review.repositoryId
      || member.githubRepositoryId !== review.githubRepositoryId || member.prNumber !== review.prNumber
      || member.headSha !== review.headSha || member.mode !== review.mode
      || !Number.isFinite(member.budgetLimit) || member.budgetLimit < 0
      || !Number.isFinite(member.budgetConsumed) || member.budgetConsumed < 0
      || !Number.isSafeInteger(toMicros(member.budgetLimit)) || !Number.isSafeInteger(toMicros(member.budgetConsumed))) return invalid();
    return member;
  };
  const ancestors: Doc<"reviews">[] = [];
  const ancestry = new Set<Id<"reviews">>([review._id]);
  let root = assertMember(review);
  while (root.parentReviewId) {
    if (ancestry.has(root.parentReviewId)) invalid();
    if (ancestry.size >= maxReviewFamilySize) throw new ConvexError("review_budget_family_limit");
    root = assertMember(await ctx.db.get(root.parentReviewId));
    ancestry.add(root._id);
    ancestors.push(root);
  }
  const members = [root], seen = new Set<Id<"reviews">>([root._id]);
  for (let index = 0; index < members.length; index += 1) {
    const children = await ctx.db.query("reviews").withIndex("by_parent", q => q.eq("parentReviewId", members[index]!._id))
      .take(maxReviewFamilySize + 1);
    for (const child of children) {
      assertMember(child);
      if (seen.has(child._id)) invalid();
      if (members.length >= maxReviewFamilySize) throw new ConvexError("review_budget_family_limit");
      seen.add(child._id); members.push(child);
    }
  }
  if (!seen.has(review._id)) invalid();
  let consumedMicros = 0, reservedMicros = 0, currentReservedMicros = 0, unresolvedInvocationCount = 0;
  for (const member of members) {
    consumedMicros += toMicros(member.budgetConsumed);
    for (const status of ["reserved", "unknown"] as const) {
      const calls = await ctx.db.query("modelInvocations").withIndex("by_review_status", q => q.eq("reviewId", member._id).eq("status", status))
        .take(maxOutstandingCallsPerReview + 1);
      if (calls.length > maxOutstandingCallsPerReview) throw new ConvexError("review_budget_family_limit");
      for (const call of calls) {
        if (call.organizationId !== review.organizationId || call.repositoryId !== review.repositoryId || call.prNumber !== review.prNumber
          || !Number.isSafeInteger(call.reservedMicros) || call.reservedMicros < 0) invalid();
        reservedMicros += call.reservedMicros;
        if (member._id === review._id) currentReservedMicros += call.reservedMicros;
        unresolvedInvocationCount += 1;
      }
    }
  }
  if (!Number.isSafeInteger(consumedMicros) || !Number.isSafeInteger(reservedMicros)) invalid();
  return { rootReviewId: root._id, limitMicros: toMicros(root.budgetLimit), consumedMicros, reservedMicros, currentReservedMicros, unresolvedInvocationCount, ancestors, members };
}

export const reconciliationPageSize = 200;
export function budgetPeriod(now: number) {
  const date = new Date(now);
  return { month: monthKey(now), periodStart: monthStart(now), periodEnd: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) };
}
export async function monthRow(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">, month: string) {
  return ctx.db.query("usageMonths").withIndex("by_org_month", q => q.eq("organizationId", organizationId).eq("month", month)).unique();
}
export type { BudgetSnapshot } from "./workspaceFigureTypes";
import type { BudgetSnapshot } from "./workspaceFigureTypes";
export async function getBudgetSnapshot(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">, now: number): Promise<BudgetSnapshot> {
  const organization = await ctx.db.get(organizationId);
  if (!organization || organization.deletedAt) throw new Error("not_found_or_forbidden");
  const period = budgetPeriod(now), row = await monthRow(ctx, organizationId, period.month);
  const estimatedSpendUsd = ((row?.estimatedMicros ?? 0) + (row?.legacyEstimatedMicros ?? 0)) / 1_000_000;
  const reservedUsd = (row?.reservedMicros ?? 0) / 1_000_000;
  const reconciliationComplete = row?.reconciliationComplete ?? false;
  const unknownInvocationCount = (row?.unknownInvocationCount ?? 0) + (row?.legacyUnknownCount ?? 0);
  const legacyCostsMayBeIncomplete = (row?.legacyRows ?? 0) > 0;
  return { ...period, estimatedSpendUsd, reservedUsd, monthlyBudgetUsd: organization.monthlyBudget,
    remainingUsd: organization.monthlyBudget > 0 && reconciliationComplete ? Math.max(0, organization.monthlyBudget - estimatedSpendUsd - reservedUsd) : null,
    reconciliationComplete, unknownInvocationCount, legacyCostsMayBeIncomplete,
    accountingComplete: reconciliationComplete && unknownInvocationCount === 0 && !legacyCostsMayBeIncomplete };
}

// Repair only legacy rows. New writes carry accountingVersion=1 and update estimatedMicros in
// the same transaction as their ledger row. They can settle while the cursor moves without
// being missed or counted twice. The cursor and subtotal commit together; interrupted pages
// retry safely. No historical row is rewritten or assigned invented token counts.
export async function reconcileMonthPage(ctx: MutationCtx, organizationId: Id<"organizations">, now: number) {
  const period = budgetPeriod(now);
  let row = await monthRow(ctx, organizationId, period.month);
  if (!row) {
    const id = await ctx.db.insert("usageMonths", { organizationId, ...period, estimatedMicros: 0, reservedMicros: 0,
      unknownInvocationCount: 0, legacyEstimatedMicros: 0, legacyUnknownCount: 0, legacyRows: 0,
      reconciliationComplete: false, createdAt: now, updatedAt: now });
    row = (await ctx.db.get(id))!;
  }
  if (row.reconciliationComplete) return row;
  const page = await ctx.db.query("usageLedger").withIndex("by_org_time", q => q.eq("organizationId", organizationId)
    .gte("occurredAt", period.periodStart).lt("occurredAt", period.periodEnd))
    .paginate({ cursor: row.reconciliationCursor ?? null, numItems: reconciliationPageSize });
  let legacyEstimatedMicros = row.legacyEstimatedMicros, legacyUnknownCount = row.legacyUnknownCount, legacyRows = row.legacyRows;
  for (const entry of page.page) {
    if (entry.accountingVersion === 1) continue;
    const review = await ctx.db.get(entry.reviewId), repository = await ctx.db.get(entry.repositoryId);
    if (!review || !repository || review.organizationId !== organizationId || repository.organizationId !== organizationId || review.repositoryId !== repository._id) throw new Error("parent_scope_mismatch");
    legacyEstimatedMicros += toMicros(rowCostUsd(entry));
    if (["model_tokens", "ask_tokens", "model_spend"].includes(entry.kind)) {
      legacyRows += 1;
      if (entry.quantity === 0 && !entry.totalCostMicros) legacyUnknownCount += 1;
    }
  }
  await ctx.db.patch(row._id, { legacyEstimatedMicros, legacyUnknownCount, legacyRows,
    reconciliationComplete: page.isDone, reconciliationCursor: page.isDone ? undefined : page.continueCursor, updatedAt: now });
  await syncLegacyAggregate(ctx, { ...row, legacyEstimatedMicros }, now);
  if (!page.isDone) await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("modelAccounting:reconcile"), { organizationId, now });
  return (await ctx.db.get(row._id))!;
}
export async function syncLegacyAggregate(ctx: MutationCtx, row: Doc<"usageMonths">, now: number) {
  // Compatibility only; enforcement and the UI use the shared snapshot. A late previous-month
  // settlement must never replace the current month's compatibility counter.
  if (row.month === monthKey(now)) await ctx.db.patch(row.organizationId, {
    monthlySpendMonth: row.month, monthlySpendMicros: row.estimatedMicros + row.legacyEstimatedMicros,
  });
}
export async function addEstimatedCharge(ctx: MutationCtx, organizationId: Id<"organizations">, costMicros: number, now: number, usageKnown = true) {
  const row = await reconcileMonthPage(ctx, organizationId, now);
  const next = { ...row, estimatedMicros: row.estimatedMicros + costMicros, legacyRows: row.legacyRows + 1, legacyUnknownCount: row.legacyUnknownCount + (usageKnown ? 0 : 1) };
  await ctx.db.patch(row._id, { estimatedMicros: next.estimatedMicros, legacyRows: next.legacyRows, legacyUnknownCount: next.legacyUnknownCount, updatedAt: now });
  await syncLegacyAggregate(ctx, next, now);
}
