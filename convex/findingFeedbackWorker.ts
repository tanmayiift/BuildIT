"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { createHash } from "node:crypto";

// A person resolving BuildIT's inline comment, or reacting to it, is telling BuildIT what they
// thought of that finding. The comment carries the finding's id in its marker, so the feedback
// attaches to the finding they were actually looking at.
const markerPattern = /<!--\s*buildit-review:inline-pr-\d+:([A-Za-z0-9_-]{1,64})\s*-->/;

export const observe = internalAction({
  args: { githubRepositoryId: v.number(), prNumber: v.number(), commentBody: v.string(), senderLogin: v.string(),
    resolved: v.optional(v.boolean()), thumbsDown: v.optional(v.boolean()), thumbsUp: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    const marker = markerPattern.exec(args.commentBody);
    // Not one of BuildIT's inline comments, so there is nothing to attribute.
    if (!marker) return { recorded: false };

    // Resolving a thread and a thumbs-down both say "not this one". A thumbs-up says the opposite,
    // and is the only thing that records an acceptance without a merged fix.
    const verdict = args.thumbsUp ? "accepted" as const
      : args.resolved || args.thumbsDown ? "dismissed" as const : undefined;
    if (!verdict) return { recorded: false };

    const repository = await ctx.runQuery(internal.findingFeedbackData.repositoryByGithubId, { githubRepositoryId: args.githubRepositoryId });
    if (!repository) return { recorded: false };

    const result = await ctx.runMutation(internal.findingFeedbackData.record, {
      repositoryId: repository.repositoryId, prNumber: args.prNumber, markerFindingId: marker[1]!,
      verdict, actorHash: createHash("sha256").update(args.senderLogin.toLowerCase()).digest("hex"), now: Date.now() });
    return { recorded: result.recorded };
  },
});
