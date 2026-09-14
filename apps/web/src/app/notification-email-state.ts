export type NotificationEmailPreferences = {
  emailEnabled: boolean;
  deliveryAvailable: boolean;
  captureAvailable?: boolean;
  recipient: { state: "verified"; maskedEmail: string } | { state: "verification_required" };
};

export function notificationEmailState(preferences: NotificationEmailPreferences) {
  if (preferences.captureAvailable) {
    return {
      status: preferences.emailEnabled ? "Local capture" : "Local capture off",
      summary: "Test messages can be captured on this computer. No email is sent.",
      recipient: preferences.recipient.state === "verified" ? `${preferences.recipient.maskedEmail} · signed-in BuildIT member` : "Verify your BuildIT email before enabling capture",
      boundary: "Local capture requires this member’s verified address and explicit opt-in. Access, consent, and repository muting are checked again before each capture. Captures stay on this computer; customer delivery is not connected.",
    };
  }
  if (!preferences.deliveryAvailable) {
    return {
      status: "Not connected",
      summary: "No customer review emails are being sent.",
      recipient: preferences.recipient.state === "verified"
        ? `${preferences.recipient.maskedEmail} · signed-in BuildIT member`
        : "No separately verified BuildIT email",
      boundary: "A future email can go only to this signed-in member after address verification and explicit opt-in. BuildIT never falls back to the GitHub App owner, installation account, workspace owner, or another member.",
    };
  }
  return {
    status: preferences.emailEnabled ? "On" : "Off",
    summary: preferences.emailEnabled ? "Decision emails are enabled for this member." : "Decision emails are off for this member.",
    recipient: preferences.recipient.state === "verified" ? preferences.recipient.maskedEmail : "Verification required",
    boundary: "Delivery is bound to the signed-in member, this workspace, and current access at send time.",
  };
}
