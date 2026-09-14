/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { summaryFixture } from "./testing/summaryFixture";

const modules = import.meta.glob("./**/*.ts");

describe("workspace summaries at the real read ceiling", () => {
  it.each([19_999, 20_000, 20_001])("distinguishes a complete metrics window of %i rows from overflow", async count => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t);
    await t.run(async ctx => {
      for (let index = 0; index < count; index++) await ctx.db.insert("metricEvents", { ...pickScope(scope), name: "review_completed", value: 1, organizationTimezone: "UTC", occurredAt: index + 1 });
    });
    const result = await t.withIdentity({ subject: "summary" }).query(api.metrics.summarize, { organizationId: scope.organizationId, since: 0 });
    expect(result).toMatchObject({ totals: { review_completed: Math.min(count, 20_000) }, recordCount: Math.min(count, 20_000), truncated: count > 20_000, since: 0 });
  }, 30_000);

  it.each([19_999, 20_000, 20_001])("distinguishes a complete usage window of %i rows from overflow", async count => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t);
    await t.run(async ctx => {
      for (let index = 0; index < count; index++) await ctx.db.insert("usageLedger", { ...pickScope(scope), kind: "model_tokens", quantity: 1, unitCost: 0.000001, totalCostMicros: 1, currency: "provider_billed", occurredAt: index + 1 });
    });
    const result = await t.withIdentity({ subject: "summary" }).query(api.usage.summarize, { organizationId: scope.organizationId, since: 0 });
    expect(result).toMatchObject({ recordCount: Math.min(count, 20_000), truncated: count > 20_000 });
  }, 30_000);

  it("scopes the metrics read to the requested repository before applying the ceiling", async () => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t);
    const otherRepositoryId = await t.run(async ctx => {
      const original = (await ctx.db.get(scope.repositoryId))!;
      const { _id: _id, _creationTime: _creationTime, ...fields } = original;
      void _id; void _creationTime;
      const second = await ctx.db.insert("repositories", { ...fields, name: "second", githubRepositoryId: original.githubRepositoryId + 1 });
      for (let index = 0; index < 20_000; index++) await ctx.db.insert("metricEvents", { organizationId: scope.organizationId, repositoryId: scope.repositoryId, name: "review_completed", value: 1, organizationTimezone: "UTC", occurredAt: index + 1 });
      await ctx.db.insert("metricEvents", { organizationId: scope.organizationId, repositoryId: second, name: "review_completed", value: 7, organizationTimezone: "UTC", occurredAt: 20_001 });
      return second;
    });
    const result = await t.withIdentity({ subject: "summary" }).query(api.metrics.summarize, { organizationId: scope.organizationId, repositoryId: otherRepositoryId, since: 0 });
    expect(result).toMatchObject({ totals: { review_completed: 7 }, recordCount: 1, truncated: false });
  }, 30_000);

  it("keeps the newest records when the metrics window overflows", async () => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t);
    await t.run(async ctx => {
      for (let index = 0; index < 20_000; index++) await ctx.db.insert("metricEvents", { ...pickScope(scope), name: "review_completed", value: 1, organizationTimezone: "UTC", occurredAt: index + 1 });
      await ctx.db.insert("metricEvents", { ...pickScope(scope), name: "runner_failure", value: 9, organizationTimezone: "UTC", occurredAt: 20_001 });
    });
    const result = await t.withIdentity({ subject: "summary" }).query(api.metrics.summarize, { organizationId: scope.organizationId, since: 0 });
    expect(result).toMatchObject({ recordCount: 20_000, truncated: true, totals: { runner_failure: 9, review_completed: 19_999 } });
  }, 30_000);

  it("retains priced provider rows, including Ask, in the server's cost totals", async () => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t);
    await t.run(async ctx => {
      for (const [kind, totalCostMicros] of [["model_tokens", 10_000_000], ["ask_tokens", 2_500_000]] as const) await ctx.db.insert("usageLedger", { ...pickScope(scope), kind, quantity: 100, unitCost: 0, totalCostMicros, currency: "provider_billed", occurredAt: Date.now() });
    });
    const result = await t.withIdentity({ subject: "summary" }).query(api.usage.summarize, { organizationId: scope.organizationId, since: 0 });
    expect(result.costs.provider_billed).toBe(12.5);
    expect(result.quantities.ask_tokens).toBe(100);
  });
});

function pickScope(scope: Awaited<ReturnType<typeof summaryFixture>>) {
  return { organizationId: scope.organizationId, repositoryId: scope.repositoryId, reviewId: scope.reviewId };
}


describe("metric event recording", () => {
  it("records a stale review once when the same observation is replayed", async () => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t);
    for (let attempt = 0; attempt < 2; attempt++) await t.mutation(internal.reviewState.markStale, { reviewId: scope.reviewId, observedHeadSha: "c".repeat(40), now: Date.now() });
    const events = await t.run(ctx => ctx.db.query("metricEvents").collect());
    expect(events.filter(event => event.name === "stale_review")).toHaveLength(1);
    const result = await t.withIdentity({ subject: "summary" }).query(api.metrics.summarize, { organizationId: scope.organizationId, since: 0 });
    expect(result.totals.stale_review).toBe(1);
  });
});

describe("recorded outcome evidence", () => {
  it.each([
    ["passed", "failed", "introduced", 1],
    ["failed", "failed", "pre_existing", 0],
    ["passed", "passed", "unchanged_pass", 0],
    ["passed", "failed", "flaky", 0],
    ["passed", "failed", "unknown", 0],
  ] as const)("records confirmed base %s/head %s (%s) once", async (base, head, classification, expected) => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t), now = Date.now();
    const checksum = "c".repeat(64);
    const artifactId = await t.run(ctx => ctx.db.insert("artifacts", { ...pickScope(scope), type: "command_output", storageKey: "fixture/validation.json", encrypted: true, checksum, size: 100, redactionStatus: "pending", expiresAt: now + 60_000, deletionAttempts: 0 }));
    const common = { planId: "test", kind: "test" as const, required: true, durationMs: 5, commandFingerprint: "d".repeat(64), nameHash: "e".repeat(64), credentialTeardownProved: true as const, sandboxStopped: true as const };
    const args = { organizationId: scope.organizationId, reviewId: scope.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, artifactId, checksum, size: 100, manager: "npm" as const, now,
      summaries: [{ ...common, revision: "base" as const, commitSha: "b".repeat(40), conclusion: base }, { ...common, revision: "head" as const, commitSha: "a".repeat(40), conclusion: head, regressionClassification: classification }] };
    await t.mutation(internal.reviewValidationData.completeValidation, args);
    await t.mutation(internal.reviewValidationData.completeValidation, args);
    const rows = await t.run(ctx => ctx.db.query("metricEvents").collect());
    expect(rows.filter(row => row.name === "ci_regression_caught")).toHaveLength(expected);
  });

  it("records a runner failure when the review transitions to sandbox unavailable", async () => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t);
    await t.mutation(internal.reviewState.transition, { reviewId: scope.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0, to: "platform_failed", statusReasonCode: "sandbox_unavailable", nextActionCode: "retry_review", now: Date.now() });
    const rows = await t.run(ctx => ctx.db.query("metricEvents").collect());
    expect(rows.filter(row => row.name === "runner_failure")).toHaveLength(1);
  });
});

describe("large workspaces with many distinct review parents", () => {
  it("returns an explicitly partial result before parent checks exhaust a transaction", async () => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t);
    await t.run(async ctx => {
      const original = (await ctx.db.get(scope.reviewId))!;
      const { _id, _creationTime, ...fields } = original; void _id; void _creationTime;
      for (let index = 0; index < 4_100; index++) {
        const reviewId = await ctx.db.insert("reviews", { ...fields, prNumber: index + 2 });
        await ctx.db.insert("metricEvents", { ...pickScope(scope), reviewId, name: "review_completed", value: 1, organizationTimezone: "UTC", occurredAt: index + 1 });
      }
    });
    const result = await t.withIdentity({ subject: "summary" }).query(api.metrics.summarize, { organizationId: scope.organizationId, since: 0 });
    expect(result.truncated).toBe(true);
    expect(result.recordCount).toBeLessThan(4_000);
    expect(result.totals.review_completed).toBe(result.recordCount);
  });
});

describe("shared budget figures and reporting periods", () => {
  it("reconciles the same $12.50 provider estimate shown in the budget figure", async () => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t), now = Date.now();
    await t.run(async ctx => {
      for (const [kind, totalCostMicros] of [["model_tokens", 10_000_000], ["ask_tokens", 2_500_000]] as const) await ctx.db.insert("usageLedger", { ...pickScope(scope), kind, quantity: 100, unitCost: 0, totalCostMicros, currency: "provider_billed", occurredAt: now });
    });
    const viewer = t.withIdentity({ subject: "summary" });
    await viewer.mutation(api.usage.prepare, { organizationId: scope.organizationId });
    const result = await viewer.query(api.usage.summarize, { organizationId: scope.organizationId });
    expect(result.costs.provider_billed).toBe(12.5);
    expect(result.budget).toMatchObject({ estimatedSpendUsd: 12.5, monthlyBudgetUsd: 100, remainingUsd: 87.5, reconciliationComplete: true, legacyCostsMayBeIncomplete: true });
    expect(result.budget.estimatedSpendUsd / result.budget.monthlyBudgetUsd * 100).toBe(12.5);
  });

  it("refuses another workspace's accounting preparation", async () => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t);
    await expect(t.withIdentity({ subject: "outsider" }).mutation(api.usage.prepare, { organizationId: scope.organizationId })).rejects.toThrow("not_found_or_forbidden");
    expect(await t.run(ctx => ctx.db.query("usageMonths").collect())).toHaveLength(0);
  });

  it("sets the month and week on the server using UTC even when India has entered October", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 30, 19));
    try {
      const t = convexTest(schema, modules), scope = await summaryFixture(t);
      const viewer = t.withIdentity({ subject: "summary" });
      const usage = await viewer.query(api.usage.summarize, { organizationId: scope.organizationId });
      const metrics = await viewer.query(api.metrics.summarize, { organizationId: scope.organizationId });
      expect(usage.since).toBe(Date.UTC(2026, 8, 1));
      expect(usage.budget.month).toBe("2026-09");
      expect(metrics.since).toBe(Date.UTC(2026, 8, 27));
    } finally { vi.useRealTimers(); }
  });
});

describe("retained metric evidence", () => {
  it("previews a historical backfill without writes and applies it once at the original time", async () => {
    const t = convexTest(schema, modules), scope = await summaryFixture(t);
    await t.run(ctx => ctx.db.patch(scope.reviewId, { isStale: true, staleSince: 1_000, executionGeneration: 1 }));
    const preview = await t.mutation(internal.metricReconciliation.backfill, { organizationId: scope.organizationId });
    expect(preview).toMatchObject({ proposed: 1, inserted: 0, historyRemainsIncomplete: true });
    expect(await t.run(ctx => ctx.db.query("metricEvents").collect())).toHaveLength(0);
    await t.mutation(internal.metricReconciliation.backfill, { organizationId: scope.organizationId, dryRun: false });
    await t.mutation(internal.metricReconciliation.backfill, { organizationId: scope.organizationId, dryRun: false });
    await t.mutation(internal.reviewState.markStale, { reviewId: scope.reviewId, observedHeadSha: "c".repeat(40), now: Date.now() });
    const rows = await t.run(ctx => ctx.db.query("metricEvents").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "stale_review", value: 1, occurredAt: 1_000 });
  });
});
