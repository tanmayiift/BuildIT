import { describe, expect, it } from "vitest";
import { durableReviewStages, nextStageAfter } from "../../convex/lib/durableStages";
import { readFileSync } from "node:fs";

describe("durable review crash recovery", () => {
  it("resumes after every persisted stage without repeating completed work", () => {
    for (let crashAfter = 0; crashAfter <= durableReviewStages.length; crashAfter += 1) {
      const completed = durableReviewStages.slice(0, crashAfter);
      expect(nextStageAfter(completed)).toBe(durableReviewStages[crashAfter]);
    }
  });

  it("uses a fixed stage order", () => {
    expect(durableReviewStages).toEqual(["context", "validation", "analysis"]);
  });

  it("executes the real context worker before recording its checkpoint", () => {
    const source = readFileSync("convex/durableReview.ts", "utf8");
    const gatherSource = readFileSync("convex/reviewContextWorker.ts", "utf8");
    const artifactSource = readFileSync("convex/reviewArtifactData.ts", "utf8");
    const worker = source.indexOf("step.runAction(internal.reviewContextWorker.gather");
    const checkpoint = source.indexOf("step.runMutation(internal.durableReview.checkpoint");
    expect(worker).toBeGreaterThan(-1);
    expect(checkpoint).toBeGreaterThan(worker);
    expect(gatherSource).toContain('["head", headSnapshot], ["base", baseSnapshot]');
    expect(artifactSource).toContain("context-${args.revision}-${args.chunkIndex}.json");
  });

  it("executes the real model analysis worker before its checkpoint", () => {
    const source = readFileSync("convex/durableReview.ts", "utf8");
    const worker = source.indexOf("step.runAction(internal.reviewAnalysisWorker.analyze");
    const analysisBranch = source.indexOf('stage === "analysis"');
    const checkpoint = source.indexOf("step.runMutation(internal.durableReview.checkpoint", worker);
    expect(analysisBranch).toBeGreaterThan(-1);
    expect(worker).toBeGreaterThan(analysisBranch);
    expect(checkpoint).toBeGreaterThan(worker);
  });

  it("runs exact base and head validation before model analysis", () => {
    const stages = [...durableReviewStages];
    expect(stages.indexOf("validation")).toBeLessThan(stages.indexOf("analysis"));
    const source = readFileSync("convex/durableReview.ts", "utf8");
    expect(source).toContain("step.runAction(internal.reviewValidationWorker.validate");
  });

  it("starts a new review through the workflow component immediately", () => {
    const source = readFileSync("convex/durableReview.ts", "utf8");
    const start = source.indexOf("reviewWorkflowManager.start(ctx, internal.durableReview.execute");
    const end = source.indexOf("await ctx.db.patch(args.reviewId", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // `startAsync` relies on the component workpool to claim the work later. A
    // review must begin durably at creation so a queued workpool cannot strand it.
    expect(source.slice(start, end)).not.toContain("startAsync");
  });

  it("keeps workflow failure detail internal and source-free", () => {
    const source = readFileSync("convex/durableReview.ts", "utf8");
    expect(source).toContain("export const workflowRuntimeStatus = internalQuery");
    expect(source).toContain("safeWorkflowFailureCode(status.error)");
    expect(source).not.toContain("failureError: status.error");
  });

  it("passes only the checkpoint contract after a completed worker", () => {
    const source = readFileSync("convex/durableReview.ts", "utf8");
    const checkpoint = source.indexOf("step.runMutation(internal.durableReview.checkpoint");
    const nextBranch = source.indexOf('if (stage === "analysis")', checkpoint);
    expect(source.slice(checkpoint, nextBranch)).not.toContain("...args");
    expect(source.slice(checkpoint, nextBranch)).toContain("expectedGeneration: args.expectedGeneration");
  });
});

// The report on the pull request is the entire output of the product. Both publishers were fired
// with `ctx.scheduler.runAfter(0, ...)`, which Convex runs exactly once: a GitHub 5xx or a
// secondary rate limit outliving the workflow's four seconds of step retries lost the review's
// output for good, while the dashboard went on showing a finished review with a verdict.
describe("publication survives a GitHub incident", () => {
  const durable = () => readFileSync("convex/durableReview.ts", "utf8");

  it("never fires a publisher through the one-shot scheduler", () => {
    expect(durable()).not.toMatch(/scheduler\.runAfter\(\s*0,\s*internal\.reviewPublicationWorker\.publish/);
  });

  it("runs both publishers on the pool that retries them", () => {
    const source = durable();
    expect(source).toContain("reviewWorkpool.enqueueAction(ctx, internal.reviewPublicationWorker.publish,");
    expect(source).toContain("reviewWorkpool.enqueueAction(ctx, internal.reviewPublicationWorker.publishPlatformFailure,");
  });

  // Bounded, with somewhere to land when the bound is reached: an unbounded retry would keep a
  // review in flight for good, and a bound with no give-up notice is the silence this replaced.
  it("bounds the retries and reports the give-up on the pull request", () => {
    const source = durable();
    expect(source).toMatch(/publicationRetry = \{ maxAttempts: [1-9]/);
    expect(source).toContain("onComplete: internal.durableReview.publicationCompleted");
    expect(source).toContain("internalCode: \"publication_gave_up\"");
  });

  // A moved head does not make "this review died" untrue. Refusing to say so left the pull request
  // showing the queue-time "BuildIT is reviewing this pull request" with nothing ever replacing it.
  it("still announces a platform failure after the head has moved", () => {
    const source = readFileSync("convex/reviewPublicationWorker.ts", "utf8");
    const failure = source.indexOf("export const publishPlatformFailure");
    expect(failure).toBeGreaterThan(-1);
    expect(source.slice(0, failure), "the verdict publisher must still refuse a moved head").toContain("stale_head");
    expect(source.slice(failure)).not.toContain("stale_head");
  });
});
