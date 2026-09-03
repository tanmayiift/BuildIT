// A review that could not run has to say why in terms the author can act on. This knew two
// reasons, so a 100 MB repository and a missing environment variable produced the identical
// sentence - "a required platform step failed" - which tells nobody anything.
export type PlatformFailureReason =
  | "provider_rate_limited"
  | "repository_too_large"
  | "repository_access_refused"
  | "model_unavailable"
  | "change_too_large"
  | "platform_misconfigured"
  | "sandbox_unavailable"
  | "platform_error";

// The failure travels as a string across the workflow boundary, so the numbers are carried in it
// as `key=value;key=value`. Parsing is deliberately forgiving: a malformed detail must degrade to
// the general message, never throw inside the reporter that exists to report a failure.
export function failureDetail(raw: string | undefined, key: string) {
  const match = raw?.match(new RegExp(`(?:^|;)${key}=([0-9]+)`));
  return match ? Number(match[1]) : undefined;
}

// Ordered most specific first. Everything here was already known internally by the time the review
// died - it just was not told to the person waiting, who got "a required platform step failed" for
// a missing environment variable, a model their key cannot reach, and a 3 MB diff alike.
export function classifyPlatformFailure(error: string): PlatformFailureReason {
  if (error.includes("repository_too_large")) return "repository_too_large";
  if (error.includes("repository_access_refused")) return "repository_access_refused";
  if (error.includes("rate_limited")) return "provider_rate_limited";
  if (error.includes("http_404") || error.includes("http_401") || error.includes("http_403") || error.includes("provider_credential")) return "model_unavailable";
  if (error.includes("_too_large") || error.includes("tree_truncated")) return "change_too_large";
  if (error.includes("missing_") || error.includes("not_configured")) return "platform_misconfigured";
  if (error.includes("sandbox_unavailable") || error.includes("runner_image_unavailable")) return "sandbox_unavailable";
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
  if (reason === "model_unavailable") {
    return ["The connected model key could not be used for this review: the provider refused it, or the selected model is not available to that key.",
      "No code decision was made and nothing was charged.",
      "Check the model connection in BuildIT, then start a new review. Retrying without changing it will fail the same way."];
  }
  if (reason === "change_too_large") {
    return ["This pull request is too large for BuildIT to hold in one review.",
      "No code decision was made. No code was changed.",
      "Splitting it into smaller pull requests will review normally. This is a limit of how much BuildIT can read at once, not a judgement about the change."];
  }
  if (reason === "platform_misconfigured") {
    return ["BuildIT is not fully configured for this workspace, so the review could not start.",
      "No code decision was made and nothing was charged.",
      "This one is on the BuildIT side rather than yours - an operator has to finish the setup. Retrying will not help until they do."];
  }
  if (reason === "sandbox_unavailable") {
    return ["The isolated environment BuildIT runs your checks in could not be reached, so no check was run.",
      "No code decision was made and nothing was charged.",
      "This is BuildIT's infrastructure rather than anything in your pull request. Starting a new review is the right move once it is back."];
  }
  return ["BuildIT stopped because a required platform step failed.",
    "No code decision was made. No code was changed. Retry only after the service is available."];
}

const titles: Record<PlatformFailureReason, string> = {
  provider_rate_limited: "BuildIT: model provider is busy",
  repository_too_large: "BuildIT: this repository is too large to review",
  repository_access_refused: "BuildIT: GitHub refused to serve this repository's files",
  model_unavailable: "BuildIT: the connected model could not be used",
  change_too_large: "BuildIT: this pull request is too large to review",
  platform_misconfigured: "BuildIT: not finished setting up",
  sandbox_unavailable: "BuildIT: the check environment was unreachable",
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
