import { describe, expect, it } from "vitest";
import { platformFailureReport } from "./platformFailureReport";

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
