import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireOrganizationRole } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";

// Customer email is deliberately unavailable until a transactional provider,
// verified sender domain, and production delivery proof are connected.
const customerEmailDeliveryAvailable = false;

function verifiedEmail(user: { email?: string; emailVerificationTime?: number } | null, now: number) {
  if (!user?.email || !user.emailVerificationTime || user.emailVerificationTime > now) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email) ? user.email : null;
}

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
    const emailEnabled = Boolean(saved?.emailEnabled && saved.emailConsentedAt && email);
    return {
      emailEnabled,
      deliveryAvailable: customerEmailDeliveryAvailable,
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
    if (args.emailEnabled) {
      const userId = ctx.db.normalizeId("users", actor.userId), user = userId ? await ctx.db.get(userId) : null;
      if (!verifiedEmail(user, now)) throw new Error("verified_email_required");
    }
    const saved = await ctx.db.query("notificationPreferences").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", actor.userId)).unique();
    const emailConsentedAt = args.emailEnabled ? saved?.emailConsentedAt ?? now : undefined;
    if (saved) await ctx.db.patch(saved._id, { emailEnabled: args.emailEnabled, emailConsentedAt, digestMode: args.digestMode, mutedRepositoryIds: unique, updatedAt: now });
    else await ctx.db.insert("notificationPreferences", { organizationId: args.organizationId, userId: actor.userId, emailEnabled: args.emailEnabled, emailConsentedAt, digestMode: args.digestMode, mutedRepositoryIds: unique, updatedAt: now });
    await appendAuditEvent(ctx, { organizationId: args.organizationId, actorId: actor.userId, action: "notification.preferences_changed", resourceType: "notification_preferences", resourceId: actor.userId, requestId: args.requestId, result: "allowed", createdAt: now });
  },
});

/**
 * Internal-only recipient resolution for a future delivery worker. The caller
 * supplies tenant IDs, never an email address. Every mutable boundary is
 * rechecked immediately before delivery and no installation identity is read.
 */
export const resolveDecisionRecipient = internalQuery({
  args: { organizationId: v.id("organizations"), repositoryId: v.id("repositories"), userId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const [membership, repository, saved] = await Promise.all([
      ctx.db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", args.userId)).unique(),
      ctx.db.get(args.repositoryId),
      ctx.db.query("notificationPreferences").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", args.userId)).unique(),
    ]);
    if (!membership || membership.status !== "active" || !repository || repository.organizationId !== args.organizationId || !repository.enabled || !saved?.emailEnabled || !saved.emailConsentedAt || saved.emailConsentedAt > args.now || saved.mutedRepositoryIds.includes(args.repositoryId)) return null;
    const userId = ctx.db.normalizeId("users", args.userId), user = userId ? await ctx.db.get(userId) : null, email = verifiedEmail(user, args.now);
    if (!email) return null;
    return { organizationId: args.organizationId, repositoryId: args.repositoryId, userId: args.userId, email, verifiedAt: user!.emailVerificationTime!, consentedAt: saved.emailConsentedAt };
  },
});
