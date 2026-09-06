// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Five surfaces treated "the workspace query has not answered" and "it answered, and no workspace
// is active" as one condition, then waited on a second query that stays skipped for as long as the
// second is true. So /metrics, /usage, /audit, /notifications and the setup permission receipt each
// showed a spinner that could never resolve, with no button and nothing to click - for every
// invited member, and for anyone removed from the workspace they had selected. The review queue had
// already been fixed once, with a comment naming the bug, and these five were left behind.
//
// Every case here asserts the same two things: the spinner is gone, and something the reader can
// act on is there instead.
const state = vi.hoisted(() => ({
  connection: undefined as unknown,
  receipt: undefined as unknown,
  queries: [] as string[],
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useQuery: (reference: string, args: unknown) => {
    if (args === "skip") return undefined;
    state.queries.push(reference);
    if (reference === "repositoryConnections:current") return state.connection;
    if (reference === "permissionReceipts:current") return state.receipt;
    // metrics:summarize, usage:summarize, audit:list and notifications:preferences are all skipped
    // while no workspace is active, so this is what they are: permanently undefined.
    return undefined;
  },
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("./workspace-route-boundary", () => ({ useSampleTour: () => false }));

const { WorkspaceMetrics, WorkspaceUsage } = await import("./live-metrics-usage");
const { WorkspaceAudit } = await import("./live-audit");
const { NotificationPreferences } = await import("./notification-preferences");
const { PermissionReceipt } = await import("./live-connections");

// What repositoryConnections:current returns for a signed-in user with no active workspace.
const noWorkspace = { state: "no_workspace", organization: null, installations: [], repositories: [] };

const surfaces = [
  { name: "/metrics", render: () => <WorkspaceMetrics />, spinner: "Loading live metrics…" },
  { name: "/usage", render: () => <WorkspaceUsage />, spinner: "Loading live usage…" },
  { name: "/audit", render: () => <WorkspaceAudit />, spinner: "Loading source-free audit history…" },
  { name: "/notifications", render: () => <NotificationPreferences />, spinner: "Loading notification preferences…" },
];

beforeEach(() => {
  state.connection = undefined;
  state.receipt = undefined;
  state.queries.length = 0;
});
afterEach(cleanup);

describe("a signed-in reader with no active workspace", () => {
  for (const surface of surfaces) {
    it(`${surface.name} ends in an answer, not a spinner that cannot resolve`, async () => {
      state.connection = noWorkspace;
      render(surface.render());
      const card = await screen.findByRole("heading", { name: "No workspace is active yet" });
      expect(screen.queryByText(surface.spinner), `${surface.name} still waits on a query that is skipped for ever`).toBeNull();
      expect(card.closest("section")!.textContent).toContain("You are signed in, but no workspace is active yet");
      // A dead end is the defect. Both routes out of this state have to be on the page: one for a
      // person who can install the App, one for a person whose workspace is an unaccepted invite.
      expect(screen.getByRole("link", { name: "Choose repository access" }).getAttribute("href")).toBe("/setup/install");
      expect(screen.getByRole("link", { name: "Accept a workspace invitation" }).getAttribute("href")).toBe("/account");
    });
  }

  it("the setup permission receipt says so too, rather than loading for ever", async () => {
    state.connection = noWorkspace;
    // permissionReceipts:current returns null - not undefined - when no workspace is active, which
    // is why `!receipt` could never stop being true.
    state.receipt = null;
    render(<PermissionReceipt />);
    await screen.findByRole("heading", { name: "No workspace is active yet" });
    expect(screen.queryByText("Loading verified permission receipt…")).toBeNull();
    expect(screen.getByRole("link", { name: "Choose repository access" }).getAttribute("href")).toBe("/setup/install");
    expect(screen.getByRole("link", { name: "Accept a workspace invitation" }).getAttribute("href")).toBe("/account");
  });
});

describe("the loading state these replace is still a loading state", () => {
  // The negative control. Splitting the condition must not turn "still asking the server" into
  // "there is no workspace", which would be the same lie in the other direction.
  for (const surface of surfaces) {
    it(`${surface.name} still says it is loading while the workspace query is in flight`, () => {
      state.connection = undefined;
      render(surface.render());
      expect(screen.getByText(surface.spinner)).not.toBeNull();
      expect(screen.queryByRole("heading", { name: "No workspace is active yet" })).toBeNull();
    });
  }

  it("the permission receipt still says it is loading while the receipt is in flight", async () => {
    state.connection = noWorkspace;
    state.receipt = undefined;
    render(<PermissionReceipt />);
    expect(await screen.findByText("Loading verified permission receipt…")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "No workspace is active yet" })).toBeNull();
  });
});
