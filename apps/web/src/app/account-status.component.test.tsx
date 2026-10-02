// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ auth: { isAuthenticated: false, isLoading: true }, viewer: undefined as unknown, organizations: undefined as unknown, tour: false, queried: [] as string[] }));

vi.mock("convex/react", () => ({
  useConvexAuth: () => state.auth,
  useQuery: (reference: string, args: unknown) => {
    if (args !== "skip") state.queried.push(reference);
    return reference === "users:viewer" ? state.viewer : state.organizations;
  },
}));
vi.mock("./workspace-route-boundary", () => ({ useSampleTour: () => state.tour }));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: vi.fn() }) }));

const { AccountStatus } = await import("./account-status");

beforeEach(() => { state.auth = { isAuthenticated: false, isLoading: true }; state.viewer = undefined; state.organizations = undefined; state.tour = false; state.queried = []; });
afterEach(cleanup);

describe("account status while the session is still resolving", () => {
  it("never offers sign-in before the session state is known", () => {
    const { container } = render(<AccountStatus compact />);
    expect(container.querySelector('a[href="/sign-in"]')).toBeNull();
    expect(container.textContent).not.toContain("Sign in");
  });

  it("never offers sign-in in the sidebar before the session state is known", () => {
    const { container } = render(<AccountStatus />);
    expect(container.querySelector('a[href="/sign-in"]')).toBeNull();
    expect(container.textContent).not.toContain("Sign in with GitHub");
  });

  it("announces the pending check to assistive technology", () => {
    render(<AccountStatus compact />);
    expect(screen.getByText("Checking…").getAttribute("aria-live")).toBe("polite");
  });

  it("offers sign-in once the session is known to be signed out", () => {
    state.auth = { isAuthenticated: false, isLoading: false };
    const { container } = render(<AccountStatus compact />);
    expect(container.querySelector('a[href="/sign-in"]')).not.toBeNull();
  });

  it("shows the account entry point once the viewer resolves", () => {
    state.auth = { isAuthenticated: true, isLoading: false };
    state.viewer = { id: "u1", name: "Tanmay Kumar", email: null, image: null };
    const { container } = render(<AccountStatus compact />);
    expect(container.querySelector('a[href="/account"]')).not.toBeNull();
    expect(container.querySelector('a[href="/sign-in"]')).toBeNull();
  });
});

// The sidebar sits beside "Sample tour · no live workspace data". It used to sit outside the tour
// context, so a signed-in visitor saw their own name and workspace there.
describe("account status inside the sample tour", () => {
  it("shows a signed-in visitor no account of theirs and asks for none", () => {
    state.auth = { isAuthenticated: true, isLoading: false };
    state.tour = true;
    state.viewer = { id: "u1", name: "Tanmay Kumar", email: "t@example.com", image: null };
    state.organizations = [{ id: "o1", name: "Ledgerline", slug: "ledgerline", timezone: "UTC", region: "eu-west-1" }];
    const { container } = render(<AccountStatus />);
    expect(container.textContent).toContain("Sample tour");
    expect(container.textContent).not.toContain("Tanmay Kumar");
    expect(container.textContent).not.toContain("Ledgerline");
    expect(state.queried).toEqual([]);
    expect(container.querySelector('a[href="/overview"]')).not.toBeNull();
  });

  it("still offers sign-in to a signed-out visitor, which is true in the tour too", () => {
    state.auth = { isAuthenticated: false, isLoading: false };
    state.tour = true;
    const { container } = render(<AccountStatus />);
    expect(container.querySelector('a[href="/sign-in"]')).not.toBeNull();
  });
});
