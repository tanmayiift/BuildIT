// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ auth: { isAuthenticated: true, isLoading: false }, tour: false, queried: [] as string[], mutation: vi.fn() }));

vi.mock("convex/react", () => ({
  useConvexAuth: () => state.auth,
  useQuery: (reference: string, args: unknown) => {
    if (args !== "skip") state.queried.push(reference);
    return reference === "organizations:listMine"
      ? [{ id: "o1", name: "Ledgerline", slug: "ledgerline", timezone: "UTC", region: "eu-west-1", role: "owner" }]
      : { id: "o1", name: "Ledgerline", slug: "ledgerline", role: "owner" };
  },
  useMutation: () => state.mutation,
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("./workspace-route-boundary", () => ({ useSampleTour: () => state.tour }));

const { WorkspaceSwitcher } = await import("./workspace-switcher");

beforeEach(() => { state.tour = false; state.queried = []; });
afterEach(cleanup);

describe("workspace switcher", () => {
  it("lists a signed-in member's real workspaces outside the tour", () => {
    const { container } = render(<WorkspaceSwitcher />);
    expect(container.querySelector("select")).not.toBeNull();
    expect(state.queried).toContain("organizations:listMine");
  });

  // Inside the tour it used to show the same list, and changing it called
  // organizations:selectActive - a real write from a screen that promises it makes none.
  it("shows only the sample workspace inside the tour, with nothing to change", () => {
    state.tour = true;
    const { container } = render(<WorkspaceSwitcher />);
    expect(container.textContent).toContain("Sample workspace");
    expect(container.textContent).not.toContain("Ledgerline");
    expect(container.querySelector("select")).toBeNull();
    expect(state.queried).toEqual([]);
  });
});
