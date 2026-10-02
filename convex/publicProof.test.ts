/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { publishableAsEvidence } from "./publicProof";

const modules = import.meta.glob("./**/*.ts");

type Proof = {
  generatedAt: number;
  rowCeiling: number;
  reviews: { counted: number; truncated: boolean; byStatus: Record<string, number>; repositoriesReviewed: number };
  findings: { counted: number; truncated: boolean };
  spend: { modelSpendUsd: number; modelTokens: number; counted: number; truncated: boolean };
};
const proofSummary = makeFunctionReference<"query", Record<string, never>, Proof>("publicProof:summary");

type PublicReviews = {
  repositoriesListed: number;
  reviews: Array<{ owner: string; name: string; prNumber: number; status: string; completedAt: number }>;
};
const publicReviews = makeFunctionReference<"query", Record<string, never>, PublicReviews>("publicProof:recentPublicReviews");

// recentPublicReviews is the one unauthenticated function that returns a repository name, so it is
// the one with a disclosure surface - and it had no test at all. Six pull requests from two
// repositories that were private on GitHub were being served from it in production, because its
// gate read `repositories.visibility`, a column written only when access was granted and which no
// code path could correct afterwards. These cases pin the four conditions that replaced it.
const hour = 60 * 60_000;
async function seedEvidenceRepository(
  t: ReturnType<typeof convexTest>,
  slug: string,
  owner: string,
  row: { publishAsEvidence?: boolean; visibility: "public" | "private"; visibilityVerifiedAt?: number },
  now: number,
) {
  return t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { name: slug, slug, timezone: "UTC", region: "eu-west-1",
      retentionHours: 24, monthlyBudget: 100, concurrencyLimit: 2, planId: "test", fingerprintKeyVersion: 1, createdAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: Math.floor(Math.random() * 1_000_000),
      accountLogin: owner, accountType: "user", permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" },
      status: "active", createdAt: now, updatedAt: now });
    const repositoryId = await ctx.db.insert("repositories", { organizationId, installationId,
      githubRepositoryId: Math.floor(Math.random() * 1_000_000), owner, name: `${slug}-repo`, defaultBranch: "main",
      visibility: row.visibility, enabled: true, autofixMode: "stacked", forkPolicy: "manual_review_only",
      indexState: "not_started", concurrencyLimit: 1,
      ...(row.publishAsEvidence === undefined ? {} : { publishAsEvidence: row.publishAsEvidence }),
      ...(row.visibilityVerifiedAt === undefined ? {} : { visibilityVerifiedAt: row.visibilityVerifiedAt }),
      createdAt: now, updatedAt: now });
    const configArtifactId = await ctx.db.insert("artifacts", { organizationId, repositoryId, type: "configuration",
      storageKey: `${slug}/config`, encrypted: true, checksum: "c".repeat(64), size: 1, redactionStatus: "redacted",
      expiresAt: now + hour, deletionAttempts: 0 });
    const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId,
      sourceCommitSha: "b".repeat(40), sourceRef: "main", configArtifactId, contentHash: "d".repeat(64),
      rulesDigest: "d".repeat(64), schemaVersion: "defaults-v1", validationState: "valid", provenance: "defaults_only",
      refProtectionState: "unverified", createdAt: now });
    await ctx.db.insert("reviews", {
      organizationId, repositoryId, githubRepositoryId: 1, prNumber: 7, isFork: false,
      baseRef: "main", baseSha: "b".repeat(40), headSha: "a".repeat(40), requiredCheckPolicy: "advisory",
      completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0, providerRetryCount: 0, commandRetryCount: 0,
      trigger: "dashboard", triggerVerb: "review", triggerActor: "octocat", triggerActorPermission: "admin",
      mode: "review", status: "checks_passed", budgetLimit: 10, budgetConsumed: 0, nextActionCode: "none",
      isStale: false, trustedRef: "main", trustedRefSha: "b".repeat(40), configRevisionId,
      configProvenance: "defaults_only", provider: "anthropic", model: "test-model", modelVersion: "test",
      promptVersion: "test", evalSetVersion: "test", coverageLevel: "limited", currentStage: "complete",
      runnerImageVersion: "test", executionGeneration: 0, queuePriority: 0,
      startedAt: now - 10_000, completedAt: now - 1_000, expiresAt: now + hour, createdAt: now, updatedAt: now,
    });
    return { organizationId, repositoryId };
  });
}

// Deliberately identifiable. Every one of these strings is something a customer would recognise as
// theirs, and the last assertion is that not one of them survives into the response.
const secretish = ["northwind", "contoso", "ledger-service", "octocat", "a".repeat(40), "b".repeat(40)];

type Seeded = { reviews: Array<{ status: string; startedAt?: number; completedAt?: number }>; findings: number; spendMicros: number[] };

async function seedTenant(t: ReturnType<typeof convexTest>, slug: string, repositoryName: string, actor: string, plan: Seeded) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", { name: slug, slug, timezone: "UTC", region: "eu-west-1", retentionHours: 24, monthlyBudget: 100, concurrencyLimit: 2, planId: "test", fingerprintKeyVersion: 1, createdAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: Math.floor(Math.random() * 1_000_000), accountLogin: slug, accountType: "organization", permissionSnapshot: { metadata: "read", contents: "write", pullRequests: "write", issues: "read", checks: "write" }, status: "active", createdAt: now, updatedAt: now });
    const repositoryId = await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: Math.floor(Math.random() * 1_000_000), owner: slug, name: repositoryName, defaultBranch: "main", enabled: true, autofixMode: "stacked", forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1, createdAt: now, updatedAt: now });
    const configArtifactId = await ctx.db.insert("artifacts", { organizationId, repositoryId, type: "configuration", storageKey: `${slug}/config`, encrypted: true, checksum: "hash", size: 1, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
    const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId, sourceCommitSha: "b".repeat(40), sourceRef: "main", configArtifactId, contentHash: "config-hash", rulesDigest: "rules-hash", schemaVersion: "1", validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: now });
    await ctx.db.patch(repositoryId, { configRevisionId });

    let prNumber = 0;
    for (const item of plan.reviews) {
      prNumber += 1;
      const reviewId = await ctx.db.insert("reviews", {
        organizationId, repositoryId, githubRepositoryId: 1, prNumber, isFork: false,
        baseRef: "main", baseSha: "b".repeat(40), headSha: "a".repeat(40),
        requiredCheckPolicy: "advisory", completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0,
        providerRetryCount: 0, commandRetryCount: 0, trigger: "dashboard", triggerVerb: "review",
        triggerActor: actor, triggerActorPermission: "admin", mode: "review", status: item.status as "queued",
        budgetLimit: 10, budgetConsumed: 0, nextActionCode: "none", isStale: false,
        trustedRef: "main", trustedRefSha: "b".repeat(40), configRevisionId, configProvenance: "defaults_only",
        provider: "anthropic", model: "test-model", modelVersion: "test", promptVersion: "test",
        evalSetVersion: "test", coverageLevel: "limited", currentStage: "queue", runnerImageVersion: "test",
        executionGeneration: 0, queuePriority: 0,
        ...(item.startedAt === undefined ? {} : { startedAt: item.startedAt }),
        ...(item.completedAt === undefined ? {} : { completedAt: item.completedAt }),
        expiresAt: now + 60_000, createdAt: now, updatedAt: now,
      });
      if (prNumber === 1) {
        const contentArtifactId = await ctx.db.insert("artifacts", { organizationId, repositoryId, reviewId, type: "command_output", storageKey: `${slug}/output`, encrypted: true, checksum: "output-hash", size: 10, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
        for (let index = 0; index < plan.findings; index += 1) {
          await ctx.db.insert("findings", { organizationId, reviewId, fingerprintHmac: `${slug}-fingerprint-${index}`, category: "correctness", severity: "warning", confidence: 0.9, blocking: false, contentArtifactId, evidenceIds: [], pathHmac: `${slug}-path`, startLine: 1, endLine: 2, resolution: "open", createdAt: now, updatedAt: now, expiresAt: now + 60_000 });
        }
        for (const micros of plan.spendMicros) {
          await ctx.db.insert("usageLedger", { organizationId, repositoryId, reviewId, kind: "model_tokens", quantity: 1_000, unitCost: 0, totalCostMicros: micros, currency: "provider_billed", occurredAt: now });
        }
        // Sandbox time is recorded at unit cost zero and must not be counted as model spend.
        await ctx.db.insert("usageLedger", { organizationId, repositoryId, reviewId, kind: "sandbox_seconds", quantity: 42, unitCost: 0, currency: "platform", occurredAt: now });
      }
    }
  });
}

// Durations are wall clock from startedAt to completedAt: 10s, 20s, 30s, 40s across both tenants.
const alpha: Seeded = {
  reviews: [
    { status: "checks_passed", startedAt: 1_000, completedAt: 11_000 },
    { status: "changes_requested", startedAt: 1_000, completedAt: 21_000 },
    // Stamped started and completed 4ms apart: a sandbox that never came up. Timed by the clock,
    // and not a measurement of how long reviewing a pull request takes.
    { status: "platform_failed", startedAt: 1_000, completedAt: 1_004 },
    { status: "analyzing", startedAt: 5_000 },
  ],
  findings: 3, spendMicros: [2_500_000, 1_250_000],
};
const beta: Seeded = {
  reviews: [
    { status: "checks_passed", startedAt: 1_000, completedAt: 31_000 },
    { status: "delivered", startedAt: 1_000, completedAt: 41_000 },
    // A second one, so dropping the filter moves the median as well as the sample size and the
    // test fails on the number a reader would actually see.
    { status: "platform_failed", startedAt: 1_000, completedAt: 1_004 },
  ],
  findings: 2, spendMicros: [250_000],
};

describe("the public proof summary", () => {
  it("answers a caller with no identity at all", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t, "northwind", "ledger-service", "octocat", alpha);
    // No withIdentity: this is the whole point of the endpoint.
    const result = await t.query(proofSummary, {});
    expect(result.reviews.counted).toBe(4);
  });

  it("counts BuildIT's whole database, not one tenant's slice", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t, "northwind", "ledger-service", "octocat", alpha);
    await seedTenant(t, "contoso", "billing-api", "hubot", beta);
    const result = await t.query(proofSummary, {});

    expect(result.reviews.counted).toBe(7);
    expect(result.reviews.byStatus).toEqual({ checks_passed: 2, changes_requested: 1, delivered: 1, platform_failed: 2, analyzing: 1 });
    expect(result.reviews.repositoriesReviewed).toBe(2);
    expect(result.findings.counted).toBe(5);
    expect(result.reviews.truncated).toBe(false);
  });

  it("prices model tokens only, and never the sandbox rows recorded at zero", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t, "northwind", "ledger-service", "octocat", alpha);
    await seedTenant(t, "contoso", "billing-api", "hubot", beta);
    const result = await t.query(proofSummary, {});

    expect(result.spend.modelSpendUsd).toBeCloseTo(4, 6);
    expect(result.spend.modelTokens).toBe(3_000);
    // Two sandbox rows are read and deliberately excluded from both totals above.
    expect(result.spend.counted).toBe(5);
  });

  // Four real runs at 10s, 20s, 30s and 40s. Beside them sit a review still analyzing, and two
  // platform failures - one of which the clock says took 4ms. Both kinds have to stay out: one has
  // no end, and the other has an end that answers a different question.

  it("reports an empty database honestly instead of failing or guessing", async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(proofSummary, {});
    expect(result.reviews.counted).toBe(0);
    expect(result.reviews.byStatus).toEqual({});
    expect(result.findings.counted).toBe(0);
    expect(result.spend.modelSpendUsd).toBe(0);
  });

  // The reason this endpoint can be unauthenticated. Every seeded value below is something a
  // customer owns; if any of them appears in the response, the endpoint is a disclosure.
  it("leaks no organization, repository, actor, commit or finding identifier", async () => {
    const t = convexTest(schema, modules);
    await seedTenant(t, "northwind", "ledger-service", "octocat", alpha);
    await seedTenant(t, "contoso", "billing-api", "hubot", beta);
    const serialized = JSON.stringify(await t.query(proofSummary, {}));

    for (const value of [...secretish, "billing-api", "hubot", "fingerprint", "path", "provider_billed", "anthropic", "test-model"]) {
      expect(serialized, `${value} reached the public response`).not.toContain(value);
    }
    // Convex document ids are 32-character base32-ish strings; none should survive either.
    expect(serialized).not.toMatch(/[a-z0-9]{25,}/);
  });
});

// The query reads the by_evidence index and iterates the allow-list, so two of the four conditions
// in publishableAsEvidence are never exercised through it - deleting either leaves every end-to-end
// case green. That redundancy is worth keeping, but it means the predicate is the contract and has
// to be pinned on its own, or a later change to how the query reads would silently remove a gate
// nobody notices is gone.
describe("publishableAsEvidence, condition by condition", () => {
  const now = 1_790_000_000_000;
  const fresh = { owner: "tanmayiift", visibility: "public", publishAsEvidence: true, visibilityVerifiedAt: now - 1_000 };

  it("admits only a row satisfying all four", () => {
    expect(publishableAsEvidence(fresh, now)).toBe(true);
  });

  it("refuses an absent or false opt-in", () => {
    expect(publishableAsEvidence({ ...fresh, publishAsEvidence: undefined }, now)).toBe(false);
    expect(publishableAsEvidence({ ...fresh, publishAsEvidence: false }, now)).toBe(false);
  });

  it("refuses an owner outside the allow-list", () => {
    expect(publishableAsEvidence({ ...fresh, owner: "acme-corp" }, now)).toBe(false);
  });

  it("refuses anything GitHub does not report as public", () => {
    for (const visibility of ["private", "internal", "unknown", undefined]) {
      expect(publishableAsEvidence({ ...fresh, visibility }, now), String(visibility)).toBe(false);
    }
  });

  it("refuses an unconfirmed, stale or nonsense confirmation", () => {
    expect(publishableAsEvidence({ ...fresh, visibilityVerifiedAt: undefined }, now)).toBe(false);
    expect(publishableAsEvidence({ ...fresh, visibilityVerifiedAt: now - 25 * 60 * 60_000 }, now)).toBe(false);
    expect(publishableAsEvidence({ ...fresh, visibilityVerifiedAt: Number.NaN }, now)).toBe(false);
    // A confirmation dated in the future is not evidence of freshness either; it still falls inside
    // the window, which is the honest reading - the stamp moves only beside a real read.
    expect(publishableAsEvidence({ ...fresh, visibilityVerifiedAt: now - 23 * 60 * 60_000 }, now)).toBe(true);
  });
});

describe("the public evidence list publishes only what was chosen", () => {
  // This is the production bug, reduced: a repository stored `public` with a completed review and no
  // explicit opt-in was served to anonymous visitors. GitHub had made it private weeks earlier.
  it("refuses a repository that was never opted in, however its visibility reads", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedEvidenceRepository(t, "unchosen", "tanmayiift", { visibility: "public", visibilityVerifiedAt: now }, now);
    const result = await t.query(publicReviews, {});
    expect(result.reviews, "an un-opted-in repository must not be published").toEqual([]);
    expect(result.repositoriesListed).toBe(0);
  });

  it("refuses an opted-in repository whose visibility has not been confirmed recently", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedEvidenceRepository(t, "stale", "tanmayiift",
      { publishAsEvidence: true, visibility: "public", visibilityVerifiedAt: now - 48 * hour }, now);
    expect((await t.query(publicReviews, {})).reviews, "staleness must fail closed").toEqual([]);
  });

  it("refuses an opted-in repository that has never been confirmed at all", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedEvidenceRepository(t, "unconfirmed", "tanmayiift", { publishAsEvidence: true, visibility: "public" }, now);
    expect((await t.query(publicReviews, {})).reviews).toEqual([]);
  });

  it("refuses an opted-in repository GitHub reports as private", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedEvidenceRepository(t, "private", "tanmayiift",
      { publishAsEvidence: true, visibility: "private", visibilityVerifiedAt: now }, now);
    expect((await t.query(publicReviews, {})).reviews).toEqual([]);
  });

  // The flag alone is not sufficient: a customer who somehow acquired it still is not BuildIT's own
  // evidence account, and the allow-list is what says so.
  it("refuses an opted-in repository owned by anyone outside the evidence allow-list", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedEvidenceRepository(t, "outsider", "acme-corp",
      { publishAsEvidence: true, visibility: "public", visibilityVerifiedAt: now }, now);
    expect((await t.query(publicReviews, {})).reviews).toEqual([]);
  });

  it("publishes a repository that satisfies all four conditions, and nothing else about it", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedEvidenceRepository(t, "chosen", "tanmayiift",
      { publishAsEvidence: true, visibility: "public", visibilityVerifiedAt: now - hour }, now);
    const result = await t.query(publicReviews, {});
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({ owner: "tanmayiift", name: "chosen-repo", prNumber: 7, status: "checks_passed" });
    const serialized = JSON.stringify(result);
    for (const value of ["organizationId", "headSha", "fingerprint", "triggerActor", "octocat", "a".repeat(40)]) {
      expect(serialized, `${value} reached the public response`).not.toContain(value);
    }
  });

  it("keeps an opted-in repository out when a second, un-opted-in one is also present", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedEvidenceRepository(t, "chosen", "tanmayiift",
      { publishAsEvidence: true, visibility: "public", visibilityVerifiedAt: now }, now);
    await seedEvidenceRepository(t, "unchosen", "tanmayiift", { visibility: "public", visibilityVerifiedAt: now }, now);
    const names = (await t.query(publicReviews, {})).reviews.map(review => review.name);
    expect(names).toEqual(["chosen-repo"]);
  });
});
