import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assertReviewParent } from "./parentConsistency";
import { terminalStatuses } from "./lifecycle";
import type { Doc } from "../_generated/dataModel";
export function trackerCredentialPayload(item: Doc<"trackerConnections">) {
  return { documentId: item._id, id: item.credentialScopeId, organizationId: String(item.organizationId), ...(item.repositoryId ? { repositoryId: String(item.repositoryId) } : {}), provider: item.provider, workspaceId: item.workspaceId, ciphertext: item.encryptedAccessToken, nonce: item.nonce, tag: item.authTag, wrappedDataKey: item.wrappedDataKey, kmsKeyId: item.kmsKeyId, envelopeVersion: item.envelopeVersion, keyVersion: item.keyVersion, aadDigest: item.aadDigest, status: "active" as const, createdBy: item.createdBy, createdAt: item.createdAt, ...(item.credentialFormat ? { credentialFormat: item.credentialFormat } : {}), ...(item.oauthResourceId ? { oauthResourceId: item.oauthResourceId } : {}), ...(item.projectKeys ? { projectKeys: item.projectKeys } : {}) };
}

// Parent consistency proves ownership, not that access is still granted. Recheck live authority
// before returning credentials and when accepting a renewal that completed outside Convex.
export async function assertTrackerReviewActive(ctx: QueryCtx | MutationCtx, args: { organizationId: Id<"organizations">; reviewId: Id<"reviews">; expectedHeadSha: string; expectedGeneration: number }) {
  const review = await assertReviewParent(ctx.db, args.organizationId, args.reviewId);
  const [organization, repository] = await Promise.all([ctx.db.get(args.organizationId), ctx.db.get(review.repositoryId)]);
  const installation = repository ? await ctx.db.get(repository.installationId) : null;
  if (!organization || organization.deletedAt !== undefined || !repository?.enabled || repository.pausedAt !== undefined || !installation || installation.organizationId !== args.organizationId || installation.status !== "active"
    || review.headSha !== args.expectedHeadSha || review.executionGeneration !== args.expectedGeneration || review.isStale || review.cancellationRequestedAt !== undefined || review.status === "cancelling" || review.status === "blocked" || terminalStatuses.has(review.status) || review.expiresAt <= Date.now()) throw new Error("not_found_or_forbidden");
  return { review, repository, installation };
}
