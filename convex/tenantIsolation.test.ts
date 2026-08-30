/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { normalizeGitHubProfile } from "./lib/githubProfile";

const modules = import.meta.glob("./**/*.ts");

async function seedTenant(
  t: ReturnType<typeof convexTest>,
  slug: string,
  userId: string,
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name: slug,
      slug,
      timezone: "Asia/Kolkata",
      region: "eu-west-1",
      retentionHours: 24,
      monthlyBudget: 100,
      concurrencyLimit: 2,
      planId: "test",
      fingerprintKeyVersion: 1,
      createdAt: now,
    });
    await ctx.db.insert("memberships", {
      organizationId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const installationId = await ctx.db.insert("githubInstallations", {
      organizationId,
      installationId: Math.floor(Math.random() * 1_000_000),
      accountLogin: slug,
      accountType: "organization",
      permissionSnapshot: {
        metadata: "read",
        contents: "write",
        pullRequests: "write",
        issues: "read",
        checks: "write",
      },
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const repositoryId = await ctx.db.insert("repositories", {
      organizationId,
      installationId,
      githubRepositoryId: Math.floor(Math.random() * 1_000_000),
      owner: slug,
      name: "fixture",
      defaultBranch: "main",
      enabled: true,
      autofixMode: "stacked",
      forkPolicy: "manual_review_only",
      indexState: "ready",
      concurrencyLimit: 1,
      createdAt: now,
      updatedAt: now,
    });
    const configArtifactId = await ctx.db.insert("artifacts", {
      organizationId,
      repositoryId,
      type: "configuration",
      storageKey: `${slug}/config`,
      encrypted: true,
      checksum: "hash",
      size: 1,
      redactionStatus: "redacted",
      expiresAt: now + 60_000,
      deletionAttempts: 0,
    });
    const configRevisionId = await ctx.db.insert("configRevisions", {
      organizationId,
      repositoryId,
      sourceCommitSha: "b".repeat(40),
      sourceRef: "main",
      configArtifactId,
      contentHash: "config-hash",
      rulesDigest: "rules-hash",
      schemaVersion: "1",
      validationState: "valid",
      provenance: "defaults_only",
      refProtectionState: "unverified",
      createdAt: now,
    });
    await ctx.db.patch(repositoryId, { configRevisionId });
    const reviewId = await ctx.db.insert("reviews", {
      organizationId,
      repositoryId,
      githubRepositoryId: 1,
      prNumber: 1,
      isFork: false,
      baseRef: "main",
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      requiredCheckPolicy: "advisory",
      completedRoundCount: 0,
      patchAttemptCount: 0,
      diagnosticRunCount: 0,
      providerRetryCount: 0,
      commandRetryCount: 0,
      trigger: "dashboard",
      triggerVerb: "review",
      triggerActor: userId,
      triggerActorPermission: "admin",
      mode: "review",
      status: "queued",
      budgetLimit: 10,
      budgetConsumed: 0,
      nextActionCode: "none",
      isStale: false,
      trustedRef: "main",
      trustedRefSha: "b".repeat(40),
      configRevisionId,
      configProvenance: "defaults_only",
      provider: "anthropic",
      model: "test-model",
      modelVersion: "test",
      promptVersion: "test",
      evalSetVersion: "test",
      coverageLevel: "limited",
      currentStage: "queue",
      runnerImageVersion: "test",
      executionGeneration: 0,
      queuePriority: 0,
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    const artifactId = await ctx.db.insert("artifacts", {
      organizationId,
      repositoryId,
      reviewId,
      type: "command_output",
      storageKey: `${slug}/output`,
      encrypted: true,
      checksum: "output-hash",
      size: 10,
      redactionStatus: "redacted",
      expiresAt: now + 60_000,
      deletionAttempts: 0,
    });
    await ctx.db.insert("providerCredentials", {
      organizationId,
      credentialScopeId: "credential-test",
      provider: "anthropic",
      encryptedCiphertext: "ciphertext",
      nonce: "nonce",
      authTag: "tag",
      aadDigest: "aad",
      wrappedDataKey: "wrapped",
      kmsKeyId: "kms-test",
      envelopeVersion: 1,
      keyVersion: 1,
      maskedSuffix: "…1234",
      status: "valid",
      createdBy: userId,
      createdAt: now,
    });
    return {
      organizationId,
      installationId,
      repositoryId,
      reviewId,
      artifactId,
    };
  });
}

describe("Convex tenant isolation", () => {
  it("stores a normalized GitHub profile when the account email is private", async () => {
    const t = convexTest(schema, modules);
    const profile = normalizeGitHubProfile({
      id: 42,
      login: "rohan",
      name: null,
      email: null,
      avatar_url: "https://avatars.example/42",
    });
    const { id: providerAccountId, ...storedProfile } = profile;
    expect(providerAccountId).toBe("42");
    const userId = await t.run((ctx) => ctx.db.insert("users", storedProfile));
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user).toMatchObject({
      githubUserId: 42,
      login: "rohan",
      name: "rohan",
    });
    expect(user).not.toHaveProperty("email");
  });

  it("authorizes a real Convex Auth subject by stable user ID, not session ID", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const signedIn = t.withIdentity({ subject: "alice|session-one" });
    const organizations = await signedIn.query(api.organizations.listMine, {});
    const reviews = await signedIn.query(api.reviews.list, {
      organizationId: alpha.organizationId,
    });
    expect(
      organizations.map((organization: { slug: string }) => organization.slug),
    ).toEqual(["alpha"]);
    expect(reviews.map((review) => review.id)).toEqual([alpha.reviewId]);
  });

  it("treats an active organization as a preference and rechecks membership", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "bob");
    const asAlice = t.withIdentity({ subject: "alice|session-one" });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    expect(await asAlice.query(api.organizations.active, {})).toMatchObject({
      slug: "alpha",
      role: "owner",
    });
    await expect(
      asAlice.mutation(api.organizations.selectActive, {
        organizationId: beta.organizationId,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("organizationId", alpha.organizationId).eq("userId", "alice"),
        )
        .unique();
      if (!membership) throw new Error("missing membership");
      await ctx.db.patch(membership._id, {
        status: "removed",
        updatedAt: Date.now(),
      });
    });
    expect(await asAlice.query(api.organizations.active, {})).toBeNull();
  });

  it("lists only the current user's sessions and identifies the current one", async () => {
    const t = convexTest(schema, modules);
    const identity = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Alice" });
      const current = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: 300,
      });
      const other = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: 400,
      });
      const outsiderId = await ctx.db.insert("users", { name: "Bob" });
      await ctx.db.insert("authSessions", {
        userId: outsiderId,
        expirationTime: 500,
      });
      return { userId, current, other };
    });
    const sessions = await t
      .withIdentity({ subject: `${identity.userId}|${identity.current}` })
      .query(api.users.sessions, {});
    expect(sessions).toHaveLength(2);
    expect(
      sessions.find((session) => session.id === identity.current)?.current,
    ).toBe(true);
    expect(
      sessions.find((session) => session.id === identity.other)?.current,
    ).toBe(false);
  });

  it("allows one user to belong to multiple organizations without merging their records", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "alice");
    const asAlice = t.withIdentity({ subject: "alice" });
    const organizations = await asAlice.query(api.organizations.listMine, {});
    expect(
      organizations
        .map((organization: { slug: string }) => organization.slug)
        .sort(),
    ).toEqual(["alpha", "beta"]);
    const alphaReviews = await asAlice.query(api.reviews.list, {
      organizationId: alpha.organizationId,
    });
    const betaReviews = await asAlice.query(api.reviews.list, {
      organizationId: beta.organizationId,
    });
    expect(alphaReviews.map((review) => review.id)).toEqual([alpha.reviewId]);
    expect(betaReviews.map((review) => review.id)).toEqual([beta.reviewId]);
  });

  it("returns only organizations belonging to the authenticated user", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t, "alpha", "alice");
    await seedTenant(t, "beta", "bob");
    const result = await t
      .withIdentity({ subject: "alice" })
      .query(api.organizations.listMine, {});
    expect(
      result.map((organization: { slug: string }) => organization.slug),
    ).toEqual(["alpha"]);
  });

  it("returns a live connection snapshot only for the active authorized organization", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    await seedTenant(t, "beta", "bob");
    const asAlice = t.withIdentity({ subject: "alice|session-one" });
    expect(await t.query(api.repositoryConnections.current, {})).toMatchObject({
      state: "signed_out",
      repositories: [],
    });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    const result = await asAlice.query(api.repositoryConnections.current, {});
    expect(result).toMatchObject({
      state: "connected",
      organization: { slug: "alpha", role: "owner" },
    });
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]).toMatchObject({
      owner: "alpha",
      name: "fixture",
    });
    expect(JSON.stringify(result)).not.toContain("permissionSnapshot");
    expect(JSON.stringify(result)).not.toContain("ciphertext");
  });

  it("returns a server-backed permission receipt without leaking another workspace or viewer credential metadata", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "receipt-alpha", "alice"),
      beta = await seedTenant(t, "receipt-beta", "bob"),
      asAlice = t.withIdentity({ subject: "alice|session-one" });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    const ownerReceipt = await asAlice.query(
      api.permissionReceipts.current,
      {},
    );
    expect(ownerReceipt).toMatchObject({
      identity: { login: "verified GitHub user" },
      organization: {
        name: "receipt-alpha",
        role: "owner",
        region: "eu-west-1",
      },
      boundaries: {
        mergeAuthority: false,
        workflowWrite: false,
        repositoryAdministration: false,
      },
    });
    expect(ownerReceipt?.repositories.map((item) => item.owner)).toEqual([
      "receipt-alpha",
    ]);
    expect(JSON.stringify(ownerReceipt)).not.toContain("receipt-beta");
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("organizationId", alpha.organizationId).eq("userId", "alice"),
        )
        .unique();
      if (!membership) throw new Error("membership_missing");
      await ctx.db.patch(membership._id, { role: "viewer" });
    });
    const viewerReceipt = await asAlice.query(
      api.permissionReceipts.current,
      {},
    );
    expect(viewerReceipt?.credentials).toEqual([]);
    expect(
      await t
        .withIdentity({ subject: "bob" })
        .query(api.permissionReceipts.current, {}),
    ).toBeNull();
    expect(beta.organizationId).not.toBe(alpha.organizationId);
  });

  it("reports an active installation with no selected repositories without inventing access", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const asAlice = t.withIdentity({ subject: "alice|session-one" });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    await t.run(async (ctx) => {
      const repositories = await ctx.db
        .query("repositories")
        .withIndex("by_org_enabled", (q) =>
          q.eq("organizationId", alpha.organizationId),
        )
        .collect();
      await Promise.all(
        repositories.map((repository) =>
          ctx.db.patch(repository._id, {
            enabled: false,
            pausedAt: Date.now(),
          }),
        ),
      );
    });
    expect(
      await asAlice.query(api.repositoryConnections.current, {}),
    ).toMatchObject({
      state: "no_repositories_selected",
      organization: { slug: "alpha" },
      repositories: [],
    });
  });

  it("reports a revoked installation as unavailable and never returns its repositories", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const asAlice = t.withIdentity({ subject: "alice|session-one" });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(alpha.installationId, {
        status: "removed",
        updatedAt: Date.now(),
      });
    });
    const result = await asAlice.query(api.repositoryConnections.current, {});
    expect(result).toMatchObject({
      state: "installation_unavailable",
      repositories: [],
    });
    expect(result.installations).toEqual([
      expect.objectContaining({ status: "removed" }),
    ]);
  });

  it("fails closed when a saved workspace outlives its active membership", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const asAlice = t.withIdentity({ subject: "alice|stale-session" });
    await asAlice.mutation(api.organizations.selectActive, {
      organizationId: alpha.organizationId,
    });
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("organizationId", alpha.organizationId).eq("userId", "alice"),
        )
        .unique();
      if (!membership) throw new Error("missing membership");
      await ctx.db.patch(membership._id, {
        status: "removed",
        updatedAt: Date.now(),
      });
    });
    expect(await asAlice.query(api.repositoryConnections.current, {})).toEqual({
      state: "no_workspace",
      organization: null,
      installations: [],
      repositories: [],
    });
  });

  it("rejects guessed organization and review IDs from another tenant", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "bob");
    const asAlice = t.withIdentity({ subject: "alice" });
    await expect(
      asAlice.query(api.reviews.list, { organizationId: beta.organizationId }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      asAlice.query(api.reviews.get, { reviewId: beta.reviewId }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      asAlice.query(api.reviews.getEvidence, { reviewId: beta.reviewId }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      asAlice.query(api.artifacts.getMetadata, { artifactId: beta.artifactId }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("returns source-free live review evidence only to the review tenant", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "evidence-alpha", "alice");
    const evidence = await t
      .withIdentity({ subject: "alice|session" })
      .query(api.reviews.getEvidence, { reviewId: alpha.reviewId });
    expect(evidence).toMatchObject({
      repository: { owner: "evidence-alpha", name: "fixture" },
      review: { headSha: "a".repeat(40) },
    });
    expect(JSON.stringify(evidence)).not.toContain("ciphertext");
    expect(JSON.stringify(evidence)).not.toContain("storageKey");
    expect(JSON.stringify(evidence)).not.toContain("sourceCommitSha");
  });

  it("aggregates usage only after validating every organization, repository, and review parent", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "usage-alpha", "alice"),
      beta = await seedTenant(t, "usage-beta", "bob"),
      now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("usageLedger", {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
        kind: "model_tokens",
        quantity: 120,
        unitCost: 0,
        currency: "provider_billed",
        occurredAt: now,
      }),
    );
    const result = await t
      .withIdentity({ subject: "alice|session" })
      .query(api.usage.summarize, {
        organizationId: alpha.organizationId,
        since: now - 1,
      });
    expect(result).toMatchObject({
      quantities: { model_tokens: 120 },
      costs: { provider_billed: 0 },
      recordCount: 1,
      monthlyBudget: 100,
    });
    expect(JSON.stringify(result)).not.toContain(String(beta.reviewId));
    await expect(
      t
        .withIdentity({ subject: "bob|session" })
        .query(api.usage.summarize, {
          organizationId: alpha.organizationId,
          since: now - 1,
        }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("returns only tenant audit metadata and detects a modified chain", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "audit-alpha", "alice"),
      beta = await seedTenant(t, "audit-beta", "bob"),
      now = Date.now();
    await t.mutation(internal.dashboardReviewData.create, {
      repositoryId: alpha.repositoryId,
      prNumber: 2,
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      baseRef: "main",
      isFork: false,
      actorId: "alice",
      actorRole: "admin",
      expectedCredentialScopeId: "credential-test",
      now,
    });
    const asAlice = t.withIdentity({ subject: "alice|session" });
    const first = await asAlice.query(api.audit.list, {
      organizationId: alpha.organizationId,
      limit: 10,
    });
    expect(first).toMatchObject({
      chainValid: true,
      events: [
        expect.objectContaining({
          action: "review.created",
          resourceType: "review",
          result: "allowed",
        }),
      ],
    });
    expect(JSON.stringify(first)).not.toContain(String(beta.organizationId));
    const eventId = first.events[0]!.id;
    await t.run((ctx) => ctx.db.patch(eventId, { action: "tampered.action" }));
    expect(
      await asAlice.query(api.audit.list, {
        organizationId: alpha.organizationId,
        limit: 10,
      }),
    ).toMatchObject({ chainValid: false });
    await expect(
      t
        .withIdentity({ subject: "bob|session" })
        .query(api.audit.list, {
          organizationId: alpha.organizationId,
          limit: 10,
        }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("creates a dashboard review only inside the authorized repository and records consent", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "dashboard-alpha", "alice"),
      beta = await seedTenant(t, "dashboard-beta", "bob");
    const asAlice = t.withIdentity({ subject: "alice|dashboard-session" });
    await expect(
      asAlice.action(api.dashboardReviews.prepare, {
        repositoryId: beta.repositoryId,
        prNumber: 2,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    const created = await t.mutation(internal.dashboardReviewData.create, {
      repositoryId: alpha.repositoryId,
      prNumber: 2,
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      baseRef: "main",
      isFork: false,
      actorId: "alice",
      actorRole: "developer",
      expectedCredentialScopeId: "credential-test",
      now: Date.now(),
    });
    expect(await t.run((ctx) => ctx.db.get(created.reviewId))).toMatchObject({
      organizationId: alpha.organizationId,
      repositoryId: alpha.repositoryId,
      trigger: "dashboard",
      triggerVerb: "review",
      triggerActorPermission: "write",
      headSha: "c".repeat(40),
      status: "queued",
    });
    await expect(t.mutation(internal.dashboardReviewData.create, {
      repositoryId: alpha.repositoryId,
      prNumber: 3,
      headSha: "d".repeat(40),
      baseSha: "b".repeat(40),
      baseRef: "main",
      isFork: false,
      actorId: "alice",
      actorRole: "developer",
      expectedCredentialScopeId: "replaced-after-preview",
      now: Date.now(),
    })).rejects.toThrow("provider_credential_changed_review_again");
    const [event, audit] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db
          .query("reviewEvents")
          .withIndex("by_review", (q) => q.eq("reviewId", created.reviewId))
          .filter((q) => q.eq(q.field("sequence"), 1))
          .unique(),
        ctx.db
          .query("auditEvents")
          .withIndex("by_org_created", (q) =>
            q.eq("organizationId", alpha.organizationId),
          )
          .order("desc")
          .first(),
      ]),
    );
    expect(event).toMatchObject({ internalCode: "dashboard_consent" });
    expect(audit).toMatchObject({
      action: "review.created",
      actorId: "alice",
      result: "allowed",
    });
    expect(audit?.resourceIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit?.resourceIdHash).not.toBe(created.reviewId);
  });

  it("does not let a viewer prepare or forge a dashboard review", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "dashboard-viewer", "owner");
    await t.run((ctx) =>
      ctx.db.insert("memberships", {
        organizationId: alpha.organizationId,
        userId: "viewer",
        role: "viewer",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(
      t
        .withIdentity({ subject: "viewer|session" })
        .action(api.dashboardReviews.prepare, {
          repositoryId: alpha.repositoryId,
          prNumber: 2,
        }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      t.mutation(internal.dashboardReviewData.create, {
        repositoryId: alpha.repositoryId,
        prNumber: 2,
        headSha: "c".repeat(40),
        baseSha: "b".repeat(40),
        baseRef: "main",
        isFork: false,
        actorId: "viewer",
        actorRole: "developer",
        expectedCredentialScopeId: "credential-test",
        now: Date.now(),
      }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("never returns encrypted provider credential fields", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const result = await t
      .withIdentity({ subject: "alice" })
      .query(api.integrations.listProviderCredentials, {
        organizationId: alpha.organizationId,
      });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "anthropic",
      maskedSuffix: "…1234",
    });
    expect(result[0]).not.toHaveProperty("encryptedCiphertext");
    expect(result[0]).not.toHaveProperty("nonce");
    expect(result[0]).not.toHaveProperty("authTag");
  });

  it("requires admin access for credential metadata", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("memberships", {
        organizationId: alpha.organizationId,
        userId: "viewer",
        role: "viewer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    await expect(
      t
        .withIdentity({ subject: "viewer" })
        .query(api.integrations.listProviderCredentials, {
          organizationId: alpha.organizationId,
        }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("stores only encrypted credential material for a recently authenticated admin", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { githubUserId: 42, githubLogin: "alice" }),
    );
    const alpha = await seedTenant(t, "credential-alpha", userId);
    await t.run((ctx) =>
      ctx.db.insert("userProfiles", {
        userId,
        githubUserId: 42,
        githubLogin: "alice",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const signedIn = t.withIdentity({
      subject: `${userId}|credential-session`,
    });
    await expect(
      signedIn.mutation(api.integrations.authorizeCredentialWrite, {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
      }),
    ).resolves.toEqual({ actorId: userId });
    const result = await signedIn.mutation(
      api.integrations.storeEncryptedCredential,
      {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        credentialScopeId: "123e4567-e89b-12d3-a456-426614174000",
        provider: "gemini",
        encryptedCiphertext: "encrypted",
        nonce: "nonce",
        authTag: "tag",
        aadDigest: "a".repeat(64),
        wrappedDataKey: "wrapped",
        kmsKeyId: "arn:aws:kms:eu-west-1:123:key/test",
        envelopeVersion: 1,
        keyVersion: 1,
        maskedSuffix: "1234",
        lastValidatedAt: Date.now(),
        requestId: "credential-create-0001",
      },
    );
    expect(result).toMatchObject({
      provider: "gemini",
      maskedSuffix: "1234",
      status: "valid",
    });
    const stored = await t.run((ctx) => ctx.db.get(result.id));
    expect(stored).toMatchObject({
      organizationId: alpha.organizationId,
      repositoryId: alpha.repositoryId,
      createdBy: userId,
      encryptedCiphertext: "encrypted",
    });
    const rotated = await signedIn.mutation(
      api.integrations.storeEncryptedCredential,
      {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        credentialScopeId: "223e4567-e89b-12d3-a456-426614174000",
        provider: "gemini", // gitleaks:allow — inert UUID fixture
        encryptedCiphertext: "replacement",
        nonce: "nonce-2",
        authTag: "tag-2",
        aadDigest: "b".repeat(64),
        wrappedDataKey: "wrapped-2",
        kmsKeyId: "arn:aws:kms:eu-west-1:123:key/test",
        envelopeVersion: 1,
        keyVersion: 1,
        maskedSuffix: "5678",
        lastValidatedAt: Date.now(),
        requestId: "credential-rotate-0001",
        replacesCredentialId: result.id,
      },
    );
    expect(await t.run((ctx) => ctx.db.get(result.id))).toMatchObject({
      status: "revoked",
    });
    expect(await t.run((ctx) => ctx.db.get(rotated.id))).toMatchObject({
      status: "valid",
      maskedSuffix: "5678",
    });
    const audit = await t.run((ctx) =>
      ctx.db
        .query("auditEvents")
        .withIndex("by_org_created", (q) =>
          q.eq("organizationId", alpha.organizationId),
        )
        .order("desc")
        .first(),
    );
    expect(audit).toMatchObject({ action: "credential.rotated" });
  });

  it("keeps an authorized credential save valid while provider validation runs", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { githubUserId: 142, githubLogin: "alice" }),
    );
    const alpha = await seedTenant(t, "credential-provider-delay", userId);
    const profileId = await t.run((ctx) =>
      ctx.db.insert("userProfiles", {
        userId,
        githubUserId: 142,
        githubLogin: "alice",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const signedIn = t.withIdentity({
      subject: `${userId}|credential-session`,
    });
    await expect(
      signedIn.mutation(api.integrations.authorizeCredentialWrite, {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
      }),
    ).resolves.toEqual({ actorId: userId });
    await t.run((ctx) =>
      ctx.db.patch(profileId, {
        lastAuthenticatedAt: Date.now() - 11 * 60 * 1000,
        updatedAt: Date.now(),
      }),
    );
    const common = {
      organizationId: alpha.organizationId,
      repositoryId: alpha.repositoryId,
      credentialScopeId: "323e4567-e89b-12d3-a456-426614174000",
      provider: "gemini" as const,
      encryptedCiphertext: "encrypted",
      nonce: "nonce",
      authTag: "tag",
      aadDigest: "c".repeat(64),
      wrappedDataKey: "wrapped",
      kmsKeyId: "arn:aws:kms:eu-west-1:123:key/test",
      envelopeVersion: 1 as const,
      keyVersion: 1,
      maskedSuffix: "9012",
      lastValidatedAt: Date.now(),
      requestId: "credential-provider-delay-0001",
    };
    await expect(
      signedIn.mutation(api.integrations.storeEncryptedCredential, common),
    ).resolves.toMatchObject({ status: "valid" });
    await expect(
      signedIn.mutation(api.integrations.authorizeCredentialWrite, {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
      }),
    ).rejects.toThrow("recent_reauthentication_required");
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("organizationId", alpha.organizationId).eq("userId", userId),
        )
        .unique();
      if (!membership) throw new Error("membership_missing");
      await ctx.db.patch(membership._id, {
        status: "removed",
        updatedAt: Date.now(),
      });
    });
    await expect(
      signedIn.mutation(api.integrations.storeEncryptedCredential, {
        ...common,
        credentialScopeId: "423e4567-e89b-12d3-a456-426614174000",
        requestId: "credential-provider-delay-0002",
      }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("rejects a model credential bound to another tenant's repository", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { githubUserId: 43, githubLogin: "alice" }),
    );
    const alpha = await seedTenant(t, "credential-owner", userId);
    const beta = await seedTenant(t, "credential-other", "bob");
    await t.run((ctx) =>
      ctx.db.insert("userProfiles", {
        userId,
        githubUserId: 43,
        githubLogin: "alice",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(
      t
        .withIdentity({ subject: `${userId}|credential-session` })
        .mutation(api.integrations.authorizeCredentialWrite, {
          organizationId: alpha.organizationId,
          repositoryId: beta.repositoryId,
        }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("stops credential validation before the eleventh provider attempt in one window", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { githubUserId: 45, githubLogin: "alice" }),
    );
    const alpha = await seedTenant(t, "credential-rate", userId);
    await t.run((ctx) =>
      ctx.db.insert("userProfiles", {
        userId,
        githubUserId: 45,
        githubLogin: "alice",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const signedIn = t.withIdentity({
      subject: `${userId}|credential-session`,
    });
    for (let attempt = 0; attempt < 10; attempt += 1)
      await expect(
        signedIn.mutation(api.integrations.authorizeCredentialWrite, {
          organizationId: alpha.organizationId,
        }),
      ).resolves.toEqual({ actorId: userId });
    await expect(
      signedIn.mutation(api.integrations.authorizeCredentialWrite, {
        organizationId: alpha.organizationId,
      }),
    ).rejects.toThrow("rate_limited");
  });

  it("revokes only a credential in the active admin's organization and records no plaintext", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { githubUserId: 44, githubLogin: "alice" }),
    );
    const alpha = await seedTenant(t, "credential-revoke", userId);
    const beta = await seedTenant(t, "credential-foreign", "bob");
    await t.run((ctx) =>
      ctx.db.insert("userProfiles", {
        userId,
        githubUserId: 44,
        githubLogin: "alice",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const signedIn = t.withIdentity({
      subject: `${userId}|credential-session`,
    });
    const [credential] = await signedIn.query(
      api.integrations.listProviderCredentials,
      { organizationId: alpha.organizationId },
    );
    const [foreign] = await t
      .withIdentity({ subject: "bob" })
      .query(api.integrations.listProviderCredentials, {
        organizationId: beta.organizationId,
      });
    await expect(
      signedIn.mutation(api.integrations.revokeProviderCredential, {
        organizationId: alpha.organizationId,
        credentialId: foreign!.id,
        requestId: "credential-revoke-foreign-0001",
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      signedIn.mutation(api.integrations.revokeProviderCredential, {
        organizationId: alpha.organizationId,
        credentialId: credential!.id,
        requestId: "credential-revoke-valid-0001",
      }),
    ).resolves.toEqual({ id: credential!.id, status: "revoked" });
    const stored = await t.run((ctx) => ctx.db.get(credential!.id));
    expect(stored).toMatchObject({ status: "revoked" });
    expect(stored?.revokedAt).toEqual(expect.any(Number));
    const audit = await t.run((ctx) =>
      ctx.db
        .query("auditEvents")
        .withIndex("by_org_created", (q) =>
          q.eq("organizationId", alpha.organizationId),
        )
        .collect(),
    );
    expect(audit.at(-1)).toMatchObject({
      action: "credential.revoked",
      result: "allowed",
    });
  });

  it("rejects an artifact whose review and repository parents do not match", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const forgedArtifactId = await t.run(async (ctx) => {
      const now = Date.now();
      const repositoryId = await ctx.db.insert("repositories", {
        organizationId: alpha.organizationId,
        installationId: alpha.installationId,
        githubRepositoryId: 99,
        owner: "alpha",
        name: "fixture",
        defaultBranch: "main",
        enabled: true,
        autofixMode: "stacked",
        forkPolicy: "manual_review_only",
        indexState: "ready",
        concurrencyLimit: 1,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("artifacts", {
        organizationId: alpha.organizationId,
        repositoryId,
        reviewId: alpha.reviewId,
        type: "command_output",
        storageKey: "forged/output",
        encrypted: true,
        checksum: "hash",
        size: 1,
        redactionStatus: "redacted",
        expiresAt: now + 60_000,
        deletionAttempts: 0,
      });
    });
    await expect(
      t
        .withIdentity({ subject: "alice" })
        .query(api.artifacts.getMetadata, { artifactId: forgedArtifactId }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("reserves and completes a repository snapshot only inside the exact review parent chain", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "snapshot-alpha", "alice"),
      beta = await seedTenant(t, "snapshot-beta", "bob");
    const review = await t.run((ctx) => ctx.db.get(alpha.reviewId));
    if (!review) throw new Error("missing review");
    const checksum = "d".repeat(64),
      now = Date.now();
    const reserved = await t.mutation(internal.reviewArtifactData.reserve, {
      organizationId: alpha.organizationId,
      reviewId: alpha.reviewId,
      expectedHeadSha: review.headSha,
      expectedGeneration: review.executionGeneration,
      checksum,
      size: 128,
      chunkIndex: 0,
      revision: "head",
      now,
    });
    await expect(
      t.mutation(internal.reviewArtifactData.reserve, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: review.headSha,
        expectedGeneration: review.executionGeneration,
        checksum,
        size: 128,
        chunkIndex: 0,
        revision: "head",
        now: now + 1,
      }),
    ).resolves.toMatchObject({ artifactId: reserved.artifactId });
    const baseReserved = await t.mutation(internal.reviewArtifactData.reserve, {
      organizationId: alpha.organizationId,
      reviewId: alpha.reviewId,
      expectedHeadSha: review.headSha,
      expectedGeneration: review.executionGeneration,
      checksum: "f".repeat(64),
      size: 128,
      chunkIndex: 0,
      revision: "base",
      now,
    });
    expect(baseReserved.artifactId).not.toBe(reserved.artifactId);
    expect(baseReserved.storageKey).toContain("/context-base-0.json");
    expect(reserved.storageKey).toContain(
      `artifacts/${alpha.organizationId}/${alpha.repositoryId}/${alpha.reviewId}/${reserved.artifactId}/context-head-0.json`,
    );
    await expect(
      t.mutation(internal.reviewArtifactData.complete, {
        organizationId: beta.organizationId,
        reviewId: alpha.reviewId,
        artifactId: reserved.artifactId,
        checksum,
        size: 128,
        coverage: "full",
        now,
      }),
    ).rejects.toThrow("parent_scope_mismatch");
    await expect(
      t.mutation(internal.reviewArtifactData.complete, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        artifactId: reserved.artifactId,
        checksum: "e".repeat(64),
        size: 128,
        coverage: "full",
        now,
      }),
    ).rejects.toThrow("artifact_completion_mismatch");
    await expect(
      t.mutation(internal.reviewArtifactData.complete, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        artifactId: reserved.artifactId,
        checksum,
        size: 128,
        coverage: "full",
        now,
      }),
    ).resolves.toBe(reserved.artifactId);
    await expect(
      t.mutation(internal.reviewArtifactData.complete, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        artifactId: reserved.artifactId,
        checksum,
        size: 128,
        coverage: "full",
        now: now + 1,
      }),
    ).resolves.toBe(reserved.artifactId);
    expect(await t.run((ctx) => ctx.db.get(reserved.artifactId))).toMatchObject(
      {
        redactionStatus: "redacted",
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
      },
    );
  });

  it("selects a repository-scoped model key and records only encrypted analysis metadata", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "analysis-alpha", "alice"),
      beta = await seedTenant(t, "analysis-beta", "bob"),
      now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const contextArtifactId = await ctx.db.insert("artifacts", {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
        type: "repository_snapshot",
        storageKey: `artifacts/${alpha.organizationId}/${alpha.repositoryId}/${alpha.reviewId}/context/context-0.json`,
        encrypted: true,
        checksum: "a".repeat(64),
        size: 100,
        redactionStatus: "redacted",
        expiresAt: now + 60_000,
        deletionAttempts: 0,
      });
      await ctx.db.insert("artifacts", {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
        type: "command_output",
        storageKey: `artifacts/${alpha.organizationId}/${alpha.repositoryId}/${alpha.reviewId}/validation/validation.json`,
        encrypted: true,
        checksum: "f".repeat(64),
        size: 100,
        redactionStatus: "redacted",
        expiresAt: now + 60_000,
        deletionAttempts: 0,
      });
      const credentialId = await ctx.db.insert("providerCredentials", {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        credentialScopeId: "repository-credential",
        provider: "anthropic",
        encryptedCiphertext: "repo-ciphertext",
        nonce: "nonce",
        authTag: "tag",
        aadDigest: "b".repeat(64),
        wrappedDataKey: "wrapped",
        kmsKeyId: "kms-test",
        envelopeVersion: 1,
        keyVersion: 1,
        maskedSuffix: "9999",
        status: "valid",
        createdBy: "alice",
        createdAt: now,
        lastValidatedAt: now,
      });
      return { credentialId, contextArtifactId };
    });
    const args = {
      organizationId: alpha.organizationId,
      reviewId: alpha.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
    };
    const scope = await t.query(internal.reviewModelData.analysisScope, args);
    expect(scope.credential).toMatchObject({
      id: "repository-credential",
      ciphertext: "repo-ciphertext",
      repositoryId: alpha.repositoryId,
    });
    await expect(
      t.query(internal.reviewModelData.analysisScope, {
        ...args,
        organizationId: beta.organizationId,
      }),
    ).rejects.toThrow("parent_scope_mismatch");
    const checksum = "c".repeat(64),
      reserved = await t.mutation(internal.reviewModelData.reserveOutput, {
        ...args,
        checksum,
        size: 200,
        now,
      }),
      analysisResults = {
        requirements: [
          {
            externalIdHash: "1".repeat(64),
            sourceUrlHash: "2".repeat(64),
            status: "resolved" as const,
            confidence: 0.9,
          },
        ],
        findings: [
          {
            fingerprintHmac: "3".repeat(64),
            pathHmac: "4".repeat(64),
            category: "correctness" as const,
            severity: "high" as const,
            confidence: 0.8,
            blocking: true,
            evidenceIds: [seeded.contextArtifactId],
            startLine: 1,
            endLine: 2,
            requirementExternalIdHash: "1".repeat(64),
            resolution: "open" as const,
          },
        ],
      };
    await expect(
      t.mutation(internal.reviewModelData.completeAnalysis, {
        ...args,
        organizationId: beta.organizationId,
        artifactId: reserved.artifactId,
        checksum,
        size: 200,
        credentialId: seeded.credentialId,
        inputTokens: 10,
        outputTokens: 2,
        ...analysisResults,
        now,
      }),
    ).rejects.toThrow("parent_scope_mismatch");
    await expect(
      t.mutation(internal.reviewModelData.completeAnalysis, {
        ...args,
        artifactId: reserved.artifactId,
        checksum,
        size: 200,
        credentialId: seeded.credentialId,
        inputTokens: 10,
        outputTokens: 2,
        ...analysisResults,
        now,
      }),
    ).resolves.toBe(reserved.artifactId);
    await expect(
      t.mutation(internal.reviewModelData.completeAnalysis, {
        ...args,
        artifactId: reserved.artifactId,
        checksum,
        size: 200,
        credentialId: seeded.credentialId,
        inputTokens: 10,
        outputTokens: 2,
        ...analysisResults,
        now: now + 1,
      }),
    ).resolves.toBe(reserved.artifactId);
    const stored = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(reserved.artifactId),
      credential: await ctx.db.get(seeded.credentialId),
      usage: await ctx.db
        .query("usageLedger")
        .withIndex("by_review", (q) => q.eq("reviewId", alpha.reviewId))
        .collect(),
      requirements: await ctx.db
        .query("requirements")
        .withIndex("by_review", (q) => q.eq("reviewId", alpha.reviewId))
        .collect(),
      findings: await ctx.db
        .query("findings")
        .withIndex("by_review_severity", (q) =>
          q.eq("reviewId", alpha.reviewId).eq("severity", "high"),
        )
        .collect(),
    }));
    expect(stored.artifact).toMatchObject({
      redactionStatus: "redacted",
      checksum,
      size: 200,
    });
    expect(stored.credential).toMatchObject({ lastUsedAt: now });
    expect(stored.usage).toEqual([
      expect.objectContaining({
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
        kind: "model_tokens",
        quantity: 12,
      }),
    ]);
    expect(stored.requirements).toHaveLength(1);
    expect(stored.findings).toHaveLength(1);
    expect(stored.findings[0]).toMatchObject({
      blocking: true,
      resolution: "open",
      contentArtifactId: reserved.artifactId,
      evidenceIds: [seeded.contextArtifactId],
    });
    expect(JSON.stringify(stored.usage)).not.toContain("ciphertext");
  });

  it("keeps review filters separate for repositories with the same name", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const second = await t.run(async (ctx) => {
      const now = Date.now();
      const repositoryId = await ctx.db.insert("repositories", {
        organizationId: alpha.organizationId,
        installationId: alpha.installationId,
        githubRepositoryId: 100,
        owner: "alpha",
        name: "fixture",
        defaultBranch: "main",
        enabled: true,
        autofixMode: "stacked",
        forkPolicy: "manual_review_only",
        indexState: "ready",
        concurrencyLimit: 1,
        createdAt: now,
        updatedAt: now,
      });
      const original = await ctx.db.get(alpha.reviewId);
      if (!original) throw new Error("missing fixture");
      const { _id: _id, _creationTime: _creationTime, ...copy } = original;
      const reviewId = await ctx.db.insert("reviews", {
        ...copy,
        repositoryId,
        githubRepositoryId: 100,
        prNumber: 2,
      });
      return { repositoryId, reviewId };
    });
    const asAlice = t.withIdentity({ subject: "alice" });
    const first = await asAlice.query(api.reviews.list, {
      organizationId: alpha.organizationId,
      repositoryId: alpha.repositoryId,
    });
    const secondOnly = await asAlice.query(api.reviews.list, {
      organizationId: alpha.organizationId,
      repositoryId: second.repositoryId,
    });
    expect(first.map((review) => review.id)).toEqual([alpha.reviewId]);
    expect(secondOnly.map((review) => review.id)).toEqual([second.reviewId]);
  });

  it("rejects a repository attached to an installation from another organization", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "bob");
    await t.run((ctx) =>
      ctx.db.patch(alpha.repositoryId, { installationId: beta.installationId }),
    );
    await expect(
      t.withIdentity({ subject: "alice" }).query(api.reviews.list, {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
  });

  it("keeps identical base-result cache inputs separate by repository", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "alice");
    const ids = await t.run(async (ctx) => {
      const common = {
        baseSha: "b".repeat(40),
        commandFingerprint: "same-command",
        runnerImageVersion: "runner-1",
        toolVersions: [],
        architecture: "amd64",
        networkPolicyVersion: "network-1",
        conclusion: "passed" as const,
        computedAt: 1,
        expiresAt: 10,
      };
      const alphaReview = await ctx.db.get(alpha.reviewId);
      const betaReview = await ctx.db.get(beta.reviewId);
      if (!alphaReview || !betaReview) throw new Error("missing fixture");
      const first = await ctx.db.insert("baseResults", {
        ...common,
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        configRevisionId: alphaReview.configRevisionId,
      });
      const second = await ctx.db.insert("baseResults", {
        ...common,
        organizationId: beta.organizationId,
        repositoryId: beta.repositoryId,
        configRevisionId: betaReview.configRevisionId,
      });
      const alphaHit = await ctx.db
        .query("baseResults")
        .withIndex("by_full_cache_key", (q) =>
          q
            .eq("repositoryId", alpha.repositoryId)
            .eq("baseSha", common.baseSha)
            .eq("commandFingerprint", common.commandFingerprint)
            .eq("configRevisionId", alphaReview.configRevisionId)
            .eq("runnerImageVersion", common.runnerImageVersion)
            .eq("architecture", common.architecture)
            .eq("networkPolicyVersion", common.networkPolicyVersion),
        )
        .unique();
      return { first, second, alphaHit: alphaHit?._id };
    });
    expect(ids.first).not.toBe(ids.second);
    expect(ids.alphaHit).toBe(ids.first);
  });

  it("scopes metric aggregation to validated repository and review parents", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const beta = await seedTenant(t, "beta", "bob");
    await t.run(async (ctx) => {
      await ctx.db.insert("metricEvents", {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        reviewId: alpha.reviewId,
        name: "review_completed",
        value: 1,
        organizationTimezone: "Asia/Kolkata",
        occurredAt: 2,
      });
    });
    const asAlice = t.withIdentity({ subject: "alice" });
    expect(
      await asAlice.query(api.metrics.summarize, {
        organizationId: alpha.organizationId,
        since: 0,
      }),
    ).toEqual({ review_completed: 1 });
    await expect(
      asAlice.query(api.metrics.summarize, {
        organizationId: beta.organizationId,
        since: 0,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    await t.run((ctx) =>
      ctx.db.insert("metricEvents", {
        organizationId: alpha.organizationId,
        repositoryId: beta.repositoryId,
        reviewId: beta.reviewId,
        name: "review_completed",
        value: 99,
        organizationTimezone: "Asia/Kolkata",
        occurredAt: 3,
      }),
    );
    await expect(
      asAlice.query(api.metrics.summarize, {
        organizationId: alpha.organizationId,
        since: 0,
      }),
    ).rejects.toThrow("not_found_or_forbidden");
  });
});

describe("audited membership administration", () => {
  async function seedMembershipWorkspace(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const memberId = await ctx.db.insert("users", { name: "Member" });
      const outsiderId = await ctx.db.insert("users", { name: "Outsider" });
      const organizationId = await ctx.db.insert("organizations", {
        name: "Acme",
        slug: "acme-members",
        timezone: "Asia/Kolkata",
        region: "eu-west-1",
        retentionHours: 24,
        monthlyBudget: 100,
        concurrencyLimit: 2,
        planId: "test",
        fingerprintKeyVersion: 1,
        createdAt: now,
      });
      const ownerMembershipId = await ctx.db.insert("memberships", {
        organizationId,
        userId: ownerId,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("userProfiles", {
        userId: ownerId,
        githubUserId: 1,
        githubLogin: "owner",
        lastAuthenticatedAt: now,
        updatedAt: now,
      });
      return {
        now,
        ownerId,
        memberId,
        outsiderId,
        organizationId,
        ownerMembershipId,
      };
    });
  }

  it("invites the intended user, requires their acceptance, and chains audit records", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedMembershipWorkspace(t);
    const owner = t.withIdentity({
      subject: `${seeded.ownerId}|owner-session`,
    });
    const membershipId = await owner.mutation(api.memberships.invite, {
      organizationId: seeded.organizationId,
      targetUserId: seeded.memberId,
      role: "developer",
      requestId: "membership-invite-0001",
    });
    await expect(
      t
        .withIdentity({ subject: `${seeded.outsiderId}|outsider-session` })
        .mutation(api.memberships.accept, {
          organizationId: seeded.organizationId,
          requestId: "membership-accept-wrong",
        }),
    ).rejects.toThrow("invitation_not_found");
    await t
      .withIdentity({ subject: `${seeded.memberId}|member-session` })
      .mutation(api.memberships.accept, {
        organizationId: seeded.organizationId,
        requestId: "membership-accept-0001",
      });
    expect(await t.run((ctx) => ctx.db.get(membershipId))).toMatchObject({
      role: "developer",
      status: "active",
    });
    const events = await t.run((ctx) =>
      ctx.db
        .query("auditEvents")
        .withIndex("by_org_created", (q) =>
          q.eq("organizationId", seeded.organizationId),
        )
        .collect(),
    );
    expect(events.map((event) => event.action)).toEqual([
      "membership.invited",
      "membership.accepted",
    ]);
    expect(events[1].previousHash).toBe(events[0].eventHash);
    expect(events[0].resourceIdHash).not.toContain(membershipId);
  });

  it("requires recent GitHub authentication and preserves the final owner", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedMembershipWorkspace(t);
    const owner = t.withIdentity({
      subject: `${seeded.ownerId}|owner-session`,
    });
    await expect(
      owner.mutation(api.memberships.changeRole, {
        organizationId: seeded.organizationId,
        membershipId: seeded.ownerMembershipId,
        role: "admin",
        requestId: "membership-demote-0001",
      }),
    ).rejects.toThrow("last_owner_required");
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("userProfiles")
        .withIndex("by_user", (q) => q.eq("userId", seeded.ownerId))
        .unique();
      await ctx.db.patch(profile!._id, {
        lastAuthenticatedAt: seeded.now - 11 * 60 * 1000,
      });
    });
    await expect(
      owner.mutation(api.memberships.invite, {
        organizationId: seeded.organizationId,
        targetUserId: seeded.memberId,
        role: "viewer",
        requestId: "membership-stale-0001",
      }),
    ).rejects.toThrow("recent_reauthentication_required");
  });

  it("prevents an administrator from granting admin or owner access", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedMembershipWorkspace(t);
    const adminMembershipId = await t.run(async (ctx) => {
      await ctx.db.insert("userProfiles", {
        userId: seeded.memberId,
        githubUserId: 2,
        githubLogin: "admin",
        lastAuthenticatedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return ctx.db.insert("memberships", {
        organizationId: seeded.organizationId,
        userId: seeded.memberId,
        role: "admin",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const admin = t.withIdentity({
      subject: `${seeded.memberId}|admin-session`,
    });
    await expect(
      admin.mutation(api.memberships.changeRole, {
        organizationId: seeded.organizationId,
        membershipId: adminMembershipId,
        role: "owner",
        requestId: "membership-escalate-01",
      }),
    ).rejects.toThrow("not_found_or_forbidden");
    await expect(
      admin.mutation(api.memberships.invite, {
        organizationId: seeded.organizationId,
        targetUserId: seeded.outsiderId,
        role: "admin",
        requestId: "membership-escalate-02",
      }),
    ).rejects.toThrow("not_found_or_forbidden");
  });
});

describe("Convex review state integrity", () => {
  it("replays a persisted workflow checkpoint idempotently", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const args = {
      organizationId: seeded.organizationId,
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      stage: "context" as const,
      sequence: 1,
      now: 2,
    };
    const first = await t.mutation(internal.durableReview.checkpoint, args);
    const replay = await t.mutation(internal.durableReview.checkpoint, {
      ...args,
      now: 3,
    });
    expect(replay).toBe(first);
    const events = await t.run((ctx) => ctx.db.query("reviewEvents").collect());
    expect(events).toHaveLength(1);
  });

  it("preserves terminal status while allowing an independent stale marker", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      to: "gathering_context",
      nextActionCode: "none",
      now: 2,
    });
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      to: "analyzing",
      nextActionCode: "none",
      now: 3,
    });
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      to: "validating",
      nextActionCode: "none",
      now: 4,
    });
    await t.mutation(internal.reviewState.transition, {
      reviewId: seeded.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      to: "checks_passed",
      statusReasonCode: "checks_complete",
      nextActionCode: "none",
      now: 5,
    });
    await expect(
      t.mutation(internal.reviewState.transition, {
        reviewId: seeded.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        to: "analyzing",
        nextActionCode: "none",
        now: 6,
      }),
    ).rejects.toThrow("invalid_transition");
    await t.mutation(internal.reviewState.markStale, {
      reviewId: seeded.reviewId,
      observedHeadSha: "c".repeat(40),
      now: 7,
    });
    const stored = await t.run((ctx) => ctx.db.get(seeded.reviewId));
    expect(stored).toMatchObject({
      status: "checks_passed",
      isStale: true,
      observedHeadSha: "c".repeat(40),
    });
  });

  it("fences a worker immediately when cancellation is requested", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const lease = await t.mutation(internal.reviewState.acquireLease, {
      reviewId: seeded.reviewId,
      workerId: "worker-1",
      now: 1,
      leaseMs: 100,
    });
    expect(lease.generation).toBe(0);
    await t.mutation(internal.reviewState.requestCancellation, {
      reviewId: seeded.reviewId,
      actorId: "alice",
      now: 2,
    });
    expect(await t.run((ctx) => ctx.db.get(seeded.reviewId))).toMatchObject({
      status: "cancelled",
      statusReasonCode: "user_cancelled",
      completedAt: 2,
      executionGeneration: 1,
    });
    await expect(
      t.mutation(internal.reviewState.transition, {
        reviewId: seeded.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        to: "gathering_context",
        nextActionCode: "none",
        now: 3,
      }),
    ).rejects.toThrow("cancelled_or_replaced");
  });

  it("resolves cancellation targets only inside the verified repository and pull request", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "cancel-alpha", "alice");
    const beta = await seedTenant(t, "cancel-beta", "bob");
    const targets = await t.query(
      internal.githubWebhookData.cancellationTargets,
      {
        organizationId: alpha.organizationId,
        repositoryId: alpha.repositoryId,
        prNumber: 1,
      },
    );
    expect(targets.map((target) => target.reviewId)).toEqual([alpha.reviewId]);
    await expect(
      t.query(internal.githubWebhookData.cancellationTargets, {
        organizationId: alpha.organizationId,
        repositoryId: beta.repositoryId,
        prNumber: 1,
      }),
    ).rejects.toThrow("repository_unavailable");
    expect(targets.map((target) => target.reviewId)).not.toContain(
      beta.reviewId,
    );
  });

  it("enforces append-only event sequence numbers", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    await t.mutation(internal.reviewState.appendEvent, {
      organizationId: seeded.organizationId,
      reviewId: seeded.reviewId,
      sequence: 1,
      type: "review_created",
      stage: "queue",
      internalCode: "created",
      now: 1,
    });
    await expect(
      t.mutation(internal.reviewState.appendEvent, {
        organizationId: seeded.organizationId,
        reviewId: seeded.reviewId,
        sequence: 3,
        type: "stage_started",
        stage: "context",
        internalCode: "context",
        now: 2,
      }),
    ).rejects.toThrow("invalid_event_sequence");
  });

  it("allows only one active review per repository, PR, head, and mode", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const duplicateReviewId = await t.run(async (ctx) => {
      const original = await ctx.db.get(seeded.reviewId);
      if (!original) throw new Error("missing fixture");
      const {
        _id: _ignoredId,
        _creationTime: _ignoredTime,
        ...copy
      } = original;
      return ctx.db.insert("reviews", copy);
    });
    await t.mutation(internal.reviewState.claimActiveReview, {
      reviewId: seeded.reviewId,
      now: 1,
    });
    await expect(
      t.mutation(internal.reviewState.claimActiveReview, {
        reviewId: duplicateReviewId,
        now: 2,
      }),
    ).rejects.toThrow("active_review_exists");
  });

  it("deduplicates identical side effects and rejects key reuse with new content", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    const args = {
      organizationId: seeded.organizationId,
      reviewId: seeded.reviewId,
      operationKey: "review:summary",
      type: "comment_update" as const,
      requestHash: "hash-1",
      now: 1,
    };
    const first = await t.mutation(
      internal.reviewState.reserveSideEffect,
      args,
    );
    const replay = await t.mutation(internal.reviewState.reserveSideEffect, {
      ...args,
      now: 2,
    });
    expect(replay).toBe(first);
    await expect(
      t.mutation(internal.reviewState.reserveSideEffect, {
        ...args,
        requestHash: "hash-2",
        now: 3,
      }),
    ).rejects.toThrow("idempotency_key_conflict");
  });

  it("completes a side effect only inside its review and tenant", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "effect-alpha", "alice"),
      beta = await seedTenant(t, "effect-beta", "bob"),
      requestHash = "e".repeat(64),
      sideEffectId = await t.mutation(internal.reviewState.reserveSideEffect, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        operationKey: "effect-alpha",
        type: "check_update",
        requestHash,
        now: 1,
      }),
      base = {
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        sideEffectId,
        requestHash,
        externalId: "99",
        status: "completed" as const,
        now: 2,
      };
    await expect(
      t.mutation(internal.reviewPublicationData.completeSideEffect, {
        ...base,
        organizationId: beta.organizationId,
      }),
    ).rejects.toThrow("parent_scope_mismatch");
    await expect(
      t.mutation(internal.reviewPublicationData.completeSideEffect, {
        ...base,
        organizationId: alpha.organizationId,
      }),
    ).resolves.toBe(sideEffectId);
    await expect(
      t.mutation(internal.reviewPublicationData.completeSideEffect, {
        ...base,
        organizationId: alpha.organizationId,
        externalId: "100",
        now: 3,
      }),
    ).rejects.toThrow("side_effect_completion_conflict");
  });

  it("allows identical idempotency labels in different repositories without collision", async () => {
    const t = convexTest(schema, modules);
    const alpha = await seedTenant(t, "alpha", "alice");
    const secondReviewId = await t.run(async (ctx) => {
      const original = await ctx.db.get(alpha.reviewId);
      if (!original) throw new Error("missing fixture");
      const repository = await ctx.db.get(alpha.repositoryId);
      if (!repository) throw new Error("missing repository");
      const {
        _id: _repoId,
        _creationTime: _repoTime,
        ...repoCopy
      } = repository;
      const repositoryId = await ctx.db.insert("repositories", {
        ...repoCopy,
        githubRepositoryId: 101,
        name: "second",
      });
      const {
        _id: _reviewId,
        _creationTime: _reviewTime,
        ...reviewCopy
      } = original;
      return ctx.db.insert("reviews", {
        ...reviewCopy,
        repositoryId,
        githubRepositoryId: 101,
        prNumber: 3,
      });
    });
    const common = {
      organizationId: alpha.organizationId,
      operationKey: "review:summary",
      type: "comment_update" as const,
      requestHash: "hash",
      now: 1,
    };
    const first = await t.mutation(internal.reviewState.reserveSideEffect, {
      ...common,
      reviewId: alpha.reviewId,
    });
    const second = await t.mutation(internal.reviewState.reserveSideEffect, {
      ...common,
      reviewId: secondReviewId,
    });
    expect(second).not.toBe(first);
  });

  it("counts applied patches and validated rounds independently within hard bounds", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTenant(t, "alpha", "alice");
    await t.run((ctx) =>
      ctx.db.patch(seeded.reviewId, {
        mode: "autofix",
        status: "autofix_queued",
      }),
    );
    const attemptId = await t.mutation(
      internal.reviewState.recordAutofixAttempt,
      {
        organizationId: seeded.organizationId,
        reviewId: seeded.reviewId,
        attemptNumber: 1,
        patchFingerprint: "patch-1",
        outcome: "applied",
        promptVersion: "test",
        startedAt: 1,
        completedAt: 2,
      },
    );
    await expect(
      t.mutation(internal.reviewState.recordAutofixRound, {
        organizationId: seeded.organizationId,
        reviewId: seeded.reviewId,
        roundNumber: 1,
        attemptId,
        candidateCommitSha: "d".repeat(40),
        validationScope: "affected_subset",
        validationOutcome: "passed",
        completedValidation: false,
        startedAt: 2,
      }),
    ).rejects.toThrow("round_requires_validation");
    await t.mutation(internal.reviewState.recordAutofixRound, {
      organizationId: seeded.organizationId,
      reviewId: seeded.reviewId,
      roundNumber: 1,
      attemptId,
      candidateCommitSha: "d".repeat(40),
      validationScope: "affected_subset",
      validationOutcome: "passed",
      completedValidation: true,
      startedAt: 2,
      completedAt: 3,
    });
    await expect(
      t.mutation(internal.reviewState.recordAutofixAttempt, {
        organizationId: seeded.organizationId,
        reviewId: seeded.reviewId,
        attemptNumber: 7,
        patchFingerprint: "patch-7",
        outcome: "empty",
        promptVersion: "test",
        startedAt: 4,
      }),
    ).rejects.toThrow("attempt_out_of_bounds");
  });
});

describe("durable validation evidence", () => {
  it("persists encrypted base/head summaries once and keeps source output in the artifact", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "validation", "alice"),
      now = Date.now(),
      checksum = "c".repeat(64),
      artifactId = await t.run((ctx) =>
        ctx.db.insert("artifacts", {
          organizationId: tenant.organizationId,
          repositoryId: tenant.repositoryId,
          reviewId: tenant.reviewId,
          type: "command_output",
          storageKey: `artifacts/${tenant.organizationId}/${tenant.repositoryId}/${tenant.reviewId}/validation-output/validation.json`,
          encrypted: true,
          checksum,
          size: 100,
          redactionStatus: "pending",
          expiresAt: now + 60_000,
          deletionAttempts: 0,
        }),
      ),
      common = {
        planId: "test",
        kind: "test" as const,
        required: true,
        conclusion: "passed" as const,
        durationMs: 5,
        commandFingerprint: "d".repeat(64),
        nameHash: "e".repeat(64),
      },
      args = {
        organizationId: tenant.organizationId,
        reviewId: tenant.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        artifactId,
        checksum,
        size: 100,
        summaries: [
          { ...common, revision: "base" as const, commitSha: "b".repeat(40) },
          { ...common, revision: "head" as const, commitSha: "a".repeat(40) },
        ],
        manager: "npm" as const,
        now,
      };
    await t.mutation(internal.reviewValidationData.completeValidation, args);
    await expect(
      t.mutation(internal.reviewValidationData.completeValidation, {
        ...args,
        now: now + 1,
      }),
    ).resolves.toBe(artifactId);
    const stored = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(artifactId),
      checks: await ctx.db
        .query("checkRuns")
        .withIndex("by_review", (q) => q.eq("reviewId", tenant.reviewId))
        .collect(),
      base: await ctx.db.query("baseResults").collect(),
      usage: await ctx.db.query("usageLedger").collect(),
    }));
    expect(stored.artifact?.redactionStatus).toBe("redacted");
    expect(stored.checks).toHaveLength(2);
    expect(stored.base).toHaveLength(1);
    expect(
      stored.usage.filter((item) => item.kind === "sandbox_seconds"),
    ).toHaveLength(1);
  });
  it("derives a ready decision only from complete head evidence", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "decision", "alice"),
      now = Date.now(),
      { artifactId, reportArtifactId } = await t.run(async (ctx) => {
        await ctx.db.patch(tenant.reviewId, {
          coverageLevel: "full",
          status: "validating",
          currentStage: "analysis",
        });
        const artifactId = await ctx.db.insert("artifacts", {
          organizationId: tenant.organizationId,
          repositoryId: tenant.repositoryId,
          reviewId: tenant.reviewId,
          type: "command_output",
          storageKey: "decision/validation.json",
          encrypted: true,
          checksum: "a".repeat(64),
          size: 10,
          redactionStatus: "redacted",
          expiresAt: now + 60_000,
          deletionAttempts: 0,
        });
        const reportArtifactId = await ctx.db.insert("artifacts", {
          organizationId: tenant.organizationId,
          repositoryId: tenant.repositoryId,
          reviewId: tenant.reviewId,
          type: "review_message",
          storageKey: "decision/report.md",
          encrypted: true,
          checksum: "d".repeat(64),
          size: 10,
          redactionStatus: "redacted",
          expiresAt: now + 60_000,
          deletionAttempts: 0,
        });
        return { artifactId, reportArtifactId };
      });
    await t.run((ctx) =>
      ctx.db.insert("checkRuns", {
        organizationId: tenant.organizationId,
        reviewId: tenant.reviewId,
        kind: "test",
        nameHash: "b".repeat(64),
        required: true,
        status: "completed",
        conclusion: "passed",
        commandFingerprint: "c".repeat(64),
        commitSha: "a".repeat(40),
        exitCode: 0,
        durationMs: 1,
        artifactId,
        startedAt: now - 1,
        completedAt: now,
      }),
    );
    const args = {
      organizationId: tenant.organizationId,
      reviewId: tenant.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      reportArtifactId,
      now,
    };
    await expect(
      t.mutation(internal.reviewValidationData.finalizeDecision, args),
    ).resolves.toMatchObject({
      status: "checks_passed",
      statusReasonCode: "checks_complete",
    });
    await expect(
      t.mutation(internal.reviewValidationData.finalizeDecision, {
        ...args,
        now: now + 1,
      }),
    ).resolves.toMatchObject({ status: "checks_passed" });
    const events = await t.run((ctx) => ctx.db.query("metricEvents").collect());
    expect(events).toHaveLength(1);
    const reviewEvent = await t.run((ctx) =>
      ctx.db
        .query("reviewEvents")
        .withIndex("by_review", (q) => q.eq("reviewId", tenant.reviewId))
        .filter((q) => q.eq(q.field("sequence"), 5))
        .unique(),
    );
    expect(reviewEvent?.publicMessageArtifactId).toBe(reportArtifactId);
  });

  it("rejects another tenant's final report artifact", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "report-alpha", "alice"),
      beta = await seedTenant(t, "report-beta", "bob"),
      now = Date.now(),
      foreignReportId = await t.run((ctx) =>
        ctx.db.insert("artifacts", {
          organizationId: beta.organizationId,
          repositoryId: beta.repositoryId,
          reviewId: beta.reviewId,
          type: "review_message",
          storageKey: "report-beta/report.md",
          encrypted: true,
          checksum: "d".repeat(64),
          size: 10,
          redactionStatus: "redacted",
          expiresAt: now + 60_000,
          deletionAttempts: 0,
        }),
      );
    await t.run((ctx) =>
      ctx.db.patch(alpha.reviewId, {
        coverageLevel: "full",
        status: "validating",
        currentStage: "analysis",
      }),
    );
    await expect(
      t.mutation(internal.reviewValidationData.finalizeDecision, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        reportArtifactId: foreignReportId,
        now,
      }),
    ).rejects.toThrow("report_artifact_mismatch");
  });
  it("rejects a validation artifact or commit from another tenant or revision", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "validation-alpha", "alice"),
      beta = await seedTenant(t, "validation-beta", "bob"),
      now = Date.now(),
      checksum = "c".repeat(64),
      artifactId = await t.run((ctx) =>
        ctx.db.insert("artifacts", {
          organizationId: beta.organizationId,
          repositoryId: beta.repositoryId,
          reviewId: beta.reviewId,
          type: "command_output",
          storageKey: "beta/validation.json",
          encrypted: true,
          checksum,
          size: 100,
          redactionStatus: "pending",
          expiresAt: now + 60_000,
          deletionAttempts: 0,
        }),
      ),
      summary = {
        revision: "head" as const,
        commitSha: "f".repeat(40),
        planId: "test",
        kind: "test" as const,
        required: true,
        conclusion: "passed" as const,
        durationMs: 1,
        commandFingerprint: "d".repeat(64),
        nameHash: "e".repeat(64),
      };
    await expect(
      t.mutation(internal.reviewValidationData.completeValidation, {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        artifactId,
        checksum,
        size: 100,
        summaries: [summary],
        manager: "npm",
        now,
      }),
    ).rejects.toThrow(
      /validation_artifact_mismatch|validation_summary_invalid/,
    );
  });
});

describe("durable Autofix evidence", () => {
  it("records one exact candidate round idempotently and rejects foreign artifacts", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "autofix-alpha", "alice"),
      beta = await seedTenant(t, "autofix-beta", "bob"),
      now = Date.now(),
      { patchArtifactId, validationArtifactId } = await t.run(async (ctx) => {
        await ctx.db.patch(alpha.reviewId, {
          mode: "autofix",
          status: "validating",
          currentStage: "analysis",
        });
        const patchArtifactId = await ctx.db.insert("artifacts", {
            organizationId: alpha.organizationId,
            repositoryId: alpha.repositoryId,
            reviewId: alpha.reviewId,
            type: "patch",
            storageKey: "autofix-alpha/autofix-1-candidate-0.json",
            encrypted: true,
            checksum: "a".repeat(64),
            size: 10,
            redactionStatus: "redacted",
            expiresAt: now + 60_000,
            deletionAttempts: 0,
          }),
          validationArtifactId = await ctx.db.insert("artifacts", {
            organizationId: alpha.organizationId,
            repositoryId: alpha.repositoryId,
            reviewId: alpha.reviewId,
            type: "command_output",
            storageKey: "autofix-alpha/autofix-1-validation.json",
            encrypted: true,
            checksum: "b".repeat(64),
            size: 10,
            redactionStatus: "redacted",
            expiresAt: now + 60_000,
            deletionAttempts: 0,
          });
        return { patchArtifactId, validationArtifactId };
      }),
      summary = {
        commitSha: "c".repeat(40),
        planId: "test",
        kind: "test" as const,
        required: true,
        conclusion: "passed" as const,
        exitCode: 0,
        durationMs: 1,
        commandFingerprint: "d".repeat(64),
        nameHash: "e".repeat(64),
      },
      args = {
        organizationId: alpha.organizationId,
        reviewId: alpha.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        roundNumber: 1,
        candidateCommitSha: "c".repeat(40),
        patchFingerprint: "f".repeat(64),
        patchArtifactId,
        validationArtifactId,
        summaries: [summary],
        outcome: "passed" as const,
        now,
      };
    const roundId = await t.mutation(
      internal.reviewAutofixData.completeRound,
      args,
    );
    await expect(
      t.mutation(internal.reviewAutofixData.completeRound, {
        ...args,
        now: now + 1,
      }),
    ).resolves.toBe(roundId);
    expect(await t.run((ctx) => ctx.db.get(alpha.reviewId))).toMatchObject({
      status: "autofixing",
      completedRoundCount: 1,
      patchAttemptCount: 1,
    });
    const foreign = await t.run((ctx) =>
      ctx.db.insert("artifacts", {
        organizationId: beta.organizationId,
        repositoryId: beta.repositoryId,
        reviewId: beta.reviewId,
        type: "patch",
        storageKey: "foreign",
        encrypted: true,
        checksum: "1".repeat(64),
        size: 1,
        redactionStatus: "redacted",
        expiresAt: now + 60_000,
        deletionAttempts: 0,
      }),
    );
    await expect(
      t.mutation(internal.reviewAutofixData.completeRound, {
        ...args,
        roundNumber: 2,
        patchArtifactId: foreign,
        now: now + 2,
      }),
    ).rejects.toThrow("autofix_round_mismatch");
  });
  it("marks delivery complete only after a passed round, encrypted report, and all four GitHub effects", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "autofix-delivery", "alice"),
      now = Date.now(),
      { patchArtifactId, validationArtifactId, reportArtifactId } = await t.run(
        async (ctx) => {
          await ctx.db.patch(tenant.reviewId, {
            mode: "autofix",
            status: "validating",
            currentStage: "analysis",
          });
          const base = {
            organizationId: tenant.organizationId,
            repositoryId: tenant.repositoryId,
            reviewId: tenant.reviewId,
            encrypted: true as const,
            size: 10,
            redactionStatus: "redacted" as const,
            expiresAt: now + 60_000,
            deletionAttempts: 0,
          };
          return {
            patchArtifactId: await ctx.db.insert("artifacts", {
              ...base,
              type: "patch",
              storageKey: "delivery/autofix-1-candidate-0.json",
              checksum: "a".repeat(64),
            }),
            validationArtifactId: await ctx.db.insert("artifacts", {
              ...base,
              type: "command_output",
              storageKey: "delivery/autofix-1-validation.json",
              checksum: "b".repeat(64),
            }),
            reportArtifactId: await ctx.db.insert("artifacts", {
              ...base,
              type: "review_message",
              storageKey: "delivery/autofix-1-handoff.md",
              checksum: "c".repeat(64),
            }),
          };
        },
      ),
      candidateCommitSha = "d".repeat(40),
      roundArgs = {
        organizationId: tenant.organizationId,
        reviewId: tenant.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        roundNumber: 1,
        candidateCommitSha,
        patchFingerprint: "e".repeat(64),
        patchArtifactId,
        validationArtifactId,
        summaries: [
          {
            commitSha: candidateCommitSha,
            planId: "test",
            kind: "test" as const,
            required: true,
            conclusion: "passed" as const,
            exitCode: 0,
            durationMs: 1,
            commandFingerprint: "f".repeat(64),
            nameHash: "1".repeat(64),
          },
        ],
        outcome: "passed" as const,
        now,
      };
    await t.mutation(internal.reviewAutofixData.completeRound, roundArgs);
    for (const [index, type] of (
      [
        "branch_create",
        "stacked_pr_create",
        "check_update",
        "comment_update",
      ] as const
    ).entries())
      await t.run((ctx) =>
        ctx.db.insert("githubSideEffects", {
          organizationId: tenant.organizationId,
          repositoryId: tenant.repositoryId,
          reviewId: tenant.reviewId,
          operationKey: `delivery-${index}`,
          type,
          requestHash: "2".repeat(64),
          status: "completed",
          externalId: String(index + 1),
          createdAt: now,
          updatedAt: now,
        }),
      );
    const deliveryArgs = {
      organizationId: tenant.organizationId,
      reviewId: tenant.reviewId,
      expectedHeadSha: "a".repeat(40),
      expectedGeneration: 0,
      roundNumber: 1,
      candidateCommitSha,
      reportArtifactId,
      now: now + 1,
    };
    await expect(
      t.mutation(internal.reviewAutofixData.completeDelivery, deliveryArgs),
    ).resolves.toBe(tenant.reviewId);
    await expect(
      t.mutation(internal.reviewAutofixData.completeDelivery, {
        ...deliveryArgs,
        now: now + 2,
      }),
    ).resolves.toBe(tenant.reviewId);
    expect(await t.run((ctx) => ctx.db.get(tenant.reviewId))).toMatchObject({
      status: "delivered",
      nextActionCode: "human_merge",
      githubCheckConclusion: "success",
    });
    expect(
      await t.run((ctx) => ctx.db.query("metricEvents").collect()),
    ).toHaveLength(1);
  });
});

describe("GitHub installation ownership", () => {
  it("rejects a GitHub installation claimed by a different signed-in account", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.githubInstallationsData.attachInstallation, {
        userId: "user-a",
        githubUserId: 10,
        githubLogin: "alice",
        installationId: 20,
        accountLogin: "bob",
        accountId: 11,
        accountType: "user",
        ownershipVerified: true,
        permissions: {
          metadata: "read",
          contents: "read",
          pullRequests: "write",
          issues: "read",
          checks: "write",
        },
        repositories: [],
        now: 1,
      }),
    ).rejects.toThrow("account_installation_mismatch");
  });
  it("creates an isolated workspace and disables repositories removed from the installation", async () => {
    const t = convexTest(schema, modules),
      base = {
        userId: "user-a",
        githubUserId: 10,
        githubLogin: "alice",
        installationId: 20,
        accountLogin: "alice",
        accountId: 10,
        accountType: "user" as const,
        ownershipVerified: true,
        permissions: {
          metadata: "read" as const,
          contents: "read" as const,
          pullRequests: "write" as const,
          issues: "read" as const,
          checks: "write" as const,
        },
        now: 1,
      },
      first = await t.mutation(
        internal.githubInstallationsData.attachInstallation,
        {
          ...base,
          repositories: [
            {
              githubRepositoryId: 100,
              owner: "alice",
              name: "public",
              defaultBranch: "main",
            },
            {
              githubRepositoryId: 101,
              owner: "alice",
              name: "private",
              defaultBranch: "main",
            },
          ],
        },
      );
    expect(first.repositoryCount).toBe(2);
    await t.mutation(internal.githubInstallationsData.attachInstallation, {
      ...base,
      now: 2,
      repositories: [
        {
          githubRepositoryId: 100,
          owner: "alice",
          name: "public-renamed",
          defaultBranch: "trunk",
        },
      ],
    });
    const repositories = await t.run((ctx) =>
        ctx.db.query("repositories").collect(),
      ),
      publicRepo = repositories.find((repo) => repo.githubRepositoryId === 100),
      removed = repositories.find((repo) => repo.githubRepositoryId === 101);
    expect(publicRepo).toMatchObject({
      name: "public-renamed",
      defaultBranch: "trunk",
      enabled: true,
    });
    expect(removed).toMatchObject({ enabled: false, pausedAt: 2 });
    const memberships = await t.run((ctx) =>
      ctx.db.query("memberships").collect(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      userId: "user-a",
      role: "owner",
      status: "active",
    });
  });
  it("creates separate user and organization workspaces only after ownership verification", async () => {
    const t = convexTest(schema, modules),
      base = {
        userId: "user-a",
        githubUserId: 10,
        githubLogin: "alice",
        permissions: {
          metadata: "read" as const,
          contents: "read" as const,
          pullRequests: "write" as const,
          issues: "read" as const,
          checks: "write" as const,
        },
        repositories: [
          {
            githubRepositoryId: 200,
            owner: "acme",
            name: "api",
            defaultBranch: "main",
          },
        ],
        now: 1,
      };
    await expect(
      t.mutation(internal.githubInstallationsData.attachInstallation, {
        ...base,
        installationId: 30,
        accountLogin: "acme",
        accountId: 99,
        accountType: "organization",
        ownershipVerified: false,
      }),
    ).rejects.toThrow("installation_ownership_unverified");
    await t.mutation(internal.githubInstallationsData.attachInstallation, {
      ...base,
      installationId: 30,
      accountLogin: "acme",
      accountId: 99,
      accountType: "organization",
      ownershipVerified: true,
    });
    const organizations = await t.run((ctx) =>
      ctx.db.query("organizations").collect(),
    );
    expect(organizations.map((org) => org.slug)).toContain("github-org-99");
    const installation = await t.run((ctx) =>
      ctx.db
        .query("githubInstallations")
        .withIndex("by_installation", (q) => q.eq("installationId", 30))
        .unique(),
    );
    expect(installation).toMatchObject({
      accountType: "organization",
      accountLogin: "acme",
    });
  });
});

describe("GitHub webhook durability", () => {
  it("deduplicates a delivery before any processor can enqueue twice", async () => {
    const t = convexTest(schema, modules),
      args = {
        deliveryId: "delivery-1",
        event: "issue_comment",
        action: "created",
        installationId: 20,
        disposition: "processed" as const,
        now: 1,
      },
      first = await t.mutation(internal.githubWebhookData.reserve, args),
      duplicate = await t.mutation(internal.githubWebhookData.reserve, {
        ...args,
        now: 2,
      });
    expect(first.duplicate).toBe(false);
    expect(duplicate).toEqual({ duplicate: true, id: first.id });
    expect(
      await t.run((ctx) => ctx.db.query("webhookDeliveries").collect()),
    ).toHaveLength(1);
  });
  it("pins one exact PR snapshot on a reserved command delivery", async () => {
    const t = convexTest(schema, modules),
      reserved = await t.mutation(internal.githubWebhookData.reserve, {
        deliveryId: "delivery-snapshot",
        event: "issue_comment",
        action: "created",
        installationId: 20,
        disposition: "processed",
        now: 1,
      }),
      refs = { headRefHash: "c".repeat(64), baseRefHash: "d".repeat(64) };
    await expect(
      t.mutation(internal.githubWebhookData.recordPinnedSnapshot, {
        deliveryId: "delivery-snapshot",
        prNumber: 7,
        headSha: "A".repeat(40),
        baseSha: "B".repeat(40),
        ...refs,
        isFork: false,
        triggerVerb: "review",
      }),
    ).resolves.toEqual(reserved.id);
    expect(await t.run((ctx) => ctx.db.get(reserved.id))).toMatchObject({
      prNumber: 7,
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      ...refs,
      isFork: false,
      triggerVerb: "review",
      status: "received",
    });
    await t.mutation(internal.githubWebhookData.complete, {
      deliveryId: "delivery-snapshot",
      disposition: "processed",
      status: "enqueued",
      now: 2,
    });
    await expect(
      t.mutation(internal.githubWebhookData.recordPinnedSnapshot, {
        deliveryId: "delivery-snapshot",
        prNumber: 7,
        headSha: "c".repeat(40),
        baseSha: "b".repeat(40),
        ...refs,
        isFork: false,
        triggerVerb: "review",
      }),
    ).rejects.toThrow("delivery_not_reservable");
  });
  it("materializes a pinned command into exactly one tenant-scoped review", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "materialize", "alice"),
      delivery = await t.mutation(internal.githubWebhookData.reserve, {
        deliveryId: "delivery-review",
        event: "issue_comment",
        action: "created",
        installationId: 20,
        disposition: "processed",
        now: 1,
      }),
      snapshot = {
        deliveryId: "delivery-review",
        prNumber: 7,
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40),
        headRefHash: "c".repeat(64),
        baseRefHash: "d".repeat(64),
        isFork: false,
        triggerVerb: "review" as const,
      };
    await t.mutation(internal.githubWebhookData.recordPinnedSnapshot, snapshot);
    const args = {
        deliveryId: "delivery-review",
        organizationId: tenant.organizationId,
        repositoryId: tenant.repositoryId,
        baseRef: "main",
        triggerActor: "e".repeat(64),
        actorPermission: "admin" as const,
        now: 2,
      },
      created = await t.mutation(
        internal.githubWebhookData.materializeReview,
        args,
      );
    expect(created).toMatchObject({
      status: "queued",
      headSha: "a".repeat(40),
      executionGeneration: 0,
    });
    expect(await t.run((ctx) => ctx.db.get(created.reviewId))).toMatchObject({
      organizationId: tenant.organizationId,
      repositoryId: tenant.repositoryId,
      prNumber: 7,
      headSha: "a".repeat(40),
      status: "queued",
      trigger: "github_comment",
      triggerActor: "e".repeat(64),
    });
    expect(await t.run((ctx) => ctx.db.get(delivery.id))).toMatchObject({
      reviewId: created.reviewId,
    });
    await expect(
      t.mutation(internal.githubWebhookData.materializeReview, args),
    ).rejects.toThrow("review_request_not_materializable");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reviewLocks")
          .withIndex("by_scope", (q) =>
            q
              .eq("repositoryId", tenant.repositoryId)
              .eq("prNumber", 7)
              .eq("headSha", "a".repeat(40))
              .eq("mode", "review"),
          )
          .collect(),
      ),
    ).toHaveLength(1);
  });
  it("does not start a blocked, stale, or replaced review workflow", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "not-runnable", "alice"),
      base = {
        organizationId: tenant.organizationId,
        reviewId: tenant.reviewId,
        expectedHeadSha: "a".repeat(40),
        expectedGeneration: 0,
        now: 1,
      };
    await t.run((ctx) => ctx.db.patch(tenant.reviewId, { status: "blocked" }));
    await expect(
      t.mutation(internal.durableReview.start, base),
    ).rejects.toThrow("review_not_runnable");
    await t.run((ctx) =>
      ctx.db.patch(tenant.reviewId, { status: "queued", isStale: true }),
    );
    await expect(
      t.mutation(internal.durableReview.start, base),
    ).rejects.toThrow("review_not_runnable");
    await t.run((ctx) =>
      ctx.db.patch(tenant.reviewId, { isStale: false, executionGeneration: 1 }),
    );
    await expect(
      t.mutation(internal.durableReview.start, base),
    ).rejects.toThrow("review_not_runnable");
  });
  it("rejects a repository that does not belong to the webhook installation", async () => {
    const t = convexTest(schema, modules),
      alpha = await seedTenant(t, "alpha", "alice"),
      beta = await seedTenant(t, "beta", "bob"),
      records = await t.run(async (ctx) => ({
        installation: await ctx.db.get(alpha.installationId),
        repository: await ctx.db.get(beta.repositoryId),
      }));
    if (!records.installation || !records.repository)
      throw new Error("missing fixture");
    await expect(
      t.query(internal.githubWebhookData.scope, {
        installationId: records.installation.installationId,
        githubRepositoryId: records.repository.githubRepositoryId,
      }),
    ).rejects.toThrow("repository_unavailable");
  });
  it("marks old PR heads stale and fences active work", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "alpha", "alice"),
      before = await t.run(async (ctx) => ({
        review: await ctx.db.get(tenant.reviewId),
        installation: await ctx.db.get(tenant.installationId),
        repository: await ctx.db.get(tenant.repositoryId),
      }));
    if (!before.review || !before.installation || !before.repository)
      throw new Error("missing fixture");
    const result = await t.mutation(
      internal.githubWebhookData.reconcilePullRequestHead,
      {
        installationId: before.installation.installationId,
        githubRepositoryId: before.repository.githubRepositoryId,
        prNumber: before.review.prNumber,
        observedHeadSha: "c".repeat(40),
        now: 20,
      },
    );
    expect(result).toEqual({ staleCount: 1 });
    const after = await t.run((ctx) => ctx.db.get(tenant.reviewId));
    expect(after).toMatchObject({
      isStale: true,
      observedHeadSha: "c".repeat(40),
      executionGeneration: 1,
    });
    expect(after?.leaseOwner).toBeUndefined();
  });
  it("stales active reviews when their exact default-branch base moves", async () => {
    const t = convexTest(schema, modules),
      tenant = await seedTenant(t, "alpha", "alice"),
      records = await t.run(async (ctx) => ({
        installation: await ctx.db.get(tenant.installationId),
        repository: await ctx.db.get(tenant.repositoryId),
      }));
    if (!records.installation || !records.repository)
      throw new Error("missing fixture");
    const ignored = await t.mutation(
      internal.githubWebhookData.reconcileDefaultBranchPush,
      {
        installationId: records.installation.installationId,
        githubRepositoryId: records.repository.githubRepositoryId,
        ref: "refs/heads/feature",
        afterSha: "d".repeat(40),
        now: 19,
      },
    );
    expect(ignored).toEqual({ staleCount: 0, ignored: true });
    const result = await t.mutation(
      internal.githubWebhookData.reconcileDefaultBranchPush,
      {
        installationId: records.installation.installationId,
        githubRepositoryId: records.repository.githubRepositoryId,
        ref: "refs/heads/main",
        afterSha: "d".repeat(40),
        now: 20,
      },
    );
    expect(result).toEqual({ staleCount: 1, ignored: false });
    const after = await t.run((ctx) => ctx.db.get(tenant.reviewId));
    expect(after).toMatchObject({ isStale: true, executionGeneration: 1 });
    expect(after?.leaseOwner).toBeUndefined();
  });
});
