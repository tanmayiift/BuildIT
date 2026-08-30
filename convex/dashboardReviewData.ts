import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireRepositoryRole } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";

export const scope = internalQuery({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const access = await requireRepositoryRole(ctx, args.repositoryId, "developer");
    if (access.role === "viewer") throw new ConvexError("not_found_or_forbidden");
    return { actorId: access.userId, actorRole: access.role, organizationId: access.repository.organizationId,
      repositoryId: access.repository._id, githubRepositoryId: access.repository.githubRepositoryId,
      installationId: access.installation.installationId, owner: access.repository.owner, name: access.repository.name,
      forkPolicy: access.repository.forkPolicy };
  },
});

export const create = internalMutation({
  args: { repositoryId: v.id("repositories"), prNumber: v.number(), headSha: v.string(), baseSha: v.string(),
    baseRef: v.string(), isFork: v.boolean(), actorId: v.string(), actorRole: v.union(v.literal("developer"), v.literal("admin"), v.literal("owner")), now: v.number() },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || !repository.enabled || !Number.isInteger(args.prNumber) || args.prNumber < 1
      || !/^[0-9a-f]{40}$/.test(args.headSha) || !/^[0-9a-f]{40}$/.test(args.baseSha)) throw new ConvexError("dashboard_review_invalid");
    const membership = await ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", repository.organizationId).eq("userId", args.actorId)).unique();
    if (!membership || membership.status !== "active" || !["developer", "admin", "owner"].includes(membership.role)) throw new ConvexError("not_found_or_forbidden");
    const existing = await ctx.db.query("reviews").withIndex("by_repo_pr_head_mode", q => q.eq("repositoryId", repository._id).eq("prNumber", args.prNumber).eq("headSha", args.headSha).eq("mode", "review")).unique();
    if (existing) return { reviewId: existing._id, status: existing.status, headSha: existing.headSha, executionGeneration: existing.executionGeneration };
    let config = repository.configRevisionId ? await ctx.db.get(repository.configRevisionId) : null;
    if (!config || config.repositoryId !== repository._id) {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("buildit-defaults-v1"));
      const contentHash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
      const id = await ctx.db.insert("configRevisions", { organizationId: repository.organizationId, repositoryId: repository._id,
        sourceCommitSha: args.baseSha, sourceRef: args.baseRef, contentHash, rulesDigest: contentHash, schemaVersion: "defaults-v1",
        validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: args.now });
      await ctx.db.patch(repository._id, { configRevisionId: id, updatedAt: args.now });
      config = await ctx.db.get(id);
    }
    if (!config) throw new ConvexError("configuration_unavailable");
    const credentials = await ctx.db.query("providerCredentials").withIndex("by_org_status", q => q.eq("organizationId", repository.organizationId).eq("status", "valid")).collect();
    const credential = credentials.find(item => item.repositoryId === repository._id) ?? credentials.find(item => item.repositoryId === undefined);
    if (!credential) throw new ConvexError("provider_credential_invalid");
    const model = credential.provider === "gemini" ? "gemini-2.5-pro" : credential.provider === "openai" ? "gpt-5" : "claude-sonnet-4-5";
    const reviewId = await ctx.db.insert("reviews", { organizationId: repository.organizationId, repositoryId: repository._id,
      githubRepositoryId: repository.githubRepositoryId, prNumber: args.prNumber, isFork: args.isFork, baseRef: args.baseRef,
      baseSha: args.baseSha, headSha: args.headSha, requiredCheckPolicy: "fail_closed", completedRoundCount: 0, patchAttemptCount: 0,
      diagnosticRunCount: 0, providerRetryCount: 0, commandRetryCount: 0, trigger: "dashboard", triggerVerb: "review",
      triggerActor: args.actorId, triggerActorPermission: args.actorRole === "developer" ? "write" : "admin",
      mode: "review", status: "queued", budgetLimit: 5, budgetConsumed: 0, nextActionCode: "none", isStale: false,
      trustedRef: args.baseRef, trustedRefSha: args.baseSha, configRevisionId: config._id, configProvenance: "defaults_only",
      provider: credential.provider, model, modelVersion: "pinned-at-execution", promptVersion: "chain-v1", evalSetVersion: "buildit-eval-v1",
      coverageLevel: "limited", currentStage: "queue", executionGeneration: 0, queuePriority: 0, runnerImageVersion: "buildit-node22-v1",
      expiresAt: args.now + 7 * 86_400_000, createdAt: args.now, updatedAt: args.now });
    await ctx.db.insert("reviewLocks", { repositoryId: repository._id, prNumber: args.prNumber, headSha: args.headSha, mode: "review", reviewId, createdAt: args.now });
    await ctx.db.insert("reviewEvents", { organizationId: repository.organizationId, reviewId, sequence: 1, type: "review_created", stage: "queue", internalCode: "dashboard_consent", metadata: {}, createdAt: args.now });
    await appendAuditEvent(ctx, { organizationId: repository.organizationId, actorId: args.actorId, action: "review.created", resourceType: "review", resourceId: reviewId, requestId: `dashboard-review:${reviewId}`, result: "allowed", createdAt: args.now });
    return { reviewId, status: "queued" as const, headSha: args.headSha, executionGeneration: 0 };
  },
});
