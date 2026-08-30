import { describe, expect, it } from "vitest";
import { issueExecutionGrant, verifyExecutionGrant } from "../src/execution-grant";
const secret = new Uint8Array(32).fill(8), now = 1_000, scope = { organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", baseSha: "b".repeat(40), headSha: "a".repeat(40), artifactsHash: "c".repeat(64), plansHash: "d".repeat(64) };
describe("single validation execution grants", () => {
  it("binds the exact tenant, commits, artifacts, and trusted plans once", async () => {
    const token = issueExecutionGrant(scope, secret, now);
    await expect(verifyExecutionGrant(token, secret, { now: now + 1, consume: async () => true })).resolves.toMatchObject(scope);
    await expect(verifyExecutionGrant(token, secret, { now: now + 1, consume: async () => false })).rejects.toThrow("execution_grant_replayed");
  });
  it("rejects tampering, invalid commit/hash claims, long grants, and expiry", async () => {
    const token = issueExecutionGrant(scope, secret, now);
    await expect(verifyExecutionGrant(`${token}x`, secret, { now, consume: async () => true })).rejects.toThrow("execution_grant_invalid");
    expect(() => issueExecutionGrant({ ...scope, headSha: "bad" }, secret, now)).toThrow("execution_grant_scope_invalid");
    expect(() => issueExecutionGrant({ ...scope, ttlMs: 120_001 }, secret, now)).toThrow("execution_grant_ttl_invalid");
    await expect(verifyExecutionGrant(token, secret, { now: now + 121_000, consume: async () => true })).rejects.toThrow("execution_grant_expired");
  });
});
