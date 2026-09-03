import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Nine full review comments accumulated on one pull request because the marker was built inline
// from the review id. The fix is only durable if the publication worker cannot go back to building
// one itself, so this asserts the shape of the call rather than the shape of the string.
describe("what identifies a review comment", () => {
  const source = readFileSync(join(import.meta.dirname, "../../convex/reviewPublicationWorker.ts"), "utf8");

  it("uses the shared marker helpers rather than assembling a marker inline", () => {
    expect(source).toContain("marker: reviewCommentMarker(scope.prNumber)");
    expect(source).toContain("marker: inlineCommentMarker(scope.prNumber)");
  });

  it("never puts the review id or the commit into a comment marker again", () => {
    for (const line of source.split("\n").filter(item => item.includes("marker:"))) {
      expect(line).not.toContain("scope.reviewId");
      expect(line).not.toContain("scope.headSha");
    }
  });
});
