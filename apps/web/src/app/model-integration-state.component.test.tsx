// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connection: undefined as unknown, credentials: undefined as unknown }));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => vi.fn(),
  useQuery: (reference: string) => {
    if (reference === "repositoryConnections:current") return state.connection;
    if (reference === "integrations:listProviderCredentials") return state.credentials;
    return undefined;
  },
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("./workspace-route-boundary", () => ({ useSampleTour: () => false }));

const { ModelIntegrationState } = await import("./live-connections");

function connected(role: string) {
  return { state: "connected", organization: { id: "org-1", name: "Acme", slug: "acme", role, region: "eu-west-1", retentionHours: 24 }, installations: [], repositories: [] };
}

beforeEach(() => { state.connection = undefined; state.credentials = undefined; });
afterEach(cleanup);

describe("model provider integration card", () => {
  it("reports the number of validated keys instead of a fixed setup prompt", () => {
    state.connection = connected("owner");
    state.credentials = [{ status: "valid" }, { status: "valid" }, { status: "revoked" }];
    render(<ModelIntegrationState />);
    expect(screen.getByText("2 connected")).toBeTruthy();
    expect(screen.queryByText("Connect when analyzing")).toBeNull();
  });

  it("still prompts to connect when every stored key is revoked", () => {
    state.connection = connected("admin");
    state.credentials = [{ status: "revoked" }];
    render(<ModelIntegrationState />);
    expect(screen.getByText("Connect when analyzing")).toBeTruthy();
  });

  it("does not claim a key is missing when the role may not read credentials", () => {
    state.connection = connected("developer");
    render(<ModelIntegrationState />);
    expect(screen.getByText("Owner or admin manages this")).toBeTruthy();
    expect(screen.queryByText("Connect when analyzing")).toBeNull();
  });

  it("shows a checking state before the credential list resolves", () => {
    state.connection = connected("owner");
    render(<ModelIntegrationState />);
    expect(screen.getByText("Checking…")).toBeTruthy();
  });

  it("never renders a provider key or suffix", () => {
    state.connection = connected("owner");
    state.credentials = [{ status: "valid", maskedSuffix: "YkEA" }];
    const { container } = render(<ModelIntegrationState />);
    expect(container.textContent).not.toContain("YkEA");
  });
});
