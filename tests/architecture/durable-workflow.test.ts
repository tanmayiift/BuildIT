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
