import { describe, expect, it } from "vitest";
import { eventPresentation, nextActionPresentation, stagePresentation, statusPresentation, summarizeChecks } from "./review-presentation";

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

  it("keeps every decision state plain-language and explicit about human authority", () => {
    expect(statusPresentation("running", false)).toMatchObject({ label: "In progress", title: "BuildIT is reviewing this change" });
    expect(statusPresentation("changes_requested", false)).toMatchObject({ label: "Action needed", title: "Changes are needed before merge" });
    expect(statusPresentation("passed", false)).toMatchObject({ label: "Ready for you", title: "All required checks passed" });
    expect(statusPresentation("delivered", false)).toMatchObject({ label: "Fix ready", title: "A tested fix is ready to inspect" });
    expect(statusPresentation("platform_failed", false)).toMatchObject({ label: "Could not complete", title: "BuildIT hit a service problem" });
    expect(statusPresentation("platform_failed", false, "provider_rate_limited")).toMatchObject({ label: "Provider is busy", title: "Your model provider is rate-limited", tone: "warning" });
    expect(statusPresentation("inconclusive", false)).toMatchObject({ label: "Not enough proof", title: "A safe decision is not possible yet" });
    expect(nextActionPresentation("await_human_approval", false).detail).toContain("never merge");
  });

  it("groups repeated immutable check executions without hiding a disagreement", () => {
    const checks = summarizeChecks([
      { kind: "test", required: true, conclusion: "passed", durationMs: 300, evidenceAvailable: true },
      { kind: "test", required: true, conclusion: "failed", durationMs: 400, evidenceAvailable: true },
      { kind: "lint", required: false, conclusion: "passed", durationMs: 50, evidenceAvailable: true },
    ]);
    expect(checks).toEqual([
      expect.objectContaining({ kind: "test", required: true, conclusion: "mixed", executions: 2, durationMs: 700, outcomeSummary: "1 passed, 1 failed" }),
      expect.objectContaining({ kind: "lint", required: false, conclusion: "passed", executions: 1 }),
    ]);
  });
});
