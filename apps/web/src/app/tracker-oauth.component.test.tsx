// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ connection: undefined as unknown, rows: [] as unknown[], available: vi.fn(), complete: vi.fn(), projects: vi.fn(), connect: vi.fn(), begin: vi.fn(), disconnect: vi.fn() }));
vi.mock("./live-connections", () => ({ useConnection: () => state.connection }));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }), useAction: (name: string) => ({ "trackerOAuth:availability": state.available, "trackerOAuth:complete": state.complete, "trackerOAuth:projects": state.projects, "trackerOAuth:connect": state.connect, "trackerOAuth:begin": state.begin, "trackerOAuth:disconnect": state.disconnect })[name], useQuery: (name: string, args: unknown) => args === "skip" ? undefined : name === "trackerOAuthData:pending" ? { rows: state.rows, truncated: false } : [] }));
const { TrackerOAuthCards, TrackerOAuthSetup } = await import("./tracker-oauth");
beforeEach(() => { state.connection = { organization: { id: "org", role: "owner" }, repositories: [{ id: "repo", owner: "acme", name: "api" }] }; state.rows = []; state.available.mockReset().mockResolvedValue({ linear: false, jira: false, runtimeConfigured: true }); state.complete.mockReset(); state.projects.mockReset(); state.connect.mockReset(); state.begin.mockReset(); window.history.replaceState(null, "", "/integrations"); });
afterEach(cleanup);
it("shows missing provider registration without a fake connect control", async () => {
 render(<TrackerOAuthCards />); await screen.findAllByText("Not configured");
 expect(screen.queryByRole("button", { name: "Connect Linear" })).toBeNull(); expect(screen.queryByRole("button", { name: "Connect Jira" })).toBeNull(); expect(state.begin).not.toHaveBeenCalled();
});
it("consumes denied callback state once and removes the sensitive redirect parameters", async () => {
 window.history.replaceState(null, "", `/setup/tracker?state=${"a".repeat(43)}&error=access_denied`); state.complete.mockResolvedValue({ cancelled: true });
 const view = render(<TrackerOAuthSetup />); await screen.findByText("Tracker access was declined. No connection was activated."); view.rerender(<TrackerOAuthSetup />);
 expect(state.complete).toHaveBeenCalledTimes(1); expect(window.location.search).toBe(""); expect(state.connect).not.toHaveBeenCalled();
});
it("requires a selected site and project and keeps success after the pending draft disappears", async () => {
 window.history.replaceState(null, "", "/setup/tracker?draft=draft"); state.rows = [{ id: "draft", provider: "jira", resources: [{ id: "cloud", name: "Acme", workspaceId: "acme.atlassian.net" }], expiresAt: Date.now() + 10000 }];
 state.projects.mockResolvedValue({ projects: [{ id: "project", key: "ENG", name: "Engineering" }], nextCursor: null }); state.connect.mockImplementation(async () => { state.rows = []; return { status: "active" }; });
 const view = render(<TrackerOAuthSetup />); await screen.findByRole("option", { name: "Engineering (ENG)" });
 const button = screen.getByRole("button", { name: "Connect selected issue scope" }); expect(button.hasAttribute("disabled")).toBe(true);
 fireEvent.change(screen.getByLabelText("Jira project"), { target: { value: "project" } }); fireEvent.click(button);
 await waitFor(() => expect(state.connect).toHaveBeenCalledWith({ draftId: "draft", resourceId: "cloud", projectId: "project" }));
 view.rerender(<TrackerOAuthSetup />); await screen.findByText("Issue tracker connected"); expect(screen.queryByText(/This selection expired/)).toBeNull();
});
