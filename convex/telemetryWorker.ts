"use node";
import { createHmac } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

const operation = v.union(
  v.literal("activation.preview"), v.literal("activation.review"), v.literal("activation.decision"),
  v.literal("review.context"), v.literal("review.analysis"), v.literal("review.tests"),
  v.literal("review.autofix"), v.literal("review.delivery"), v.literal("review.decision"), v.literal("webhook.process"),
  v.literal("github.comment"), v.literal("github.check"), v.literal("github.branch"), v.literal("github.stacked_pr"),
  v.literal("artifact.delete"), v.literal("sandbox.cleanup"),
);
const stage = v.union(v.literal("activation"), v.literal("context"), v.literal("analysis"), v.literal("tests"), v.literal("autofix"), v.literal("delivery"), v.literal("decision"));
const outcome = v.union(v.literal("started"), v.literal("succeeded"), v.literal("failed"), v.literal("cancelled"), v.literal("blocked"));
const errorCode = v.optional(v.union(v.literal("UnknownError"), v.literal("cancelled"), v.literal("stale_head"), v.literal("budget_exhausted"), v.literal("loop_guard"), v.literal("provider_error"), v.literal("runner_error"), v.literal("upstream_unavailable"), v.literal("configuration_missing"), v.literal("timeout"), v.literal("rate_limited")));

export function safeTelemetryError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("stale")) return "stale_head" as const;
  if (message.includes("cancel")) return "cancelled" as const;
  if (message.includes("budget")) return "budget_exhausted" as const;
  if (message.includes("loop") || message.includes("repeated_patch")) return "loop_guard" as const;
  if (message.includes("model") || message.includes("provider")) return "provider_error" as const;
  if (message.includes("execution") || message.includes("runner")) return "runner_error" as const;
  if (message.includes("missing_") || message.includes("configuration")) return "configuration_missing" as const;
  return "UnknownError" as const;
}

export const emit = internalAction({
  args: { operation, stage, outcome, errorCode },
  handler: async (_ctx, args): Promise<{ delivered: boolean }> => {
    const broker = process.env.BUILDIT_BROKER_URL?.replace(/\/$/, ""), secret = process.env.TELEMETRY_INGEST_SECRET;
    if (!broker || !secret) return { delivered: false };
    try {
      const body = JSON.stringify(args), signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
      const response = await fetch(`${broker}/api/telemetry`, { method: "POST", headers: { "content-type": "application/json", "x-buildit-telemetry-signature": signature }, body });
      return { delivered: response.status === 202 };
    } catch { return { delivered: false }; }
  },
});
