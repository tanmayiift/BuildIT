"use node";
import { createHmac } from "node:crypto";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const names = {
  queueDepth: "queue_depth", activeReviews: "active_reviews", capacityUtilization: "capacity_utilization",
  expiredArtifactBacklog: "expired_artifact_backlog", modelCostUsdHour: "model_cost_usd_hour",
  budgetExhaustedReviewsHour: "budget_exhausted_reviews_hour", effectiveLocDeliveredHour: "effective_loc_delivered_hour",
} as const;

export const emit = internalAction({
  args: {},
  handler: async (ctx): Promise<{ delivered: number }> => {
    const broker = process.env.BUILDIT_BROKER_URL?.replace(/\/$/, ""), secret = process.env.TELEMETRY_INGEST_SECRET;
    if (!broker || !secret) return { delivered: 0 };
    const values = await ctx.runQuery(internal.telemetrySnapshotData.snapshot, { now: Date.now() });
    let delivered = 0;
    for (const [key, measurement] of Object.entries(names) as Array<[keyof typeof names, (typeof names)[keyof typeof names]]>) {
      const body = JSON.stringify({ measurement, value: values[key] });
      const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
      try {
        const response = await fetch(`${broker}/api/telemetry`, { method: "POST", headers: { "content-type": "application/json", "x-buildit-telemetry-signature": signature }, body });
        if (response.status === 202) delivered += 1;
      } catch { /* The next scheduled snapshot retries without blocking reviews. */ }
    }
    return { delivered };
  },
});
