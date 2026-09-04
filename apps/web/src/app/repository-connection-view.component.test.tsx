// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connection: undefined as unknown,
  updatePolicy: vi.fn(),
  refreshRepositories: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (reference: string) => reference === "repositoryConnections:current" ? state.connection : undefined,
  useMutation: () => state.updatePolicy,
  useAction: () => state.refreshRepositories,
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("./workspace-route-boundary", () => ({ useSampleTour: () => false }));

import { RepositoryConnectionView } from "./live-connections.js";

const repositories = [
  { id: "repo-public", installationId: "installation-a", githubRepositoryId: 1, owner: "acme", name: "public-api", defaultBranch: "main", visibility: "public", autofixMode: "stacked", paused: false, indexState: "ready", updatedAt: 1 },
  { id: "repo-private", installationId: "installation-a", githubRepositoryId: 2, owner: "acme", name: "private-api", defaultBranch: "main", visibility: "private", autofixMode: "disabled", paused: true, indexState: "ready", updatedAt: 1 },
  { id: "repo-web", installationId: "installation-a", githubRepositoryId: 3, owner: "acme", name: "web", defaultBranch: "main", visibility: "public", autofixMode: "stacked", paused: false, indexState: "ready", updatedAt: 1 },
];

describe("connected repository workspace", () => {
  beforeEach(() => {
    state.connection = {
      state: "connected",
      organization: { id: "org-acme", name: "Acme workspace", slug: "acme", role: "owner", region: "eu-west-1", retentionHours: 24 },
      installations: [{ id: "installation-a", installationId: 42, accountLogin: "acme", accountType: "organization", status: "active", updatedAt: 1 }],
      repositories,
    };
    state.updatePolicy.mockReset().mockResolvedValue(null);
  });

  afterEach(cleanup);

  it("leads with a compact connection receipt and the selected repository count", async () => {
    render(<RepositoryConnectionView />);
    expect(await screen.findByRole("heading", { name: "3 repositories connected" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "GitHub connection" }).textContent).toContain("Acme workspace");
    expect(screen.getByText("Ireland", { exact: true })).not.toBeNull();
    expect(screen.getByText("Paris", { exact: true })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Manage GitHub access" })).not.toBeNull();
  });

  it("groups each repository's state and policy in one readable control area", async () => {
    render(<RepositoryConnectionView />);
    const active = await screen.findByRole("article", { name: "Repository policy for acme/public-api" });
    expect(active.textContent).toContain("Public repository");
    expect(active.textContent).toContain("Reviews active");
    expect(active.textContent).toContain("Fixes open as a separate pull request");
    expect(screen.getByLabelText("Autofix delivery for acme/public-api")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Pause reviews for acme/public-api" })).not.toBeNull();

    const paused = screen.getByRole("article", { name: "Repository policy for acme/private-api" });
    expect(paused.textContent).toContain("Private repository");
    expect(paused.textContent).toContain("Reviews paused");
    expect(screen.getByRole("button", { name: "Resume reviews for acme/private-api" })).not.toBeNull();
  });

  it("keeps controls accessible and responsive in the shared stylesheet", async () => {
    render(<RepositoryConnectionView />);
    await waitFor(() => expect(screen.getAllByRole("article", { name: /Repository policy for/ })).toHaveLength(3));
    const css = readFileSync("apps/web/src/app/flows.css", "utf8");
    expect(css).toMatch(/\.repository-policy-select[^}]*min-height:44px/);
    expect(css).toMatch(/\.repository-actions[^}]*min-height:44px/);
    expect(css).toMatch(/@media\(max-width:760px\)[\s\S]*\.repository-row\{grid-template-columns:1fr/);
    expect(css).toMatch(/\.repository-row:focus-within[^}]*var\(--navy-soft\)/);
  });
});

// A review that reads a .buildit.yml it cannot trust names the version in its receipt. Until this
// control existed the product offered no way to act on that, and admin approval is the only trust
// route BuildIT has - the protected-ref route needs administration:read, which the App lacks. So a
// missing button here meant a repository configuration could never be used by anyone who could not
// reach the operator directly.
describe("approving a repository configuration", () => {
  beforeEach(() => {
    state.connection = {
      state: "connected",
      organization: { id: "org-acme", name: "Acme workspace", slug: "acme", role: "owner", region: "eu-west-1", retentionHours: 24 },
      installations: [{ id: "installation-a", installationId: 42, accountLogin: "acme", accountType: "organization", status: "active", updatedAt: 1 }],
      repositories: [{ ...repositories[0], pendingConfigHash: "f".repeat(64) }],
    };
    state.updatePolicy.mockReset().mockResolvedValue(null);
  });

  afterEach(cleanup);

  it("offers the exact version the review refused", async () => {
    render(<RepositoryConnectionView />);
    await screen.findByRole("button", { name: /Approve \.buildit\.yml ffffffffffff for acme\/public-api/ });
    expect(screen.getByText("ffffffffffff")).toBeDefined();
  });

  it("approves that version and nothing else", async () => {
    render(<RepositoryConnectionView />);
    (await screen.findByRole("button", { name: /Approve \.buildit\.yml/ })).click();
    await waitFor(() => expect(state.updatePolicy).toHaveBeenCalled());
    expect((state.updatePolicy.mock.calls[0]![0] as { approvedConfigHash?: string }).approvedConfigHash).toBe("f".repeat(64));
  });

  it("shows nothing at all when no configuration has ever been seen", async () => {
    state.connection = { ...(state.connection as Record<string, unknown>), repositories: [repositories[0]] };
    render(<RepositoryConnectionView />);
    await screen.findByText("acme/public-api");
    expect(screen.queryByText(/awaiting approval/)).toBeNull();
  });

  it("says the configuration is in use once the approved version matches", async () => {
    const approved = "e".repeat(64);
    state.connection = { ...(state.connection as Record<string, unknown>),
      repositories: [{ ...repositories[0], pendingConfigHash: approved, approvedConfigHash: approved }] };
    render(<RepositoryConnectionView />);
    await screen.findByText("eeeeeeeeeeee");
    expect(screen.queryByRole("button", { name: /Approve \.buildit\.yml/ })).toBeNull();
  });
});

// GitHub tells BuildIT when the installation's repository list changes, but that webhook can be
// switched off in the App's settings and a delivery can be missed. Both launch demo repositories
// were added in GitHub and sat invisible, because nothing on this page ever re-read the list - it
// only linked out. "I granted access and nothing happened" needs an answer on the page itself.
describe("refreshing the repository list", () => {
  beforeEach(() => {
    state.connection = {
      state: "connected",
      organization: { id: "org-acme", name: "Acme workspace", slug: "acme", role: "owner", region: "eu-west-1", retentionHours: 24 },
      installations: [{ id: "installation-a", installationId: 42, accountLogin: "acme", accountType: "organization", status: "active", updatedAt: 1 }],
      repositories,
    };
    state.updatePolicy.mockReset().mockResolvedValue(null);
    state.refreshRepositories.mockReset().mockResolvedValue({ organizationId: "org-acme", repositoryCount: 4 });
  });

  afterEach(cleanup);

  it("asks GitHub for the installation actually on screen", async () => {
    render(<RepositoryConnectionView />);
    (await screen.findByRole("button", { name: /Refresh the repository list/ })).click();
    await waitFor(() => expect(state.refreshRepositories).toHaveBeenCalled());
    expect((state.refreshRepositories.mock.calls[0]![0] as { installationId: number }).installationId).toBe(42);
  });

  it("says how many repositories BuildIT can now see", async () => {
    render(<RepositoryConnectionView />);
    (await screen.findByRole("button", { name: /Refresh the repository list/ })).click();
    await screen.findByText("4 repositories available to BuildIT.");
  });

  it("says plainly that nothing changed when GitHub could not be read", async () => {
    state.refreshRepositories.mockRejectedValue(new Error("nope"));
    render(<RepositoryConnectionView />);
    (await screen.findByRole("button", { name: /Refresh the repository list/ })).click();
    await screen.findByText(/Nothing was changed/);
  });
});
