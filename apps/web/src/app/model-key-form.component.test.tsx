// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  loading: false,
  connection: undefined as unknown,
  credentials: undefined as unknown,
  revoke: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: state.authenticated, isLoading: state.loading }),
  useQuery: (reference: string) => reference === "repositoryConnections:current" ? state.connection : state.credentials,
  useMutation: () => state.revoke,
}));
vi.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => "session-token" }));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));

import { ModelKeyForm } from "./model-key-form.js";

const connection = { organization: { id: "org-a", name: "Acme", role: "owner" }, credentialReauthenticationExpiresAt: Date.now() + 60_000, repositories: [{ id: "repo-a", owner: "acme", name: "api" }] };
const credential = { id: "cred-a", provider: "gemini", maskedSuffix: "nmiQ", status: "valid", lastValidatedAt: Date.UTC(2026, 7, 30), lastUsedAt: Date.UTC(2026, 7, 31), repositoryId: "repo-a" };

describe("authenticated model-key controls", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_BROKER_URL = "https://broker.buildit.test";
    state.authenticated = true;
    state.loading = false;
    state.connection = connection;
    state.credentials = [credential];
    state.revoke.mockReset().mockResolvedValue({ id: "cred-a", status: "revoked" });
  });
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("returns a signed-out user to the selected OpenAI and repository scope", async () => {
    state.authenticated = false;
    state.connection = undefined;
    window.history.replaceState({}, "", "/setup/model?provider=openai&repository=repo-a");
    render(<ModelKeyForm />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Sign in with GitHub" }).getAttribute("href")).toBe("/sign-in?returnTo=%2Fsetup%2Fmodel%3Fprovider%3Dopenai%26repository%3Drepo-a"));
  });

  it("shows tenant scope, masked metadata, and safe action order without returning a key", async () => {
    const user = userEvent.setup();
    render(<ModelKeyForm />);
    expect((await screen.findAllByText("acme/api")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Key ending in nmiQ").textContent).toContain("•••• nmiQ");
    expect(screen.getByText(/Validated .*last used/)).not.toBeNull();
    expect(document.body.textContent).not.toContain("session-token");
    const replace = screen.getByRole("button", { name: "Replace" }), revoke = screen.getByRole("button", { name: "Revoke" });
    expect(replace.compareDocumentPosition(revoke) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.tab();
    expect(document.activeElement?.tagName).toBe("SELECT");
  });

  it("truthfully distinguishes a valid key that has never been used", async () => {
    state.credentials = [{ ...credential, lastUsedAt: undefined }];
    render(<ModelKeyForm />);
    expect(await screen.findByText(/Validated .*never used/)).not.toBeNull();
  });

  it("requires a reversible confirmation before revocation", async () => {
    const user = userEvent.setup();
    render(<ModelKeyForm />);
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    expect(screen.getByText("Stop BuildIT from using this key?")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Confirm revoke" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await user.click(screen.getByRole("button", { name: "Confirm revoke" }));
    await waitFor(() => expect(state.revoke).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-a", credentialId: "cred-a" })));
    expect(await screen.findByText(/was revoked\. BuildIT will not use it again/)).not.toBeNull();
  });

  it("keeps loading, failure, and recovery states explicit", async () => {
    state.connection = undefined;
    const { rerender } = render(<ModelKeyForm />);
    expect(await screen.findByText("Checking your account and organization…")).not.toBeNull();
    state.connection = connection;
    state.revoke.mockRejectedValueOnce(new Error("credential_scope_changed"));
    rerender(<ModelKeyForm />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some(item => /could not save|access|organization|refresh/i.test(item.textContent ?? ""))).toBe(true);
  });

  it("never queries or exposes another organization's credentials to a member", async () => {
    state.connection = { ...connection, organization: { id: "org-b", name: "Other", role: "member" } };
    state.credentials = [{ ...credential, id: "foreign-secret" }];
    render(<ModelKeyForm />);
    expect(await screen.findByRole("heading", { name: "An Admin or Owner manages model keys" })).not.toBeNull();
    expect(screen.queryByText("foreign-secret")).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  it("keeps identity, scope, and actions in document flow at a narrow width", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    render(<ModelKeyForm />);
    expect(await screen.findByLabelText("Key ending in nmiQ")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Replace" }).closest(".credential-actions")).not.toBeNull();
    const css = readFileSync("apps/web/src/app/flows.css", "utf8");
    expect(css).toMatch(/@media\(max-width:760px\).*\.saved-credentials>div\{grid-template-columns:38px 1fr\}/s);
    expect(css).toMatch(/\.credential-actions,.credential-confirm\{grid-column:2\}/);
  });
});
