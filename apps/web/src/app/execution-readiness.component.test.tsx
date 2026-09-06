// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executionReadiness } from "./execution-readiness";

// runtimeReadiness:current ANDed BuildIT's deliberate execution safety switch with a check that
// this deployment holds its own eight REVIEW_RUNTIME_ENV secrets, and every customer surface read
// the single boolean that came out. So a rotated secret nobody re-set, a partial deploy or a new
// environment told a paying owner "Repository execution and AI review remain disabled until their
// safety gates pass", "Review execution is safety-blocked" and "Sandbox boundary · blocked" - their
// repository blamed for our misconfiguration. The one sentence that told the truth was written and
// could never render, because the same boolean disabled the button whose failure would have
// produced it.
//
// These fix the state the four surfaces must report when the safety gate is open and BuildIT's own
// configuration is not: it is ours, and the reader is told so.
const state = vi.hoisted(() => ({ connection: undefined as unknown, readiness: undefined as unknown, action: vi.fn() }));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => vi.fn(),
  useAction: () => state.action,
  useQuery: (reference: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (reference === "repositoryConnections:current") return state.connection;
    if (reference === "runtimeReadiness:current") return state.readiness;
    if (reference === "dashboardReviewData:availableProviders") return ["anthropic"];
    return undefined;
  },
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("./workspace-route-boundary", () => ({ useSampleTour: () => false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { ConnectionBanner, OverviewReadiness, SetupAccessSummary, SetupHealthState } = await import("./live-connections");
const { DashboardReviewStart } = await import("./reviews/dashboard-review-start");

const connection = {
  state: "connected",
  organization: { id: "org-1", name: "Acme workspace", slug: "acme", role: "owner", region: "eu-west-1", retentionHours: 24 },
  installations: [{ id: "installation-a", installationId: 42, accountLogin: "acme", accountType: "organization", status: "active", updatedAt: 1 }],
  repositories: [{ id: "repo-a", installationId: "installation-a", githubRepositoryId: 1, owner: "acme", name: "api", defaultBranch: "main", visibility: "private", autofixMode: "stacked", paused: false, indexState: "ready", updatedAt: 1 }],
};

// The safety switch is on. Only BuildIT's own review-runtime configuration is incomplete.
const buildItMisconfigured = { executionEnabled: true, runtimeConfigured: false };
// The deliberate product state: the release gate has not been opened yet.
const safetyGateClosed = { executionEnabled: false, runtimeConfigured: true };

// The exact dashboardReviews:prepare return shape - the consent panel, and the button this finding
// is about, exist only once a preview has been inspected.
const prepared = {
  repository: "acme/api", credentialScopeId: "scope-a",
  pull: { number: 42, title: "Refund rounding", url: "https://github.com/acme/api/pull/42", headSha: "c".repeat(40), baseSha: "b".repeat(40), changedFiles: 3, additions: 12, deletions: 4, isFork: false },
  consent: { reads: ["the pull request diff"], runs: ["the repository's own tests"], provider: "anthropic", model: "claude-sonnet-4-5", maximumProviderCostUsd: 2, writes: ["one BuildIT check"], cannot: ["merge"] },
};

async function previewOnePullRequest() {
  render(<DashboardReviewStart repositories={[{ id: "repo-a", owner: "acme", name: "api" }]} />);
  fireEvent.change(screen.getByLabelText("Pull request number"), { target: { value: "42" } });
  fireEvent.click(await screen.findByRole("button", { name: "Preview review access" }));
  await screen.findByText(/acme\/api #42/);
}

beforeEach(() => { state.connection = connection; state.readiness = buildItMisconfigured; state.action.mockReset().mockResolvedValue(prepared); });
afterEach(cleanup);

describe("what the customer is told when BuildIT is missing its own configuration", () => {
  const surfaces = [
    { name: "the connection banner", render: () => <ConnectionBanner /> },
    { name: "the overview readiness card", render: () => <OverviewReadiness /> },
    { name: "the setup health card", render: () => <SetupHealthState /> },
  ];

  for (const surface of surfaces) {
    it(`${surface.name} names BuildIT as the cause, not the customer's repository`, async () => {
      render(surface.render());
      const page = await screen.findByText(/BuildIT is missing part of its own review runtime configuration/);
      expect(page).not.toBeNull();
      // The three sentences that blamed the reader for our missing secret.
      for (const blame of [
        "Repository execution and AI review remain disabled until their safety gates pass",
        "Review execution is safety-blocked",
        "Execution remains disabled until adversarial tests pass",
      ]) expect(document.body.textContent, `still blames the workspace: ${blame}`).not.toContain(blame);
    });
  }

  it("the setup access row says whose configuration is incomplete", () => {
    render(<SetupAccessSummary stepIndex={3} />);
    expect(screen.getByText("BuildIT configuration incomplete")).not.toBeNull();
    expect(screen.queryByText("Safety blocked")).toBeNull();
    expect(screen.queryByText("Release gate passed")).toBeNull();
  });

  it("the consent control renders the sentence that could never render, and still starts nothing", async () => {
    await previewOnePullRequest();
    const button = screen.getByRole("button", { name: "BuildIT cannot start reviews right now" });
    // Never claim success before the server confirmed it: the start action would refuse this.
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/This is a BuildIT service problem, not a setting you can change/)).not.toBeNull();
  });
});

describe("the deliberate safety gate is still its own state", () => {
  // The negative control. Turning a missing secret into honest copy must not turn the real safety
  // gate into "BuildIT is broken" - that is a product state, and its wording is load-bearing.
  beforeEach(() => { state.readiness = safetyGateClosed; });

  it("still says the safety gates have not passed, and does not blame a missing secret", async () => {
    render(<ConnectionBanner />);
    expect(await screen.findByText(/Repository execution and AI review remain disabled until their safety gates pass/)).not.toBeNull();
    expect(document.body.textContent).not.toContain("missing part of its own review runtime configuration");
  });

  it("still reports the sandbox boundary as blocked on the setup health card", async () => {
    render(<SetupHealthState />);
    expect(await screen.findByText("Execution remains disabled until adversarial tests pass")).not.toBeNull();
    expect(screen.getByText("blocked")).not.toBeNull();
  });
});

describe("the two facts, and the precedence between them", () => {
  it("matches the order requireExecutionEnabled throws them in", () => {
    expect(executionReadiness(undefined)).toBe("checking");
    expect(executionReadiness({ executionEnabled: true, runtimeConfigured: true })).toBe("ready");
    expect(executionReadiness({ executionEnabled: true, runtimeConfigured: false })).toBe("service_unconfigured");
    expect(executionReadiness({ executionEnabled: false, runtimeConfigured: true })).toBe("safety_blocked");
    // convex/lib/executionGate.ts throws repository_execution_safety_blocked before it throws
    // review_runtime_configuration_missing, so a screen naming the gate first names the cause a
    // start attempt would actually have reported.
    expect(executionReadiness({ executionEnabled: false, runtimeConfigured: false })).toBe("safety_blocked");
  });

  it("never reports ready on one fact alone", () => {
    for (const readiness of [
      { executionEnabled: true, runtimeConfigured: false },
      { executionEnabled: false, runtimeConfigured: true },
      { executionEnabled: false, runtimeConfigured: false },
    ]) expect(executionReadiness(readiness)).not.toBe("ready");
  });
});
