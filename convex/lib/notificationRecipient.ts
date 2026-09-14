import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";

export function verifiedEmail(user: Pick<Doc<"users">, "email" | "emailVerificationTime" | "emailVerificationExpiresAt"> | null, now: number) {
  if (!user?.email || !user.emailVerificationTime || user.emailVerificationTime > now || (user.emailVerificationExpiresAt !== undefined && user.emailVerificationExpiresAt <= now)) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email) ? user.email : null;
}
export async function emailConsentHash(organizationId: string, userId: string, email: string) {
  const bytes = new TextEncoder().encode(`${organizationId}:${userId}:${email.toLowerCase()}`);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
}
export async function resolveNotificationRecipient(db: GenericDatabaseReader<DataModel>, args: { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; userId: string; now: number }) {
  const [organization, membership, repository, saved] = await Promise.all([
    db.get(args.organizationId),
    db.query("memberships").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", args.userId)).unique(),
    db.get(args.repositoryId),
    db.query("notificationPreferences").withIndex("by_org_user", q => q.eq("organizationId", args.organizationId).eq("userId", args.userId)).unique(),
  ]);
  if (!organization || organization.deletedAt || !membership || membership.status !== "active" || !repository || repository.organizationId !== args.organizationId || !repository.enabled || !saved?.emailEnabled || !saved.emailConsentedAt || saved.emailConsentedAt > args.now || saved.mutedRepositoryIds.includes(args.repositoryId)) return null;
  const installation = await db.get(repository.installationId);
  if (!installation || installation.organizationId !== args.organizationId || installation.status !== "active") return null;
  const userId = db.normalizeId("users", args.userId), user = userId ? await db.get(userId) : null, email = verifiedEmail(user, args.now);
  if (!email || saved.emailConsentedAddressHash !== await emailConsentHash(args.organizationId, args.userId, email)) return null;
  return { organizationId: args.organizationId, repositoryId: args.repositoryId, userId: args.userId, email, verifiedAt: user!.emailVerificationTime!, consentedAt: saved.emailConsentedAt };
}
