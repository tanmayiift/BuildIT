import { describe, expect, it } from "vitest";
import { classifyPlatformFailure, platformFailureReport } from "./platformFailureReport";

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
    expect(classifyPlatformFailure("Uncaught Error: analysis_context_too_large")).toBe("platform_error");
  });

  it("never claims a merge happened", () => {
    for (const reason of ["provider_rate_limited", "repository_too_large", "repository_access_refused", "platform_error"] as const) {
      expect(platformFailureReport({ headSha: head, reason }).summary).toContain("BuildIT did not merge this pull request.");
    }
  });
});
