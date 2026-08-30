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
    expect(durableReviewStages).toEqual(["context", "analysis", "validation"]);
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
});
