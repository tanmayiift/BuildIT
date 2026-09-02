import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireRepositoryRole } from "./lib/authz";
import { appendAuditEvent } from "./lib/audit";
import { suppressionScope } from "./validators";

// findingSuppressions has existed in the schema since the beginning and nothing ever wrote to it,
// so a person who read a finding and knew it was wrong had no way to say so. That is a gap in the
// product - a reviewer people cannot correct is one they stop reading - and it is also the missing
// half of the evaluation loop, because a dismissed finding is the clearest false-positive signal
// there is.
export const dismiss = mutation({
  args: {
    reviewId: v.id("reviews"),
    fingerprintHmac: v.string(),
    scope: suppressionScope,
    reasonCode: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new ConvexError("not_found_or_forbidden");
    // Dismissing a finding changes what a future review will show, so it needs the same authority
    // as starting one - a viewer may read a review but not silence it.
    const access = await requireRepositoryRole(ctx, review.repositoryId, "developer", review.organizationId);
    if (!/^[0-9a-f]{64}$/i.test(args.fingerprintHmac)) throw new ConvexError("finding_fingerprint_invalid");
    if (!args.reasonCode || args.reasonCode.length > 80) throw new ConvexError("finding_dismissal_reason_invalid");

    const finding = await ctx.db.query("findings")
      .withIndex("by_review_fingerprint", q => q.eq("reviewId", review._id).eq("fingerprintHmac", args.fingerprintHmac))
      .unique();
    if (!finding || finding.organizationId !== review.organizationId) throw new ConvexError("not_found_or_forbidden");

    const now = Date.now();
    const existing = await ctx.db.query("findingSuppressions")
      .withIndex("by_repo_fingerprint", q => q.eq("repositoryId", review.repositoryId).eq("fingerprintHmac", args.fingerprintHmac))
      .unique();
    if (!existing) {
      await ctx.db.insert("findingSuppressions", {
        organizationId: review.organizationId, repositoryId: review.repositoryId,
        fingerprintHmac: args.fingerprintHmac, hmacKeyVersion: 1, scope: args.scope,
        // The fingerprint already identifies the finding, so the scope value is stored as the same
        // digest rather than a second copy of anything derived from source.
        scopeValueHmac: args.fingerprintHmac, reasonCode: args.reasonCode,
        dismissedBy: access.userId, dismissedAt: now,
      });
    }

    // Marking it resolved is what the reader sees; the eval candidate is what the system learns.
    await ctx.db.patch(finding._id, { resolution: "dismissed", updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.evalLoop.recordDismissedFinding, {
      organizationId: review.organizationId, reviewId: review._id,
      fingerprintHmac: args.fingerprintHmac, reasonCode: args.reasonCode, now,
    });
    await appendAuditEvent(ctx, {
      organizationId: review.organizationId, actorId: access.userId, action: "finding.dismissed",
      resourceType: "finding", resourceId: finding._id, requestId: args.requestId,
      result: "allowed", createdAt: now,
    });
    return { id: finding._id, scope: args.scope };
  },
});
