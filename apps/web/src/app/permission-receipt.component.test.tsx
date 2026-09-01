// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connection: undefined as unknown, receipt: undefined as unknown }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => vi.fn(),
  useQuery: (reference: string) => {
    if (reference === "repositoryConnections:current") return state.connection;
    if (reference === "permissionReceipts:current") return state.receipt;
    return undefined;
  },
}));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("./workspace-route-boundary", () => ({ useSampleTour: () => false }));

import { PermissionReceipt } from "./live-connections.js";

const connection = {
  state: "connected",
  organization: { id: "org-a", name: "Acme workspace", slug: "acme", role: "owner", region: "eu-west-1", retentionHours: 24 },
  installations: [{ id: "installation-a", installationId: 42, accountLogin: "acme", accountType: "organization", status: "active", updatedAt: 1 }],
  repositories: [{ id: "repo-a", installationId: "installation-a", githubRepositoryId: 1, owner: "acme", name: "api", defaultBranch: "main", visibility: "private", autofixMode: "stacked", paused: false, indexState: "ready", updatedAt: 1 }],
};

const receipt = {
  identity: { login: "owner" },
  organization: { name: "Acme workspace", role: "owner", region: "eu-west-1", retentionHours: 24 },
  installations: [{ installationId: 42, accountLogin: "acme", accountType: "organization", status: "active", permissions: { metadata: "read", contents: "write", pullRequests: "write", issues: "read", checks: "write" }, lastSynchronizedAt: 1 }],
  repositories: [{ id: "repo-a", owner: "acme", name: "api", visibility: "private", autofixMode: "stacked" }],
  credentials: [
    { id: "gemini-a", provider: "gemini", repositoryId: "repo-a", maskedSuffix: "nmiQ", lastValidatedAt: Date.UTC(2026, 7, 30), lastUsedAt: Date.UTC(2026, 7, 31) },
    { id: "openai-a", provider: "openai", maskedSuffix: "YkEA", lastValidatedAt: Date.UTC(2026, 7, 30) },
  ],
  boundaries: { sourceRegion: "eu-west-1", maximumSourceRetentionHours: 24, mergeAuthority: false, workflowWrite: false, repositoryAdministration: false },
};

describe("permission receipt model-provider layout", () => {
  beforeEach(() => {
    state.connection = connection;
    state.receipt = receipt;
  });
  afterEach(cleanup);

  it("separates provider identity, scope, and activity into readable rows", async () => {
    render(<PermissionReceipt />);
    const list = await screen.findByRole("list", { name: "Active model-provider access" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Google Gemini")).not.toBeNull();
    expect(within(rows[0]!).getByLabelText("Key ending in nmiQ").textContent).toBe("•••• nmiQ");
    expect(within(rows[0]!).getByText("acme/api")).not.toBeNull();
    expect(within(rows[0]!).getByText(/Used 8\/31\/2026/)).not.toBeNull();
    expect(within(rows[1]!).getByText("OpenAI")).not.toBeNull();
    expect(within(rows[1]!).getByText("All selected repositories")).not.toBeNull();
    expect(within(rows[1]!).getByText("Not used yet")).not.toBeNull();
    expect(document.body.textContent).not.toContain("raw-provider-key");
  });

  it("keeps the layout responsive instead of relying on unstyled inline spans", async () => {
    render(<PermissionReceipt />);
    await waitFor(() => expect(screen.getByRole("list", { name: "Active model-provider access" })).not.toBeNull());
    const css = readFileSync("apps/web/src/app/flows.css", "utf8");
    expect(css).toContain(".permission-provider-list>li{display:grid");
    expect(css).toContain(".permission-provider-metadata{display:grid");
    expect(css).toContain("@media(max-width:640px){.permission-provider-heading");
  });
});
