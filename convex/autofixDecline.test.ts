/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { summaryFixture } from "./testing/summaryFixture";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("recording why autofix opened no fix", () => {
  async function setUp(mode: "autofix" | "review") {
    const t = convexTest(schema, modules), base = await summaryFixture(t, "decline", Date.now() - 10_000);
    const review = await t.run(async ctx => { await ctx.db.patch(base.reviewId, { mode }); return (await ctx.db.get(base.reviewId))!; });
    const args = { organizationId: base.organizationId, reviewId: base.reviewId, expectedHeadSha: review.headSha, expectedGeneration: review.executionGeneration };
    return { t, args };
  }

  it("stores the decline on an autofix review, for the report to state", async () => {
    const { t, args } = await setUp("autofix");
    await t.mutation(internal.reviewAutofixData.recordDecline, { ...args, reason: "checks_fail_on_base" });
    expect((await t.run(ctx => ctx.db.get(args.reviewId)))?.autofixDecline).toBe("checks_fail_on_base");
  });

  it("refuses a review that is not an autofix, or a superseded head", async () => {
    const plain = await setUp("review");
    await expect(plain.t.mutation(internal.reviewAutofixData.recordDecline, { ...plain.args, reason: "no_safe_patch" })).rejects.toThrow("autofix_decline_mismatch");
    const stale = await setUp("autofix");
    await expect(stale.t.mutation(internal.reviewAutofixData.recordDecline, { ...stale.args, expectedHeadSha: "f".repeat(40), reason: "no_safe_patch" })).rejects.toThrow("autofix_decline_mismatch");
  });
});
