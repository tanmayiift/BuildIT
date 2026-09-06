// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// usage:summarize caps its read at convex/lib/parentScope.ts summaryRowCeiling and returns
// `truncated: rows.length === summaryRowCeiling` precisely so the caller can say the figures are a
// window rather than the month. The client's declared result type omitted the field and the render
// never read it, so on the one page whose job is to answer "how much have we spent this month" the
// page printed a partial sum with nothing marking it as partial. One ledger row is written per
// model stage run, so a few hundred reviews reach the ceiling.
const state = vi.hoisted(() => ({ connection: undefined as unknown, usage: undefined as unknown }));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => vi.fn(),
  useQuery: (reference: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (reference === "repositoryConnections:current") return state.connection;
    if (reference === "usage:summarize") return state.usage;
    return undefined;
  },
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("./workspace-route-boundary", () => ({ useSampleTour: () => false }));

const { WorkspaceUsage } = await import("./live-metrics-usage");

const connection = { state: "connected", organization: { id: "org-1", name: "Acme workspace" }, installations: [], repositories: [] };

// The exact usage:summarize return shape, field for field - a field invented here would render for
// nobody. `truncated` is true exactly when rows.length hit summaryRowCeiling.
const summary = (over: Record<string, unknown> = {}) => ({
  quantities: { model_tokens: 41_000, sandbox_seconds: 900, storage_bytes: 12_000 },
  costs: { provider_billed: 0, usd: 12.5 },
  recordCount: 20_000,
  truncated: true,
  monthlyBudget: 100,
  ...over,
});

beforeEach(() => { state.connection = connection; state.usage = summary(); });
afterEach(cleanup);

describe("a month with more ledger rows than the query reads", () => {
  it("says the figures and the budget bar are a window, not the month", () => {
    render(<WorkspaceUsage />);
    const note = screen.getByText(/read only the most recent/);
    expect(note.textContent).toContain("20,000 ledger records");
    expect(note.textContent).toContain("floors rather than totals");
  });

  it("stops calling the capped row count the month's record count", () => {
    render(<WorkspaceUsage />);
    expect(screen.getByText("Most recent 20,000 of this month's ledger records")).not.toBeNull();
    expect(screen.queryByText("20000 source-free ledger records")).toBeNull();
  });

  // The negative control: an ordinary month must not be labelled as truncated, or the warning is
  // noise everywhere and means nothing where it counts.
  it("says nothing of the sort when the whole month was read", () => {
    state.usage = summary({ recordCount: 312, truncated: false });
    render(<WorkspaceUsage />);
    expect(screen.getByText("312 source-free ledger records")).not.toBeNull();
    expect(screen.queryByText(/read only the most recent/)).toBeNull();
  });
});
