/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api";
import schema from "./schema";
import { summaryFixture } from "./testing/summaryFixture";
import { usageKind } from "./validators";
const modules = import.meta.glob("./**/*.ts");

// The first version counted every model_tokens row for the review, so a review's own seven prompt
// stages used the entire allowance before anybody could ask a question about it - the limiter
// silently refused the very first `@buildit ask` on every fresh review. Questions are billed under
// their own kind now, which fixes the count and also makes asks separately visible in usage rather
// than hidden inside review spend.
describe("what a question is billed as", () => {
  it("has a kind of its own, distinct from review stages", () => {
    const members = (usageKind as unknown as { members: Array<{ value: string }> }).members.map(item => item.value);
    expect(members).toContain("ask_tokens");
    expect(members).toContain("model_tokens");
  });

  it("allows five Ask attempts after review stages and counts unpublished attempts", async () => {
    const t = convexTest(schema, modules), now = Date.now(), b = await summaryFixture(t, "ask-limit", now);
    await t.run(async ctx => {
      await ctx.db.patch(b.reviewId, { model: "claude-sonnet-4-5", status: "checks_passed", completedAt: now });
      for (let i = 0; i < 7; i++) await ctx.db.insert("usageLedger", { organizationId: b.organizationId, repositoryId: b.repositoryId, reviewId: b.reviewId,
        kind: "model_tokens", quantity: 10, unitCost: 0.0001, totalCostMicros: 1000, currency: "provider_billed", occurredAt: now });
    });
    const request = { organizationId: b.organizationId, reviewId: b.reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0,
      requestHash: "7".repeat(64), stage: "ask", provider: "anthropic" as const, model: "claude-sonnet-4-5", inputBytes: 0, maxOutputTokens: 1, now };
    for (let i = 0; i < 5; i++) expect(await t.mutation(internal.modelAccounting.reserve, { ...request, invocationKey: `ask-attempt-${i}`.padEnd(20, "x") })).toMatchObject({ allowed: true });
    expect(await t.mutation(internal.modelAccounting.reserve, { ...request, invocationKey: "ask-attempt-sixthxxxx" })).toMatchObject({ allowed: false, reason: "ask_rate_limited" });
    const rows = await t.run(ctx => ctx.db.query("usageLedger").collect());
    expect(rows.filter(row => row.kind === "ask_tokens")).toHaveLength(5);
    expect(rows.filter(row => row.kind === "model_tokens")).toHaveLength(7);
  });
});

// missing_model_invocation_secret: the ask worker invented an env var name that does not exist,
// and the failure only surfaced in production logs because the scheduler swallows it. Every secret
// a worker reads has to be one the deployment actually sets.
describe("the secrets the ask worker reads", () => {
  it("uses the same names as the worker it borrowed the grant flow from", async () => {
    const { readFileSync } = await import("node:fs");
    const ask = readFileSync(new URL("./reviewAskWorker.ts", import.meta.url), "utf8");
    const analysis = readFileSync(new URL("./reviewAnalysisWorker.ts", import.meta.url), "utf8");
    const names = (source: string) => new Set([...source.matchAll(/required\("([A-Z_]+)"\)/g)].map(match => match[1]!));
    const known = names(analysis);
    for (const name of names(ask)) {
      if (name.startsWith("GITHUB_")) continue;
      expect(known).toContain(name);
    }
  });
});
