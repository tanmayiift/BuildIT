// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connection: undefined as unknown,
  updatePolicy: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (reference: string) => reference === "repositoryConnections:current" ? state.connection : undefined,
  useMutation: () => state.updatePolicy,
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
