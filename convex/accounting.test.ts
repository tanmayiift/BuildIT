/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { invokeAccountedModel } from "./lib/accountedModel";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import schema from "./schema";
const githubState = vi.hoisted(() => ({ failPublication: false, publications: 0 }));
vi.mock("@buildit/github", async importOriginal => ({
  ...await importOriginal<typeof import("@buildit/github")>(),
  GitHubAppClient: class { async tokenFor() { return "test-installation-token"; } async revoke() {} },
  GitHubRepositoryWriter: class { async upsertIssueComment() { githubState.publications += 1; if (githubState.failPublication) throw new Error("test_github_unavailable"); } },
}));
const modules = import.meta.glob("./**/*.ts");
const now = Date.UTC(2026, 8, 14, 12);
async function seed(t: ReturnType<typeof convexTest>, budgetLimit = 5, monthlyBudget = 10) {
  return t.run(async ctx => {
    const organizationId = await ctx.db.insert("organizations", { name: "Accounting test", slug: "accounting", timezone: "Asia/Kolkata", region: "eu-west-1", retentionHours: 24, monthlyBudget, concurrencyLimit: 2, planId: "test", fingerprintKeyVersion: 1, createdAt: now });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: 1, accountLogin: "accounting", accountType: "organization", permissionSnapshot: { metadata: "read", contents: "write", pullRequests: "write", issues: "read", checks: "write" }, status: "active", createdAt: now, updatedAt: now });
    const repositoryId = await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: 1, owner: "accounting", name: "test", defaultBranch: "main", enabled: true, autofixMode: "stacked", forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 2, createdAt: now, updatedAt: now });
    const configArtifactId = await ctx.db.insert("artifacts", { organizationId, repositoryId, type: "configuration", storageKey: "test/config", encrypted: true, checksum: "a".repeat(64), size: 1, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
    const configRevisionId = await ctx.db.insert("configRevisions", { organizationId, repositoryId, sourceCommitSha: "b".repeat(40), sourceRef: "main", configArtifactId, contentHash: "config", rulesDigest: "rules", schemaVersion: "1", validationState: "valid", provenance: "defaults_only", refProtectionState: "unverified", createdAt: now });
    await ctx.db.patch(repositoryId, { configRevisionId });
    const reviewId = await ctx.db.insert("reviews", { organizationId, repositoryId, githubRepositoryId: 1, prNumber: 1, isFork: false, baseRef: "main", baseSha: "b".repeat(40), headSha: "a".repeat(40), requiredCheckPolicy: "advisory", completedRoundCount: 0, patchAttemptCount: 0, diagnosticRunCount: 0, providerRetryCount: 0, commandRetryCount: 0, trigger: "dashboard", triggerVerb: "review", triggerActor: "test", triggerActorPermission: "admin", mode: "review", status: "analyzing", budgetLimit, budgetConsumed: 0, nextActionCode: "none", isStale: false, trustedRef: "main", trustedRefSha: "b".repeat(40), configRevisionId, configProvenance: "defaults_only", provider: "anthropic", model: "claude-sonnet-4-5", modelVersion: "test", promptVersion: "test", evalSetVersion: "test", coverageLevel: "limited", currentStage: "analysis", runnerImageVersion: "test", executionGeneration: 0, queuePriority: 0, expiresAt: now + 60_000, createdAt: now, updatedAt: now });
    return { organizationId, repositoryId, reviewId, expectedHeadSha: "a".repeat(40), expectedGeneration: 0 };
  });
}

describe("charges already incurred remain accountable", () => {
  it("records an over-limit response and preserves the stop, instead of rolling both back", async () => {
    const t = convexTest(schema, modules), args = await seed(t, 0.01);
    const { repositoryId: _repositoryId, ...scope } = args;
    await t.mutation(internal.reviewModelData.recordStageRun, { ...scope, stage: "findings", provider: "anthropic", model: "claude-sonnet-4-5", promptVersion: "v1", schemaVersion: "v1", finishReason: "tool_use", requestHash: "9".repeat(64), requestId: "paid-1", attempt: 1, outcome: "valid", inputTokens: 1_000, outputTokens: 1_000, now }).catch(() => undefined);
    expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.get(args.reviewId))).toMatchObject({ status: "budget_exhausted", budgetConsumed: 0.09 });
  });
  it("does not stamp away pre-existing spend when an Ask is the first new writer", async () => {
    const t = convexTest(schema, modules), args = await seed(t);
    await t.run(ctx => ctx.db.insert("usageLedger", { organizationId: args.organizationId, repositoryId: args.repositoryId, reviewId: args.reviewId, kind: "model_tokens", quantity: 1, unitCost: 8, totalCostMicros: 8_000_000, currency: "provider_billed", occurredAt: now - 1 }));
    await t.mutation(internal.reviewAskData.recordAsk, { organizationId: args.organizationId, reviewId: args.reviewId, provider: "anthropic", model: "claude-sonnet-4-5", inputTokens: 1_000, outputTokens: 1_000, now });
    expect(await t.run(ctx => ctx.db.get(args.organizationId))).toMatchObject({ monthlySpendMicros: 8_090_000 });
  });
});

// New invocation API regression cases follow below once the path exists; no provider or network calls.

const reserveCall = makeFunctionReference<"mutation">("modelAccounting:reserve");
const settleCall = makeFunctionReference<"mutation">("modelAccounting:settle");
const snapshotCall = makeFunctionReference<"query">("modelAccounting:snapshot");
const reconcileCall = makeFunctionReference<"mutation">("modelAccounting:reconcile");
const reservation = (scope: Awaited<ReturnType<typeof seed>>, key: string, extra: Record<string, unknown> = {}) => {
  const { repositoryId: _repositoryId, ...args } = scope;
  return { ...args, invocationKey: key.padEnd(20, "x"), requestHash: "7".repeat(64), stage: "findings", provider: "anthropic", model: "claude-sonnet-4-5", inputBytes: 0, maxOutputTokens: 100, now, ...extra };
};
const payment = (organizationId: Awaited<ReturnType<typeof seed>>["organizationId"], invocationId: string, extra: Record<string, unknown> = {}) => ({ organizationId, invocationId, outcome: "estimated", inputTokens: 1_000, outputTokens: 1_000, finishReason: "tool_use", now, ...extra });

describe("durable invocation accounting", () => {
  it.each(["cancelling", "requested", "installation_suspended", "expired"])("refuses a new paid call after %s", async stopped => {
    const t = convexTest(schema, modules), scope = await seed(t);
    await t.run(async ctx => {
      if (stopped === "cancelling") await ctx.db.patch(scope.reviewId, { status: "cancelling" });
      if (stopped === "requested") await ctx.db.patch(scope.reviewId, { cancellationRequestedAt: now });
      if (stopped === "expired") await ctx.db.patch(scope.reviewId, { expiresAt: now });
      if (stopped === "installation_suspended") {
        const repository = (await ctx.db.get(scope.repositoryId))!;
        await ctx.db.patch(repository.installationId, { status: "suspended" });
      }
    });
    await expect(t.mutation(reserveCall, reservation(scope, "stopped"))).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.query("modelInvocations").collect())).toHaveLength(0);
  });
  it("preserves a cancellation in progress when a late paid response exceeds the budget", async () => {
    const t = convexTest(schema, modules), scope = await seed(t, 0.07);
    const reserved = await t.mutation(reserveCall, reservation(scope, "late"));
    await t.run(ctx => ctx.db.patch(scope.reviewId, { status: "cancelling", cancellationRequestedAt: now }));
    await t.mutation(settleCall, payment(scope.organizationId, reserved.invocationId));
    expect(await t.run(ctx => ctx.db.get(scope.reviewId))).toMatchObject({ status: "cancelling", cancellationRequestedAt: now, budgetConsumed: 0.09 });
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0.09, reservedUsd: 0 });
  });
  it("reserves allowance atomically so simultaneous reviews cannot spend the same remainder", async () => {
    const t = convexTest(schema, modules), scope = await seed(t, 5, 0.1);
    const secondId = await t.run(async ctx => { const { _id: _id, _creationTime: _time, ...copy } = (await ctx.db.get(scope.reviewId))!; return ctx.db.insert("reviews", { ...copy, prNumber: 2 }); });
    const results = await Promise.all([t.mutation(reserveCall, reservation(scope, "first")), t.mutation(reserveCall, reservation({ ...scope, reviewId: secondId }, "second"))]);
    expect(results.filter(item => item.allowed)).toHaveLength(1);
    expect(results.find(item => !item.allowed)).toMatchObject({ reason: "budget_exhausted" });
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0, reservedUsd: 0.06894, unknownInvocationCount: 1 });
  });
  it("does not reuse an invocation id to issue a second external request", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    await t.mutation(reserveCall, reservation(scope, "first"));
    expect(await t.mutation(reserveCall, reservation(scope, "first"))).toMatchObject({ allowed: false, reason: "invocation_already_reserved" });
    expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toHaveLength(1);
  });
  it("settles callback replay once but counts two actual requests for the same prompt", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    const first = await t.mutation(reserveCall, reservation(scope, "first"));
    await t.mutation(settleCall, payment(scope.organizationId, first.invocationId));
    await t.mutation(settleCall, payment(scope.organizationId, first.invocationId));
    const second = await t.mutation(reserveCall, reservation(scope, "second"));
    await t.mutation(settleCall, payment(scope.organizationId, second.invocationId));
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0.18, reservedUsd: 0, accountingComplete: true });
    expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toHaveLength(2);
  });
  it("keeps a paid over-limit response and stops future work", async () => {
    const t = convexTest(schema, modules), scope = await seed(t, 0.07);
    const reserved = await t.mutation(reserveCall, reservation(scope, "first"));
    await t.mutation(settleCall, payment(scope.organizationId, reserved.invocationId));
    expect(await t.run(ctx => ctx.db.get(scope.reviewId))).toMatchObject({ status: "budget_exhausted", budgetConsumed: 0.09 });
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0.09, reservedUsd: 0 });
  });
  it("accounts after cancellation or replacement without reviving the review", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    const reserved = await t.mutation(reserveCall, reservation(scope, "first"));
    await t.run(ctx => ctx.db.patch(scope.reviewId, { status: "cancelled", isStale: true, executionGeneration: 1 }));
    await t.mutation(settleCall, payment(scope.organizationId, reserved.invocationId));
    expect(await t.run(ctx => ctx.db.get(scope.reviewId))).toMatchObject({ status: "cancelled", isStale: true, executionGeneration: 1, budgetConsumed: 0.09 });
  });
  it("holds unknown charges until an actual receipt resolves them", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    const reserved = await t.mutation(reserveCall, reservation(scope, "first"));
    const unresolved = { organizationId: scope.organizationId, invocationId: reserved.invocationId, outcome: "unknown", finishReason: "timeout", failed: true, now };
    await t.mutation(settleCall, unresolved); await t.mutation(settleCall, unresolved);
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0, reservedUsd: 0.06894, unknownInvocationCount: 1, accountingComplete: false });
    expect(await t.run(ctx => ctx.db.query("metricEvents").collect())).toHaveLength(1);
    await t.mutation(settleCall, payment(scope.organizationId, reserved.invocationId));
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0.09, reservedUsd: 0, unknownInvocationCount: 0 });
  });
  it("reserves an Ask rate slot before the model can run", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    await t.run(ctx => ctx.db.patch(scope.reviewId, { status: "checks_passed", completedAt: now - 1 }));
    const calls = await Promise.all(Array.from({ length: 6 }, (_, index) => t.mutation(reserveCall, reservation(scope, `ask-${index}`, { stage: "ask" }))));
    expect(calls.filter(call => call.allowed)).toHaveLength(5);
    expect(calls.find(call => !call.allowed)).toMatchObject({ reason: "ask_rate_limited" });
    const result = calls.find(call => call.allowed)!;
    await t.mutation(settleCall, payment(scope.organizationId, result.invocationId));
    expect((await t.run(ctx => ctx.db.query("usageLedger").collect())).every(row => row.kind === "ask_tokens")).toBe(true);
  });
  it("releases a provider rejection known not to have charged", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    const reserved = await t.mutation(reserveCall, reservation(scope, "first"));
    await t.mutation(settleCall, { organizationId: scope.organizationId, invocationId: reserved.invocationId, outcome: "not_charged", finishReason: "rate_limited", failed: true, now });
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0, reservedUsd: 0, unknownInvocationCount: 0, accountingComplete: true });
  });
  it("keeps late settlement in its original UTC reservation month", async () => {
    const t = convexTest(schema, modules), scope = await seed(t), september = Date.UTC(2026, 8, 30, 23, 59), october = Date.UTC(2026, 9, 1);
    await t.run(ctx => ctx.db.patch(scope.reviewId, { expiresAt: october + 60_000 }));
    const prior = await t.mutation(reserveCall, reservation(scope, "september", { now: september }));
    await t.mutation(reserveCall, reservation(scope, "october", { now: october }));
    await t.mutation(settleCall, payment(scope.organizationId, prior.invocationId, { now: october + 1 }));
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now: september })).toMatchObject({ month: "2026-09", estimatedSpendUsd: 0.09, reservedUsd: 0 });
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now: october })).toMatchObject({ month: "2026-10", estimatedSpendUsd: 0, reservedUsd: 0.06894 });
    expect(await t.run(ctx => ctx.db.get(scope.organizationId))).toMatchObject({ monthlySpendMonth: "2026-10", monthlySpendMicros: 0 });
  });
  it("repairs a large legacy month page by page without doubling new charges", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    await t.run(async ctx => { for (let index = 0; index < 450; index += 1) await ctx.db.insert("usageLedger", { organizationId: scope.organizationId, repositoryId: scope.repositoryId, reviewId: scope.reviewId, kind: "model_tokens", quantity: 1, unitCost: 0.01, totalCostMicros: 10_000, currency: "provider_billed", occurredAt: now - 1_000 + index }); });
    expect(await t.mutation(reconcileCall, { organizationId: scope.organizationId, now })).toEqual({ complete: false });
    await t.mutation(internal.reviewAskData.recordAsk, { organizationId: scope.organizationId, reviewId: scope.reviewId, provider: "anthropic", model: "claude-sonnet-4-5", inputTokens: 1_000, outputTokens: 1_000, now });
    await t.mutation(reconcileCall, { organizationId: scope.organizationId, now });
    await t.mutation(reconcileCall, { organizationId: scope.organizationId, now });
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 4.59, reconciliationComplete: true, legacyCostsMayBeIncomplete: true, accountingComplete: false });
    expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toHaveLength(451);
  });
  it("rejects a settlement against another organization's invocation", async () => {
    const t = convexTest(schema, modules), scope = await seed(t), other = await seed(t);
    const reserved = await t.mutation(reserveCall, reservation(scope, "first"));
    await expect(t.mutation(settleCall, payment(other.organizationId, reserved.invocationId))).rejects.toThrow("not_found_or_forbidden");
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0, reservedUsd: 0.06894 });
  });
});

function modelInput(scope: Awaited<ReturnType<typeof seed>>) {
  const { repositoryId, ...args } = scope;
  return { scope: args, repositoryId, stage: "findings" as const, provider: "anthropic" as const, credential: { id: "test-credential" },
    request: { model: "claude-sonnet-4-5", system: "policy", input: "test", schemaName: "result", schema: { type: "object", properties: {}, additionalProperties: false }, maxOutputTokens: 100 },
    brokerUrl: "https://broker.example", modelSecret: new Uint8Array(32).fill(6), now: () => now, wait: async () => undefined };
}
function actionContext(t: ReturnType<typeof convexTest>): Pick<ActionCtx, "runMutation"> {
  return { runMutation: t.mutation.bind(t) as ActionCtx["runMutation"] };
}

describe("worker accounting transport", () => {
  it("uses a distinct reservation and signed grant for each retry", async () => {
    const t = convexTest(schema, modules), scope = await seed(t), ids: string[] = [], grants: string[] = [];
    const http: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); ids.push(body.invocationId); grants.push(new Headers(init?.headers).get("authorization")!);
      if (ids.length === 1) return Response.json({ invocationId: body.invocationId, error: "rate_limited", providerStatus: 429, notCharged: true }, { status: 429 });
      return Response.json({ invocationId: body.invocationId, result: { provider: "anthropic", model: "claude-sonnet-4-5", value: {}, finishReason: "tool_use", inputTokens: 1_000, outputTokens: 1_000, usageKnown: true } });
    };
    await invokeAccountedModel(actionContext(t), { ...modelInput(scope), http });
    expect(new Set(ids).size).toBe(2); expect(new Set(grants).size).toBe(2);
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0.09, reservedUsd: 0, unknownInvocationCount: 0 });
    expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toHaveLength(2);
  });
  it("records paid truncation before the worker reports failure", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    const http: typeof fetch = async (_url, init) => Response.json({ invocationId: JSON.parse(String(init?.body)).invocationId, error: "truncated", usage: { inputTokens: 1_000, outputTokens: 1_000, usageKnown: true } }, { status: 422 });
    await expect(invokeAccountedModel(actionContext(t), { ...modelInput(scope), http })).rejects.toThrow("truncated");
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0.09, reservedUsd: 0, unknownInvocationCount: 0 });
  });
  it("retains an unknown reservation when the provider response is lost", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    const http: typeof fetch = async () => { throw new Error("test network failure"); };
    await expect(invokeAccountedModel(actionContext(t), { ...modelInput(scope), http, maxAttempts: 1 })).rejects.toThrow("provider_transport_unknown");
    const snapshot = await t.query(snapshotCall, { organizationId: scope.organizationId, now });
    expect(snapshot).toMatchObject({ estimatedSpendUsd: 0, accountingComplete: false, unknownInvocationCount: 1 });
    expect(snapshot.reservedUsd).toBeGreaterThan(0);
    expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toMatchObject([{ costStatus: "unknown" }]);
  });
  it("cannot spend after cancellation between two provider attempts", async () => {
    const t = convexTest(schema, modules), scope = await seed(t);
    const http = vi.fn(async (_url, init) => {
      await t.run(ctx => ctx.db.patch(scope.reviewId, { status: "cancelled", executionGeneration: 1 }));
      return Response.json({ invocationId: JSON.parse(String(init?.body)).invocationId, error: "rate_limited", providerStatus: 429, notCharged: true }, { status: 429 });
    });
    await expect(invokeAccountedModel(actionContext(t), { ...modelInput(scope), http })).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
    expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0, reservedUsd: 0 });
  });
});

describe("Ask accounts before presentation side effects", () => {
  it.each(["empty", "publication_failure"])("keeps the charge after %s", async outcome => {
    const t = convexTest(schema, modules), scope = await seed(t);
    const report = Buffer.from("Published review evidence for this test."), checksum = createHash("sha256").update(report).digest("hex");
    await t.run(async ctx => {
      await ctx.db.patch(scope.reviewId, { status: "checks_passed", completedAt: now - 1 });
      await ctx.db.insert("providerCredentials", { organizationId: scope.organizationId, credentialScopeId: "test-credential", provider: "anthropic",
        encryptedCiphertext: "test-ciphertext", nonce: "test-nonce", authTag: "test-tag", aadDigest: "a".repeat(64), wrappedDataKey: "test-wrapped", kmsKeyId: "test-kms",
        envelopeVersion: 1, keyVersion: 1, maskedSuffix: "test", availableModels: ["claude-sonnet-4-5"], status: "valid", createdBy: "test", createdAt: now, lastValidatedAt: now });
      const id = await ctx.db.insert("artifacts", { organizationId: scope.organizationId, repositoryId: scope.repositoryId, reviewId: scope.reviewId, type: "review_message", storageKey: "pending",
        encrypted: true, checksum, size: report.byteLength, redactionStatus: "redacted", expiresAt: now + 60_000, deletionAttempts: 0 });
      await ctx.db.patch(id, { storageKey: `artifacts/${scope.organizationId}/${scope.repositoryId}/${scope.reviewId}/${id}/review.md` });
    });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    githubState.failPublication = outcome === "publication_failure"; githubState.publications = 0;
    for (const [key, value] of Object.entries({ GITHUB_APP_ID: "test-app", GITHUB_APP_PRIVATE_KEY: "test-private-key", BUILDIT_BROKER_URL: "https://broker.example", ARTIFACT_GRANT_SECRET: Buffer.alloc(32, 5).toString("base64url"), MODEL_GRANT_SECRET: Buffer.alloc(32, 6).toString("base64url") })) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/artifacts")) return new Response(report);
      const body = JSON.parse(String(init?.body));
      return Response.json({ invocationId: body.invocationId, result: { provider: "anthropic", model: "claude-sonnet-4-5", finishReason: "tool_use",
        value: { answer: outcome === "empty" ? "" : "The published evidence says this.", groundedInReview: true }, inputTokens: 1_000, outputTokens: 1_000, usageKnown: true } });
    });
    try {
      const action = t.action(makeFunctionReference<"action">("reviewAskWorker:answer"), { organizationId: scope.organizationId, repositoryId: scope.repositoryId, prNumber: 1, question: "What changed?", askedBy: "test" });
      if (outcome === "empty") await expect(action).resolves.toMatchObject({ answered: false, reason: "model_answer_empty" });
      else await expect(action).rejects.toThrow("test_github_unavailable");
      expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0.09, reservedUsd: 0, unknownInvocationCount: 0 });
      expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toMatchObject([{ kind: "ask_tokens", totalCostMicros: 90_000 }]);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); githubState.failPublication = false; }
  });
});

it("links stage evidence to its invocation without charging the provider call again", async () => {
  const t = convexTest(schema, modules), scope = await seed(t);
  const reserved = await t.mutation(reserveCall, reservation(scope, "first"));
  await t.mutation(settleCall, payment(scope.organizationId, reserved.invocationId));
  const { repositoryId: _repositoryId, ...args } = scope;
  const stage = { ...args, invocationId: reserved.invocationId, stage: "findings" as const, provider: "anthropic" as const, model: "claude-sonnet-4-5", promptVersion: "v1", schemaVersion: "v1", finishReason: "tool_use", requestHash: "9".repeat(64), requestId: "paid-1", attempt: 1, outcome: "valid" as const, inputTokens: 1_000, outputTokens: 1_000, now };
  await t.mutation(internal.reviewModelData.recordStageRun, stage); await t.mutation(internal.reviewModelData.recordStageRun, stage);
  expect(await t.query(snapshotCall, { organizationId: scope.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0.09, reservedUsd: 0 });
  expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.query("modelStageRuns").collect())).toMatchObject([{ invocationId: reserved.invocationId, costMicros: 90_000 }]);
});

async function fallbackScope(t: ReturnType<typeof convexTest>, scope: Awaited<ReturnType<typeof seed>>) {
  const reviewId = await t.run(async ctx => {
    const { _id, _creationTime: _time, ...copy } = (await ctx.db.get(scope.reviewId))!;
    return ctx.db.insert("reviews", { ...copy, parentReviewId: _id, provider: "gemini", model: "gemini-2.5-pro",
      budgetConsumed: 0, status: "analyzing", completedAt: undefined, createdAt: now + 1 });
  });
  return { ...scope, reviewId };
}
const fallbackReservation = (scope: Awaited<ReturnType<typeof seed>>, key: string) => reservation(scope, key, { provider: "gemini", model: "gemini-2.5-pro" });

describe("one allowance across a review and provider fallback", () => {
  it("does not grant a fallback a second budget after a paid parent failure", async () => {
    const t = convexTest(schema, modules), root = await seed(t, 0.15);
    const paid = await t.mutation(reserveCall, reservation(root, "parent-paid"));
    await t.mutation(settleCall, payment(root.organizationId, paid.invocationId, { failed: true }));
    await t.run(ctx => ctx.db.patch(root.reviewId, { status: "platform_failed", completedAt: now }));
    const child = await fallbackScope(t, root);
    expect(await t.mutation(reserveCall, fallbackReservation(child, "fallback-paid"))).toMatchObject({ allowed: false, reason: "budget_exhausted" });
    expect(await t.run(ctx => ctx.db.get(child.reviewId))).toMatchObject({ status: "budget_exhausted", budgetConsumed: 0 });
    expect(await t.query(snapshotCall, { organizationId: root.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0.09, reservedUsd: 0 });
    expect(await t.run(ctx => ctx.db.query("modelInvocations").collect())).toHaveLength(1);
  });

  it.each(["reserved", "unknown"])("holds the parent's %s call against the fallback allowance", async status => {
    const t = convexTest(schema, modules), root = await seed(t, 0.1);
    const parent = await t.mutation(reserveCall, reservation(root, "parent-pending"));
    if (status === "unknown") await t.mutation(settleCall, { organizationId: root.organizationId, invocationId: parent.invocationId, outcome: "unknown", finishReason: "timeout", now });
    const child = await fallbackScope(t, root);
    expect(await t.mutation(reserveCall, fallbackReservation(child, "fallback-pending"))).toMatchObject({ allowed: false, reason: "budget_exhausted" });
    expect(await t.query(snapshotCall, { organizationId: root.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0, reservedUsd: 0.06894, unknownInvocationCount: 1 });
  });

  it("counts a descendant's paid work when Ask uses the original review", async () => {
    const t = convexTest(schema, modules), root = await seed(t, 0.15), child = await fallbackScope(t, root);
    const paid = await t.mutation(reserveCall, fallbackReservation(child, "child-paid"));
    await t.mutation(settleCall, payment(root.organizationId, paid.invocationId));
    await t.run(ctx => ctx.db.patch(root.reviewId, { status: "checks_passed", completedAt: now }));
    expect(await t.mutation(reserveCall, reservation(root, "root-ask", { stage: "ask" }))).toMatchObject({ allowed: false, reason: "budget_exhausted" });
    expect(await t.run(ctx => ctx.db.get(root.reviewId))).toMatchObject({ status: "checks_passed", budgetConsumed: 0 });
  });

  it("reserves the family's last allowance atomically across simultaneous siblings", async () => {
    const t = convexTest(schema, modules), root = await seed(t, 0.1);
    const first = await fallbackScope(t, root), second = await fallbackScope(t, root);
    const calls = await Promise.all([t.mutation(reserveCall, fallbackReservation(first, "sibling-one")), t.mutation(reserveCall, fallbackReservation(second, "sibling-two"))]);
    expect(calls.filter(call => call.allowed)).toHaveLength(1);
    expect(calls.filter(call => !call.allowed)).toMatchObject([{ reason: "budget_exhausted" }]);
    expect(await t.query(snapshotCall, { organizationId: root.organizationId, now })).toMatchObject({ reservedUsd: 0.06894 });
  });

  it.each(["cancelled", "platform_failed"] as const)("keeps late parent charges after %s and prevents more child spending", async status => {
    const t = convexTest(schema, modules), root = await seed(t, 0.2);
    const parent = await t.mutation(reserveCall, reservation(root, "late-parent")), child = await fallbackScope(t, root);
    const childPaid = await t.mutation(reserveCall, fallbackReservation(child, "early-child"));
    await t.mutation(settleCall, payment(root.organizationId, childPaid.invocationId));
    await t.run(ctx => ctx.db.patch(root.reviewId, { status, executionGeneration: 1 }));
    await t.mutation(settleCall, payment(root.organizationId, parent.invocationId, { inputTokens: 2_000, outputTokens: 2_000 }));
    expect(await t.run(ctx => ctx.db.get(root.reviewId))).toMatchObject({ status, budgetConsumed: 0.18 });
    expect(await t.run(ctx => ctx.db.get(child.reviewId))).toMatchObject({ budgetConsumed: 0.09 });
    expect(await t.query(snapshotCall, { organizationId: root.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0.27, reservedUsd: 0 });
    const next = t.mutation(reserveCall, fallbackReservation(child, "child-after-late"));
    if (status === "cancelled") await expect(next).rejects.toThrow("model_invocation_invalid");
    else expect(await next).toMatchObject({ allowed: false, reason: "budget_exhausted" });
    expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toHaveLength(2);
  });

  it("releases a definitely uncharged parent call for its fallback", async () => {
    const t = convexTest(schema, modules), root = await seed(t, 0.1);
    const parent = await t.mutation(reserveCall, reservation(root, "rejected-parent")), child = await fallbackScope(t, root);
    await t.mutation(settleCall, { organizationId: root.organizationId, invocationId: parent.invocationId, outcome: "not_charged", finishReason: "invalid_key", now });
    expect(await t.mutation(reserveCall, fallbackReservation(child, "allowed-fallback"))).toMatchObject({ allowed: true, reservedUsd: 0.06894 });
  });

  it("keeps a separately authorized same-commit review's allowance independent", async () => {
    const t = convexTest(schema, modules), root = await seed(t, 0.1);
    const paid = await t.mutation(reserveCall, reservation(root, "root-paid"));
    await t.mutation(settleCall, payment(root.organizationId, paid.invocationId));
    const independent = await fallbackScope(t, root);
    await t.run(ctx => ctx.db.patch(independent.reviewId, { parentReviewId: undefined }));
    expect(await t.mutation(reserveCall, fallbackReservation(independent, "separate-review"))).toMatchObject({ allowed: true });
  });

  it("rejects a cross-workspace parent link without touching either allowance", async () => {
    const t = convexTest(schema, modules), root = await seed(t), foreign = await seed(t), child = await fallbackScope(t, root);
    await t.run(ctx => ctx.db.patch(child.reviewId, { parentReviewId: foreign.reviewId }));
    await expect(t.mutation(reserveCall, fallbackReservation(child, "foreign-parent"))).rejects.toThrow("review_budget_family_invalid");
    expect(await t.run(ctx => ctx.db.query("modelInvocations").collect())).toHaveLength(0);
  });

  it("enforces the same family allowance in the legacy preflight during rollout", async () => {
    const t = convexTest(schema, modules), root = await seed(t, 0.15), child = await fallbackScope(t, root);
    await t.run(ctx => ctx.db.patch(root.reviewId, { budgetConsumed: 0.09 }));
    const { repositoryId: _repositoryId, ...scope } = child;
    expect(await t.mutation(internal.reviewModelData.preflightStageSpend, { ...scope, provider: "gemini", model: "gemini-2.5-pro", inputBytes: 0, maxOutputTokens: 100, now })).toMatchObject({ allowed: false });
  });
});


describe("fallback budget graph integrity", () => {
  it.each(["cycle", "head", "repository", "pull_request", "mode", "missing_parent"])("fails closed for a %s mismatch", async mismatch => {
    const t = convexTest(schema, modules), root = await seed(t), other = await seed(t), child = await fallbackScope(t, root);
    await t.run(async ctx => {
      if (mismatch === "cycle") await ctx.db.patch(root.reviewId, { parentReviewId: child.reviewId });
      if (mismatch === "head") await ctx.db.patch(root.reviewId, { headSha: "c".repeat(40) });
      if (mismatch === "repository") await ctx.db.patch(root.reviewId, { repositoryId: other.repositoryId });
      if (mismatch === "pull_request") await ctx.db.patch(root.reviewId, { prNumber: 2 });
      if (mismatch === "mode") await ctx.db.patch(root.reviewId, { mode: "autofix" });
      if (mismatch === "missing_parent") await ctx.db.delete(root.reviewId);
    });
    await expect(t.mutation(reserveCall, fallbackReservation(child, "invalid-family"))).rejects.toThrow("review_budget_family_invalid");
    expect(await t.run(ctx => ctx.db.query("modelInvocations").collect())).toHaveLength(0);
  });

  it.each(["stale", "cancelled", "cancelling", "cancellation_requested", "expired"] as const)("does not spend through a %s ancestor", async stopped => {
    const t = convexTest(schema, modules), root = await seed(t), child = await fallbackScope(t, root);
    await t.run(ctx => ctx.db.patch(root.reviewId, stopped === "stale" ? { isStale: true } : stopped === "expired" ? { expiresAt: now }
      : stopped === "cancellation_requested" ? { cancellationRequestedAt: now } : { status: stopped }));
    await expect(t.mutation(reserveCall, fallbackReservation(child, "stopped-ancestor"))).rejects.toThrow("model_invocation_invalid");
    expect(await t.run(ctx => ctx.db.query("modelInvocations").collect())).toHaveLength(0);
  });

  it("refuses an oversized family instead of pricing a truncated subset", async () => {
    const t = convexTest(schema, modules), root = await seed(t);
    for (let i = 0; i < 16; i += 1) await fallbackScope(t, root);
    await expect(t.mutation(reserveCall, reservation(root, "oversized-family"))).rejects.toThrow("review_budget_family_limit");
    expect(await t.run(ctx => ctx.db.query("modelInvocations").collect())).toHaveLength(0);
  });

  it("does not create or schedule a second fallback when failure handling replays", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules), root = await seed(t);
      await t.run(async ctx => {
        await ctx.db.patch(root.reviewId, { status: "platform_failed", statusReasonCode: "provider_rate_limited", completedAt: now });
        await ctx.db.insert("providerCredentials", { organizationId: root.organizationId, credentialScopeId: "fallback-credential", provider: "openai",
          encryptedCiphertext: "fixture", nonce: "fixture", authTag: "fixture", aadDigest: "a".repeat(64), wrappedDataKey: "fixture", kmsKeyId: "fixture",
          envelopeVersion: 1, keyVersion: 1, maskedSuffix: "test", availableModels: ["gpt-5.4-mini"], status: "valid", createdBy: "test", createdAt: now, lastValidatedAt: now });
      });
      const { repositoryId: _repositoryId, ...scope } = root;
      const args = { ...scope, now };
      expect(await t.mutation(internal.durableReview.fallbackOrReport, args)).toBe("fallback_started");
      expect(await t.mutation(internal.durableReview.fallbackOrReport, args)).toBe("fallback_started");
      expect(await t.run(ctx => ctx.db.query("reviews").collect())).toHaveLength(2);
      const jobs = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
      expect(jobs.filter(job => job.name.includes("durableReview:start"))).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
});


it("returns the same allowance receipt from a parent and its fallback without double-counting payments", async () => {
  const t = convexTest(schema, modules), root = await seed(t, 0.3), child = await fallbackScope(t, root);
  const parent = await t.mutation(reserveCall, reservation(root, "receipt-parent"));
  await t.mutation(settleCall, payment(root.organizationId, parent.invocationId));
  const pending = await t.mutation(reserveCall, fallbackReservation(child, "receipt-child"));
  const receipt = makeFunctionReference<"query">("modelAccounting:reviewSnapshot");
  const before = await t.query(receipt, { organizationId: root.organizationId, reviewId: root.reviewId });
  expect(before).toEqual(await t.query(receipt, { organizationId: root.organizationId, reviewId: child.reviewId }));
  expect(before).toMatchObject({ rootReviewId: root.reviewId, reviewIds: [root.reviewId, child.reviewId], budgetLimitUsd: 0.3,
    estimatedSpendUsd: 0.09, reservedUsd: 0.06894, remainingUsd: 0.14106, unresolvedInvocationCount: 1 });
  await t.mutation(settleCall, payment(root.organizationId, pending.invocationId));
  await t.mutation(settleCall, payment(root.organizationId, pending.invocationId));
  expect(await t.query(receipt, { organizationId: root.organizationId, reviewId: child.reviewId })).toMatchObject({ estimatedSpendUsd: 0.18, reservedUsd: 0, remainingUsd: 0.12, unresolvedInvocationCount: 0 });
  const foreign = await seed(t);
  await expect(t.query(receipt, { organizationId: foreign.organizationId, reviewId: root.reviewId })).rejects.toThrow("parent_scope_mismatch");
});

it("fails closed when unresolved call enumeration would be incomplete", async () => {
  const t = convexTest(schema, modules), root = await seed(t);
  const reserved = await t.mutation(reserveCall, reservation(root, "many-calls"));
  await t.run(async ctx => {
    const { _id: _id, _creationTime: _time, ...copy } = (await ctx.db.get(reserved.invocationId as Id<"modelInvocations">))!;
    for (let index = 0; index < 100; index += 1) await ctx.db.insert("modelInvocations", { ...copy, invocationKey: `fixture-pending-${index}` });
  });
  await expect(t.mutation(reserveCall, reservation(root, "beyond-call-page"))).rejects.toThrow("review_budget_family_limit");
  expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toHaveLength(1);
});

it("preserves a stricter child cap while never allowing an inflated child cap to replace root consent", async () => {
  const t = convexTest(schema, modules), root = await seed(t, 0.15), child = await fallbackScope(t, root);
  await t.run(ctx => ctx.db.patch(child.reviewId, { budgetLimit: 0.05 }));
  expect(await t.mutation(reserveCall, fallbackReservation(child, "smaller-child"))).toMatchObject({ allowed: false, reason: "budget_exhausted" });
  await t.run(async ctx => {
    await ctx.db.patch(root.reviewId, { budgetConsumed: 0.09 });
    await ctx.db.patch(child.reviewId, { budgetLimit: 100, status: "analyzing", completedAt: undefined });
  });
  expect(await t.mutation(reserveCall, fallbackReservation(child, "inflated-child"))).toMatchObject({ allowed: false, reason: "budget_exhausted" });
});

it("counts a late legacy receipt against the shared allowance without rewriting individual charges", async () => {
  const t = convexTest(schema, modules), root = await seed(t, 0.15), child = await fallbackScope(t, root);
  const { repositoryId: _repositoryId, ...scope } = root;
  await t.run(ctx => ctx.db.patch(root.reviewId, { status: "platform_failed", completedAt: now }));
  const receipt = { ...scope, stage: "findings" as const, provider: "anthropic" as const, model: "claude-sonnet-4-5", promptVersion: "v1", schemaVersion: "v1", finishReason: "tool_use",
    requestHash: "9".repeat(64), requestId: "legacy-parent", attempt: 1, outcome: "valid" as const, inputTokens: 1_000, outputTokens: 1_000, now };
  await t.mutation(internal.reviewModelData.recordStageRun, receipt);
  await t.mutation(internal.reviewModelData.recordStageRun, receipt);
  expect(await t.mutation(reserveCall, fallbackReservation(child, "after-legacy"))).toMatchObject({ allowed: false, reason: "budget_exhausted" });
  expect(await t.run(ctx => ctx.db.get(root.reviewId))).toMatchObject({ status: "platform_failed", budgetConsumed: 0.09 });
  expect(await t.run(ctx => ctx.db.query("usageLedger").collect())).toHaveLength(1);
});


it("retains an already incurred charge even if the family's parent link becomes invalid", async () => {
  const t = convexTest(schema, modules), root = await seed(t), child = await fallbackScope(t, root), foreign = await seed(t);
  const reserved = await t.mutation(reserveCall, fallbackReservation(child, "before-invalid-link"));
  await t.run(ctx => ctx.db.patch(child.reviewId, { parentReviewId: foreign.reviewId }));
  await expect(t.mutation(settleCall, payment(root.organizationId, reserved.invocationId))).resolves.toMatchObject({ accounted: true, costUsd: 0.09 });
  expect(await t.run(ctx => ctx.db.get(child.reviewId))).toMatchObject({ budgetConsumed: 0.09 });
  expect(await t.query(snapshotCall, { organizationId: root.organizationId, now })).toMatchObject({ estimatedSpendUsd: 0.09, reservedUsd: 0 });
  await expect(t.mutation(reserveCall, fallbackReservation(child, "after-invalid-link"))).rejects.toThrow("review_budget_family_invalid");
});
