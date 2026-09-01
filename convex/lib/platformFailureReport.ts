export type PlatformFailureReason = "provider_rate_limited" | "platform_error";

export function platformFailureReport(input: {
  headSha: string;
  reason: PlatformFailureReason;
}) {
  if (!/^[0-9a-f]{40}$/i.test(input.headSha))
    throw new Error("invalid_head_sha");
  const providerLimited = input.reason === "provider_rate_limited";
  return {
    conclusion: "action_required" as const,
    title: providerLimited
      ? "BuildIT: model provider is busy"
      : "BuildIT: review did not complete",
    summary: [
      `Head: \`${input.headSha.toLowerCase()}\``,
      "",
      providerLimited
        ? "The model provider refused this run because its rate limit was reached."
        : "BuildIT stopped because a required platform step failed.",
      "",
      "No code decision was made. No code was changed. Retry only after the service is available.",
      "",
      "BuildIT did not merge this pull request.",
    ].join("\n"),
  };
}
