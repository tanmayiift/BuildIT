import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import * as value from "./validators";

const timestampFields = { createdAt: v.number(), updatedAt: v.number() };

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()), image: v.optional(v.string()), email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()), phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()), isAnonymous: v.optional(v.boolean()),
    githubUserId: v.optional(v.number()), githubLogin: v.optional(v.string()), login: v.optional(v.string()),
  }).index("email", ["email"]).index("phone", ["phone"]).index("githubUserId", ["githubUserId"]),
  organizations: defineTable({
    name: v.string(), slug: v.string(), timezone: v.string(), region: v.literal("eu-west-1"),
    retentionHours: v.number(), monthlyBudget: v.number(), concurrencyLimit: v.number(),
    planId: v.string(), fingerprintKeyVersion: v.number(), createdAt: v.number(),
    monthlySpendMicros: v.optional(v.number()), monthlySpendMonth: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
  }).index("by_slug", ["slug"]).index("by_deleted", ["deletedAt"]).index("by_created", ["createdAt"]),

  memberships: defineTable({
    organizationId: v.id("organizations"), userId: v.string(), role: value.role,
    status: value.membershipStatus, createdAt: v.number(), updatedAt: v.number(),
  }).index("by_org_user", ["organizationId", "userId"])
    .index("by_org_status", ["organizationId", "status"])
    .index("by_user_status", ["userId", "status"]),

  userPreferences: defineTable({
    userId: v.string(), activeOrganizationId: v.optional(v.id("organizations")), updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  userProfiles: defineTable({
    userId: v.id("users"), githubUserId: v.number(), githubLogin: v.string(),
    lastAuthenticatedAt: v.optional(v.number()), updatedAt: v.number(),
  }).index("by_user", ["userId"]).index("by_github_user", ["githubUserId"]).index("by_github_login", ["githubLogin"]),

  githubInstallations: defineTable({
    organizationId: v.id("organizations"), installationId: v.number(), accountLogin: v.string(),
    accountType: value.accountType,
    permissionSnapshot: v.object({
      metadata: v.literal("read"), contents: v.union(v.literal("read"), v.literal("write")),
      pullRequests: v.literal("write"), issues: v.literal("read"),
      checks: v.union(v.literal("read"), v.literal("write")),
    }),
    status: value.installationStatus, suspendedAt: v.optional(v.number()), ...timestampFields,
  }).index("by_installation", ["installationId"])
    .index("by_org_status", ["organizationId", "status"]),

  repositories: defineTable({
    organizationId: v.id("organizations"), installationId: v.id("githubInstallations"),
    githubRepositoryId: v.number(), owner: v.string(), name: v.string(), defaultBranch: v.string(), visibility: v.optional(value.repositoryVisibility),
    enabled: v.boolean(), pausedAt: v.optional(v.number()), autofixMode: value.autofixMode,
    // How much of what survived the evidence gate lands on the diff. The summary comment always
    // carries everything; this only decides what is loud.
    reviewProfile: v.optional(value.reviewProfile),
    // Paths this team would never review - a vendored directory, a generated client - on top of
    // the defaults BuildIT already skips. Glob, not regex, deliberately.
    reviewPathFilters: v.optional(v.array(v.string())),
    // Automatic review spends the customer's own model key, so it is off until a repository asks
    // for it - including the ones already connected.
    reviewTrigger: v.optional(v.union(v.literal("manual"), v.literal("automatic"))),
    // An admin approves the configuration, not the commit: the trusted ref is the base branch and
    // its sha moves on every merge, so approving a commit meant re-approving an unchanged file
    // several times a day - and an approval nobody reads is worse than no approval.
    approvedConfigHash: v.optional(v.string()), approvedConfigBy: v.optional(v.string()),
    // The configuration the last review actually read and refused, so an admin can approve the
    // exact version they were told about. Without this the receipt names a hash the product has no
    // way to act on, and the only route to trusting a config file is a support request.
    pendingConfigHash: v.optional(v.string()), pendingConfigSeenAt: v.optional(v.number()),
    // Off unless asked: BuildIT opening pull requests nobody wanted is its own kind of noise.
    changelogOnMerge: v.optional(v.boolean()),
    forkPolicy: value.forkPolicy, configRevisionId: v.optional(v.id("configRevisions")),
    indexState: value.indexState, concurrencyLimit: v.number(), ...timestampFields,
  }).index("by_github_id", ["githubRepositoryId"])
    .index("by_installation", ["installationId"])
    .index("by_org_enabled", ["organizationId", "enabled"]),

  configRevisions: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.id("repositories"),
    sourceCommitSha: v.string(), sourceRef: v.string(), configArtifactId: v.optional(v.id("artifacts")),
    contentHash: v.string(), rulesDigest: v.string(), schemaVersion: v.string(),
    validationState: value.configValidationState, provenance: value.configProvenance,
    refProtectionState: value.refProtectionState, approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()), createdAt: v.number(),
  }).index("by_repository_hash", ["repositoryId", "contentHash"])
    .index("by_repository_created", ["repositoryId", "createdAt"]),

  providerCredentials: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")), credentialScopeId: v.string(), provider: value.provider,
    encryptedCiphertext: v.string(), nonce: v.string(), authTag: v.string(), aadDigest: v.string(),
    wrappedDataKey: v.string(), kmsKeyId: v.string(), envelopeVersion: v.literal(1),
    keyVersion: v.number(), maskedSuffix: v.string(), availableModels: v.optional(v.array(v.string())), status: value.credentialStatus,
    createdBy: v.string(), createdAt: v.number(), lastValidatedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()), revokedAt: v.optional(v.number()),
  }).index("by_org_provider", ["organizationId", "provider"])
    .index("by_repository_provider", ["repositoryId", "provider"])
    .index("by_scope", ["credentialScopeId"])
    .index("by_org_status", ["organizationId", "status"]),

  credentialRateLimits: defineTable({
    organizationId: v.id("organizations"), userId: v.string(), action: v.literal("credential_validate"),
    windowStart: v.number(), attemptCount: v.number(), updatedAt: v.number(),
  }).index("by_org_user_action_window", ["organizationId", "userId", "action", "windowStart"]),

  trackerConnections: defineTable({
    organizationId: v.id("organizations"), repositoryId:v.optional(v.id("repositories")),provider: value.trackerProvider,
    credentialScopeId:v.string(),wrappedDataKey:v.string(),kmsKeyId:v.string(),envelopeVersion:v.literal(1),
    encryptedAccessToken: v.string(), encryptedRefreshToken: v.optional(v.string()),
    nonce: v.string(), authTag: v.string(), aadDigest: v.string(), keyVersion: v.number(),
    scopes: v.array(v.string()), workspaceId: v.string(), status: value.trackerStatus,
    createdBy: v.string(),maskedSuffix:v.string(),lastValidatedAt:v.number(),lastUsedAt:v.optional(v.number()),revokedAt:v.optional(v.number()), expiresAt: v.optional(v.number()), ...timestampFields,
  }).index("by_org_provider", ["organizationId", "provider"])
    .index("by_status", ["status"]),

  reviews: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.id("repositories"),
    githubRepositoryId: v.number(), prNumber: v.number(), isFork: v.boolean(),
    baseRef: v.string(), baseSha: v.string(), headSha: v.string(),
    githubCheckConclusion: v.optional(value.githubConclusion), requiredCheckPolicy: value.requiredCheckPolicy,
    completedRoundCount: v.number(), patchAttemptCount: v.number(), diagnosticRunCount: v.number(),
    providerRetryCount: v.number(), commandRetryCount: v.number(), trigger: value.triggerSource,
    triggerVerb: value.triggerVerb, triggerActor: v.string(), triggerActorPermission: value.actorPermission,
    mode: value.reviewMode, status: value.reviewStatus,
    terminationBound: v.optional(value.terminationBound), budgetCeilingId: v.optional(v.string()),
    budgetLimit: v.number(), budgetConsumed: v.number(), statusReasonCode: v.optional(value.statusReasonCode), statusDetail: v.optional(v.string()),
    nextActionCode: value.nextActionCode, isStale: v.boolean(), staleSince: v.optional(v.number()),
    observedHeadSha: v.optional(v.string()), trustedRef: v.string(), trustedRefSha: v.string(),
    configRevisionId: v.id("configRevisions"), configProvenance: value.configProvenance,
    provider: value.provider, model: v.string(), modelVersion: v.string(), promptVersion: v.string(),
    evalSetVersion: v.string(), coverageLevel: value.coverageLevel, coverageGap: v.optional(value.coverageGap),
    // Beside the gap it explains, because "requirements" alone is what made the receipt say
    // "One or more unreadable" and name neither which source nor why.
    unreadableSources: v.optional(v.object({ total: v.number(), unreadable: v.number(), summary: v.string(), nextStep: v.string() })),
    // Counted from the diff at context time, where the file list actually is.
    changeSummary: v.optional(v.string()),
    configNote: v.optional(v.string()),
    currentStage: value.reviewStage,
    promptInjectionUnscopedAt: v.optional(v.number()), promptInjectionSurfaces: v.optional(v.array(value.injectionSurface)),
    blockedReason: v.optional(v.string()), blockedSince: v.optional(v.number()),
    blockedExpiresAt: v.optional(v.number()), parentReviewId: v.optional(v.id("reviews")),
    attemptOfReviewId: v.optional(v.id("reviews")), cancelledBy: v.optional(v.string()),
    cancellationRequestedAt: v.optional(v.number()), executionGeneration: v.number(),
    workflowId: v.optional(v.string()),
    queuePriority: v.number(), leaseOwner: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()),
    sandboxId: v.optional(v.string()), runnerImageVersion: v.string(), startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()), expiresAt: v.number(), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_org_status", ["organizationId", "status"])
    .index("by_status", ["status", "updatedAt"])
    .index("by_repo_pr_head_mode", ["repositoryId", "prNumber", "headSha", "mode"])
    .index("by_expiry", ["expiresAt"])
    .index("by_org_created", ["organizationId", "createdAt"])
    .index("by_queue", ["organizationId", "status", "createdAt"])
    .index("by_blocked_expiry", ["status", "blockedExpiresAt"]),

  reviewEvents: defineTable({
    organizationId: v.id("organizations"), reviewId: v.id("reviews"), sequence: v.number(),
    type: value.eventType, stage: value.reviewStage,
    publicMessageArtifactId: v.optional(v.id("artifacts")), internalCode: v.string(),
    metadata: v.object({ count: v.optional(v.number()), durationMs: v.optional(v.number()),
      reasonCode: v.optional(v.string()), externalIdHash: v.optional(v.string()) }),
    createdAt: v.number(),
  }).index("by_review", ["reviewId", "sequence"])
    .index("by_org_created", ["organizationId", "createdAt"]),

  modelStageRuns: defineTable({
    organizationId:v.id("organizations"),repositoryId:v.id("repositories"),reviewId:v.id("reviews"),roundNumber:v.optional(v.number()),stage:value.modelStage,
    provider:value.provider,model:v.string(),promptVersion:v.string(),schemaVersion:v.string(),finishReason:v.string(),requestHash:v.string(),requestId:v.optional(v.string()),
    attempt:v.number(),outcome:value.modelStageOutcome,inputTokens:v.number(),outputTokens:v.number(),createdAt:v.number(),
    // Optional because rows written before this existed have neither, and backfilling a duration
    // nobody measured would be inventing evidence. durationMs is the provider call itself;
    // costMicros is what recordStageRun already computed to charge the budget and then discarded,
    // so per-stage cost was derivable from tokens but never actually stored anywhere.
    durationMs:v.optional(v.number()),costMicros:v.optional(v.number()),
    runId:v.optional(v.string()),
  }).index("by_review",["reviewId"]).index("by_review_stage",["reviewId","stage"]),

  requirements: defineTable({
    organizationId: v.id("organizations"), reviewId: v.id("reviews"), sourceType: value.sourceType,
    sourceUrlHash: v.optional(v.string()), externalIdHash: v.optional(v.string()),
    contentArtifactId: v.optional(v.id("artifacts")), fetchedVersion: v.optional(v.string()),
    fetchedAt: v.optional(v.number()), status: value.requirementStatus, confidence: v.number(),
    createdAt: v.number(), updatedAt: v.number(), expiresAt: v.number(),
  }).index("by_review", ["reviewId"]),

  findings: defineTable({
    organizationId: v.id("organizations"), reviewId: v.id("reviews"), fingerprintHmac: v.string(),
    category: value.findingCategory, severity: value.severity, confidence: v.number(), blocking: v.boolean(),
    contentArtifactId: v.id("artifacts"), evidenceIds: v.array(v.id("artifacts")), pathHmac: v.string(),
    startLine: v.number(), endLine: v.number(), ruleId: v.optional(v.string()),
    requirementId: v.optional(v.id("requirements")), resolution: value.findingResolution, uncertainPasses: v.optional(v.number()),
    injectionSuspected: v.optional(v.boolean()),
    createdAt: v.number(), updatedAt: v.number(), expiresAt: v.number(),
  }).index("by_organization", ["organizationId"])
    .index("by_review_severity", ["reviewId", "severity"])
    .index("by_review_fingerprint", ["reviewId", "fingerprintHmac"]),

  evalCandidates: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.id("repositories"), reviewId: v.id("reviews"),
    // "missed" is a run that reached no verdict; "false_positive" is a finding a person dismissed.
    kind: v.union(v.literal("missed"), v.literal("false_positive")),
    reasonCode: v.string(), fingerprintHmac: v.optional(v.string()),
    promptVersion: v.string(), model: v.string(), headSha: v.string(),
    reviewedIntoEvalSet: v.optional(v.boolean()), createdAt: v.number(),
  }).index("by_org_created", ["organizationId", "createdAt"])
    .index("by_pending", ["reviewedIntoEvalSet", "createdAt"])
    .index("by_review", ["reviewId"]),

  findingSuppressions: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.id("repositories"),
    fingerprintHmac: v.string(), hmacKeyVersion: v.number(), scope: value.suppressionScope,
    scopeValueHmac: v.string(), reasonCode: v.string(), dismissedBy: v.string(),
    dismissedAt: v.number(), expiresAt: v.optional(v.number()),
  }).index("by_repo_fingerprint", ["repositoryId", "fingerprintHmac"])
    .index("by_expiry", ["expiresAt"]),

  checkRuns: defineTable({
    organizationId: v.id("organizations"), reviewId: v.id("reviews"),
    roundId: v.optional(v.id("autofixRounds")), kind: value.checkKind, nameHash: v.string(),
    required: v.boolean(), status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed")),
    conclusion: value.checkConclusion, commandFingerprint: v.string(), commitSha: v.string(),
    exitCode: v.optional(v.number()), durationMs: v.number(), artifactId: v.optional(v.id("artifacts")),
    credentialTeardownProved: v.optional(v.boolean()), sandboxStopped: v.optional(v.boolean()),
    executionFingerprint:v.optional(v.string()),outputHash:v.optional(v.string()),outputTruncated:v.optional(v.boolean()),scannerName:v.optional(v.string()),scannerVersion:v.optional(v.string()),
    regressionClassification:v.optional(v.union(v.literal("introduced"),v.literal("pre_existing"),v.literal("resolved"),v.literal("unchanged_pass"),v.literal("flaky"),v.literal("unknown"))),
    failureClass: v.optional(value.failureClass), startedAt: v.number(), completedAt: v.optional(v.number()),
  }).index("by_review", ["reviewId"])
    .index("by_review_round", ["reviewId", "roundId"]),

  baseResults: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.id("repositories"), baseSha: v.string(),
    commandFingerprint: v.string(), configRevisionId: v.id("configRevisions"), runnerImageVersion: v.string(),
    toolVersions: v.array(v.object({ name: v.string(), version: v.string() })), architecture: v.string(),
    networkPolicyVersion: v.string(), conclusion: value.checkConclusion,
    artifactId: v.optional(v.id("artifacts")), computedAt: v.number(), expiresAt: v.number(),
  }).index("by_full_cache_key", ["repositoryId", "baseSha", "commandFingerprint", "configRevisionId", "runnerImageVersion", "architecture", "networkPolicyVersion"])
    .index("by_expiry", ["expiresAt"]),

  autofixAttempts: defineTable({
    organizationId: v.id("organizations"), reviewId: v.id("reviews"), attemptNumber: v.number(),
    patchFingerprint: v.string(), patchArtifactId: v.optional(v.id("artifacts")), outcome: value.patchOutcome,
    rejectionReasonCode: v.optional(v.string()), promptVersion: v.string(), startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_review_attempt", ["reviewId", "attemptNumber"])
    .index("by_review_fingerprint", ["reviewId", "patchFingerprint"]),

  autofixRounds: defineTable({
    organizationId: v.id("organizations"), reviewId: v.id("reviews"), roundNumber: v.number(),
    attemptId: v.id("autofixAttempts"), candidateCommitSha: v.string(), validationScope: value.validationScope,
    validationOutcome: value.validationOutcome, completedValidation: v.boolean(),
    startedAt: v.number(), completedAt: v.optional(v.number()),
  }).index("by_review_round", ["reviewId", "roundNumber"])
    .index("by_attempt", ["attemptId"]),

  artifacts: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.id("repositories"), reviewId: v.optional(v.id("reviews")), type: value.artifactType,
    storageKey: v.string(), encrypted: v.literal(true), checksum: v.string(), size: v.number(),
    redactionStatus: value.redactionStatus, expiresAt: v.number(), deletedAt: v.optional(v.number()),
    deletionAttempts: v.number(), deletionLeaseId: v.optional(v.string()), deletionLeaseExpiresAt: v.optional(v.number()),
    lastDeletionErrorCode: v.optional(v.string()), deletionTerminalAt: v.optional(v.number()),
  }).index("by_expiry", ["expiresAt"])
    .index("by_pending_expiry", ["deletedAt", "expiresAt"])
    // Retention claims must skip rows that are already gone or permanently stuck. Skipping them
    // in the loop instead left them holding the front of by_expiry forever, so once enough
    // accumulated the cron claimed zero work and deletion stopped with no error and no alert.
    .index("by_claimable_expiry", ["deletionTerminalAt", "deletedAt", "expiresAt"])
    .index("by_deletion_terminal", ["deletionTerminalAt"])
    .index("by_repository", ["repositoryId"])
    .index("by_review", ["reviewId"]),

  usageLedger: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.id("repositories"), reviewId: v.id("reviews"),
    roundId: v.optional(v.id("autofixRounds")), kind: value.usageKind, quantity: v.number(),
    // The authoritative cost of the row. unitCost is retained for rows written before this
    // existed; it is a derived price and reconstructing a total from it loses the cost of any
    // call a provider reported no usage for.
    unitCost: v.number(), totalCostMicros: v.optional(v.number()), currency: v.string(), occurredAt: v.number(),
  }).index("by_org_time", ["organizationId", "occurredAt"])
    .index("by_time", ["occurredAt"])
    .index("by_review", ["reviewId"]),

  githubSideEffects: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.id("repositories"), reviewId: v.id("reviews"), operationKey: v.string(),
    type: value.sideEffectType, externalId: v.optional(v.string()), requestHash: v.string(),
    status: value.sideEffectStatus, createdAt: v.number(), updatedAt: v.number(),
  }).index("by_repo_operation_key", ["repositoryId", "operationKey"])
    .index("by_review", ["reviewId"]),

  deliveries: defineTable({
    organizationId: v.id("organizations"), reviewId: v.id("reviews"),
    sourceHeadSha: v.string(), candidateCommitSha: v.string(), branchNameHash: v.string(),
    pullRequestNumber: v.optional(v.number()), pullRequestId: v.optional(v.number()),
    status: v.union(v.literal("reserved"), v.literal("branch_created"), v.literal("pr_created"), v.literal("failed")),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_review", ["reviewId"])
    .index("by_candidate", ["candidateCommitSha"]),

  // A pause has to outlive the next push, which is the whole point of it, so it cannot live on a
  // review row - a review is per commit. It is a fact about one pull request.
  pullRequestPauses: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.id("repositories"), prNumber: v.number(),
    pausedBy: v.string(), pausedAt: v.number(),
  }).index("by_repository_pr", ["repositoryId", "prNumber"]),

  // What a person did with a finding. Learning reads this to decide what to stop putting on the
  // diff; the history page reads it to answer whether BuildIT is useful on this repository. One
  // record, because inferring the same fact twice is how two surfaces come to disagree.
  //
  // Keyed on repositoryId, never organizationId: one team's dismissals must not change another
  // team's reviews, and two repositories in the same organization stay independent. Paths are
  // hashed, like pathHmac on findings.
  findingFeedback: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.id("repositories"), reviewId: v.id("reviews"),
    findingId: v.optional(v.id("findings")), fingerprintHmac: v.string(),
    ruleKey: v.string(), pathPrefixHmac: v.string(),
    verdict: v.union(v.literal("accepted"), v.literal("dismissed")),
    actorHash: v.string(), occurredAt: v.number(),
  }).index("by_repository_rule", ["repositoryId", "ruleKey", "pathPrefixHmac"])
    .index("by_review", ["reviewId"])
    .index("by_repository_time", ["repositoryId", "occurredAt"]),

  webhookDeliveries: defineTable({
    deliveryId: v.string(), event: v.string(), action: v.string(), installationId: v.optional(v.number()),
    signatureValid: v.boolean(), disposition: value.webhookDisposition, status: value.webhookStatus,
    reviewId: v.optional(v.id("reviews")), prNumber: v.optional(v.number()), headSha: v.optional(v.string()),
    baseSha: v.optional(v.string()), headRefHash: v.optional(v.string()), baseRefHash: v.optional(v.string()),
    isFork: v.optional(v.boolean()), triggerVerb: v.optional(value.triggerVerb),
    receivedAt: v.number(), completedAt: v.optional(v.number()), expiresAt: v.optional(v.number()),
  }).index("by_delivery_id", ["deliveryId"])
    .index("by_status_received", ["status", "receivedAt"])
    .index("by_expiry", ["expiresAt"]),

  notifications: defineTable({
    organizationId: v.id("organizations"), userId: v.string(), type: value.notificationType,
    channel: value.notificationChannel, reviewId: v.optional(v.id("reviews")), sentAt: v.optional(v.number()),
    deliveryStatus: value.notificationStatus, dedupeKey: v.string(), createdAt: v.number(),
  }).index("by_dedupe_key", ["dedupeKey"])
    .index("by_user_created", ["userId", "createdAt"]),

  notificationPreferences: defineTable({
    organizationId: v.id("organizations"), userId: v.string(), emailEnabled: v.boolean(),
    emailConsentedAt: v.optional(v.number()),
    digestMode: v.union(v.literal("immediate"), v.literal("daily")),
    mutedRepositoryIds: v.array(v.id("repositories")), updatedAt: v.number(),
  }).index("by_org_user", ["organizationId", "userId"]),

  auditEvents: defineTable({
    organizationId: v.id("organizations"), actorId: v.string(), action: v.string(),
    resourceType: v.string(), resourceIdHash: v.string(), result: value.auditResult,
    requestId: v.string(), previousHash: v.optional(v.string()), eventHash: v.string(), createdAt: v.number(),
  }).index("by_org_created", ["organizationId", "createdAt"])
    .index("by_request", ["requestId"]),

  metricEvents: defineTable({
    organizationId: v.id("organizations"), repositoryId: v.optional(v.id("repositories")),
    reviewId: v.optional(v.id("reviews")), roundId: v.optional(v.id("autofixRounds")),
    name: value.metricName, value: v.number(), organizationTimezone: v.string(), occurredAt: v.number(),
  }).index("by_org_time", ["organizationId", "occurredAt"])
    .index("by_name_time", ["name", "occurredAt"])
    .index("by_review_name", ["reviewId", "name"]),

  reviewLocks: defineTable({
    repositoryId: v.id("repositories"), prNumber: v.number(), headSha: v.string(),
    mode: value.reviewMode, reviewId: v.id("reviews"), createdAt: v.number(),
  }).index("by_scope", ["repositoryId", "prNumber", "headSha", "mode"])
    .index("by_review", ["reviewId"]),
});
