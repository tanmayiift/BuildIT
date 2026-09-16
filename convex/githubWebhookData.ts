import { publishCancellationNotice, recordBaseAdvance } from "./reviewState";
import { v } from "convex/values";
import { recordReviewMetric } from "./lib/recordMetric";
import { selectProviderModel } from "@buildit/providers";
import { RUNNER_IMAGE_VERSION } from "./lib/runtimeVersion";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { retentionMs, terminalStatuses, webhookDeliveryRetentionMs } from "./lib/lifecycle";
import { activeReviewCount, concurrencyExceeded } from "./lib/tenantLimits";
import { provider as providerValidator } from "./validators";
import { orderCredentialsByHealth } from "./lib/providerFallback";

// A blocked review is waiting on a person: connect a model key, or let an earlier review finish.
// Two hours is long enough for either and short enough that a forgotten one frees its slot.
const blockedReviewTtlMs = 2 * 60 * 60_000;

export function webhookTelemetryOutcome(disposition: "processed" | "ignored_bot" | "ignored_edit" | "duplicate" | "rejected", status: "enqueued" | "completed" | "failed") {
  return { operation: "webhook.process" as const, stage: "context" as const, outcome: status === "failed" ? "failed" as const : disposition === "rejected" ? "blocked" as const : "succeeded" as const };
}

// GitHub retries a failed delivery for hours. Long enough that a delivery still in flight is
// not reprocessed concurrently, short enough that a redelivery is not refused.
const failedRetryGraceMs = 60_000;

export const reserve = internalMutation({
  args: {
    deliveryId: v.string(),
    event: v.string(),
    action: v.string(),
    installationId: v.optional(v.number()),
    disposition: v.union(
      v.literal("processed"),
      v.literal("ignored_bot"),
      v.literal("ignored_edit"),
      v.literal("rejected"),
    ),
    signatureValid: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_delivery_id", (q) => q.eq("deliveryId", args.deliveryId))
      .unique();
    // A failed delivery used to be answered "duplicate" forever. GitHub reuses the same delivery
    // id when it redelivers - automatically or from the Redeliver button - so one transient blip
    // silently discarded the user's "@buildit review" comment with no error anywhere and no way
    // to retry. A retry is only allowed once the failure has settled, so a redelivery arriving
    // while the first attempt is still running is still deduplicated.
    if (existing) {
      const retryable = existing.status === "failed" && (existing.completedAt ?? 0) + failedRetryGraceMs <= args.now;
      if (!retryable) return { duplicate: true, id: existing._id };
      await ctx.db.patch(existing._id, { status: "received", disposition: args.disposition, completedAt: undefined, receivedAt: args.now });
      return { duplicate: false, id: existing._id };
    }
    const id = await ctx.db.insert("webhookDeliveries", {
      expiresAt: args.now + webhookDeliveryRetentionMs,
      deliveryId: args.deliveryId,
      event: args.event,
      action: args.action,
      installationId: args.installationId,
      // The endpoint rejects an unsigned or wrongly signed request before reaching this
      // mutation, so a stored delivery is signature-verified by construction. Recorded from
      // the caller rather than hardcoded, so the column means what it says.
      signatureValid: args.signatureValid,
      disposition: args.disposition,
      status: args.disposition === "processed" ? "received" : "completed",
      receivedAt: args.now,
      completedAt: args.disposition === "processed" ? undefined : args.now,
    });
    return { duplicate: false, id };
  },
});

export const scope = internalQuery({
  args: { installationId: v.number(), githubRepositoryId: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", args.installationId),
      )
      .unique();
    if (!installation || installation.status !== "active")
      throw new Error("installation_unavailable");
    const repository = await ctx.db
      .query("repositories")
      .withIndex("by_github_id", (q) =>
        q.eq("githubRepositoryId", args.githubRepositoryId),
      )
      .unique();
    if (
      !repository ||
      !repository.enabled ||
      repository.installationId !== installation._id ||
      repository.organizationId !== installation.organizationId
    )
      throw new Error("repository_unavailable");
    return {
      organizationId: installation.organizationId,
      repositoryId: repository._id,
      owner: repository.owner,
      name: repository.name,
      forkPolicy: repository.forkPolicy,
    };
  },
});

export const cancellationTargets = internalQuery({
  args: {
    organizationId: v.id("organizations"),
    repositoryId: v.id("repositories"),
    prNumber: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.prNumber) || args.prNumber < 1)
      throw new Error("invalid_pull_request_number");
    const repository = await ctx.db.get(args.repositoryId);
    if (
      !repository ||
      !repository.enabled ||
      repository.organizationId !== args.organizationId
    )
      throw new Error("repository_unavailable");
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_org_status", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    return reviews
      .filter(
        (review) =>
          review.repositoryId === args.repositoryId &&
          review.prNumber === args.prNumber &&
          !terminalStatuses.has(review.status),
      )
      .map((review) => ({
        reviewId: review._id,
        workflowId: review.workflowId,
      }));
  },
});

export const recordPinnedSnapshot = internalMutation({
  args: {
    deliveryId: v.string(),
    prNumber: v.number(),
    headSha: v.string(),
    baseSha: v.string(),
    headRefHash: v.string(),
    baseRefHash: v.string(),
    isFork: v.boolean(),
    triggerVerb: v.union(v.literal("review"), v.literal("autofix")),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.prNumber) ||
      args.prNumber < 1 ||
      !/^[0-9a-f]{40}$/i.test(args.headSha) ||
      !/^[0-9a-f]{40}$/i.test(args.baseSha) ||
      !/^[0-9a-f]{64}$/i.test(args.headRefHash) ||
      !/^[0-9a-f]{64}$/i.test(args.baseRefHash)
    )
      throw new Error("invalid_pull_request_snapshot");
    const delivery = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_delivery_id", (q) => q.eq("deliveryId", args.deliveryId))
      .unique();
    if (
      !delivery ||
      delivery.status !== "received" ||
      delivery.disposition !== "processed"
    )
      throw new Error("delivery_not_reservable");
    await ctx.db.patch(delivery._id, {
      ...args,
      headSha: args.headSha.toLowerCase(),
      baseSha: args.baseSha.toLowerCase(),
    });
    return delivery._id;
  },
});

export const materializeReview = internalMutation({
  args: {
    deliveryId: v.string(),
    trigger: v.optional(v.union(v.literal("github_comment"), v.literal("automatic"))),
    organizationId: v.id("organizations"),
    repositoryId: v.id("repositories"),
    baseRef: v.string(),
    triggerActor: v.string(),
    actorPermission: v.union(
      v.literal("read"),
      v.literal("triage"),
      v.literal("write"),
      v.literal("maintain"),
      v.literal("admin"),
    ),
    expectedProvider: v.optional(providerValidator),
    expectedBudgetLimit: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const budgetLimit = args.expectedBudgetLimit ?? 2;
    if (![1, 2, 3, 5].includes(budgetLimit))
      throw new Error("invalid_budget_limit");
    const delivery = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_delivery_id", (q) => q.eq("deliveryId", args.deliveryId))
      .unique();
    const repository = await ctx.db.get(args.repositoryId);
    if (
      !delivery ||
      delivery.status !== "received" ||
      !delivery.prNumber ||
      !delivery.headSha ||
      !delivery.baseSha ||
      !delivery.triggerVerb ||
      delivery.triggerVerb === "cancel" ||
      delivery.reviewId ||
      !repository ||
      repository.organizationId !== args.organizationId ||
      repository.githubRepositoryId < 1
    )
      throw new Error("review_request_not_materializable");
    const mode = delivery.triggerVerb === "autofix" ? "autofix" : "review";
    const matching = await ctx.db
      .query("reviews")
      .withIndex("by_repo_pr_head_mode", (q) =>
        q
          .eq("repositoryId", args.repositoryId)
          .eq("prNumber", delivery.prNumber!)
          .eq("headSha", delivery.headSha!)
          .eq("mode", mode),
      )
      .collect();
    // A blocked review never started and holds no work: it is a recorded refusal. It was also
    // non-terminal, so it matched here and was handed back to every later request, which replayed
    // the same refusal forever. One `@buildit review provider=<a provider with no key>` therefore
    // bricked that pull request's reviews permanently - the next request could not even be a
    // different provider, because it never got as far as reading one. Retire it and let the new
    // request build a fresh review instead.
    const stale = matching.filter(review => review.status === "blocked");
    for (const review of stale) {
      await ctx.db.patch(review._id, {
        status: "cancelled", statusReasonCode: "superseded_by_new_commit",
        nextActionCode: "start_new_review", currentStage: "complete",
        completedAt: args.now, updatedAt: args.now,
      });
    }
    const existing = matching.find(
      (review) => !terminalStatuses.has(review.status) && review.status !== "blocked",
    );
    if (existing) {
      await ctx.db.patch(delivery._id, { reviewId: existing._id });
      return {
        reviewId: existing._id,
        status: existing.status,
        headSha: existing.headSha,
        executionGeneration: existing.executionGeneration,
        // Carried so the caller can say "a review is already running" rather than falling through
        // to the no-key message, which is what it used to announce for every reused review.
        alreadyRunning: true as const,
      };
    }
    let config = repository.configRevisionId
      ? await ctx.db.get(repository.configRevisionId)
      : null;
    if (
      !config ||
      config.repositoryId !== repository._id ||
      config.organizationId !== args.organizationId
    ) {
      const contentHash = await digestText("buildit-defaults-v1");
      const configId = await ctx.db.insert("configRevisions", {
        organizationId: args.organizationId,
        repositoryId: repository._id,
        sourceCommitSha: delivery.baseSha,
        sourceRef: args.baseRef,
        contentHash,
        rulesDigest: contentHash,
        schemaVersion: "defaults-v1",
        validationState: "valid",
        provenance: "defaults_only",
        refProtectionState: "unverified",
        createdAt: args.now,
      });
      await ctx.db.patch(repository._id, {
        configRevisionId: configId,
        updatedAt: args.now,
      });
      config = await ctx.db.get(configId);
    }
    if (!config) throw new Error("configuration_unavailable");
    const credentials = await ctx.db
      .query("providerCredentials")
      .withIndex("by_org_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "valid"),
      )
      .collect();
    const eligible = credentials
      .filter(
        (item) =>
          (!args.expectedProvider || item.provider === args.expectedProvider) &&
          (item.repositoryId === repository._id || item.repositoryId === undefined),
      )
      ;
    // Recency alone picked the most recently validated key, which in a workspace holding both a
    // spent account and a working one is very often the spent one - the key you last touched is the
    // key you last tried to fix. orderCredentialsByHealth keeps recency as the tie-break and only
    // moves an account that has just reported no credit behind the others.
    const ordered = orderCredentialsByHealth(eligible, args.now);
    const credential =
      ordered.find((item) => item.repositoryId === repository._id) ??
      ordered.find((item) => item.repositoryId === undefined);
    const selectedProvider =
      credential?.provider ?? args.expectedProvider ?? "anthropic";
    const model = credential
      ? selectProviderModel(selectedProvider, credential.availableModels)
      : null;
    // A webhook must not error on a tenant limit: GitHub would retry the delivery and the PR
    // author would see nothing. Materialize the review as blocked so it is visible and retryable.
    const organization = await ctx.db.get(args.organizationId);
    const overConcurrency = Boolean(organization) && organization!.concurrencyLimit > 0
      && concurrencyExceeded(await activeReviewCount(ctx, args.organizationId, organization!.concurrencyLimit), organization!.concurrencyLimit);
    const status = overConcurrency ? ("blocked" as const) : credential && model ? ("queued" as const) : ("blocked" as const);
    const reviewId = await ctx.db.insert("reviews", {
      organizationId: args.organizationId,
      repositoryId: repository._id,
      githubRepositoryId: repository.githubRepositoryId,
      prNumber: delivery.prNumber,
      isFork: delivery.isFork ?? false,
      baseRef: args.baseRef,
      baseSha: delivery.baseSha,
      headSha: delivery.headSha,
      requiredCheckPolicy: "fail_closed",
      completedRoundCount: 0,
      patchAttemptCount: 0,
      diagnosticRunCount: 0,
      providerRetryCount: 0,
      commandRetryCount: 0,
      trigger: args.trigger ?? "github_comment",
      triggerVerb: delivery.triggerVerb,
      triggerActor: args.triggerActor,
      triggerActorPermission: args.actorPermission,
      mode,
      status,
      budgetLimit,
      budgetConsumed: 0,
      statusReasonCode: overConcurrency ? "concurrency_limit_reached" : credential ? undefined : "provider_credential_invalid",
      nextActionCode: overConcurrency ? "retry_review" : credential ? "none" : "reconnect_provider",
      isStale: false,
      ...(status === "blocked" ? { blockedExpiresAt: args.now + blockedReviewTtlMs } : {}),
      trustedRef: args.baseRef,
      trustedRefSha: delivery.baseSha,
      configRevisionId: config._id,
      configProvenance: "defaults_only",
      provider: selectedProvider,
      model: model ?? "unavailable",
      modelVersion: "pinned-at-execution",
      promptVersion: "chain-v1",
      evalSetVersion: "buildit-eval-v1",
      coverageLevel: "limited",
      currentStage: "queue",
      executionGeneration: 0,
      queuePriority: 0,
      runnerImageVersion: RUNNER_IMAGE_VERSION,
      expiresAt: args.now + retentionMs(organization?.retentionHours),
      createdAt: args.now,
      updatedAt: args.now,
    });
    await ctx.db.insert("reviewLocks", {
      repositoryId: repository._id,
      prNumber: delivery.prNumber,
      headSha: delivery.headSha,
      mode,
      reviewId,
      createdAt: args.now,
    });
    await ctx.db.insert("reviewEvents", {
      organizationId: args.organizationId,
      reviewId,
      sequence: 1,
      type: "review_created",
      stage: "queue",
      internalCode: credential ? "review_queued" : "provider_key_required",
      metadata: {},
      createdAt: args.now,
    });
    await ctx.db.patch(delivery._id, { reviewId });
    return {
      reviewId,
      status,
      // The caller tells the pull request why nothing is going to happen, which needs the reason.
      // Three ways a review refuses to start, and the caller used to be able to name only two - so
      // anything that was not the concurrency limit was announced on the pull request as "no model
      // provider is connected", including a key that is connected and simply exposes no model
      // BuildIT can use. Debugging a live incident against that message costs an hour, because the
      // one thing it rules out is the thing that is actually wrong.
      blockedReason: overConcurrency
        ? ("concurrency_limit_reached" as const)
        : !credential
          ? ("provider_credential_invalid" as const)
          : !model
            ? ("provider_model_unavailable" as const)
            : undefined,
      // Echoed back so the message can say which provider was asked for rather than implying none
      // exists: `@buildit review provider=anthropic` on an OpenAI-only workspace is a different
      // problem from having no key at all, and only the author knows which they meant.
      ...(args.expectedProvider ? { requestedProvider: args.expectedProvider } : {}),
      headSha: delivery.headSha,
      executionGeneration: 0,
    };
  },
});

async function digestText(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export const complete = internalMutation({
  args: {
    deliveryId: v.string(),
    disposition: v.union(
      v.literal("processed"),
      v.literal("ignored_bot"),
      v.literal("ignored_edit"),
      v.literal("duplicate"),
      v.literal("rejected"),
    ),
    status: v.union(
      v.literal("enqueued"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_delivery_id", (q) => q.eq("deliveryId", args.deliveryId))
      .unique();
    if (delivery)
      await ctx.db.patch(delivery._id, {
        disposition: args.disposition,
        status: args.status,
        completedAt: args.status === "enqueued" ? undefined : args.now,
      });
    await ctx.scheduler.runAfter(0, internal.telemetryWorker.emit, webhookTelemetryOutcome(args.disposition, args.status));
  },
});

export const reconcilePullRequestHead = internalMutation({
  args: {
    installationId: v.number(),
    githubRepositoryId: v.number(),
    prNumber: v.number(),
    observedHeadSha: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.prNumber) ||
      args.prNumber < 1 ||
      !/^[0-9a-f]{40}$/i.test(args.observedHeadSha)
    )
      throw new Error("invalid_pull_request_snapshot");
    const installation = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", args.installationId),
      )
      .unique();
    const repository = await ctx.db
      .query("repositories")
      .withIndex("by_github_id", (q) =>
        q.eq("githubRepositoryId", args.githubRepositoryId),
      )
      .unique();
    if (
      !installation ||
      installation.status !== "active" ||
      !repository ||
      !repository.enabled ||
      repository.installationId !== installation._id ||
      repository.organizationId !== installation.organizationId
    )
      throw new Error("repository_unavailable");
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_repo_pr_head_mode", (q) =>
        q.eq("repositoryId", repository._id).eq("prNumber", args.prNumber),
      )
      .collect();
    let staleCount = 0;
    for (const review of reviews) {
      if (review.headSha === args.observedHeadSha || review.isStale) continue;
      const active = !terminalStatuses.has(review.status);
      await recordReviewMetric(ctx, review, "stale_review", args.now);
      await ctx.db.patch(review._id, {
        isStale: true,
        staleSince: args.now,
        observedHeadSha: args.observedHeadSha.toLowerCase(),
        // Terminal in the same mutation that bumps the generation. Without this the next
        // assertActive throws, the workflow fails, and workflowCompleted returns on the
        // generation mismatch without writing anything - leaving the review "In progress" forever.
        ...(active ? { status: "cancelled" as const, statusReasonCode: "superseded_by_new_commit" as const,
          nextActionCode: "start_new_review" as const, githubCheckConclusion: "neutral" as const,
          currentStage: "complete" as const, completedAt: args.now } : {}),
        executionGeneration: active
          ? review.executionGeneration + 1
          : review.executionGeneration,
        leaseOwner: active ? undefined : review.leaseOwner,
        leaseExpiresAt: active ? undefined : review.leaseExpiresAt,
        updatedAt: args.now,
      });
      // The row went terminal above, and the acknowledgement check run created when the review
      // started did not. It stayed in_progress on the old head forever, and where an organization
      // has made "BuildIT / review" a required check, BuildIT itself blocked the merge with nothing
      // in the product able to clear it. No-ops unless this patch actually cancelled the review.
      await publishCancellationNotice(ctx, review._id);
      staleCount++;
    }
    return { staleCount };
  },
});

export const reconcileDefaultBranchPush = internalMutation({
  args: {
    installationId: v.number(),
    githubRepositoryId: v.number(),
    ref: v.string(),
    afterSha: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      !/^refs\/heads\/[A-Za-z0-9._\/-]+$/.test(args.ref) ||
      !/^[0-9a-f]{40}$/i.test(args.afterSha)
    )
      throw new Error("invalid_push_snapshot");
    const installation = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", args.installationId),
      )
      .unique();
    const repository = await ctx.db
      .query("repositories")
      .withIndex("by_github_id", (q) =>
        q.eq("githubRepositoryId", args.githubRepositoryId),
      )
      .unique();
    if (
      !installation ||
      installation.status !== "active" ||
      !repository ||
      !repository.enabled ||
      repository.installationId !== installation._id ||
      repository.organizationId !== installation.organizationId
    )
      throw new Error("repository_unavailable");
    const branch = args.ref.slice("refs/heads/".length);
    if (branch !== repository.defaultBranch)
      return { staleCount: 0, ignored: true };
    // This used to cancel every in-flight review in the repository whose base was this branch, so
    // one routine merge killed every other open pull request's review at once - silently, because
    // the cancellation was never published, and permanently, because nothing re-queued them. The
    // author watched "BuildIT is reviewing this pull request" simply stop.
    //
    // The base moving does not make findings about the head commit wrong. It makes them findings
    // against an older base, which is a caveat to state rather than a result to throw away.
    // Cancelling and re-queueing was the other option and is worse: it spends the model budget
    // again on every merge, and on a repository where merges arrive faster than reviews finish, no
    // review ever completes.
    const { driftedCount } = await recordBaseAdvance(ctx, {
      organizationId: repository.organizationId,
      repositoryId: repository._id,
      branch,
      afterSha: args.afterSha,
      now: args.now,
    });
    const staleCount = driftedCount;
    return { staleCount, ignored: false };
  },
});
