"use node";
import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { captureEmail } from "../packages/operations/src/emailCapture";

export const captureBatch = internalAction({
  args: { batchId: v.id("emailBatches") },
  handler: async (ctx, args) => {
    const leaseKey = randomUUID();
    const prepared = await ctx.runMutation(internal.notificationOutbox.prepare, { ...args, leaseKey });
    if (!prepared) return;
    let captureId: string | undefined;
    try { captureId = (await captureEmail(prepared.config, prepared.message)).captureId; } catch { /* Only a fixed failure code crosses into durable metadata. */ }
    await ctx.runMutation(internal.notificationOutbox.finish, { ...args, leaseKey, captureId });
  },
});
