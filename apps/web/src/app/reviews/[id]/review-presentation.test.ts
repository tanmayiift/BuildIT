import { describe, expect, it } from "vitest";
import { eventPresentation, nextActionPresentation, stagePresentation, statusPresentation } from "./review-presentation";

describe("review presentation", () => {
  it("explains cancellation without implying a code failure", () => {
    expect(statusPresentation("cancelled", false)).toMatchObject({ label: "Stopped", title: "Review stopped", tone: "warning" });
    expect(nextActionPresentation("start_new_review", false)).toEqual({ title: "Run a new review", detail: "This run ended without a decision." });
  });

  it("makes stale evidence override an old verdict", () => {
    expect(statusPresentation("passed", true)).toMatchObject({ label: "Out of date", title: "The pull request changed" });
    expect(nextActionPresentation("human_review", true).title).toBe("Run a new review");
  });

  it("turns internal stages and events into human copy", () => {
    expect(stagePresentation("context")).toBe("Understanding the change");
    expect(eventPresentation("review_created")).toBe("Review started");
    expect(eventPresentation("review_cancelled")).toBe("Review stopped");
  });
});
