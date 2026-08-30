import { describe, expect, it, vi } from "vitest";
import { issueArtifactGrant, verifyArtifactGrant } from "../src/artifact-grant";

const secret = new Uint8Array(32).fill(9);
const scope = { organizationId: "org-a", repositoryId: "repo-a", reviewId: "review-a", artifactId: "artifact-a", storageKey: "artifacts/org-a/repo-a/review-a/artifact-a/content.bin", operation: "read" as const };

describe("single-artifact grants", () => {
  it("accepts one exact operation once", async () => {
    const consume = vi.fn(async () => true), token = issueArtifactGrant(scope, secret, 1_000);
    await expect(verifyArtifactGrant(token, secret, { operation: "read", now: 2_000, consume })).resolves.toMatchObject(scope);
    expect(consume).toHaveBeenCalledOnce();
  });

  it("rejects tampering, another operation, expiry, and replay", async () => {
    const token = issueArtifactGrant(scope, secret, 1_000);
    await expect(verifyArtifactGrant(`${token}x`, secret, { operation: "read", now: 2_000, consume: async () => true })).rejects.toThrow("artifact_grant_invalid");
    await expect(verifyArtifactGrant(token, secret, { operation: "delete", now: 2_000, consume: async () => true })).rejects.toThrow("artifact_grant_scope_invalid");
    await expect(verifyArtifactGrant(token, secret, { operation: "read", now: 70_000, consume: async () => true })).rejects.toThrow("artifact_grant_expired");
    await expect(verifyArtifactGrant(token, secret, { operation: "read", now: 2_000, consume: async () => false })).rejects.toThrow("artifact_grant_replayed");
  });

  it("requires the object key to contain every immutable tenant parent", () => {
    expect(() => issueArtifactGrant({ ...scope, storageKey: "artifacts/org-b/repo-a/review-a/artifact-a/content.bin" }, secret)).toThrow("artifact_grant_scope_invalid");
    expect(() => issueArtifactGrant({ ...scope, storageKey: "artifacts/org-a/repo-a/review-a/artifact-a/../other" }, secret)).toThrow("artifact_grant_scope_invalid");
  });

  it("caps grants at five minutes and requires a 256-bit signing secret", () => {
    expect(() => issueArtifactGrant({ ...scope, ttlMs: 300_001 }, secret)).toThrow("artifact_grant_ttl_invalid");
    expect(() => issueArtifactGrant(scope, new Uint8Array(16))).toThrow("artifact_grant_secret_too_short");
  });
});
