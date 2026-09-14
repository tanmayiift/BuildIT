/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { summaryFixture } from "./testing/summaryFixture";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const makeTest = () => convexTest(schema, modules);
async function seed(t: ReturnType<typeof makeTest>) {
  const now = Date.now(), base = await summaryFixture(t, "summary", now - 10_000);
  return t.run(async ctx => {
    await ctx.db.patch(base.repositoryId, { owner: "tanmayiift", name: "proof-fixture", visibility: "public" });
    await ctx.db.patch(base.reviewId, { status: "checks_passed", currentStage: "complete", createdAt: now - 100, completedAt: now });
    const row = (await ctx.db.get(base.reviewId))!;
    const { _id, _creationTime, ...review } = row;
    const artifactId = await ctx.db.insert("artifacts", { organizationId: base.organizationId, repositoryId: base.repositoryId, reviewId: base.reviewId, type: "review_message", storageKey: "test/report", encrypted: true, checksum: "a".repeat(64), size: 1, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
    return { ...base, now, review, artifactId };
  });
}
async function finding(t: ReturnType<typeof makeTest>, b: Awaited<ReturnType<typeof seed>>, reviewId = b.reviewId, print = "f".repeat(64)) {
  return t.run(ctx => ctx.db.insert("findings", { organizationId: b.organizationId, reviewId, fingerprintHmac: print, category: "correctness", severity: "high", confidence: 0.9, blocking: true, contentArtifactId: b.artifactId, evidenceIds: [b.artifactId], pathHmac: "e".repeat(64), startLine: 1, endLine: 1, resolution: "open", createdAt: b.now, updatedAt: b.now, expiresAt: b.now + 60_000 }));
}
async function charge(t: ReturnType<typeof makeTest>, b: Awaited<ReturnType<typeof seed>>, micros: number, options: { repositoryId?: Id<"repositories">; reviewId?: Id<"reviews">; occurredAt?: number } = {}) {
  return t.run(ctx => ctx.db.insert("usageLedger", { organizationId: b.organizationId, repositoryId: options.repositoryId ?? b.repositoryId, reviewId: options.reviewId ?? b.reviewId, kind: "model_tokens", quantity: 10, unitCost: 0, totalCostMicros: micros, currency: "provider_billed", occurredAt: options.occurredAt ?? b.now }));
}
const signed = (t: ReturnType<typeof makeTest>) => t.withIdentity({ subject: "summary|session" });

describe("bounded history remains truthful", () => {
  it("keeps newest active work despite 500 old failures and discloses the cap", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => {
      for (let i = 0; i < 500; i++) await ctx.db.insert("reviews", { ...b.review, prNumber: i + 2, status: "platform_failed", createdAt: b.now - 1000 - i });
      await ctx.db.patch(b.reviewId, { status: "analyzing", createdAt: b.now, currentStage: "analysis" });
    });
    const result = await signed(t).query(api.reviews.list, { organizationId: b.organizationId });
    expect(result.rows[0]?.id).toBe(b.reviewId); expect(result.truncated).toBe(true);
  });
  it("does not claim truncation at exactly 500 reviews", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => { for (let i = 0; i < 499; i++) await ctx.db.insert("reviews", { ...b.review, prNumber: i + 2 }); });
    const result = await signed(t).query(api.reviews.list, { organizationId: b.organizationId });
    expect(result.rows).toHaveLength(500); expect(result.truncated).toBe(false);
  });
  it("chooses the latest 50 runs by time, not commit spelling", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => {
      for (let i = 0; i < 50; i++) await ctx.db.insert("reviews", { ...b.review, headSha: i.toString(16).padStart(40, "0"), createdAt: b.now - 1000 - i });
      await ctx.db.patch(b.reviewId, { headSha: "f".repeat(40), createdAt: b.now });
    });
    const result = await signed(t).query(api.reviews.runHistory, { reviewId: b.reviewId });
    expect(result.rows[0]?.id).toBe(b.reviewId); expect(result.truncated).toBe(true);
  });
  it("scopes history and spend before limits and never fabricates wall-clock duration", async () => {
    const t = makeTest(), b = await seed(t);
    const other = await t.run(async ctx => {
      const { _id, _creationTime, ...fields } = (await ctx.db.get(b.repositoryId))!;
      const repositoryId = await ctx.db.insert("repositories", { ...fields, githubRepositoryId: 2, name: "other" });
      for (let i = 0; i < 501; i++) await ctx.db.insert("reviews", { ...b.review, repositoryId, githubRepositoryId: 2, createdAt: b.now - 5000 + i });
      await ctx.db.patch(b.reviewId, { startedAt: b.now - 3, completedAt: b.now });
      const reviewId = await ctx.db.insert("reviews", { ...b.review, repositoryId, githubRepositoryId: 2 });
      return { repositoryId, reviewId };
    });
    await charge(t, b, 100_000); await charge(t, b, 500_000, other);
    const result = await signed(t).query(api.reviewHistory.summary, { organizationId: b.organizationId, repositoryId: b.repositoryId, since: b.now - 6000 });
    expect(result.totals.reviews).toBe(1); expect(result.totals.costUsd).toBeCloseTo(0.1); expect(result.pullRequests[0]?.durationMs).toBeNull();
  });
  it("marks capped review totals as partial", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => { for (let i = 0; i < 501; i++) await ctx.db.insert("reviews", { ...b.review, prNumber: i + 2, createdAt: b.now - i }); });
    const result = await signed(t).query(api.reviewHistory.summary, { organizationId: b.organizationId, since: b.now - 5000 });
    expect(result.partial.reviews).toBe(true); expect(result.window.since).toBe(b.now - 5000);
  });
  it("records an app dismissal in distinct-finding feedback counts", async () => {
    const t = makeTest(), b = await seed(t); await finding(t, b);
    await signed(t).mutation(api.findings.dismiss, { reviewId: b.reviewId, fingerprintHmac: "f".repeat(64), scope: "pull_request", reasonCode: "false_positive", requestId: "history-dismiss-regression" });
    const result = await signed(t).query(api.reviewHistory.summary, { organizationId: b.organizationId, since: 0 });
    expect(result.totals.dismissed).toBe(1); expect(result.pullRequests[0]?.blocking).toBe(0);
  });
  it("uses the latest human opinion once per finding and applies actual GitHub dismissal", async () => {
    const t = makeTest(), b = await seed(t), id = await finding(t, b);
    await t.mutation(internal.findingFeedbackData.record, { repositoryId: b.repositoryId, prNumber: 1, markerFindingId: id, verdict: "accepted", actorHash: "actor-one", now: b.now });
    await t.mutation(internal.findingFeedbackData.record, { repositoryId: b.repositoryId, prNumber: 1, markerFindingId: id, verdict: "dismissed", actorHash: "actor-two", now: b.now + 1 });
    const result = await signed(t).query(api.reviewHistory.summary, { organizationId: b.organizationId, since: 0 });
    expect(result.totals.accepted).toBe(0); expect(result.totals.dismissed).toBe(1); expect(result.pullRequests[0]?.blocking).toBe(0);
  });
  it("targets the latest completed PR run and can still find an older exact marker", async () => {
    const t = makeTest(), b = await seed(t), old = await finding(t, b);
    await t.run(ctx => ctx.db.patch(b.reviewId, { headSha: "f".repeat(40), createdAt: b.now - 1000 }));
    const latest = await t.run(async ctx => {
      let id = b.reviewId;
      for (let i = 0; i < 25; i++) id = await ctx.db.insert("reviews", { ...b.review, headSha: "0".repeat(40), createdAt: b.now + i, completedAt: b.now + i });
      return id;
    });
    const latestFinding = await finding(t, b, latest, "d".repeat(64));
    await t.mutation(internal.findingFeedbackData.recordByIndex, { repositoryId: b.repositoryId, prNumber: 1, findingIndex: 1, actorHash: "actor", now: b.now + 100 });
    const rows = await t.run(ctx => ctx.db.query("findingFeedback").collect()); expect(rows[0]?.findingId).toBe(latestFinding);
    expect(await t.mutation(internal.findingFeedbackData.record, { repositoryId: b.repositoryId, prNumber: 1, markerFindingId: old, verdict: "accepted", actorHash: "actor", now: b.now + 101 })).toEqual({ recorded: true });
  });
  it("does not let earlier unrelated events hide activation milestones", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => {
      const audit = { organizationId: b.organizationId, actorId: "actor", resourceType: "repository", resourceIdHash: "test", requestId: "audit", result: "allowed" as const, previousHash: "", eventHash: "test", createdAt: b.now - 100 };
      for (let i = 0; i < 1001; i++) {
        await ctx.db.insert("auditEvents", { ...audit, action: "other" });
        await ctx.db.insert("reviewEvents", { organizationId: b.organizationId, reviewId: b.reviewId, sequence: i, type: "stage_completed", stage: "analysis", internalCode: "attempt", metadata: {}, createdAt: b.now - 100 });
      }
      await ctx.db.insert("auditEvents", { ...audit, action: "review.previewed", createdAt: b.now });
      await ctx.db.insert("reviewEvents", { organizationId: b.organizationId, reviewId: b.reviewId, sequence: 1002, type: "status_changed", stage: "complete", publicMessageArtifactId: b.artifactId, internalCode: "decision", metadata: {}, createdAt: b.now + 1 });
    });
    const result = await signed(t).query(api.activation.funnel, { organizationId: b.organizationId });
    expect(result.pullRequestPreviewed).toBe(true); expect(result.firstEvidenceReady).toBe(true);
  });
  it("distinguishes review attempts from distinct completed pull requests", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => { await ctx.db.insert("reviews", { ...b.review, status: "platform_failed" }); await ctx.db.insert("reviews", { ...b.review, prNumber: 2, status: "queued", completedAt: undefined }); });
    const result = await t.query(api.publicProof.summary, {});
    expect(result.reviews.counted).toBe(3); expect(result.reviews.distinctCompletedPullRequests).toBe(1);
  });
  it("scopes public review evidence before applying review bounds", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => {
      const { _id, _creationTime, ...fields } = (await ctx.db.get(b.repositoryId))!;
      const other = await ctx.db.insert("repositories", { ...fields, owner: "customer", name: "private", visibility: "private", githubRepositoryId: 9 });
      for (let i = 0; i < 2001; i++) await ctx.db.insert("reviews", { ...b.review, repositoryId: other, prNumber: i + 2 });
    });
    const result = await t.query(api.publicProof.recentPublicReviews, {});
    expect(result.reviews).toHaveLength(1); expect(result.reviews[0]?.name).toBe("proof-fixture"); expect(result.truncated).toBe(false);
  });
});

describe("history boundaries and incomplete evidence", () => {
  it("does not expose a customer public repository or a private evidence repository", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => {
      const { _id, _creationTime, ...fields } = (await ctx.db.get(b.repositoryId))!;
      for (const [owner, visibility] of [["customer", "public"], ["tanmayiift", "private"]] as const) {
        const id = await ctx.db.insert("repositories", { ...fields, owner, visibility, githubRepositoryId: Math.random() });
        await ctx.db.insert("reviews", { ...b.review, repositoryId: id });
      }
    });
    const result = await t.query(api.publicProof.recentPublicReviews, {});
    expect(result.reviews.map(row => row.name)).toEqual(["proof-fixture"]);
  });
  it("rejects feedback for a finding in a different repository and refuses ambiguous legacy markers", async () => {
    const t = makeTest(), b = await seed(t), original = await finding(t, b);
    const other = await summaryFixture(t, "other", b.now);
    expect(await t.mutation(internal.findingFeedbackData.record, { repositoryId: other.repositoryId, prNumber: 1, markerFindingId: original, actorHash: "actor", verdict: "accepted", now: b.now })).toEqual({ recorded: false });
    const rerun = await t.run(ctx => ctx.db.insert("reviews", b.review));
    await finding(t, b, rerun);
    expect(await t.mutation(internal.findingFeedbackData.record, { repositoryId: b.repositoryId, prNumber: 1, markerFindingId: "f".repeat(64), actorHash: "actor", verdict: "accepted", now: b.now })).toEqual({ recorded: false });
  });
  it("keeps one latest opinion per person and ignores late deliveries", async () => {
    const t = makeTest(), b = await seed(t), id = await finding(t, b);
    const input = { repositoryId: b.repositoryId, prNumber: 1, markerFindingId: id, actorHash: "actor" };
    await t.mutation(internal.findingFeedbackData.record, { ...input, verdict: "dismissed", now: b.now + 2 });
    await t.mutation(internal.findingFeedbackData.record, { ...input, verdict: "accepted", now: b.now + 1 });
    let rows = await t.run(ctx => ctx.db.query("findingFeedback").collect());
    expect(rows).toHaveLength(1); expect(rows[0]?.verdict).toBe("dismissed");
    await t.mutation(internal.findingFeedbackData.record, { ...input, verdict: "accepted", now: b.now + 3 });
    rows = await t.run(ctx => ctx.db.query("findingFeedback").collect());
    expect(rows).toHaveLength(1); expect(rows[0]?.verdict).toBe("accepted");
    expect((await t.run(ctx => ctx.db.get(id)))?.resolution).toBe("open");
  });
  it("marks too many finding rows partial and leaves missing provider time unknown", async () => {
    const t = makeTest(), b = await seed(t), first = await finding(t, b);
    await t.run(async ctx => {
      const { _id, _creationTime, ...fields } = (await ctx.db.get(first))!;
      for (let i = 0; i < 1000; i++) await ctx.db.insert("findings", { ...fields, fingerprintHmac: i.toString(16).padStart(64, "0") });
    });
    const evidence = await signed(t).query(api.reviews.getEvidence, { reviewId: b.reviewId });
    expect(evidence.partial).toBe(true); expect(evidence.modelDurationMs).toBeNull();
    const comparison = await signed(t).query(api.reviews.compareRuns, { leftReviewId: b.reviewId, rightReviewId: b.reviewId });
    expect(comparison.partial).toBe(true);
    const history = await signed(t).query(api.reviewHistory.summary, { organizationId: b.organizationId, since: 0 });
    expect(history.partial.findings).toBe(true);
  });
  it("does not mistake exactly 2000 public aggregate rows for an overflow", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => { for (let i = 0; i < 1999; i++) await ctx.db.insert("reviews", { ...b.review, prNumber: i + 2 }); });
    expect((await t.query(api.publicProof.summary, {})).reviews.truncated).toBe(false);
    await t.run(ctx => ctx.db.insert("reviews", { ...b.review, prNumber: 3000 }));
    expect((await t.query(api.publicProof.summary, {})).reviews.truncated).toBe(true);
  });
  it("rejects cost rows whose parent belongs to another repository", async () => {
    const t = makeTest(), b = await seed(t), other = await summaryFixture(t, "other", b.now);
    await charge(t, b, 999_000, { reviewId: other.reviewId });
    await expect(signed(t).query(api.reviewHistory.summary, { organizationId: b.organizationId, since: 0 })).rejects.toThrow("not_found_or_forbidden");
  });
});


describe("stable live windows", () => {
  it("keeps the upper history boundary at day end so later writes remain subscribed", async () => {
    const t = makeTest(), b = await seed(t);
    const result = await signed(t).query(api.reviewHistory.summary, { organizationId: b.organizationId, since: b.now - 1000 });
    expect(result.window.until).toBeGreaterThan(result.observedAt);
    expect(result.window.until % 86_400_000).toBe(0);
  });
  it("does not let unfinished attempts hide the latest completed run's numbered findings", async () => {
    const t = makeTest(), b = await seed(t), id = await finding(t, b);
    await t.run(async ctx => { for (let i = 0; i < 101; i++) await ctx.db.insert("reviews", { ...b.review, createdAt: b.now + i, status: "queued", completedAt: undefined }); });
    const recorded = await t.mutation(internal.findingFeedbackData.recordByIndex, { repositoryId: b.repositoryId, prNumber: 1, findingIndex: 1, actorHash: "actor", now: b.now + 200 });
    expect(recorded.recorded).toBe(true);
    expect((await t.run(ctx => ctx.db.get(id)))?.resolution).toBe("dismissed");
  });
  // The funnel ended at "evidence rendered", which says BuildIT produced something and nothing
  // about whether it mattered. humanDecisionAt was declared in StageTimes from the beginning and
  // never written, so firstEvidenceToHumanDecision was permanently undefined - the one duration
  // that closes the loop between a finding and a person acting on it.
  it("records when a human first judged a finding, not just when evidence appeared", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => {
      await ctx.db.insert("reviewEvents", { organizationId: b.organizationId, reviewId: b.reviewId, sequence: 1002,
        type: "status_changed", stage: "complete", publicMessageArtifactId: b.artifactId,
        internalCode: "decision", metadata: {}, createdAt: b.now });
    });
    const before = await signed(t).query(api.activation.funnel, { organizationId: b.organizationId });
    expect(before.times.evidenceAt).toBeDefined();
    expect(before.times.humanDecisionAt).toBeUndefined();
    expect(before.durationMs.firstEvidenceToHumanDecision).toBeUndefined();

    await t.run(async ctx => {
      await ctx.db.insert("findingFeedback", {
        organizationId: b.organizationId, repositoryId: b.repositoryId, reviewId: b.reviewId,
        fingerprintHmac: "f".repeat(64), ruleKey: "rule", pathPrefixHmac: "p".repeat(64),
        verdict: "dismissed", actorHash: "actor", occurredAt: before.times.evidenceAt! + 500,
      });
    });
    const after = await signed(t).query(api.activation.funnel, { organizationId: b.organizationId });
    expect(after.times.humanDecisionAt).toBe(before.times.evidenceAt! + 500);
    expect(after.durationMs.firstEvidenceToHumanDecision).toBe(500);
  });

  // A verdict recorded before the evidence it judges cannot be a decision about it, and counting
  // one would report a negative duration as though the loop closed early.
  it("ignores feedback that predates the evidence", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => {
      await ctx.db.insert("reviewEvents", { organizationId: b.organizationId, reviewId: b.reviewId, sequence: 1002,
        type: "status_changed", stage: "complete", publicMessageArtifactId: b.artifactId,
        internalCode: "decision", metadata: {}, createdAt: b.now });
    });
    const before = await signed(t).query(api.activation.funnel, { organizationId: b.organizationId });
    await t.run(async ctx => {
      await ctx.db.insert("findingFeedback", {
        organizationId: b.organizationId, repositoryId: b.repositoryId, reviewId: b.reviewId,
        fingerprintHmac: "e".repeat(64), ruleKey: "rule", pathPrefixHmac: "p".repeat(64),
        verdict: "accepted", actorHash: "actor", occurredAt: before.times.evidenceAt! - 1,
      });
    });
    const after = await signed(t).query(api.activation.funnel, { organizationId: b.organizationId });
    expect(after.times.humanDecisionAt).toBeUndefined();
  });

  it("returns unknown if a bounded report scan cannot establish readiness", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => {
      await ctx.db.patch(b.artifactId, { expiresAt: b.now - 1 });
      for (let i = 0; i < 101; i++) await ctx.db.insert("reviewEvents", { organizationId: b.organizationId, reviewId: b.reviewId, sequence: i, type: "status_changed", stage: "complete", publicMessageArtifactId: b.artifactId, internalCode: "decision", metadata: {}, createdAt: b.now });
    });
    const result = await signed(t).query(api.activation.funnel, { organizationId: b.organizationId });
    expect(result.firstEvidenceReady).toBeNull(); expect(result.partial.evidence).toBe(true);
  });
});

describe("unknown provider costs", () => {
  it("never presents pending provider usage as a complete zero across history and proof", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => {
      const invocationId = await ctx.db.insert("modelInvocations", { organizationId: b.organizationId, repositoryId: b.repositoryId, reviewId: b.reviewId, prNumber: 1, invocationKey: "history-pending-call", requestHash: "a".repeat(64), generation: 0, stage: "analysis", provider: "anthropic", model: "claude-sonnet-4-5", month: "2026-09", reservedMicros: 1000, status: "unknown", createdAt: b.now, updatedAt: b.now });
      await ctx.db.insert("usageLedger", { organizationId: b.organizationId, repositoryId: b.repositoryId, reviewId: b.reviewId, kind: "model_tokens", quantity: 0, unitCost: 0, totalCostMicros: 0, currency: "provider_billed", occurredAt: b.now, costStatus: "unknown", accountingVersion: 1, invocationId });
    });
    const history = await signed(t).query(api.reviewHistory.summary, { organizationId: b.organizationId, since: 0 });
    expect(history.partial.spend).toBe(true); expect(history.costPending).toBe(true); expect(history.pullRequests[0]?.costPending).toBe(true);
    const evidence = await signed(t).query(api.reviews.getEvidence, { reviewId: b.reviewId });
    expect(evidence.partial).toBe(true); expect(evidence.spend.costPending).toBe(true);
    const runs = await signed(t).query(api.reviews.runHistory, { reviewId: b.reviewId });
    expect(runs.rows[0]?.partial).toBe(true); expect(runs.rows[0]?.costPending).toBe(true);
    expect((await signed(t).query(api.reviews.compareRuns, { leftReviewId: b.reviewId, rightReviewId: b.reviewId })).partial).toBe(true);
    expect((await t.query(api.publicProof.summary, {})).spend.costPending).toBe(true);
  });
});

// BuildIT watched every merge go past and kept none of it. The closed+merged webhook reached
// changelogWorker and stopped, and only when changelogOnMerge was on - so for most workspaces the
// strongest available signal about whether a review mattered was observed and dropped. A review
// that found nothing and one whose findings were fixed before merge looked identical afterwards.
describe("merge outcome", () => {
  it("stamps the review that reached a verdict and emits the time to merge", async () => {
    const t = makeTest(), b = await seed(t);
    const repository = await t.run(ctx => ctx.db.get(b.repositoryId));
    const merged = b.now + 90_000;
    const result = await t.mutation(internal.changelogData.recordMergeOutcome, {
      githubRepositoryId: repository!.githubRepositoryId, prNumber: 1, mergedAt: merged,
    });
    expect(result.recorded).toBe(true);
    const review = await t.run(ctx => ctx.db.get(b.reviewId));
    expect(review?.mergedAt).toBe(merged);
    const metric = await t.run(ctx => ctx.db.query("metricEvents")
      .filter(q => q.eq(q.field("name"), "human_time_to_merge_ms")).first());
    expect(metric?.value).toBe(merged - (review!.completedAt ?? 0));
  });

  it("records a merge once, so a redelivered webhook does not double count", async () => {
    const t = makeTest(), b = await seed(t);
    const repository = await t.run(ctx => ctx.db.get(b.repositoryId));
    const args = { githubRepositoryId: repository!.githubRepositoryId, prNumber: 1, mergedAt: b.now + 5_000 };
    expect((await t.mutation(internal.changelogData.recordMergeOutcome, args)).recorded).toBe(true);
    const second = await t.mutation(internal.changelogData.recordMergeOutcome, args);
    expect(second.recorded).toBe(false);
    expect(second.reason).toBe("already_recorded");
  });

  // A clock skew between GitHub's merge timestamp and ours must not produce a duration saying the
  // merge happened before the review it followed.
  it("never reports a negative time to merge", async () => {
    const t = makeTest(), b = await seed(t);
    const repository = await t.run(ctx => ctx.db.get(b.repositoryId));
    const result = await t.mutation(internal.changelogData.recordMergeOutcome, {
      githubRepositoryId: repository!.githubRepositoryId, prNumber: 1, mergedAt: b.now - 10_000,
    });
    expect(result.recorded).toBe(true);
    expect(result.elapsed).toBe(0);
  });
});

// "Findings raised" says BuildIT spoke. It says nothing about whether anyone listened, and a
// reviewer nobody reads is worth reporting as such - that is the half of the north star the public
// page never showed, though reviewHistory has computed it privately all along.
describe("feedback coverage on the public page", () => {
  it("reports how many findings a human judged, not just how many were raised", async () => {
    const t = makeTest(), b = await seed(t);
    const before = await t.query(api.publicProof.summary, {});
    expect(before.findings.judged).toBe(0);
    expect(before.findings.accepted).toBe(0);

    await t.run(async ctx => {
      await ctx.db.insert("findingFeedback", {
        organizationId: b.organizationId, repositoryId: b.repositoryId, reviewId: b.reviewId,
        fingerprintHmac: "c".repeat(64), ruleKey: "rule", pathPrefixHmac: "p".repeat(64),
        verdict: "accepted", actorHash: "actor", occurredAt: b.now,
      });
    });
    const after = await t.query(api.publicProof.summary, {});
    expect(after.findings.judged).toBe(1);
    expect(after.findings.accepted).toBe(1);
  });

  // Two people dismissing the same finding is one judgement about one finding. Counting rows would
  // let feedback exceed the findings it is feedback on.
  it("counts a finding once however many people judged it", async () => {
    const t = makeTest(), b = await seed(t);
    await t.run(async ctx => {
      for (const actor of ["one", "two", "three"]) {
        await ctx.db.insert("findingFeedback", {
          organizationId: b.organizationId, repositoryId: b.repositoryId, reviewId: b.reviewId,
          fingerprintHmac: "d".repeat(64), ruleKey: "rule", pathPrefixHmac: "p".repeat(64),
          verdict: "dismissed", actorHash: actor, occurredAt: b.now,
        });
      }
    });
    const result = await t.query(api.publicProof.summary, {});
    expect(result.findings.judged).toBe(1);
    expect(result.findings.accepted).toBe(0);
  });
});
