// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ history: undefined as unknown, queries: [] as unknown[] }));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("convex/react", () => ({ useQuery: (_reference: string, args: unknown) => { state.queries.push(args); return state.history; } }));
vi.mock("./live-connections", () => ({ useConnection: () => ({ state: "ready", organization: { id: "org" } }) }));
import { LiveHistory } from "./live-history";
const summary = () => ({
  partial: { reviews: false, spend: false, findings: false, feedback: false, list: false },
  costPending: false,
  observedAt: 1_700_000_100_000,
  window: { since: 1_700_000_000_000, until: 1_700_000_100_000 },
  totals: { reviews: 1, decisive: 1, inconclusive: 0, platformFailed: 0, automatic: 1, costUsd: 0.125, accepted: 1, dismissed: 0 },
  pullRequests: [{ reviewId: "review", prNumber: 1, status: "checks_passed", reason: null, incompleteReason: null, trigger: "automatic", blocking: 0, findings: 1, accepted: 1, dismissed: 0, costUsd: 0.125, durationMs: null, stale: false, findingsPartial: false, feedbackPartial: false, costPartial: false, costPending: false }],
});
beforeEach(() => { state.history = summary(); state.queries = []; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("truthful history figures", () => {
  it("keeps the query window stable during ordinary rerenders", () => {
    const time = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const view = render(<LiveHistory />), first = state.queries.at(-1);
    time.mockReturnValue(1_700_000_001_000); view.rerender(<LiveHistory />);
    expect(state.queries.at(-1)).toEqual(first);
  });
  it("does not turn missing time into zero seconds", () => {
    render(<LiveHistory />);
    expect(screen.getByText(/duration not measured/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("0s");
  });
  it("renders pending provider usage without a false zero price", () => {
    const value = summary(); value.costPending = true; value.partial.spend = true; value.totals.costUsd = 0;
    value.pullRequests[0]!.costPending = true; value.pullRequests[0]!.costUsd = 0; state.history = value;
    render(<LiveHistory />);
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(document.body.textContent).toContain("cost pending");
    expect(document.body.textContent).not.toContain("$0.0000");
  });
  it("hides acceptance percentages when feedback is incomplete", () => {
    const value = summary(); value.partial.feedback = true; value.partial.reviews = true; state.history = value;
    render(<LiveHistory />);
    expect(screen.getByText("Incomplete")).toBeTruthy();
    expect(screen.getByText(/History is incomplete/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("100%");
  });
  it("shows period charges even if their reviews started before this period", () => {
    const value = summary(); value.pullRequests = []; value.totals.reviews = 0; state.history = value;
    render(<LiveHistory />);
    expect(screen.getByText("$0.1250")).toBeTruthy();
    expect(screen.queryByText("No reviews in the last 30 days")).toBeNull();
  });
});
