// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  // Four tiles stated the mix as four separate numbers and made the reader do the arithmetic, and
  // none of them led anywhere: "6 reached a verdict" could not be turned into those six rows. These
  // three pin the two properties that make the bar worth having - it must be legible without seeing
  // it, and selecting a share must open the rows it counts.
  it("draws the verdict mix as a shape whose figures are also written out", () => {
    const value = summary();
    value.totals = { ...value.totals, reviews: 10, decisive: 6, inconclusive: 3, platformFailed: 1 };
    state.history = value;
    render(<LiveHistory />);
    const figure = screen.getByRole("img", { name: /Of 10 review attempts/ });
    // A band for each outcome that happened and none for the one that did not.
    expect(figure.querySelectorAll("span[data-group]")).toHaveLength(3);
    expect((figure.querySelector('span[data-group="decisive"]') as HTMLElement).style.width).toBe("60%");
    // Hue is never the only channel carrying a figure: the accessible name states every count.
    expect(figure.getAttribute("aria-label")).toContain("3 inconclusive");
    expect(figure.getAttribute("aria-label")).toContain("1 did not finish");
  });

  it("turns a share of the bar into the rows it counts", async () => {
    const value = summary();
    value.totals = { ...value.totals, reviews: 2, decisive: 1, inconclusive: 1 };
    value.pullRequests = [value.pullRequests[0]!, { ...value.pullRequests[0]!, reviewId: "second", prNumber: 2, status: "inconclusive" }];
    state.history = value;
    render(<LiveHistory />);
    expect(screen.getByText("#1")).toBeTruthy();
    screen.getByRole("button", { name: /^Inconclusive 1$/ }).click();
    await waitFor(() => expect(screen.queryByText("#1")).toBeNull());
    expect(screen.getByText("#2")).toBeTruthy();
    screen.getByRole("button", { name: /^All attempts 2$/ }).click();
    await waitFor(() => expect(screen.getByText("#1")).toBeTruthy());
  });

  // A filter that empties the list looks identical to a broken page, and this list is the part of
  // the summary that can be truncated - so the page has to say which of the two just happened.
  it("distinguishes an outcome that did not occur from one whose rows were not listed", async () => {
    const value = summary();
    value.totals = { ...value.totals, reviews: 3, decisive: 1, platformFailed: 2 };
    state.history = value;
    render(<LiveHistory />);
    screen.getByRole("button", { name: /^Did not finish 2$/ }).click();
    await waitFor(() => expect(screen.getByText(/are not among the rows listed here/)).toBeTruthy());
    screen.getByRole("button", { name: /^Inconclusive 0$/ }).click();
    await waitFor(() => expect(screen.getByText(/No attempt in this period ended inconclusive/)).toBeTruthy());
  });

  it("shows period charges even if their reviews started before this period", () => {
    const value = summary(); value.pullRequests = []; value.totals.reviews = 0; state.history = value;
    render(<LiveHistory />);
    expect(screen.getByText("$0.1250")).toBeTruthy();
    expect(screen.queryByText("No reviews in the last 30 days")).toBeNull();
  });
});
