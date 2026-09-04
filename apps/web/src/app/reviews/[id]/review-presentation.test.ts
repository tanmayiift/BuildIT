import { describe, expect, it } from "vitest";
import { dismissalReasonLabel, dismissalRefusal, eventPresentation, nextActionPresentation, pairFindingDetails, pullRequestHref, stagePresentation, statusPresentation, summarizeChecks, suppressionScopeLabel } from "./review-presentation";

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
    expect(statusPresentation("budget_exhausted", false)).toMatchObject({ label: "Budget reached", title: "Review stopped before the next model step", tone: "warning" });
    expect(nextActionPresentation("increase_budget", false)).toEqual({ title: "Increase the review budget", detail: "No further model call was made. Choose a higher ceiling, then start a new review." });
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

  it("links an authorized person to the exact pull request without inventing a URL", () => {
    expect(pullRequestHref("tanmayiift", "buildit-public-fixture", 2)).toBe("https://github.com/tanmayiift/buildit-public-fixture/pull/2");
    expect(pullRequestHref("", "repository", 2)).toBeUndefined();
    expect(pullRequestHref("owner", "repository", 0)).toBeUndefined();
  });

  it("offers the dismissal choices as prose rather than the database words", () => {
    expect(suppressionScopeLabel("pull_request")).toBe("This pull request");
    expect(suppressionScopeLabel("repository")).toBe("Anywhere in this repository");
    expect(dismissalReasonLabel("wrong_lines")).toBe("The cited lines are not where this happens");
    // An enum value this file has never heard of is still capitalised prose, never a raw code.
    expect(suppressionScopeLabel("branch_only")).toBe("Branch only");
    expect(dismissalReasonLabel("someone_elses_problem")).toBe("Someone elses problem");
  });

  it("turns each dismissal refusal into a sentence that says nothing was recorded", () => {
    const refused = dismissalRefusal(new Error("[Request ID: 8f2] Server Error\nUncaught ConvexError: not_found_or_forbidden"));
    expect(refused).toContain("developer access to this repository");
    expect(refused).toContain("Nothing was recorded.");
    // A ConvexError puts the code in .data, and a transport failure has only a message.
    expect(dismissalRefusal({ data: "finding_dismissal_reason_invalid" })).toContain("Choose one of the reasons offered");
    expect(dismissalRefusal(new Error("Failed to fetch"))).toContain("nothing about the review changed");
    for (const code of ["not_found_or_forbidden", "finding_fingerprint_invalid", "Server Error"]) {
      expect(refused + dismissalRefusal(new Error("Failed to fetch"))).not.toContain(code);
    }
  });

  // The rows carry a keyed HMAC of the path and the prose carries the path itself, so nothing joins
  // them but the fields both copy unchanged from the same arbitrated finding. Prose attached to the
  // wrong finding would name the wrong file to the person deciding whether to merge, so an
  // ambiguous key has to be refused rather than guessed.
  it("pairs decrypted prose to the row it belongs to, and refuses to guess", () => {
    const row = (id: string, over: Record<string, unknown> = {}) =>
      ({ id, category: "correctness", severity: "high", blocking: false, startLine: 12, endLine: 20, ...over });
    const prose = (id: string, over: Record<string, unknown> = {}) =>
      ({ id, path: "src/refund.ts", category: "correctness", severity: "high", blocking: false, startLine: 12, endLine: 20, ...over });

    const paired = pairFindingDetails([row("finding-a"), row("finding-b", { startLine: 40, endLine: 44 })],
      [prose("arbitrated-a"), prose("arbitrated-b", { path: "src/other.ts", startLine: 40, endLine: 44 })]);
    expect([...paired].map(([id, detail]) => [id, detail.path]))
      .toEqual([["finding-a", "src/refund.ts"], ["finding-b", "src/other.ts"]]);

    // The same kind of defect on the same lines of two different files: neither row may borrow the
    // other's file name, so neither is paired at all.
    expect(pairFindingDetails([row("finding-a"), row("finding-b")],
      [prose("arbitrated-a"), prose("arbitrated-b", { path: "src/other.ts" })]).size).toBe(0);
    expect(pairFindingDetails([row("finding-a")], []).size).toBe(0);
    expect(pairFindingDetails([row("finding-a", { severity: "warning" })], [prose("arbitrated-a")]).size).toBe(0);
  });
});
