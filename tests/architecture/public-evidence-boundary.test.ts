import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The only unauthenticated function that returns a repository name is publicProof.recentPublicReviews,
// and in production it served six pull requests from two repositories that GitHub had made private.
// The gate read `repositories.visibility`, which is written only when access is granted and which no
// code path could correct afterwards, so the stored value was a snapshot and the leak could not
// self-heal. These assertions pin the four conditions that replaced it, and pin the allow-list narrow
// so widening it is an explicit, reviewed edit rather than a one-word change nobody notices.
const source = readFileSync(fileURLToPath(new URL("../../convex/publicProof.ts", import.meta.url)), "utf8");

describe("the public evidence boundary", () => {
  it("publishes only for BuildIT's own evidence account, and names at most one", () => {
    const literal = /const evidenceOwners = new Set\(\[([^\]]*)\]\)/.exec(source);
    expect(literal, "evidenceOwners must stay a readable literal").not.toBeNull();
    const owners = [...literal![1]!.matchAll(/"([^"]+)"/g)].map(match => match[1]);
    expect(owners).toEqual(["tanmayiift"]);
  });

  it("requires an explicit opt-in that no repository has by default", () => {
    // The flag is the whole fix: a repository is published because somebody chose it, never because
    // a stale column failed to exclude it.
    expect(source).toContain("repository.publishAsEvidence !== true");
    expect(source).toContain('.withIndex("by_evidence"');
    // And the opt-in alone must not be sufficient.
    expect(source).toContain("evidenceOwners.has(repository.owner)");
    expect(source).toContain('repository.visibility !== "public"');
  });

  it("treats an unconfirmed or stale visibility as unpublishable", () => {
    expect(source).toMatch(/visibilityFreshnessMs/);
    expect(source).toContain("repository.visibilityVerifiedAt");
    // Fail closed: a missing or non-finite stamp must refuse, not default to fresh.
    expect(source).toMatch(/if \(!Number\.isFinite\(verifiedAt\)/);
  });

  it("reads no identity, so it cannot accidentally become an authorized endpoint", () => {
    expect(source).not.toMatch(/require\w*Role|getAuthUserId|ctx\.auth/);
  });
});
