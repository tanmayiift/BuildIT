import { describe, expect, it } from "vitest";
import { durableReviewStages, nextStageAfter } from "../../convex/lib/durableStages";

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
});
