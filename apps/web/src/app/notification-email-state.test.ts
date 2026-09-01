import { describe, expect, it } from "vitest";
import { notificationEmailState } from "./notification-email-state";

describe("notification email presentation", () => {
  it("states that deferred email sends nothing and never uses the installation owner", () => {
    const state = notificationEmailState({ emailEnabled: false, deliveryAvailable: false, recipient: { state: "verification_required" } });
    expect(state).toMatchObject({ status: "Not connected", summary: "No customer review emails are being sent.", recipient: "No separately verified BuildIT email" });
    expect(state.boundary).toContain("never falls back to the GitHub App owner");
  });

  it("names only the masked signed-in member address", () => {
    const state = notificationEmailState({ emailEnabled: false, deliveryAvailable: false, recipient: { state: "verified", maskedEmail: "r•••@example.com" } });
    expect(state.recipient).toBe("r•••@example.com · signed-in BuildIT member");
    expect(JSON.stringify(state)).not.toContain("tanmayiift");
  });
});
