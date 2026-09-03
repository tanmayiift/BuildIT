import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// The trust page lists "a stored provider key can be rotated and the old ciphertext rendered
// unusable" as a release blocker. Every review-time read already filters on status "valid"
// (durableReview.ts:304, githubWebhookData.ts:273), so a rotated key is unselectable - but revoke
// only flagged the row and left encryptedCiphertext, nonce, authTag and wrappedDataKey sitting in
// it. That makes the claim true by filtering rather than structurally: one future read path that
// forgets the filter, or one database export, and the envelope is openable again.
//
// Scrubbing the wrapped data key is what makes it structural. Without it the envelope cannot be
// opened at all, whatever a caller does with the row.

async function credential(t: ReturnType<typeof convexTest>, overrides: Record<string, unknown> = {}) {
  return t.run(async ctx => {
    const now = 1_000;
    const organizationId = await ctx.db.insert("organizations", { name: "Ledgerline", slug: "ledgerline", timezone: "UTC",
      region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, planId: "trial",
      fingerprintKeyVersion: 1, createdAt: now });
    const envelope = (label: string) => Buffer.from(["fixture", label, "not-a-secret"].join("-")).toString("base64url");
    const credentialId = await ctx.db.insert("providerCredentials", { organizationId,
      credentialScopeId: "11111111-1111-1111-1111-111111111111", provider: "anthropic",
      encryptedCiphertext: envelope("ciphertext"), nonce: envelope("nonce"), authTag: envelope("tag"),
      aadDigest: "e".repeat(64),
      wrappedDataKey: envelope("wrapped-key"), kmsKeyId: "kms-key-1", envelopeVersion: 1, keyVersion: 1,
      maskedSuffix: "9f2c", status: "valid", createdBy: "owner", createdAt: now, lastValidatedAt: now,
      ...overrides });
    return { organizationId, credentialId };
  });
}

describe("revoking a provider credential", () => {
  it("destroys the wrapped data key rather than only flagging the row", async () => {
    const t = convexTest(schema, modules), seeded = await credential(t);
    await t.run(async ctx => {
      const { revokeCredentialSecret } = await import("./lib/credentialRevocation");
      await revokeCredentialSecret(ctx, seeded.credentialId, 5_000);
    });

    const row = await t.run(async ctx => ctx.db.get(seeded.credentialId));
    expect(row?.status).toBe("revoked");
    expect(row?.revokedAt).toBe(5_000);
    // The envelope cannot be opened without these, so an exported row is inert.
    expect(row?.wrappedDataKey).toBe("");
    expect(row?.encryptedCiphertext).toBe("");
    expect(row?.nonce).toBe("");
    expect(row?.authTag).toBe("");
  });

  it("keeps the history a person needs to audit the rotation", async () => {
    const t = convexTest(schema, modules), seeded = await credential(t);
    await t.run(async ctx => {
      const { revokeCredentialSecret } = await import("./lib/credentialRevocation");
      await revokeCredentialSecret(ctx, seeded.credentialId, 5_000);
    });

    const row = await t.run(async ctx => ctx.db.get(seeded.credentialId));
    expect(row?.maskedSuffix).toBe("9f2c");
    expect(row?.keyVersion).toBe(1);
    expect(row?.provider).toBe("anthropic");
    expect(row?.createdAt).toBe(1_000);
  });

  it("is safe to apply twice, because a retry must not report a different outcome", async () => {
    const t = convexTest(schema, modules), seeded = await credential(t);
    await t.run(async ctx => {
      const { revokeCredentialSecret } = await import("./lib/credentialRevocation");
      await revokeCredentialSecret(ctx, seeded.credentialId, 5_000);
      await revokeCredentialSecret(ctx, seeded.credentialId, 9_000);
    });

    const row = await t.run(async ctx => ctx.db.get(seeded.credentialId));
    // The first revocation is the one that happened; a second pass must not rewrite the date.
    expect(row?.revokedAt).toBe(5_000);
    expect(row?.wrappedDataKey).toBe("");
  });

  it("leaves a revoked credential unselectable by the review-time index", async () => {
    const t = convexTest(schema, modules), seeded = await credential(t);
    await t.run(async ctx => {
      const { revokeCredentialSecret } = await import("./lib/credentialRevocation");
      await revokeCredentialSecret(ctx, seeded.credentialId, 5_000);
    });

    const selectable = await t.run(async ctx => ctx.db.query("providerCredentials")
      .withIndex("by_org_status", q => q.eq("organizationId", seeded.organizationId).eq("status", "valid"))
      .collect());
    expect(selectable).toEqual([]);
  });
});
