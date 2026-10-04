import { describe, expect, it } from "vitest";
import { dismissalReasonLabel, dismissalRefusal, eventPresentation, evidenceRefusal, nextActionPresentation, pairFindingDetails, pullRequestHref, stagePresentation, statusPresentation, summarizeChecks, suppressionScopeLabel } from "./review-presentation";

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

  // The short labels for real statuses come from review-status.ts, shared with every page. The titles
  // asserted here are still this page's own and still carry the human-authority wording; "running" and
  // "passed" are sample-tour states rather than enum values and keep their own labels.
  it("keeps every decision state plain-language and explicit about human authority", () => {
    expect(statusPresentation("running", false)).toMatchObject({ label: "In progress", title: "BuildIT is reviewing this change" });
    expect(statusPresentation("changes_requested", false)).toMatchObject({ label: "Changes requested", title: "Changes are needed before merge" });
    expect(statusPresentation("passed", false)).toMatchObject({ label: "Ready for you", title: "All required checks passed" });
    expect(statusPresentation("delivered", false)).toMatchObject({ label: "Fix delivered", title: "A tested fix is ready to inspect" });
    expect(statusPresentation("platform_failed", false)).toMatchObject({ label: "BuildIT failed", title: "BuildIT hit a service problem" });
    expect(statusPresentation("platform_failed", false, "provider_rate_limited")).toMatchObject({ label: "Provider is busy", title: "Your model provider is rate-limited", tone: "warning" });
    expect(statusPresentation("budget_exhausted", false)).toMatchObject({ label: "Budget reached", title: "Review stopped before the next model step", tone: "warning" });
    expect(nextActionPresentation("increase_budget", false)).toEqual({ title: "Increase the review budget", detail: "No further model call was made. Choose a higher ceiling, then start a new review." });
    expect(statusPresentation("inconclusive", false)).toMatchObject({ label: "Inconclusive", title: "A safe decision is not possible yet" });
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

  it("shows the head commit's test counts, not the base commit's", () => {
    const [test] = summarizeChecks([
      { kind: "test", required: true, conclusion: "failed", durationMs: 300, evidenceAvailable: true, commitSha: "b".repeat(40), testSummary: "Tests: 190 passed, 4 failed" },
      { kind: "test", required: true, conclusion: "failed", durationMs: 400, evidenceAvailable: true, commitSha: "a".repeat(40), testSummary: "Tests: 192 passed, 2 failed" },
    ], "a".repeat(40));
    expect(test).toMatchObject({ testSummary: "Tests: 192 passed, 2 failed" });
    expect(summarizeChecks([{ kind: "lint", required: true, conclusion: "passed", durationMs: 1, evidenceAvailable: true, commitSha: "a".repeat(40) }], "a".repeat(40))[0]).not.toHaveProperty("testSummary");
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

  // reviews:getEvidence throws for a malformed id, a review in another workspace, a membership that
  // was removed, and an installation that was suspended or uninstalled - and every one of those
  // reached the reader as the generic route error page's "We could not load this workspace", which
  // names the wrong noun and offers a Retry that cannot ever succeed.
  it("turns a refused review into a sentence about the review, naming what a person can do", () => {
    const refused = evidenceRefusal(new Error("[Request ID: 8f2] Server Error\nUncaught ConvexError: not_found_or_forbidden"));
    expect(refused).toContain("not in your active workspace");
    expect(refused).toContain("review queue");
    // The uninstall and suspension cases produce the same code, and are the ones a reader is least
    // likely to guess: every previously-working review URL in the workspace starts refusing at once.
    expect(refused).toContain("uninstalled or suspended");
    // A ConvexError puts the code in .data; a transport failure has only a message.
    expect(evidenceRefusal({ data: "not_found_or_forbidden" })).toBe(refused);
    expect(evidenceRefusal(new Error("Failed to fetch"))).toContain("Nothing about the review changed");
    for (const code of ["not_found_or_forbidden", "Server Error", "Request ID"]) {
      expect(refused + evidenceRefusal(new Error("Failed to fetch"))).not.toContain(code);
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

// zod #1, 4 Oct 2026: the page showed "Build · Required · Passed" for the dependency install. BuildIT
// built nothing; the runner files the install under kind "build".
describe("naming the step a check row ran", () => {
  it("calls the install what it is, and keeps a trusted build check apart from it", async () => {
    const { checkLabel, summarizeChecks } = await import("./review-presentation");
    expect(checkLabel({ kind: "build", planId: "install" })).toBe("Dependency install");
    expect(checkLabel({ kind: "build", planId: "build" })).toBe("Build");
    expect(checkLabel({ kind: "secret_scan", planId: "gitleaks" })).toBe("Secret scan");
    const rows = summarizeChecks([
      { kind: "build", planId: "install", required: true, conclusion: "passed", durationMs: 10, evidenceAvailable: true },
      { kind: "build", planId: "build", required: true, conclusion: "failed", durationMs: 20, evidenceAvailable: true },
    ]);
    expect(rows.map(row => [checkLabel(row), row.conclusion])).toEqual([["Dependency install", "passed"], ["Build", "failed"]]);
  });

  it("does not guess for a row recorded before the step was stored", async () => {
    const { checkLabel } = await import("./review-presentation");
    expect(checkLabel({ kind: "build" })).toBe("Dependency install or build");
    expect(checkLabel({ kind: "test" })).toBe("Test");
  });

  it("names a failing install as the install in the pre-existing summary", async () => {
    const { preExistingFailurePresentation } = await import("./review-presentation");
    const shown = preExistingFailurePresentation("checks_passed", [
      { kind: "build", planId: "install", required: true, conclusion: "failed", durationMs: 1, evidenceAvailable: true, executions: 2, outcomeSummary: "2 failed" },
    ])!;
    expect(shown.summary).toMatch(/\(dependency install\)/);
  });
});

describe("a pass with required checks that were already failing", () => {
  it("does not claim every required check passed", async () => {
    const { preExistingFailurePresentation } = await import("./review-presentation");
    const checks = [
      { kind: "test", required: true, conclusion: "failed", durationMs: 1, evidenceAvailable: true, executions: 2, outcomeSummary: "2 failed" },
      { kind: "secret_scan", required: true, conclusion: "failed", durationMs: 1, evidenceAvailable: true, executions: 2, outcomeSummary: "2 failed" },
      { kind: "build", required: true, conclusion: "passed", durationMs: 1, evidenceAvailable: true, executions: 2, outcomeSummary: "2 passed" },
    ];
    const shown = preExistingFailurePresentation("checks_passed", checks)!;
    expect(shown.title).toBe("No new failures from this change");
    expect(shown.summary).toMatch(/test, secret scan/);
    expect(shown.summary).not.toMatch(/All required checks passed/);
    expect(preExistingFailurePresentation("checks_passed", [checks[2]!])).toBeUndefined();
    expect(preExistingFailurePresentation("changes_requested", checks)).toBeUndefined();
  });
});
