// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression fixtures use provider-paid estimated dollars, the shape written by real model
// calls. Activity truncation must remain visible independently of the monthly budget snapshot.
import type { WorkspaceUsageSummary } from "../../../../convex/lib/workspaceFigureTypes";
const state = vi.hoisted(() => ({ connection: undefined as unknown, usage: undefined as unknown, metrics: undefined as unknown }));

const mutation = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => mutation,
  useQuery: (reference: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (reference === "repositoryConnections:current") return state.connection;
    if (reference === "usage:summarize") return state.usage;
    if (reference === "metrics:summarize") return state.metrics;
    return undefined;
  },
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("./workspace-route-boundary", () => ({ useSampleTour: () => false }));

const { WorkspaceUsage, WorkspaceMetrics } = await import("./live-metrics-usage");

const connection = { state: "connected", organization: { id: "org-1", name: "Acme workspace" }, installations: [], repositories: [] };

const summary = (over: Partial<WorkspaceUsageSummary> = {}): WorkspaceUsageSummary => ({
  quantities: { model_tokens: 41_000, ask_tokens: 1_000, sandbox_seconds: 900 },
  costs: { provider_billed: 12.5, platform: 0 },
  since: Date.UTC(2026, 8, 1),
  recordCount: 20_000,
  truncated: true,
  monthlyBudget: 100,
  budget: { month: "2026-09", periodStart: Date.UTC(2026, 8, 1), periodEnd: Date.UTC(2026, 9, 1), estimatedSpendUsd: 12.5, reservedUsd: 0, monthlyBudgetUsd: 100, remainingUsd: 87.5, accountingComplete: true, reconciliationComplete: true, unknownInvocationCount: 0, legacyCostsMayBeIncomplete: false },
  ...over,
});

beforeEach(() => { state.connection = connection; state.usage = summary(); state.metrics = { totals: { review_completed: 20_000, ci_regression_caught: 4, autofix_applied: 2, runner_failure: 1, provider_failure: 3, stale_review: 2 }, recordCount: 20_000, truncated: true, since: Date.UTC(2026, 8, 13) }; });
afterEach(cleanup);

describe("a month with more ledger rows than the query reads", () => {
  it("marks bounded activity figures without claiming the reconciled budget is partial", () => {
    render(<WorkspaceUsage />);
    const note = screen.getByText(/Activity figures read only/);
    expect(note.textContent).toContain("20,000 ledger records");
    expect(note.textContent).toContain("partial");
  });

  it("stops calling the capped row count the month's record count", () => {
    render(<WorkspaceUsage />);
    expect(screen.getByText("20,000 ledger records included · partial activity")).not.toBeNull();
    expect(screen.queryByText("20000 source-free ledger records")).toBeNull();
  });

  // The negative control: an ordinary month must not be labelled as truncated, or the warning is
  // noise everywhere and means nothing where it counts.
  it("says nothing of the sort when the whole month was read", () => {
    state.usage = summary({ recordCount: 312, truncated: false });
    render(<WorkspaceUsage />);
    expect(screen.getByText("312 ledger records included")).not.toBeNull();
    expect(screen.queryByText(/Activity figures read only/)).toBeNull();
  });
});


describe("figures match provider-paid ledger costs", () => {
  it("shows $12.50 of $100 and a 12.5 percent budget bar", () => {
    render(<WorkspaceUsage />);
    expect(screen.getByText(/12\.50/).textContent).toContain("100.00");
    const bar = screen.getByRole("progressbar", { name: /estimated model spend/i });
    expect(bar.getAttribute("aria-valuenow")).toBe("12.5");
    expect(screen.getByText(/42,000 model tokens/)).not.toBeNull();
    expect(screen.getByText(/Storage usage is not measured/)).not.toBeNull();
  });

  it("shows no limit rather than an empty zero-dollar allowance", () => {
    const ordinary = summary();
    state.usage = summary({ monthlyBudget: 0, budget: { ...ordinary.budget, monthlyBudgetUsd: 0, remainingUsd: null } });
    render(<WorkspaceUsage />);
    expect(screen.getByText("No monthly limit")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("does not show an uninitialized accounting counter as trusted zero", () => {
    const ordinary = summary();
    state.usage = summary({ budget: { ...ordinary.budget, estimatedSpendUsd: 0, accountingComplete: false, reconciliationComplete: false } });
    render(<WorkspaceUsage />);
    expect(screen.getByText(/Accounting is being reconciled/)).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("metric completeness", () => {
  it("marks every numeric tile and secondary count when the query overflows", () => {
    render(<WorkspaceMetrics />);
    expect(screen.getAllByText("Partial count")).toHaveLength(6);
    expect(screen.getByRole("status").textContent).toContain("20,000");
  });

  it("does not mark a complete metric window as partial", () => {
    state.metrics = { totals: { review_completed: 12 }, recordCount: 12, truncated: false, since: 0 };
    render(<WorkspaceMetrics />);
    expect(screen.queryByText("Partial count")).toBeNull();
    expect(screen.getByText("12")).not.toBeNull();
  });
});
