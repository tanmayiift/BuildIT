// A review that could not run has to say why in terms the author can act on. This knew two
// reasons, so a 100 MB repository and a missing environment variable produced the identical
// sentence - "a required platform step failed" - which tells nobody anything.
export type PlatformFailureReason =
  | "provider_rate_limited"
  | "repository_too_large"
  | "repository_access_refused"
  | "platform_error";

// The failure travels as a string across the workflow boundary, so the numbers are carried in it
// as `key=value;key=value`. Parsing is deliberately forgiving: a malformed detail must degrade to
// the general message, never throw inside the reporter that exists to report a failure.
export function failureDetail(raw: string | undefined, key: string) {
  const match = raw?.match(new RegExp(`(?:^|;)${key}=([0-9]+)`));
  return match ? Number(match[1]) : undefined;
}

export function classifyPlatformFailure(error: string): PlatformFailureReason {
  if (error.includes("repository_too_large")) return "repository_too_large";
  if (error.includes("repository_access_refused")) return "repository_access_refused";
  if (error.includes("rate_limited")) return "provider_rate_limited";
  return "platform_error";
}

function body(reason: PlatformFailureReason, detail: string | undefined) {
  const files = failureDetail(detail, "files");
  const limit = failureDetail(detail, "limit");
  if (reason === "provider_rate_limited") {
    return ["The model provider refused this run because its rate limit was reached.",
      "Retry once the provider's limit resets. No code decision was made."];
  }
  if (reason === "repository_too_large") {
    return [`This repository is larger than BuildIT can read one file at a time${files ? `: ${files.toLocaleString()} files against a limit of ${(limit ?? 0).toLocaleString()}` : ""}.`,
      "BuildIT stopped before spending anything, and made no code decision.",
      "This is a limit of how BuildIT fetches source, not a problem with your pull request. Reviewing a repository this size needs an archive download rather than per-file reads, which BuildIT does not do yet."];
  }
  if (reason === "repository_access_refused") {
    return [`GitHub refused to serve this repository's files${files ? ` after ${files.toLocaleString()} were requested` : ""}, which it does when too many are read in a short window.`,
      "No code decision was made and no code was changed.",
      "A smaller repository will review normally. This one needs a different fetch strategy, which BuildIT does not do yet."];
  }
  return ["BuildIT stopped because a required platform step failed.",
    "No code decision was made. No code was changed. Retry only after the service is available."];
}

const titles: Record<PlatformFailureReason, string> = {
  provider_rate_limited: "BuildIT: model provider is busy",
  repository_too_large: "BuildIT: this repository is too large to review",
  repository_access_refused: "BuildIT: GitHub refused to serve this repository's files",
  platform_error: "BuildIT: review did not complete",
};

export function platformFailureReport(input: {
  headSha: string;
  reason: PlatformFailureReason;
  detail?: string;
}) {
  if (!/^[0-9a-f]{40}$/i.test(input.headSha))
    throw new Error("invalid_head_sha");
  return {
    conclusion: "action_required" as const,
    title: titles[input.reason],
    summary: [
      `Head: \`${input.headSha.toLowerCase()}\``,
      "",
      ...body(input.reason, input.detail).flatMap(line => [line, ""]),
      "BuildIT did not merge this pull request.",
    ].join("\n"),
  };
}
