// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ preferences: undefined as unknown, connection: undefined as unknown }));
const update = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: true }), useMutation: () => update, useQuery: (name: string, args: unknown) => args === "skip" ? undefined : name === "repositoryConnections:current" ? state.connection : state.preferences }));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
const { NotificationPreferences } = await import("./notification-preferences");
const prefs = { emailEnabled: false, deliveryAvailable: false, captureAvailable: true, digestMode: "immediate", mutedRepositoryIds: [], updatedAt: null, recipient: { state: "verified", maskedEmail: "m•••@example.com" } };
beforeEach(() => { update.mockReset().mockResolvedValue(null); state.preferences = { ...prefs }; state.connection = { organization: { id: "org-1", name: "BuildIT test" }, repositories: [{ id: "repo-1", owner: "BuildIT", name: "fixture" }] }; });
afterEach(cleanup);
describe("local email capture preferences", () => {
  it("offers capture opt-in with an explicit no-delivery label", async () => {
    render(<NotificationPreferences />);
    expect(screen.getByText(/No email is sent/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enable local capture" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", emailEnabled: true, digestMode: "immediate", mutedRepositoryIds: [] })));
    expect(screen.queryByRole("button", { name: "Send email" })).toBeNull();
  });
  it("saves daily timing, repository mute and opt-out for the active workspace", async () => {
    state.preferences = { ...prefs, emailEnabled: true };
    render(<NotificationPreferences />);
    fireEvent.change(screen.getByRole("combobox", { name: "Local capture timing" }), { target: { value: "daily" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ digestMode: "daily" })));
    await screen.findByText("Notification preferences saved for this workspace.");
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ mutedRepositoryIds: ["repo-1"] })));
    await screen.findByText("Notification preferences saved for this workspace.");
    fireEvent.click(screen.getByRole("button", { name: "Disable local capture" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ emailEnabled: false })));
  });
  it("allows consent withdrawal after verification expires", async () => {
    state.preferences = { ...prefs, emailEnabled: false, emailOptedIn: true, recipient: { state: "verification_required" } };
    render(<NotificationPreferences />);
    const button = screen.getByRole("button", { name: "Disable local capture" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false); fireEvent.click(button);
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ emailEnabled: false })));
  });
  it("keeps hosted customer email disconnected and controls unavailable", () => {
    state.preferences = { ...prefs, captureAvailable: false };
    render(<NotificationPreferences />);
    expect(screen.getByText("Not connected")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull(); expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("requires address verification before opt-in and reports save failures", async () => {
    state.preferences = { ...prefs, recipient: { state: "verification_required" } };
    const view = render(<NotificationPreferences />);
    expect((screen.getByRole("button", { name: "Enable local capture" }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount(); state.preferences = { ...prefs }; update.mockRejectedValue(new Error("fixture error"));
    render(<NotificationPreferences />); fireEvent.click(screen.getByRole("button", { name: "Enable local capture" }));
    expect(await screen.findByText(/Preferences were not saved/)).not.toBeNull();
  });
});
