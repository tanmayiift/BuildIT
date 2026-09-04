import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The comment path grew a pipeline before any review is materialized: fetch the pull request, pin
// it to exact commits, apply fork policy, record the snapshot. An automatic trigger that reached
// materializeReview by another route would skip every one of those checks - precisely the risk
// that kept automatic review unbuilt.
//
// So there is one way in. This asserts the property rather than the implementation: however the
// callers change, only startReviewForPullRequest may materialize a review, and only after pinning
// and the fork check.
const source = readFileSync(join(import.meta.dirname, "../../convex/githubWebhookProcessor.ts"), "utf8");
// Comments and imports mention these names too; only executable references count.
const code = source.split("\n").filter(line => !line.trim().startsWith("//") && !line.startsWith("import ")).join("\n");

describe("one way to start a review", () => {
  it("materializes a review from exactly one place", () => {
    expect(code.split("\n").filter(line => line.includes("materializeReview"))).toHaveLength(1);
  });

  it("pins the pull request and applies fork policy before materializing", () => {
    const pin = code.indexOf("pinPullRequest({");
    const fork = code.indexOf("reviewPolicy(snapshot");
    const materialize = code.indexOf("materializeReview");
    expect(pin).toBeGreaterThan(-1);
    expect(fork).toBeGreaterThan(pin);
    expect(materialize).toBeGreaterThan(fork);
  });

  it("keeps every one of those steps inside the shared entry point", () => {
    const entry = code.indexOf("async function startReviewForPullRequest");
    const nextTopLevel = code.indexOf("\nexport const", entry);
    expect(entry).toBeGreaterThan(-1);
    const bodyEnd = nextTopLevel === -1 ? code.length : nextTopLevel;
    for (const step of ["pinPullRequest({", "reviewPolicy(snapshot", "recordPinnedSnapshot", "materializeReview"]) {
      const at = code.indexOf(step);
      expect(at).toBeGreaterThan(entry);
      expect(at).toBeLessThan(bodyEnd);
    }
  });
});

// The first automatic review in production recorded itself as trigger "github_comment" - saying a
// person asked for it when nobody had. It only surfaced by reading the row rather than checking
// that a review appeared. The history view is built on this field, so a wrong value there is a
// wrong answer to "how do reviews start here".
describe("a review says how it was started", () => {
  it("carries a trigger source from its caller rather than assuming one", () => {
    expect(code).toContain("trigger: input.trigger");
    expect(code).not.toContain('trigger: "github_comment",\n          organizationId');
  });

  it("labels the two entry points differently", () => {
    expect(code).toContain('trigger: "automatic"');
    expect(code).toContain('trigger: "github_comment"');
  });
});
