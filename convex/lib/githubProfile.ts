type GitHubProfile = {
  id?: unknown;
  login?: unknown;
  name?: unknown;
  email?: unknown;
  avatar_url?: unknown;
};

export function normalizeGitHubProfile(profile: GitHubProfile) {
  const githubUserId = typeof profile.id === "number" ? profile.id : typeof profile.id === "string" ? Number(profile.id) : Number.NaN;
  if (!Number.isSafeInteger(githubUserId) || githubUserId <= 0 || typeof profile.login !== "string" || !profile.login) throw new Error("github_identity_incomplete");
  return {
    id: String(githubUserId),
    githubUserId,
    login: profile.login,
    name: typeof profile.name === "string" && profile.name ? profile.name : profile.login,
    ...(typeof profile.email === "string" && profile.email ? { email: profile.email } : {}),
    ...(typeof profile.avatar_url === "string" && profile.avatar_url ? { image: profile.avatar_url } : {}),
  };
}
