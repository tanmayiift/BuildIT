"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { issueModelInvocationGrant } from "@buildit/security";
import { provider as providerValidator } from "./validators";

// Does this workspace's model key actually answer?
//
// `validateKey` cannot tell you. It calls the provider's `/v1/models`, which is free and answers
// perfectly well on an account with a zero balance - which is exactly the state that produced
// weeks of failures here. Only a real completion distinguishes "the key is valid" from "the key is
// valid and there is credit behind it", and the difference is the whole question.
//
// So this makes one, deliberately tiny: a one-line prompt and the smallest approved model. On
// gpt-5.4-mini that is a fraction of a cent.
//
// 256 output tokens rather than 8, for two reasons found by trying. OpenAI's /v1/responses refuses
// max_output_tokens below 16 outright, and the GPT-5 family spends output tokens on reasoning
// before it writes anything - so a ceiling low enough to "cost nothing" returns `truncated`, which
// is indistinguishable from a real failure and answers nothing. 256 is the smallest ceiling that
// reliably produces a verdict.
//
// It is an internalAction rather than a script because the two things it needs - MODEL_GRANT_SECRET
// and the encrypted credential - already live inside Convex. Running it here means neither has to
// be handled, copied, or read by an operator to use it.
//
// It deliberately does NOT reserve budget or write a modelInvocations row: there is no review to
// attribute the spend to, and inventing one to satisfy the ledger would put a fake review in the
// customer's history to answer an operational question. The spend is one call and the caller is an
// operator who asked for it. That trade is recorded here rather than left for someone to discover.

const probeSchema = { type: "object" as const, additionalProperties: false as const,
  properties: { ok: { type: "boolean" as const } }, required: ["ok"] };

export const probe = internalAction({
  args: { organizationId: v.id("organizations"), provider: providerValidator, model: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ outcome: string; detail?: string; model?: string; maskedSuffix?: string; inputTokens?: number; outputTokens?: number }> => {
    const scope = await ctx.runQuery(internal.modelProbeData.probeScope, { organizationId: args.organizationId, provider: args.provider });
    if (!scope) return { outcome: "no_valid_credential" };
    const model = args.model ?? scope.availableModels[0];
    if (!model) return { outcome: "no_model_on_credential" };

    const brokerUrl = (process.env.BUILDIT_BROKER_URL ?? "").replace(/\/$/, "");
    const secret = process.env.MODEL_GRANT_SECRET;
    if (!brokerUrl || !secret) return { outcome: "probe_misconfigured", detail: "BUILDIT_BROKER_URL or MODEL_GRANT_SECRET missing" };

    // reviewId is a scope label here, not a row: the broker compares grant against body and never
    // reads Convex. Naming it makes the probe obvious in any broker log that records it.
    //
    // invocationId is set for a reason beyond correlation: the broker takes its single-call
    // `generate` path when one is present and its retrying `generateWithRetry` path when it is not.
    // A probe that quietly retried three times would be three charges, not one.
    const reviewId = "model-probe";
    const request = { model, system: "Reply with the JSON {\"ok\":true} and nothing else.", input: "ping",
      schemaName: "probe", schema: probeSchema, maxOutputTokens: 256 };
    const body = JSON.stringify({ organizationId: String(args.organizationId), repositoryId: scope.repositoryId,
      reviewId, invocationId: reviewId, stage: "report", credential: scope.credential, request });
    const grant = issueModelInvocationGrant({ organizationId: String(args.organizationId), repositoryId: scope.repositoryId,
      reviewId, credentialScopeId: scope.credential.id, provider: args.provider, model, stage: "report",
      requestHash: createHash("sha256").update(body).digest("hex") }, Buffer.from(secret, "base64url"));

    const response = await fetch(`${brokerUrl}/api/model`, { method: "POST",
      headers: { authorization: `Bearer ${grant}`, "content-type": "application/json" },
      body, signal: AbortSignal.timeout(60_000) });
    const text = await response.text();
    let reply: { result?: { inputTokens?: number; outputTokens?: number }; error?: string; providerStatus?: number } = {};
    try { reply = JSON.parse(text) as typeof reply; } catch { /* keep the raw text below */ }

    if (response.ok && reply.result) {
      return { outcome: "answered", model, maskedSuffix: scope.maskedSuffix,
        inputTokens: reply.result.inputTokens, outputTokens: reply.result.outputTokens };
    }
    // The distinction that matters: an exhausted account never clears on its own, a rate limit does.
    const code = reply.error ?? `http_${response.status}`;
    return { outcome: code === "quota_exhausted" ? "no_credit" : code === "rate_limited" ? "rate_limited" : "failed",
      detail: `${code}${reply.providerStatus ? ` (provider ${reply.providerStatus})` : ""}${reply.error ? "" : ` :: ${text.slice(0, 200)}`}`,
      model, maskedSuffix: scope.maskedSuffix };
  },
});
