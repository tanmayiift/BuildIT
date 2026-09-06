// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TrackerConnections subscribed to integrations:listTrackerConnections on nothing but "an
// organization id exists". That query requires admin, convex/lib/authz.ts throws
// not_found_or_forbidden below it, and Convex's useQuery rethrows a refused query during render -
// so /integrations unmounted into app/error.tsx for every viewer and every developer, and its Retry
// button re-rendered the same subtree into the same throw. The sibling hook on the same page
// (useCredentialReadiness) gates on the role; this one was missed.
//
// These hold the gate at the only place it can be observed from the outside: which arguments the
// subscription is opened with.
const state = vi.hoisted(() => ({
  connection: undefined as unknown,
  rows: undefined as unknown,
  queries: [] as Array<{ reference: string; args: unknown }>,
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useQuery: (reference: string, args: unknown) => {
    state.queries.push({ reference, args });
    if (args === "skip") return undefined;
    if (reference === "repositoryConnections:current") return state.connection;
    if (reference === "integrations:listTrackerConnections") return state.rows;
    return undefined;
  },
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("./workspace-route-boundary", () => ({ useSampleTour: () => false }));

const { TrackerConnections } = await import("./live-connections");

const connection = (role: string) => ({
  state: "connected",
  organization: { id: "org-1", name: "Acme workspace", slug: "acme", role, region: "eu-west-1", retentionHours: 24 },
  installations: [],
  repositories: [],
});

const trackerRow = {
  id: "tracker-1", provider: "linear", workspaceId: "acme", scopes: ["read"], status: "active",
  maskedSuffix: "1a2b", lastUsedAt: null, createdAt: 1,
};

const trackerCalls = () => state.queries.filter(call => call.reference === "integrations:listTrackerConnections");

beforeEach(() => {
  state.connection = undefined;
  state.rows = undefined;
  state.queries.length = 0;
});
afterEach(cleanup);

describe("who may subscribe to the tracker connection list", () => {
  for (const role of ["viewer", "developer"]) {
    it(`never opens the admin-only subscription for a ${role}`, async () => {
      state.connection = connection(role);
      state.rows = [trackerRow];
      render(<TrackerConnections />);
      await screen.findByText(/Only an owner or admin can see/);
      expect(trackerCalls().every(call => call.args === "skip"), "the query that throws for this role was still opened").toBe(true);
    });
  }

  it("tells a role that cannot read the list who can, instead of leaving it to the route error page", async () => {
    state.connection = connection("developer");
    state.rows = [trackerRow];
    render(<TrackerConnections />);
    expect((await screen.findByText(/Only an owner or admin can see/)).textContent).toContain("Acme workspace");
    expect(screen.getByText("Owner or admin manages this")).not.toBeNull();
    // The route error page's copy, and the server code behind it, must never be what a person reads.
    expect(document.body.textContent).not.toContain("We could not load this workspace");
    expect(document.body.textContent).not.toContain("not_found_or_forbidden");
  });

  for (const role of ["owner", "admin"]) {
    it(`still subscribes and still lists live trackers for an ${role}`, async () => {
      state.connection = connection(role);
      state.rows = [trackerRow];
      render(<TrackerConnections />);
      await screen.findByText("1 active");
      expect(trackerCalls().some(call => JSON.stringify(call.args) === JSON.stringify({ organizationId: "org-1" }))).toBe(true);
      expect(screen.queryByText(/Only an owner or admin can see/)).toBeNull();
    });
  }
});
