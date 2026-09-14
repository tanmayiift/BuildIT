import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";
import { emailConsentHash, resolveNotificationRecipient, verifiedEmail } from "./lib/notificationRecipient";
import { localEmailCaptureConfig } from "../packages/operations/src/emailCaptureConfig";

// Customer email is deliberately unavailable until a transactional provider,
// verified sender domain, and production delivery proof are connected.
const customerEmailDeliveryAvailable = false;

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local?.slice(0, 1) ?? ""}•••@${domain}`;
}

export const preferences = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const actor = await requireOrganizationRole(ctx, args.organizationId, "viewer");
    const saved = await ctx.db.query("notificationPreferences").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", actor.userId)).unique();
    const userId = ctx.db.normalizeId("users", actor.userId), user = userId ? await ctx.db.get(userId) : null, email = verifiedEmail(user, Date.now());
    const now = Date.now();
    const emailEnabled = Boolean(saved?.emailEnabled && saved.emailConsentedAt && saved.emailConsentedAt <= now && email && saved.emailConsentedAddressHash === await emailConsentHash(args.organizationId, actor.userId, email));
    return {
      emailEnabled,
      emailOptedIn: saved?.emailEnabled ?? false,
      deliveryAvailable: customerEmailDeliveryAvailable,
      captureAvailable: Boolean(localEmailCaptureConfig(process.env)),
      digestMode: saved?.digestMode ?? "immediate" as const,
      mutedRepositoryIds: saved?.mutedRepositoryIds ?? [],
      updatedAt: saved?.updatedAt ?? null,
      recipient: email ? { state: "verified" as const, maskedEmail: maskEmail(email) } : { state: "verification_required" as const },
    };
  },
});

export const updatePreferences = mutation({
  args: { organizationId: v.id("organizations"), emailEnabled: v.boolean(), digestMode: v.union(v.literal("immediate"), v.literal("daily")), mutedRepositoryIds: v.array(v.id("repositories")), requestId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireOrganizationRole(ctx, args.organizationId, "viewer"), now = Date.now(), unique = [...new Set(args.mutedRepositoryIds)];
    for (const repositoryId of unique) { const repository = await ctx.db.get(repositoryId); if (!repository || repository.organizationId !== args.organizationId || !repository.enabled) throw new Error("not_found_or_forbidden"); }
    const userId = ctx.db.normalizeId("users", actor.userId), user = userId ? await ctx.db.get(userId) : null;
    const email = verifiedEmail(user, now);
    if (args.emailEnabled && !email) throw new Error("verified_email_required");
    const saved = await ctx.db.query("notificationPreferences").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", actor.userId)).unique();
    const emailConsentedAddressHash = args.emailEnabled && email ? await emailConsentHash(args.organizationId, actor.userId, email) : undefined;
    const emailConsentedAt = args.emailEnabled ? (saved?.emailConsentedAddressHash === emailConsentedAddressHash ? saved?.emailConsentedAt ?? now : now) : undefined;
    if (saved) await ctx.db.patch(saved._id, { emailEnabled: args.emailEnabled, emailConsentedAt, emailConsentedAddressHash, digestMode: args.digestMode, mutedRepositoryIds: unique, updatedAt: now });
    else await ctx.db.insert("notificationPreferences", { organizationId: args.organizationId, userId: actor.userId, emailEnabled: args.emailEnabled, emailConsentedAt, emailConsentedAddressHash, digestMode: args.digestMode, mutedRepositoryIds: unique, updatedAt: now });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: actor.userId, action: "notification.preferences_changed", resourceType: "notification_preferences", resourceId: actor.userId, requestId: args.requestId, result: "allowed", createdAt: now });
  },
});

/**
 * Internal-only recipient resolution for the local capture worker. The caller
 * supplies tenant IDs, never an email address. Every mutable boundary is
 * rechecked immediately before capture and no installation identity is read.
 */
export const resolveDecisionRecipient = internalQuery({
  args: { organizationId: v.id("organizations"), repositoryId: v.id("repositories"), userId: v.string(), now: v.number() },
  handler: async (ctx, args) => resolveNotificationRecipient(ctx.db, args),
});
