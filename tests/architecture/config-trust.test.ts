import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// If a repository's configuration could be read from the pull request head, anyone opening a pull
// request could rewrite the rules of the review running on that same pull request - turn off the
// path filter that reads their file, lower the profile that would have flagged it, or point the
// instructions somewhere harmless. That is the whole reason trustedConfiguration exists.
//
// This asserts the property at the call site, because the function can only refuse what it is
// given: handing it the head sha as the trusted sha would look correct and be exactly wrong.
const worker = readFileSync(join(import.meta.dirname, "../../convex/reviewContextWorker.ts"), "utf8");

describe("where a repository's configuration may be read from", () => {
  it("fetches the configuration at the trusted ref, never the head", () => {
    const fetchCall = worker.slice(worker.indexOf("fetchFileAtCommit({"), worker.indexOf("fetchFileAtCommit({") + 300);
    expect(fetchCall).toContain("commitSha: scope.trustedRefSha");
    expect(fetchCall).not.toContain("commitSha: scope.headSha");
  });

  it("hands trustedConfiguration the trusted sha and the head separately, so it can refuse", () => {
    const call = worker.slice(worker.indexOf("trustedConfiguration({"), worker.indexOf("trustedConfiguration({") + 400);
    expect(call).toContain("headSha: scope.headSha");
    expect(call).toContain("trustedSha: scope.trustedRefSha");
  });

  it("uses the parsed configuration only when trust was granted", () => {
    const guard = worker.indexOf("if (!trust.useRepositoryConfig)");
    const parse = worker.indexOf("parseRepositoryConfig(file.content)");
    expect(guard).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(guard);
  });

  it("claims no branch protection it cannot verify", () => {
    const call = worker.slice(worker.indexOf("trustedConfiguration({"), worker.indexOf("trustedConfiguration({") + 400);
    expect(call).toContain("branchProtected: false");
    expect(call).toContain("rulesetProtected: false");
  });
});
