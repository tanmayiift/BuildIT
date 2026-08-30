export type CredentialErrorCode =
  | "invalid_key"
  | "rate_limited"
  | "recent_reauthentication_required"
  | "not_found_or_forbidden"
  | "credential_save_failed";

export function credentialErrorCode(value: unknown): CredentialErrorCode {
  const code = value instanceof Error ? value.message : String(value);
  if (code === "invalid_key" || code === "rate_limited" || code === "recent_reauthentication_required" || code === "not_found_or_forbidden") return code;
  return "credential_save_failed";
}

export function credentialErrorMessage(code: CredentialErrorCode) {
  if (code === "invalid_key") return "Google, OpenAI, or Anthropic rejected this key. Check that the key is active and has API access, then paste it again.";
  if (code === "rate_limited") return "Too many key checks were attempted. No key was stored. Wait 15 minutes, then paste it again.";
  if (code === "recent_reauthentication_required") return "Your security check expired before the key was saved. No key was stored. Verify with GitHub, then paste the key again.";
  if (code === "not_found_or_forbidden") return "This organization or repository is no longer available to your account. No key was stored. Refresh your access before trying again.";
  return "The secure key service could not save this key. No key was stored. Try again shortly.";
}

export function needsFreshCredentialAuthentication(expiresAt: number | undefined, now: number) {
  return !expiresAt || expiresAt <= now;
}

export function credentialReauthenticationHref(provider: string, repositoryId: string) {
  const returnPath = new URL("https://buildit.invalid/setup/model");
  returnPath.searchParams.set("provider", provider);
  if (repositoryId) returnPath.searchParams.set("repository", repositoryId);
  return `/sign-in?reauth=1&returnTo=${encodeURIComponent(`${returnPath.pathname}${returnPath.search}`)}`;
}
