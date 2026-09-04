// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// reviews:runHistory and reviews:compareRuns were built, authorized, declared customer-facing and
// unit-tested, and no screen called either one. BuildIT re-reviews a pull request after every push,
// so "it found this last time and not this time" is the question people actually have, and until
// the run diff shipped the product could not answer it. These tests hold the answer to the exact
// shape convex/reviews.ts returns - a field invented here would render for nobody.
const state = vi.hoisted(() => ({
  evidence: undefined as unknown,
  runs: undefined as unknown,
  comparison: undefined as unknown,
  comparisonError: null as Error | null,
  queries: [] as Array<{ reference: string; args: unknown }>,
  action: vi.fn(),
  mutations: [] as string[],
  mutation: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (reference: string, args: unknown) => {
    if (args === "skip") return undefined;
    state.queries.push({ reference, args });
    if (reference === "reviews:getEvidence") return state.evidence;
    if (reference === "reviews:runHistory") return state.runs;
    // Convex's useQuery throws a failed query's error out of render rather than returning it.
    if (reference === "reviews:compareRuns") {
      if (state.comparisonError) throw state.comparisonError;
      return state.comparison;
    }
    return undefined;
  },
  useAction: () => state.action,
  useMutation: (reference: string) => { state.mutations.push(reference); return state.mutation; },
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));

import { LiveReviewDetail } from "./live-review-detail.js";

const evidence = {
  review: {
    id: "run-current", prNumber: 41, headSha: "c".repeat(40), baseSha: "b".repeat(40), baseRef: "main",
    status: "checks_passed", isStale: false, coverageLevel: "full", currentStage: "complete",
    nextActionCode: "none", mode: "review", provider: "anthropic", model: "claude-sonnet-4-5",
    budgetLimit: 5, budgetConsumed: 0.4, updatedAt: 1_700_000_200_000,
  },
  repository: { owner: "acme", name: "public-api" },
  requirements: [], findings: [], checks: [], rounds: [], events: [], stages: [],
  spend: { costUsd: 0.4, inputTokens: 1_000, outputTokens: 200 },
};

// The exact reviews:runHistory row shape.
const run = (id: string, createdAt: number, over: Record<string, unknown> = {}) => ({
  id, headSha: id === "run-current" ? "c".repeat(40) : "a".repeat(40), status: "checks_passed",
  mode: "review", createdAt, completedAt: createdAt + 60_000, promptVersion: "chain-v1",
  model: "claude-sonnet-4-5", provider: "anthropic", stageCount: 3, repairedStages: 0,
  inputTokens: 1_000, outputTokens: 200, costUsd: 0.4, blockingFindings: 0, totalFindings: 0,
  isCurrent: id === "run-current", ...over,
});

// The exact reviews:compareRuns return shape, field for field.
const comparison = {
  left: { id: "run-earlier", headSha: "a".repeat(40), status: "changes_requested", costUsd: 0.5, promptVersion: "chain-v1", model: "claude-sonnet-4-5" },
  right: { id: "run-current", headSha: "c".repeat(40), status: "checks_passed", costUsd: 0.4, promptVersion: "chain-v2", model: "claude-sonnet-4-5" },
  statusChanged: true,
  costDeltaUsd: -0.1,
  stages: [
    { stage: "requirements", left: { ran: true, attempts: 1, tokens: 1_200, repaired: false }, right: { ran: false, attempts: 0, tokens: 0, repaired: false } },
    { stage: "analysis", left: { ran: true, attempts: 2, tokens: 3_400, repaired: true }, right: { ran: true, attempts: 1, tokens: 2_000, repaired: false } },
  ],
  onlyInLeft: [{ severity: "critical", category: "requirement", blocking: true, resolution: "open", startLine: 12, endLine: 20 }],
  onlyInRight: [{ severity: "info", category: "test", blocking: false, resolution: "uncertain", startLine: 7, endLine: 7 }],
  inBoth: 2,
};

describe("comparing two runs of one pull request", () => {
  beforeEach(() => {
    state.evidence = evidence;
    state.runs = [run("run-current", 1_700_000_100_000), run("run-earlier", 1_700_000_000_000, { status: "changes_requested" })];
    state.comparison = comparison;
    state.comparisonError = null;
    state.queries.length = 0;
    state.action.mockReset().mockResolvedValue([]);
  });

  afterEach(cleanup);

  it("asks the server for exactly the two runs the person chose, older run first", async () => {
    render(<LiveReviewDetail id="run-current" />);
    fireEvent.change(await screen.findByLabelText("Compare against"), { target: { value: "run-earlier" } });
    expect(state.queries.filter(call => call.reference === "reviews:compareRuns").at(-1)).toEqual({
      reference: "reviews:compareRuns",
      args: { leftReviewId: "run-earlier", rightReviewId: "run-current" },
    });
  });

  it("renders what compareRuns reports changed, in prose rather than database words", async () => {
    render(<LiveReviewDetail id="run-current" />);
    fireEvent.change(await screen.findByLabelText("Compare against"), { target: { value: "run-earlier" } });

    const diff = screen.getByRole("region", { name: "Stage comparison, scrolls horizontally" });
    expect(screen.getByText("Action needed → Ready for you")).not.toBeNull();
    expect(screen.getByText("aaaaaaa → ccccccc")).not.toBeNull();
    expect(screen.getByText("−$0.1000")).not.toBeNull();
    expect(screen.getByText("chain-v1 → chain-v2")).not.toBeNull();

    // The column that matters: a defect the earlier run reported and this one did not.
    const lost = screen.getByRole("heading", { name: "Lost · 1" }).closest("div")!,
      added = screen.getByRole("heading", { name: "New · 1" }).closest("div")!;
    expect(screen.getByRole("heading", { name: "In both · 2" })).not.toBeNull();
    expect(lost.textContent).toContain("Critical");
    expect(lost.textContent).toContain("Unmet requirement · lines 12–20 · blocks merge");
    expect(added.textContent).toContain("For information");
    expect(added.textContent).toContain("Test coverage · line 7 · A person decides this one");

    // A stage the second run skipped is stated, not silently dropped.
    expect(diff.textContent).toContain("Not run");
    expect(diff.textContent).toContain("tokens · 2 calls · repaired");

    // The words technicalLabel would have printed instead - the enum, lightly capitalised.
    //
    // Split deliberately. An underscored status can never be legitimate anywhere in the section, so
    // it is checked against the whole thing. The category words cannot be: "Requirements" is a real
    // stage name in the stage table, and asserting against the section made this test fail on
    // correct output. Those are checked only where a leaked category would actually surface - the
    // findings panels - which is the difference between a guard and a tripwire.
    const section = diff.closest("section")!;
    for (const raw of ["changes_requested", "checks_passed"]) {
      expect(section.textContent, `raw status "${raw}" reached the page`).not.toContain(raw);
    }
    for (const raw of ["Requirement", "Uncertain", "Blocking"]) {
      expect(added.textContent, `raw category "${raw}" reached the findings list`).not.toContain(raw);
    }
  });

  it("says in a sentence when the two runs cannot be compared", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    state.comparisonError = new Error("[Request ID: 8f2] Server Error\nUncaught Error: not_found_or_forbidden");
    render(<LiveReviewDetail id="run-current" />);
    fireEvent.change(await screen.findByLabelText("Compare against"), { target: { value: "run-earlier" } });

    const refusal = await screen.findByText(/These two runs cannot be compared/);
    expect(refusal.textContent).toContain("runs of the same pull request");
    expect(document.body.textContent).not.toContain("not_found_or_forbidden");
    expect(document.body.textContent).not.toContain("Server Error");
    logged.mockRestore();
  });

  it("offers no comparison at all when the pull request has been reviewed once", async () => {
    state.runs = [run("run-current", 1_700_000_100_000)];
    render(<LiveReviewDetail id="run-current" />);
    await screen.findByText("acme/public-api");
    expect(screen.queryByText("Compare this run with another")).toBeNull();
    expect(screen.queryByLabelText("Compare against")).toBeNull();
    expect(state.queries.some(call => call.reference === "reviews:compareRuns")).toBe(false);
  });

  it("asks for no comparison until a run is chosen", async () => {
    render(<LiveReviewDetail id="run-current" />);
    await screen.findByLabelText("Compare against");
    expect(screen.getByText("Compare this run with another")).not.toBeNull();
    expect(state.queries.some(call => call.reference === "reviews:compareRuns")).toBe(false);
  });
});

// findings:dismiss is the only writer of findingSuppressions, which repositoryMemory reads into
// the next review's prompt, and no screen ever called it - so a person who read a finding and knew
// it was wrong had no way to say so, and the false-positive half of the evaluation loop had never
// received a candidate. The rows in reviews:getEvidence are what carry the fingerprint the mutation
// identifies a finding by; the exact row shape is held here, because a field invented in this file
// would render for nobody.
const findingRow = (over: Record<string, unknown> = {}) => ({
  id: "finding-a", category: "correctness", severity: "high", confidence: 0.9, blocking: false,
  fingerprintHmac: "a".repeat(64), pathFingerprint: "0123456789ab", startLine: 12, endLine: 20,
  evidenceCount: 2, resolution: "open", ...over,
});
// The exact reviewEvidenceActions:getFindingDetails shape - decrypted prose, joined to the row above
// on what both copy from the same arbitrated finding.
const findingProse = (over: Record<string, unknown> = {}) => ({
  id: "arbitrated-a", title: "Refund total ignores the currency", category: "correctness", severity: "high",
  confidence: 0.9, path: "src/billing/refund.ts", startLine: 12, endLine: 20,
  impact: "A refund raised in euros is paid at the pound amount.",
  explanation: "Compare the currency before summing the lines.", resolution: "accepted", blocking: false, ...over,
});

describe("dismissing a finding a person knows is wrong", () => {
  beforeEach(() => {
    state.evidence = { ...evidence, findings: [findingRow()] };
    state.runs = [run("run-current", 1_700_000_100_000)];
    state.queries.length = 0;
    state.mutations.length = 0;
    state.action.mockReset().mockResolvedValue([findingProse()]);
    state.mutation.mockReset().mockResolvedValue({ id: "finding-a", scope: "path" });
  });

  afterEach(cleanup);

  it("sends findings:dismiss the fingerprint of the finding on screen, with the chosen scope and reason", async () => {
    render(<LiveReviewDetail id="run-current" />);
    const finding = await screen.findByRole("article", { name: "Finding: Refund total ignores the currency" });
    fireEvent.change(within(finding).getByLabelText("How far this applies"), { target: { value: "path" } });
    fireEvent.change(within(finding).getByLabelText("Why it is wrong"), { target: { value: "wrong_lines" } });
    fireEvent.click(within(finding).getByRole("button", { name: "Dismiss this finding" }));

    await waitFor(() => expect(state.mutation).toHaveBeenCalled());
    expect(state.mutations).toContain("findings:dismiss");
    expect(state.mutation.mock.calls[0]![0]).toEqual({
      reviewId: "run-current",
      fingerprintHmac: "a".repeat(64),
      scope: "path",
      reasonCode: "wrong_lines",
      requestId: expect.any(String),
    });
    // The dismissal is only worth making if the person is told it landed.
    expect((await screen.findByRole("status")).textContent).toContain("Dismissed by your team");
  });

  it("says in a sentence when the dismissal is refused, and never shows the code", async () => {
    state.mutation.mockRejectedValue(new Error("[Request ID: 8f2] Server Error\nUncaught ConvexError: not_found_or_forbidden"));
    render(<LiveReviewDetail id="run-current" />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss this finding" }));

    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("needs developer access to this repository");
    expect(refusal.textContent).toContain("Nothing was recorded.");
    expect(document.body.textContent).not.toContain("not_found_or_forbidden");
    expect(document.body.textContent).not.toContain("Server Error");
  });

  // packages/orchestrator/src/learning.ts is demote-only and refuses these three whatever a team
  // dismisses, so the control must not read as a mute button on any of them.
  it("says plainly which findings keep being reported however often they are dismissed", async () => {
    state.evidence = { ...evidence, findings: [
      findingRow({ id: "finding-blocking", blocking: true, startLine: 3, endLine: 3 }),
      findingRow({ id: "finding-critical", severity: "critical", startLine: 4, endLine: 4 }),
      findingRow({ id: "finding-scanner", category: "security", ruleId: "generic-api-key", startLine: 5, endLine: 5 }),
      findingRow({ id: "finding-plain", severity: "warning", category: "quality", startLine: 6, endLine: 6 }),
    ] };
    state.action.mockResolvedValue([]);
    render(<LiveReviewDetail id="run-current" />);
    await screen.findByText("Issues to fix");

    const kept = "It is still reported after this: BuildIT never silences a finding that blocks merge, a Critical finding, or a scanner result.";
    for (const name of ["Wrong behaviour · line 3", "Wrong behaviour · line 4", "Security · line 5"]) {
      expect(within(screen.getByRole("article", { name: `Finding: ${name}` })).getByText(new RegExp(kept.slice(0, 40)))).not.toBeNull();
    }
    const plain = within(screen.getByRole("article", { name: "Finding: Code quality · line 6" }));
    expect(plain.queryByText(new RegExp(kept.slice(0, 40)))).toBeNull();
    expect(plain.getByText(/Nothing here changes the pull request/)).not.toBeNull();
  });

  it("offers no form for a finding the team has already dismissed, and says what that did", async () => {
    state.evidence = { ...evidence, findings: [findingRow({ resolution: "dismissed" })] };
    render(<LiveReviewDetail id="run-current" />);
    const finding = await screen.findByRole("article", { name: "Finding: Refund total ignores the currency" });
    expect(within(finding).queryByRole("button", { name: "Dismiss this finding" })).toBeNull();
    expect(within(finding).getByRole("status").textContent).toContain("The next review of this repository is told a person judged this finding wrong");
  });

  // The prose and the row are joined on what both copy unchanged from the same arbitrated finding.
  // A row the prose cannot be matched to still gets its control - what it must never get is another
  // finding's file name beside it.
  it("keeps the control on every finding, prose or not, and never borrows the wrong file", async () => {
    state.evidence = { ...evidence, findings: [findingRow(), findingRow({ id: "finding-b", severity: "warning", startLine: 44, endLine: 44 })] };
    render(<LiveReviewDetail id="run-current" />);
    await screen.findByRole("article", { name: "Finding: Refund total ignores the currency" });
    const unmatched = screen.getByRole("article", { name: "Finding: Wrong behaviour · line 44" });
    expect(unmatched.textContent).toContain("path 0123456789ab · line 44");
    expect(unmatched.textContent).not.toContain("src/billing/refund.ts");
    expect(within(unmatched).getByRole("button", { name: "Dismiss this finding" })).not.toBeNull();
  });
});
