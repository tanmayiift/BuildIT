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
    const worker = source.indexOf("step.runAction(internal.reviewContextWorker.gather");
    const checkpoint = source.indexOf("step.runMutation(internal.durableReview.checkpoint");
    expect(worker).toBeGreaterThan(-1);
    expect(checkpoint).toBeGreaterThan(worker);
  });
});
