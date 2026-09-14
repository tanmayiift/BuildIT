"use node";
import { createHash, randomUUID } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { issueModelInvocationGrant, type ModelStage } from "@buildit/security";
import type { ProviderName, ProviderRequest, ProviderResult, ProviderUsage } from "@buildit/providers";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { isRetryableProviderReason, retryDelayMs } from "./providerRetry";

type Scope = { organizationId: Id<"organizations">; reviewId: Id<"reviews">; expectedHeadSha: string; expectedGeneration: number };
type ReserveArgs = Scope & { invocationKey: string; requestHash: string; stage: string; provider: ProviderName; model: string; inputBytes: number; maxOutputTokens: number; now: number };
type Reservation = { allowed: boolean; reason?: string; invocationId?: Id<"modelInvocations"> };
const reserve = makeFunctionReference<"mutation", ReserveArgs, Reservation>("modelAccounting:reserve");
const settle = makeFunctionReference<"mutation", { organizationId: Id<"organizations">; invocationId: Id<"modelInvocations">; outcome: "estimated" | "unknown" | "not_charged";
  inputTokens?: number; outputTokens?: number; providerRequestId?: string; finishReason: string; failed?: boolean; now: number }, { accounted: boolean; costUsd: number | null }>("modelAccounting:settle");

export class AccountedModelError extends Error {
  constructor(message: string, readonly invocationId?: Id<"modelInvocations">) { super(message); this.name = "AccountedModelError"; }
}

// One durable reservation and one broker request per physical provider attempt. The broker's
// accounted protocol explicitly disables its old hidden retry/fallback loop. Unknown responses
// keep their reservation; sending the same prompt again is a new, separately accounted attempt.
export async function invokeAccountedModel(ctx: Pick<ActionCtx, "runMutation">, input: {
  scope: Scope; repositoryId: Id<"repositories">; stage: ModelStage; provider: ProviderName;
  credential: { id: string; availableModels?: readonly string[] }; request: ProviderRequest;
  brokerUrl: string; modelSecret: Uint8Array; http?: typeof fetch; now?: () => number; wait?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}): Promise<ProviderResult> {
  const http = input.http ?? fetch, now = input.now ?? Date.now, wait = input.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let model = input.request.model;
  const tried = new Set<string>();
  const maxAttempts = input.maxAttempts ?? 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    tried.add(model);
    const request = { ...input.request, model };
    const requestHash = createHash("sha256").update(JSON.stringify({ stage: input.stage, request })).digest("hex");
    const reservationArgs: ReserveArgs = { ...input.scope, invocationKey: randomUUID(), requestHash, stage: input.stage, provider: input.provider, model,
      inputBytes: Buffer.byteLength(request.system) + Buffer.byteLength(request.input) + Buffer.byteLength(JSON.stringify(request.schema)), maxOutputTokens: request.maxOutputTokens, now: now() };
    let reservation: Reservation = { allowed: false };
    for (let page = 0; page < 50; page += 1) {
      reservation = await ctx.runMutation(reserve, reservationArgs);
      if (reservation.reason !== "accounting_reconciling") break;
    }
    if (!reservation.allowed || !reservation.invocationId) throw new AccountedModelError(reservation.reason ?? "budget_reservation_failed");
    const invocationId = reservation.invocationId;
    const body = JSON.stringify({ organizationId: String(input.scope.organizationId), repositoryId: String(input.repositoryId), reviewId: String(input.scope.reviewId),
      invocationId: String(invocationId), stage: input.stage, credential: input.credential, request });
    const grant = issueModelInvocationGrant({ organizationId: String(input.scope.organizationId), repositoryId: String(input.repositoryId), reviewId: String(input.scope.reviewId),
      credentialScopeId: input.credential.id, provider: input.provider, model, stage: input.stage, requestHash: createHash("sha256").update(body).digest("hex") }, input.modelSecret, now());
    type Reply = { invocationId?: string; result?: ProviderResult; error?: string; providerStatus?: number; retryAfterSeconds?: number;
      usage?: ProviderUsage; notCharged?: boolean; availableModels?: string[] };
    let response: Response | undefined, reply: Reply = {}, transportFailed = false;
    try {
      response = await http(`${input.brokerUrl.replace(/\/$/, "")}/api/model`, { method: "POST", headers: { authorization: `Bearer ${grant}`, "content-type": "application/json" }, body, signal: AbortSignal.timeout(120_000) });
      const parsed: unknown = JSON.parse(await response.text());
      reply = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Reply : {};
    } catch { transportFailed = true; }
    const correlated = reply.invocationId === String(invocationId);
    const candidate = correlated && response?.ok ? reply.result : undefined;
    const result = candidate?.provider === input.provider && candidate.model === model && typeof candidate.finishReason === "string"
      && candidate.finishReason.length <= 100 && "value" in candidate ? candidate : undefined;
    const usage = result ?? (correlated ? reply.usage : undefined);
    const known = usage?.usageKnown === true && [usage.inputTokens, usage.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0);
    const notCharged = correlated && reply.notCharged === true;
    const reason = result ? result.finishReason : transportFailed ? "provider_transport_unknown" : correlated && typeof reply.error === "string" ? reply.error : "provider_response_unknown";
    await ctx.runMutation(settle, { organizationId: input.scope.organizationId, invocationId,
      outcome: known ? "estimated" : notCharged ? "not_charged" : "unknown",
      ...(known ? { inputTokens: usage!.inputTokens, outputTokens: usage!.outputTokens } : {}),
      ...(usage?.requestId ? { providerRequestId: usage.requestId.slice(0, 200) } : {}), finishReason: reason.slice(0, 100), failed: !result, now: now() });
    if (result) {
      return { ...result, invocationId: String(invocationId) };
    }
    if (attempt < maxAttempts && correlated && input.provider === "gemini" && reply.providerStatus === 404) {
      const fallback = Array.isArray(reply.availableModels) ? reply.availableModels.find(candidate => typeof candidate === "string" && !tried.has(candidate)) : undefined;
      if (fallback) {
        if (input.stage !== "ask") await ctx.runMutation(makeFunctionReference<"mutation">("reviewModelData:recordProviderRetry"), { ...input.scope, now: now() });
        model = fallback; continue;
      }
    }
    const retryable = transportFailed || isRetryableProviderReason(`${reason}${reply.providerStatus ? `:http_${reply.providerStatus}` : ""}`);
    if (attempt >= maxAttempts || !retryable) throw new AccountedModelError(`${reason}${reply.providerStatus ? `:http_${reply.providerStatus}` : ""}`, invocationId);
    if (input.stage !== "ask") await ctx.runMutation(makeFunctionReference<"mutation">("reviewModelData:recordProviderRetry"), { ...input.scope, now: now() });
    await wait(retryDelayMs(attempt, reply.retryAfterSeconds));
  }
  throw new AccountedModelError("provider_attempts_exhausted");
}
