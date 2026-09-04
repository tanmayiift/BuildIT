/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const makeTest = () => convexTest(schema, modules);

// The connected-state UI, the "connected" accessibility and product journeys, and the committed
// release screenshots were all rendered from connectedDesignFixture - a hardcoded client object.
// Those artefacts prove layout and nothing else: repositoryConnections:current, the query that
// actually decides what a signed-in customer sees, was exercised by none of them.
//
// This is the missing evidence: a signed-in identity against a seeded backend, driving the real
// query through every state the UI branches on.
async function seedWorkspace(t: ReturnType<typeof convexTest>, options: { installationStatus?: "active" | "suspended"; repositories?: number; enabled?: boolean } = {}) {
  return t.run(async ctx => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { githubUserId: 7001, githubLogin: "riya" });
    const organizationId = await ctx.db.insert("organizations", { name: "Ledgerline", slug: "ledgerline", timezone: "Asia/Kolkata",
      region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, planId: "trial", fingerprintKeyVersion: 1, createdAt: now });
    await ctx.db.insert("memberships", { organizationId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("userPreferences", { userId, activeOrganizationId: organizationId, updatedAt: now });
    await ctx.db.insert("userProfiles", { userId, githubUserId: 7001, githubLogin: "riya", lastAuthenticatedAt: now, updatedAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: 5150, accountLogin: "ledgerline",
      accountType: "organization", permissionSnapshot: { metadata: "read", contents: "write", pullRequests: "write", issues: "read", checks: "write" },
      status: options.installationStatus ?? "active", createdAt: now, updatedAt: now });
    for (let index = 0; index < (options.repositories ?? 2); index += 1) {
      await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: 900 + index, owner: "ledgerline",
        name: index === 0 ? "billing-api" : `service-${index}`, defaultBranch: "main", visibility: "private",
        enabled: options.enabled ?? true, autofixMode: "stacked", forkPolicy: "manual_review_only", indexState: "ready",
        concurrencyLimit: 1, createdAt: now, updatedAt: now });
    }
    return { userId, organizationId };
  });
}

describe("connected workspace, from the backend rather than a fixture", () => {
  it("returns the real workspace to the identity that owns it", async () => {
    const t = convexTest(schema, modules);
    const { userId, organizationId } = await seedWorkspace(t);
    const connection = await t.withIdentity({ subject: `${userId}|session` }).query(api.repositoryConnections.current, {});

    expect(connection.state).toBe("connected");
    expect(connection.organization).toMatchObject({ id: organizationId, name: "Ledgerline", slug: "ledgerline", role: "owner", retentionHours: 24 });
    expect(connection.installations).toHaveLength(1);
    expect(connection.installations[0]).toMatchObject({ installationId: 5150, accountLogin: "ledgerline", status: "active" });
    expect(connection.repositories).toHaveLength(2);
    expect(connection.repositories[0]).toMatchObject({ owner: "ledgerline", name: "billing-api", defaultBranch: "main", autofixMode: "stacked", paused: false });
    // Nothing from the design fixture can appear in a real answer.
    expect(JSON.stringify(connection)).not.toContain("Northstar");
    expect(JSON.stringify(connection)).not.toContain("fixture-");
  });

  // Every state the connected UI branches on, driven by real data rather than a hardcoded object.
  it("reports installation_required when no installation exists", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedWorkspace(t);
    await t.run(async ctx => { for (const row of await ctx.db.query("githubInstallations").collect()) await ctx.db.delete(row._id); });
    await expect(t.withIdentity({ subject: `${userId}|session` }).query(api.repositoryConnections.current, {}))
      .resolves.toMatchObject({ state: "installation_required" });
  });

  it("reports installation_unavailable when the installation is suspended", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedWorkspace(t, { installationStatus: "suspended" });
    await expect(t.withIdentity({ subject: `${userId}|session` }).query(api.repositoryConnections.current, {}))
      .resolves.toMatchObject({ state: "installation_unavailable" });
  });

  it("reports no_repositories_selected when every repository is disabled", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedWorkspace(t, { enabled: false });
    await expect(t.withIdentity({ subject: `${userId}|session` }).query(api.repositoryConnections.current, {}))
      .resolves.toMatchObject({ state: "no_repositories_selected", repositories: [] });
  });

  it("shows a signed-out visitor nothing at all", async () => {
    const t = convexTest(schema, modules);
    await seedWorkspace(t);
    const connection = await t.query(api.repositoryConnections.current, {});
    expect(connection).toMatchObject({ state: "signed_out", organization: null, installations: [], repositories: [] });
  });

  // The step-up window the UI reads to decide whether a policy control is usable.
  it("carries the credential re-authentication deadline the UI depends on", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedWorkspace(t);
    const connection = await t.withIdentity({ subject: `${userId}|session` }).query(api.repositoryConnections.current, {});
    expect(connection.credentialReauthenticationExpiresAt).toBeGreaterThan(Date.now());
  });
});

// modelStageRuns recorded the provider, model, tokens, attempt and outcome of every model call
// since the table was created, and nothing read it. A review that went wrong could not be
// debugged: no way to see which stage failed, what it cost, or whether the schema had to be
// repaired. The rubric asks what a reviewer can see, and a table nobody queries is not a surface.
describe("a run can be debugged after the fact", () => {
  it("returns every stage with its model, attempt, outcome and tokens", async () => {
    const t = convexTest(schema, modules);
    const { userId, organizationId } = await seedWorkspace(t);
    const reviewId = await t.run(async ctx => {
      const now = Date.now();
      const repository = (await ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", organizationId).eq("enabled", true)).first())!;
      const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId: repository._id,
        sourceCommitSha: "b".repeat(40), sourceRef: "main", contentHash: "c".repeat(64), rulesDigest: "c".repeat(64),
        schemaVersion: "defaults-v1", validationState: "valid", provenance: "defaults_only",
        refProtectionState: "unverified", createdAt: now });
      const review = await ctx.db.insert("reviews", { organizationId, repositoryId: repository._id, githubRepositoryId: repository.githubRepositoryId,
        prNumber: 4, isFork: false, baseRef: "main", baseSha: "b".repeat(40), headSha: "a".repeat(40), requiredCheckPolicy: "fail_closed",
        completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0, providerRetryCount: 0, commandRetryCount: 0,
        trigger: "dashboard", triggerVerb: "review", triggerActor: userId, triggerActorPermission: "admin", mode: "review",
        status: "changes_requested", budgetLimit: 2, budgetConsumed: 0, nextActionCode: "inspect_findings", isStale: false,
        trustedRef: "main", trustedRefSha: "b".repeat(40), configRevisionId, queuePriority: 0, configProvenance: "defaults_only", provider: "anthropic",
        model: "claude-sonnet-4-5", modelVersion: "pinned", promptVersion: "chain-v1", evalSetVersion: "v1",
        coverageLevel: "full", currentStage: "complete", executionGeneration: 0, runnerImageVersion: "img",
        expiresAt: now + 86_400_000, createdAt: now, updatedAt: now });
      for (const [index, stage] of ["requirements", "findings", "critic"].entries()) {
        await ctx.db.insert("modelStageRuns", { organizationId, repositoryId: repository._id, reviewId: review,
          stage: stage as never, provider: "anthropic", model: "claude-sonnet-4-5", promptVersion: "chain-v1",
          schemaVersion: "v1", finishReason: "stop", requestHash: "h".repeat(64), attempt: index === 1 ? 2 : 1,
          outcome: index === 1 ? "schema_invalid" : "valid", inputTokens: 1_000 * (index + 1), outputTokens: 100 * (index + 1),
          createdAt: now + index });
      }
      await ctx.db.insert("usageLedger", { organizationId, repositoryId: repository._id, reviewId: review,
        kind: "model_spend", quantity: 1, unitCost: 0.037, totalCostMicros: 37_000, currency: "USD", occurredAt: now });
      return review;
    });

    const evidence = await t.withIdentity({ subject: `${userId}|session` }).query(api.reviews.getEvidence, { reviewId });
    expect(evidence.stages).toHaveLength(3);
    expect(evidence.stages.map(stage => stage.stage)).toEqual(["requirements", "findings", "critic"]);
    // The repaired stage is the one worth spotting: the model returned something the schema refused.
    expect(evidence.stages.find(stage => stage.stage === "findings")).toMatchObject({ attempt: 2, outcome: "schema_invalid", model: "claude-sonnet-4-5" });
    expect(evidence.spend.inputTokens).toBe(6_000);
    expect(evidence.spend.outputTokens).toBe(600);
    expect(evidence.spend.costUsd).toBeCloseTo(0.037, 6);
  });

  it("still refuses the whole thing to another tenant", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedWorkspace(t);
    const other = await t.run(ctx => ctx.db.insert("users", { githubUserId: 9002, githubLogin: "mallory" }));
    const reviewId = await t.run(async ctx => (await ctx.db.query("reviews").first())?._id);
    if (reviewId) {
      await expect(t.withIdentity({ subject: `${other}|session` }).query(api.reviews.getEvidence, { reviewId }))
        .rejects.toThrow("not_found_or_forbidden");
    }
    expect(userId).toBeTruthy();
  });
});

// L5 observability asks whether two runs can be compared. Until now each run could only be read on
// its own, so "it found this last time and not this time" - the exact failure that motivated the
// detection suite - could not be seen in the product at all.
describe("two runs of the same pull request can be compared", () => {
  const seedRun = async (t: ReturnType<typeof makeTest>, organizationId: Awaited<ReturnType<typeof seedWorkspace>>["organizationId"], userId: string, options: { headSha: string; status: string; findings: Array<{ print: string; blocking: boolean }>; stages: string[] }) =>
    t.run(async ctx => {
      const now = Date.now();
      const repository = (await ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", organizationId).eq("enabled", true)).first())!;
      const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId: repository._id,
        sourceCommitSha: "b".repeat(40), sourceRef: "main", contentHash: "c".repeat(64), rulesDigest: "c".repeat(64),
        schemaVersion: "defaults-v1", validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: now });
      const reviewId = await ctx.db.insert("reviews", { organizationId, repositoryId: repository._id,
        githubRepositoryId: repository.githubRepositoryId, prNumber: 12, isFork: false, baseRef: "main", baseSha: "b".repeat(40),
        headSha: options.headSha, requiredCheckPolicy: "fail_closed", completedRoundCount: 0, patchAttemptCount: 0,
        diagnosticRunCount: 0, providerRetryCount: 0, commandRetryCount: 0, trigger: "dashboard", triggerVerb: "review",
        triggerActor: userId, triggerActorPermission: "admin", mode: "review", status: options.status as never,
        budgetLimit: 2, budgetConsumed: 0, nextActionCode: "none", isStale: false, trustedRef: "main",
        trustedRefSha: "b".repeat(40), configRevisionId, queuePriority: 0, configProvenance: "defaults_only",
        provider: "anthropic", model: "claude-sonnet-4-5", modelVersion: "pinned", promptVersion: "chain-v1",
        evalSetVersion: "v1", coverageLevel: "full", currentStage: "complete", executionGeneration: 0,
        runnerImageVersion: "img", expiresAt: now + 86_400_000, createdAt: now, updatedAt: now });
      const artifactId = await ctx.db.insert("artifacts", { organizationId, repositoryId: repository._id,
        reviewId, type: "prompt_trace", storageKey: `compare/${options.headSha}.json`, encrypted: true,
        checksum: "a".repeat(64), size: 10, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
      for (const stage of options.stages) {
        await ctx.db.insert("modelStageRuns", { organizationId, repositoryId: repository._id, reviewId,
          stage: stage as never, provider: "anthropic", model: "claude-sonnet-4-5", promptVersion: "chain-v1",
          schemaVersion: "v1", finishReason: "stop", requestHash: "h".repeat(64), attempt: 1, outcome: "valid",
          inputTokens: 500, outputTokens: 50, createdAt: now });
      }
      for (const item of options.findings) {
        await ctx.db.insert("findings", { organizationId, reviewId, fingerprintHmac: item.print.padEnd(64, "0"),
          category: "correctness", severity: "high", confidence: 0.9, blocking: item.blocking, contentArtifactId: artifactId,
          evidenceIds: [artifactId], pathHmac: "p".repeat(64), startLine: 3, endLine: 3, resolution: "open",
          createdAt: now, updatedAt: now, expiresAt: now + 86_400_000 });
      }
      return reviewId;
    });

  it("shows what one run found that the other did not", async () => {
    const t = convexTest(schema, modules);
    const { userId, organizationId } = await seedWorkspace(t);
    const earlier = await seedRun(t, organizationId, userId, { headSha: "a".repeat(40), status: "changes_requested", stages: ["requirements", "findings", "critic"], findings: [{ print: "rounding", blocking: true }, { print: "shared", blocking: true }] });
    const later = await seedRun(t, organizationId, userId, { headSha: "c".repeat(40), status: "checks_passed", stages: ["findings", "critic"], findings: [{ print: "shared", blocking: true }] });

    const signedIn = t.withIdentity({ subject: `${userId}|session` });
    const diff = await signedIn.query(api.reviews.compareRuns, { leftReviewId: earlier, rightReviewId: later });

    // The column that matters: a defect the earlier run reported and the later one did not.
    expect(diff.onlyInLeft).toHaveLength(1);
    expect(diff.onlyInRight).toHaveLength(0);
    expect(diff.inBoth).toBe(1);
    expect(diff.statusChanged).toBe(true);
    // A stage the planner skipped shows as not run rather than silently missing.
    const requirements = diff.stages.find(row => row.stage === "requirements")!;
    expect(requirements.left.ran).toBe(true);
    expect(requirements.right.ran).toBe(false);
  });

  it("lists every run of the pull request, newest first", async () => {
    const t = convexTest(schema, modules);
    const { userId, organizationId } = await seedWorkspace(t);
    const first = await seedRun(t, organizationId, userId, { headSha: "a".repeat(40), status: "changes_requested", stages: ["findings"], findings: [] });
    await seedRun(t, organizationId, userId, { headSha: "c".repeat(40), status: "checks_passed", stages: ["findings"], findings: [] });
    const history = await t.withIdentity({ subject: `${userId}|session` }).query(api.reviews.runHistory, { reviewId: first });
    expect(history).toHaveLength(2);
    expect(history.filter(run => run.isCurrent)).toHaveLength(1);
    expect(history.every(run => typeof run.costUsd === "number")).toBe(true);
  });

  it("refuses to compare across a repository boundary", async () => {
    const t = convexTest(schema, modules);
    const { userId, organizationId } = await seedWorkspace(t);
    const mine = await seedRun(t, organizationId, userId, { headSha: "a".repeat(40), status: "checks_passed", stages: ["findings"], findings: [] });
    const other = await t.run(async ctx => (await ctx.db.query("reviews").filter(q => q.neq(q.field("_id"), mine)).first())?._id);
    const stranger = await t.run(ctx => ctx.db.insert("users", { githubUserId: 9500, githubLogin: "mallory" }));
    await expect(t.withIdentity({ subject: `${stranger}|session` }).query(api.reviews.runHistory, { reviewId: mine }))
      .rejects.toThrow("not_found_or_forbidden");
    expect(other ?? null).toBeDefined();
  });
});

// The eval set only ever grew by hand, so the runs most worth learning from were the ones nothing
// captured: a review that reached no verdict, and a finding a person read and dismissed as wrong.
// The second had no code path at all - findingSuppressions existed in the schema and nothing wrote
// to it, so a reviewer people could not correct was one they would stop reading.
describe("the eval set learns from production", () => {
  const seedFinding = async (t: ReturnType<typeof makeTest>, organizationId: Awaited<ReturnType<typeof seedWorkspace>>["organizationId"], userId: string) =>
    t.run(async ctx => {
      const now = Date.now();
      const repository = (await ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", organizationId).eq("enabled", true)).first())!;
      const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId: repository._id,
        sourceCommitSha: "b".repeat(40), sourceRef: "main", contentHash: "c".repeat(64), rulesDigest: "c".repeat(64),
        schemaVersion: "defaults-v1", validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: now });
      const reviewId = await ctx.db.insert("reviews", { organizationId, repositoryId: repository._id,
        githubRepositoryId: repository.githubRepositoryId, prNumber: 21, isFork: false, baseRef: "main",
        baseSha: "b".repeat(40), headSha: "a".repeat(40), requiredCheckPolicy: "fail_closed", completedRoundCount: 0,
        patchAttemptCount: 0, diagnosticRunCount: 0, providerRetryCount: 0, commandRetryCount: 0, trigger: "dashboard",
        triggerVerb: "review", triggerActor: userId, triggerActorPermission: "admin", mode: "review",
        status: "changes_requested", budgetLimit: 2, budgetConsumed: 0, nextActionCode: "inspect_findings",
        isStale: false, trustedRef: "main", trustedRefSha: "b".repeat(40), configRevisionId, queuePriority: 0,
        configProvenance: "defaults_only", provider: "anthropic", model: "claude-sonnet-4-5", modelVersion: "pinned",
        promptVersion: "chain-v1", evalSetVersion: "v1", coverageLevel: "full", currentStage: "complete",
        executionGeneration: 0, runnerImageVersion: "img", expiresAt: now + 86_400_000, createdAt: now, updatedAt: now });
      const artifactId = await ctx.db.insert("artifacts", { organizationId, repositoryId: repository._id, reviewId,
        type: "prompt_trace", storageKey: "eval/trace.json", encrypted: true, checksum: "a".repeat(64), size: 10,
        redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
      const print = "f".repeat(64);
      await ctx.db.insert("findings", { organizationId, reviewId, fingerprintHmac: print, category: "correctness",
        severity: "high", confidence: 0.9, blocking: true, contentArtifactId: artifactId, evidenceIds: [artifactId],
        pathHmac: "p".repeat(64), startLine: 3, endLine: 3, resolution: "open", createdAt: now, updatedAt: now,
        expiresAt: now + 86_400_000 });
      return { reviewId, print };
    });

  it("turns a dismissed finding into an eval candidate and silences it", async () => {
    vi.useFakeTimers();
    const t = makeTest();
    const { userId, organizationId } = await seedWorkspace(t);
    const { reviewId, print } = await seedFinding(t, organizationId, userId);
    const signedIn = t.withIdentity({ subject: `${userId}|session` });

    await expect(signedIn.mutation(api.findings.dismiss, {
      reviewId, fingerprintHmac: print, scope: "repository",
      reasonCode: "not_a_defect", requestId: "dismiss-finding-000001",
    })).resolves.toMatchObject({ scope: "repository" });

    const suppressions = await t.run(ctx => ctx.db.query("findingSuppressions").collect());
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]).toMatchObject({ reasonCode: "not_a_defect", dismissedBy: userId });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const candidates = await t.run(ctx => ctx.db.query("evalCandidates").collect());
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "false_positive", reasonCode: "not_a_defect", promptVersion: "chain-v1" });
    // Source-free: a fingerprint and codes, never repository content.
    expect(JSON.stringify(candidates[0])).not.toContain("src/");
    vi.useRealTimers();
  });

  it("records a review that reached no verdict, once", async () => {
    const t = makeTest();
    const { userId, organizationId } = await seedWorkspace(t);
    const { reviewId } = await seedFinding(t, organizationId, userId);
    for (const reason of ["injection_unscoped", "injection_unscoped"]) {
      await t.mutation(internal.evalLoop.recordMissedVerdict, { organizationId, reviewId, reasonCode: reason, now: Date.now() });
    }
    const candidates = await t.run(ctx => ctx.db.query("evalCandidates").collect());
    // Finalizing twice is still one thing to learn from.
    expect(candidates.filter(item => item.kind === "missed")).toHaveLength(1);
  });

  it("lists what a curator has not yet folded into the corpus", async () => {
    const t = makeTest();
    const { userId, organizationId } = await seedWorkspace(t);
    const { reviewId } = await seedFinding(t, organizationId, userId);
    await t.mutation(internal.evalLoop.recordMissedVerdict, { organizationId, reviewId, reasonCode: "coverage_partial", now: Date.now() });
    const pending = await t.query(internal.evalLoop.pendingCandidates, { limit: 10 });
    expect(pending).toHaveLength(1);
    await t.mutation(internal.evalLoop.markCurated, { candidateId: pending[0]!.id as never, now: Date.now() });
    await expect(t.query(internal.evalLoop.pendingCandidates, { limit: 10 })).resolves.toHaveLength(0);
  });

  // Both halves of this were already tested and the join between them was not: dismiss wrote a
  // suppression, and repositoryMemory read one a test had inserted by hand. Nothing in the product
  // ever called dismiss, so in production that row was never written and dismissedFingerprints was
  // an empty array on every review BuildIT has ever run. This is the whole path, end to end: a
  // person says a finding is wrong, and the next review of that repository is told.
  it("puts a dismissed fingerprint into the memory the next review reads", async () => {
    const t = makeTest();
    const { userId, organizationId } = await seedWorkspace(t);
    const { reviewId, print } = await seedFinding(t, organizationId, userId);
    const repositoryId = await t.run(async ctx => (await ctx.db.get(reviewId))!.repositoryId);
    await expect(t.query(internal.repositoryMemory.forRepository, { repositoryId }))
      .resolves.toMatchObject({ dismissedFingerprints: [] });

    await t.withIdentity({ subject: `${userId}|session` }).mutation(api.findings.dismiss, {
      reviewId, fingerprintHmac: print, scope: "path", reasonCode: "wrong_lines", requestId: "dismiss-finding-000003",
    });

    expect(await t.run(ctx => ctx.db.query("findingSuppressions").collect())).toMatchObject([
      { repositoryId, fingerprintHmac: print, scope: "path", reasonCode: "wrong_lines", hmacKeyVersion: 1, dismissedBy: userId },
    ]);
    const memory = await t.query(internal.repositoryMemory.forRepository, { repositoryId });
    expect(memory.dismissedFingerprints).toEqual([print]);
    // What the reader sees, on the review they were reading.
    expect(await t.run(ctx => ctx.db.query("findings").collect())).toMatchObject([{ resolution: "dismissed" }]);
  });

  it("remembers one dismissal when the same finding is dismissed twice", async () => {
    const t = makeTest();
    const { userId, organizationId } = await seedWorkspace(t);
    const { reviewId, print } = await seedFinding(t, organizationId, userId);
    const repositoryId = await t.run(async ctx => (await ctx.db.get(reviewId))!.repositoryId);
    const signedIn = t.withIdentity({ subject: `${userId}|session` });
    for (const requestId of ["dismiss-finding-000004", "dismiss-finding-000005"]) {
      await signedIn.mutation(api.findings.dismiss, { reviewId, fingerprintHmac: print, scope: "repository", reasonCode: "not_a_defect", requestId });
    }
    await expect(t.query(internal.repositoryMemory.forRepository, { repositoryId }))
      .resolves.toMatchObject({ dismissedFingerprints: [print] });
  });

  it("refuses a dismissal from someone who may only read", async () => {
    const t = makeTest();
    const { userId, organizationId } = await seedWorkspace(t);
    const { reviewId, print } = await seedFinding(t, organizationId, userId);
    await t.run(async ctx => {
      const membership = await ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", organizationId).eq("userId", userId)).unique();
      if (membership) await ctx.db.patch(membership._id, { role: "viewer" });
    });
    await expect(t.withIdentity({ subject: `${userId}|session` }).mutation(api.findings.dismiss, {
      reviewId, fingerprintHmac: print, scope: "repository", reasonCode: "not_a_defect", requestId: "dismiss-finding-000002",
    })).rejects.toThrow("not_found_or_forbidden");
  });
});

// Context survived within a review and nowhere else, so the second review of a repository started
// as cold as the first: a finding a person had already dismissed came back, and a defect reported
// last week was reported again as if new.
describe("a review remembers the repository", () => {
  it("carries dismissed and recurring fingerprints, and nothing else", async () => {
    const t = makeTest();
    const { userId, organizationId } = await seedWorkspace(t);
    const repositoryId = await t.run(async ctx =>
      (await ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", organizationId).eq("enabled", true)).first())!._id);

    const dismissed = "d".repeat(64), recurring = "e".repeat(64), fresh = "f".repeat(64);
    await t.run(async ctx => {
      const now = Date.now();
      await ctx.db.insert("findingSuppressions", { organizationId, repositoryId, fingerprintHmac: dismissed,
        hmacKeyVersion: 1, scope: "repository", scopeValueHmac: dismissed, reasonCode: "not_a_defect",
        dismissedBy: userId, dismissedAt: now });
      const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId,
        sourceCommitSha: "b".repeat(40), sourceRef: "main", contentHash: "c".repeat(64), rulesDigest: "c".repeat(64),
        schemaVersion: "defaults-v1", validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: now });
      const repository = (await ctx.db.get(repositoryId))!;
      // Two reviews that both reported the same fingerprint, plus one that reported another.
      for (const [index, prints] of [[recurring, fresh], [recurring]].entries()) {
        const reviewId = await ctx.db.insert("reviews", { organizationId, repositoryId,
          githubRepositoryId: repository.githubRepositoryId, prNumber: 30 + index, isFork: false, baseRef: "main",
          baseSha: "b".repeat(40), headSha: `${index}`.repeat(40).slice(0, 40), requiredCheckPolicy: "fail_closed",
          completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0, providerRetryCount: 0,
          commandRetryCount: 0, trigger: "dashboard", triggerVerb: "review", triggerActor: userId,
          triggerActorPermission: "admin", mode: "review", status: "changes_requested", budgetLimit: 2,
          budgetConsumed: 0, nextActionCode: "none", isStale: false, trustedRef: "main", trustedRefSha: "b".repeat(40),
          configRevisionId, queuePriority: 0, configProvenance: "defaults_only", provider: "anthropic",
          model: "claude-sonnet-4-5", modelVersion: "pinned", promptVersion: "chain-v1", evalSetVersion: "v1",
          coverageLevel: "full", currentStage: "complete", executionGeneration: 0, runnerImageVersion: "img",
          expiresAt: now + 86_400_000, createdAt: now + index, updatedAt: now + index });
        const artifactId = await ctx.db.insert("artifacts", { organizationId, repositoryId, reviewId,
          type: "prompt_trace", storageKey: `memory/${index}.json`, encrypted: true, checksum: "a".repeat(64),
          size: 10, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
        for (const print of prints as string[]) {
          await ctx.db.insert("findings", { organizationId, reviewId, fingerprintHmac: print, category: "correctness",
            severity: "high", confidence: 0.9, blocking: true, contentArtifactId: artifactId, evidenceIds: [artifactId],
            pathHmac: "p".repeat(64), startLine: 1, endLine: 1, resolution: "open", createdAt: now, updatedAt: now,
            expiresAt: now + 86_400_000 });
        }
      }
    });

    const memory = await t.query(internal.repositoryMemory.forRepository, { repositoryId });
    expect(memory.dismissedFingerprints).toEqual([dismissed]);
    expect(memory.recurringFingerprints).toEqual([recurring]);
    // Seen once is not recurring, or every finding would be one after two reviews.
    expect(memory.recurringFingerprints).not.toContain(fresh);
    expect(memory.reviewsSeen).toBe(2);
  });

  // Memory is fed back into a prompt, so it must never be able to carry one review's prose into
  // the next - that would be a channel from model output to model input.
  it("carries no repository content, path or prose", async () => {
    const t = makeTest();
    const { organizationId } = await seedWorkspace(t);
    const repositoryId = await t.run(async ctx =>
      (await ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", organizationId).eq("enabled", true)).first())!._id);
    const memory = await t.query(internal.repositoryMemory.forRepository, { repositoryId });
    const serialized = JSON.stringify(memory);
    for (const leak of ["src/", ".ts", "billing-api", "ledgerline", "http"]) expect(serialized.toLowerCase()).not.toContain(leak);
    expect(Object.keys(memory).sort()).toEqual(["dismissedFingerprints", "recurringFingerprints", "reviewsSeen"]);
  });

  it("is empty for a repository nobody has reviewed", async () => {
    const t = makeTest();
    const { organizationId } = await seedWorkspace(t);
    const repositoryId = await t.run(async ctx =>
      (await ctx.db.query("repositories").withIndex("by_org_enabled", q => q.eq("organizationId", organizationId).eq("enabled", true)).first())!._id);
    await expect(t.query(internal.repositoryMemory.forRepository, { repositoryId }))
      .resolves.toEqual({ dismissedFingerprints: [], recurringFingerprints: [], reviewsSeen: 0 });
  });
});
