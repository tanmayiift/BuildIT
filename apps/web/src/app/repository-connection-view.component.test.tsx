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
    // The refresh result is a quiet note under a button, not a coloured .form-result banner.
    expect(css).toMatch(/\.form-note\{[^}]*var\(--muted\)/);
    // .repository-row declares 280+570 columns + 24 gap + 2x18 padding = 910px, but inside
    // .content the inner width is only viewport-316 (252px sidebar + 2x32 padding). So the row
    // must collapse below 1226px, and the breakpoint carries ~15px of scrollbar headroom on top:
    // 1261-316-15 = 930 >= 910. At the old 1100 the connections page scrolled sideways from
    // 1101 to 1225 - do not lower it back.
    expect(css).toMatch(/@media\(max-width:1260px\)\{[^@]*\.repository-row\{grid-template-columns:1fr/);
    // "button danger" matches no rule in either stylesheet, so a destructive control wearing it
    // renders as the primary call to action - solid navy, leftmost, indistinguishable from the
    // action you meant to take. Both files that own a destructive control are checked, because the
    // first version of this guard read only one of them and "Cancel review" kept the defect.
    for (const owner of ["apps/web/src/app/live-connections.tsx",
      "apps/web/src/app/reviews/[id]/live-review-detail.tsx"]) {
      expect(readFileSync(owner, "utf8"), `${owner} uses a class that matches no rule`)
        .not.toContain("button danger");
    }
    expect(css + readFileSync("apps/web/src/app/globals.css", "utf8"), "the class destructive controls do use must exist")
      .toMatch(/\.button\.destructive/);
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
    const result = await screen.findByText("4 repositories available to BuildIT.");
    expect(result.className).toContain("form-note");
  });

  it("says plainly that nothing changed when GitHub could not be read", async () => {
    state.refreshRepositories.mockRejectedValue(new Error("nope"));
    render(<RepositoryConnectionView />);
    (await screen.findByRole("button", { name: /Refresh the repository list/ })).click();
    await screen.findByText(/Nothing was changed/);
  });
});

// At fifteen repositories this page was mostly prose the reader had already read: four helper
// paragraphs per card, two of them identical on every card in every state, and no way to find one
// repository among them.
describe("a repository list long enough to be hard to read", () => {
  const many = Array.from({ length: 15 }, (_, index) => ({
    id: `repo-${index}`, installationId: "installation-a", githubRepositoryId: 100 + index,
    owner: "acme", name: `service-${index}`, defaultBranch: "main", visibility: "public" as const,
    autofixMode: "stacked" as const, paused: false, reviewProfile: "balanced" as const,
    reviewTrigger: "manual" as const, changelogOnMerge: false, enabled: true,
  }));

  beforeEach(() => {
    state.connection = {
      state: "connected",
      organization: { id: "org-acme", name: "Acme workspace", slug: "acme", role: "owner", region: "eu-west-1", retentionHours: 24 },
      installations: [{ id: "installation-a", installationId: 42, accountLogin: "acme", accountType: "organization", status: "active", updatedAt: 1 }],
      repositories: many,
    };
    state.updatePolicy.mockReset().mockResolvedValue(null);
  });
  afterEach(cleanup);

  it("explains the settings once rather than once per repository", () => {
    render(<RepositoryConnectionView />);
    // These two sentences never varied with any repository's state, so fifteen copies of each was
    // thirty paragraphs pushing the repository names off the screen.
    expect(screen.getAllByText(/It never merges that either/)).toHaveLength(1);
    expect(screen.getAllByText(/how much of it also lands on the diff/)).toHaveLength(1);
  });

  it("keeps the explanation that changes with the setting on the card, where the setting is", () => {
    render(<RepositoryConnectionView />);
    // This one does vary - it tells you what your current choice does - so it stays per row.
    expect(screen.getAllByText("Fixes open as a separate pull request").length).toBe(many.length);
  });

  it("offers a filter, and narrows the list to what was typed", async () => {
    const { default: userEventModule } = await import("@testing-library/user-event");
    const user = userEventModule.setup();
    render(<RepositoryConnectionView />);
    const field = screen.getByLabelText("Find a repository");
    await user.type(field, "service-11");
    await waitFor(() => expect(screen.getByRole("region", { name: "Connected repositories" }).textContent).toContain("service-11"));
    expect(screen.getByRole("region", { name: "Connected repositories" }).textContent).not.toContain("service-12");
    expect(screen.getByRole("status").textContent).toContain("1 of 15");
  });

  it("says so rather than showing an empty page when nothing matches", async () => {
    const { default: userEventModule } = await import("@testing-library/user-event");
    const user = userEventModule.setup();
    render(<RepositoryConnectionView />);
    await user.type(screen.getByLabelText("Find a repository"), "nothing-here");
    await waitFor(() => expect(screen.getByText(/No connected repository matches/)).not.toBeNull());
  });

  it("shows no filter when the whole list already fits", () => {
    state.connection = { ...(state.connection as Record<string, unknown>), repositories: many.slice(0, 3) };
    render(<RepositoryConnectionView />);
    // A search box over three rows is chrome, not help.
    expect(screen.queryByLabelText("Find a repository")).toBeNull();
  });
});
