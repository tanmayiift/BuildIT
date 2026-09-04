import { describe, expect, it } from "vitest";
import { trustedConfiguration } from "../src/index.js";

// trustedConfiguration has two routes to trusting a repository's own configuration: the ref is
// protected, or an admin approved it. The protected route needs to read branch protection, which
// needs administration:read - a permission this GitHub App does not have and cannot get without
// every installation re-accepting it.
//
// So the approval route is the one that works today, and as written it approves a *commit*. That
// makes it unusable in practice: the trusted ref is the base branch, whose sha moves on every
// merge, so an admin would re-approve the same unchanged config file several times a day and stop
// reading what they were approving - which is worse than not asking.
//
// Approving the configuration's content hash instead means approval lasts exactly as long as the
// configuration does, and changing the file is what asks again. The refusal that matters is
// untouched: configuration taken from the pull request head is never trusted, whatever anyone
// approved.

const sha = "a".repeat(40), otherSha = "b".repeat(40), hash = "c".repeat(64), otherHash = "d".repeat(64);
const unprotected = { branchProtected: false, rulesetProtected: false, allowsUntrustedDirectWrites: true };

const base = { defaultBranch: "main", headSha: otherSha, trustedSha: sha, contentHash: hash, protection: unprotected };

describe("trusting a repository's configuration", () => {
  it("refuses configuration taken from the pull request head, whatever was approved", () => {
    const result = trustedConfiguration({ ...base, headSha: sha,
      approval: { actorRole: "owner", approvedContentHash: hash } });
    expect(result).toMatchObject({ useRepositoryConfig: false, reason: "pr_head_untrusted" });
  });

  it("accepts an admin approval of this exact configuration", () => {
    const result = trustedConfiguration({ ...base, approval: { actorRole: "admin", approvedContentHash: hash } });
    expect(result).toMatchObject({ useRepositoryConfig: true, provenance: "explicit_admin_approval" });
  });

  it("refuses once the configuration changes, because that is a different thing to approve", () => {
    const result = trustedConfiguration({ ...base, approval: { actorRole: "admin", approvedContentHash: otherHash } });
    expect(result).toMatchObject({ useRepositoryConfig: false, reason: "unverified_ref" });
  });

  it("keeps the approval across a base commit that did not touch the file", () => {
    const approval = { actorRole: "admin" as const, approvedContentHash: hash };
    for (const trustedSha of [sha, otherSha, "e".repeat(40)]) {
      expect(trustedConfiguration({ ...base, headSha: "f".repeat(40), trustedSha, approval }))
        .toMatchObject({ useRepositoryConfig: true });
    }
  });

  it("still refuses an approval from someone who is not an admin or owner", () => {
    for (const actorRole of ["viewer", "member"] as const) {
      expect(trustedConfiguration({ ...base, approval: { actorRole, approvedContentHash: hash } }))
        .toMatchObject({ useRepositoryConfig: false, reason: "unverified_ref" });
    }
  });

  it("still trusts a protected ref without any approval at all", () => {
    const result = trustedConfiguration({ ...base,
      protection: { branchProtected: true, rulesetProtected: false, allowsUntrustedDirectWrites: false } });
    expect(result).toMatchObject({ useRepositoryConfig: true, provenance: "protected_ref_merge" });
  });

  it("refuses when nothing vouches for it", () => {
    expect(trustedConfiguration(base)).toMatchObject({ useRepositoryConfig: false, reason: "unverified_ref" });
  });
});
