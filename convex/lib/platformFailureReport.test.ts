import { describe, expect, it } from "vitest";
import { classifyPlatformFailure, isPlatformFailureReason, platformFailureReport } from "./platformFailureReport";

describe("source-free platform failure report", () => {
  it("reports a provider limit as no code decision and never as a pass", () => {
    const headSha = "a".repeat(40);
    expect(
      platformFailureReport({ headSha, reason: "provider_rate_limited" }),
    ).toEqual({
      conclusion: "action_required",
      title: "BuildIT: model provider is busy",
      summary: expect.stringContaining(`Head: \`${headSha}\``),
    });
    const summary = platformFailureReport({
      headSha,
      reason: "provider_rate_limited",
    }).summary;
    expect(summary).toContain("No code decision was made");
    expect(summary).toContain("BuildIT did not merge this pull request.");
    expect(summary).not.toMatch(/source|prompt|credential|token/i);
  });

  it("rejects an unpinned commit", () => {
    expect(() =>
      platformFailureReport({
        headSha: "latest",
        reason: "platform_error",
      }),
    ).toThrow("invalid_head_sha");
  });
});

// A 100 MB repository and a missing environment variable produced the identical sentence -
// "a required platform step failed" - so an author had nothing to act on. This is the message
// they actually read.
describe("a review that could not run says why", () => {
  const head = "a".repeat(40);

  it("names the size and the limit rather than a category", () => {
    const report = platformFailureReport({ headSha: head, reason: "repository_too_large", detail: "files=4210;limit=2500" });
    expect(report.title).toBe("BuildIT: this repository is too large to review");
    expect(report.summary).toContain("4,210 files");
    expect(report.summary).toContain("limit of 2,500");
    // It must not read as the author's fault, and it must say nothing was spent.
    expect(report.summary).toContain("not a problem with your pull request");
    expect(report.summary).toContain("stopped before spending anything");
  });

  it("explains a refusal as volume, not permission", () => {
    const report = platformFailureReport({ headSha: head, reason: "repository_access_refused", detail: "files=3900;status=403" });
    expect(report.summary).toContain("3,900");
    expect(report.summary).toContain("too many are read in a short window");
    expect(report.summary).not.toContain("permission");
  });

  it("still works when the numbers are missing or malformed", () => {
    // The reporter exists to report a failure; it must never throw parsing one.
    for (const detail of [undefined, "", "files=;limit=", "garbage"]) {
      const report = platformFailureReport({ headSha: head, reason: "repository_too_large", ...(detail === undefined ? {} : { detail }) });
      expect(report.summary).toContain("larger than BuildIT can read");
      expect(report.summary).not.toContain("undefined");
      expect(report.summary).not.toContain("NaN");
    }
  });

  it("classifies from the raw error the workflow threw", () => {
    expect(classifyPlatformFailure("Uncaught Error: repository_too_large:files=4210;limit=2500")).toBe("repository_too_large");
    expect(classifyPlatformFailure("Uncaught Error: repository_access_refused:files=3900;status=403")).toBe("repository_access_refused");
    expect(classifyPlatformFailure("provider rate_limited")).toBe("provider_rate_limited");
    expect(classifyPlatformFailure("Uncaught Error: analysis_context_too_large")).toBe("change_too_large");
    expect(classifyPlatformFailure("Uncaught Error: nothing_recognisable")).toBe("platform_error");
  });

  it("never claims a merge happened", () => {
    for (const reason of ["provider_rate_limited", "repository_too_large", "repository_access_refused", "model_unavailable", "change_too_large", "platform_misconfigured", "platform_error"] as const) {
      expect(platformFailureReport({ headSha: head, reason }).summary).toContain("BuildIT did not merge this pull request.");
    }
  });
});

// Production ran 26 platform failures and 22 of them said "a required platform step failed", while
// the real cause was already known internally in most cases. These are the ones seen live.
describe("classifies the failures production actually produces", () => {
  const cases: Array<[string, string]> = [
    ["requirements:provider_error:malformed_response:http_404", "model_unavailable"],
    ["provider_credential_invalid", "model_unavailable"],
    ["analysis_context_too_large", "change_too_large"],
    ["pull_request_context_too_large", "change_too_large"],
    ["github_tree_truncated", "change_too_large"],
    ["missing_ARTIFACT_GRANT_SECRET", "platform_misconfigured"],
    ["something_nobody_has_seen", "platform_error"],
  ];
  for (const [error, reason] of cases) {
    it(`reads ${error} as ${reason}`, () => {
      expect(classifyPlatformFailure(error)).toBe(reason);
      // And the message must name something the reader can do, not just restate the failure.
      const report = platformFailureReport({ headSha: "a".repeat(40), reason: classifyPlatformFailure(error) });
      expect(report.summary).toContain("BuildIT did not merge this pull request.");
      expect(report.title).not.toBe("");
    });
  }

  it("does not blame the user for a BuildIT-side misconfiguration", () => {
    const report = platformFailureReport({ headSha: "b".repeat(40), reason: "platform_misconfigured" });
    expect(report.summary).toContain("on the BuildIT side");
  });
});

// Measured, not assumed: production recorded one sandbox_unavailable and it reached the author as
// "a required platform step failed". packages/broker/test/execution-failure-modes.test.ts proves
// the broker names it; this proves the review keeps the name instead of flattening it.
describe("an unreachable check environment says so", () => {
  it("classifies the broker's code instead of falling back to platform_error", () => {
    expect(classifyPlatformFailure("sandbox_unavailable")).toBe("sandbox_unavailable");
    expect(classifyPlatformFailure("runner_image_unavailable")).toBe("sandbox_unavailable");
  });

  it("tells the author it is BuildIT's infrastructure and a new review is the move", () => {
    const report = platformFailureReport({ headSha: "c".repeat(40), reason: "sandbox_unavailable" });
    expect(report.summary).toContain("could not be reached");
    expect(report.summary).toContain("rather than anything in your pull request");
    expect(report.summary).toContain("BuildIT did not merge this pull request.");
  });

  // execution_failed stays the honest unknown. Giving it a friendlier message would be a lie.
  it("leaves a genuine unknown as platform_error", () => {
    expect(classifyPlatformFailure("execution_failed")).toBe("platform_error");
  });
});

// A rate limit on the only connected provider is a dead end the product used to hide: the check run
// said "retry once the provider's limit resets", which is true and useless, because the thing that
// makes it recoverable is a second key rather than waiting. Observed in production - roughly twenty
// reviews in one afternoon exhausted the single OpenAI key and every one of them stopped here with
// no way forward offered.
describe("a provider failure with nothing to fall back to", () => {
  const sha = "a".repeat(40);
  it("names the second key as the fix when the workspace has one provider", () => {
    const report = platformFailureReport({ headSha: sha, reason: "provider_rate_limited", soleProvider: true });
    expect(report.summary).toContain("one model provider connected");
    expect(report.summary).toContain("restarts the review on it automatically");
    expect(report.conclusion).toBe("action_required");
  });

  it("stays quiet about it when another provider is connected, because then it did fall back", () => {
    const report = platformFailureReport({ headSha: sha, reason: "provider_rate_limited" });
    expect(report.summary).not.toContain("one model provider connected");
    expect(report.summary).toContain("rate limit was reached");
  });

  it("says it for model_unavailable too, which fails over for the same reason", () => {
    expect(platformFailureReport({ headSha: sha, reason: "model_unavailable", soleProvider: true }).summary)
      .toContain("one model provider connected");
  });

  it("never says it for a failure another provider could not have fixed", () => {
    for (const reason of ["repository_too_large", "change_too_large", "sandbox_unavailable", "platform_misconfigured"] as const) {
      expect(platformFailureReport({ headSha: sha, reason, soleProvider: true }).summary)
        .not.toContain("one model provider connected");
    }
  });
});

// The publisher used to run classifyPlatformFailure over a value classifyPlatformFailure had
// already produced. That round trip is not the identity, and the two reasons it loses are the two
// a user can act on: a refused model key and a missing environment variable both arrived as
// "review did not complete. Retry only after the service is available", which for a refused key is
// advice that cannot work. This pins the property the publisher now relies on instead.
describe("classifying an already-classified reason", () => {
  const reasons = ["provider_rate_limited", "repository_too_large", "repository_access_refused",
    "model_unavailable", "change_too_large", "platform_misconfigured", "sandbox_unavailable",
    "platform_error"] as const;

  it("is not idempotent, which is why the stored code must be read rather than re-derived", () => {
    const lost = reasons.filter(reason => classifyPlatformFailure(reason) !== reason);
    expect(lost).toEqual(["model_unavailable", "platform_misconfigured"]);
  });

  it("recognises every reason it can produce", () => {
    for (const reason of reasons) expect(isPlatformFailureReason(reason)).toBe(true);
  });

  it("refuses anything that is not one, so an unknown code still falls back", () => {
    for (const value of ["", "queued", "required_check_failed", undefined]) {
      expect(isPlatformFailureReason(value)).toBe(false);
    }
  });

  it("keeps the actionable body for a refused key, which the round trip used to erase", () => {
    const direct = platformFailureReport({ headSha: "b".repeat(40), reason: "model_unavailable" });
    expect(direct.title).toBe("BuildIT: the connected model could not be used");
    expect(direct.summary).toContain("Check the model connection in BuildIT");
    const roundTripped = platformFailureReport({ headSha: "b".repeat(40), reason: classifyPlatformFailure("model_unavailable") });
    expect(roundTripped.summary).not.toContain("Check the model connection in BuildIT");
  });
});
