export function installationClaimErrorMessage(rawError: unknown) {
  const code = rawError instanceof Error ? rawError.message : "installation_verification_failed";
  if (code.includes("mismatch")) return "This installation belongs to a different GitHub account. Sign out and use the account that installed the App.";
  if (code.includes("organization_installation")) return "Organization installations need a GitHub organization owner to verify access.";
  if (code.includes("authentication") || code.includes("identity")) return "Your GitHub session is incomplete. Sign out, sign in again, and retry this installation.";
  if (code.includes("already_claimed")) return "This installation is already connected to another BuildIT workspace. Remove it there before retrying.";
  return "GitHub could not verify this installation. Confirm the App is active and the repositories are still selected, then retry.";
}
