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
    resolved: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    const marker = markerPattern.exec(args.commentBody);
    // Not one of BuildIT's inline comments, so there is nothing to attribute.
    if (!marker) return { recorded: false };

    // Resolving the thread says "not this one"; reopening it takes that back. Reactions are not
    // a signal because GitHub emits no webhook for them - the first version of this listened for a
    // "reaction" event that can never arrive.
    const verdict = args.resolved === true ? "dismissed" as const
      : args.resolved === false ? "accepted" as const : undefined;
    if (!verdict) return { recorded: false };

    const repository = await ctx.runQuery(internal.findingFeedbackData.repositoryByGithubId, { githubRepositoryId: args.githubRepositoryId });
    if (!repository) return { recorded: false };

    const result = await ctx.runMutation(internal.findingFeedbackData.record, {
      repositoryId: repository.repositoryId, prNumber: args.prNumber, markerFindingId: marker[1]!,
      verdict, actorHash: createHash("sha256").update(args.senderLogin.toLowerCase()).digest("hex"), now: Date.now() });
    return { recorded: result.recorded };
  },
});

// The summary comment numbers its findings, so "dismiss 2" names the second one a reader can see.
// This is the signal that works with the webhook events the App already receives; resolving a
// review thread is the better one and needs pull_request_review_thread enabled.
export const dismissByIndex = internalAction({
  args: { githubRepositoryId: v.number(), prNumber: v.number(), findingIndex: v.number(), senderLogin: v.string() },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    const repository = await ctx.runQuery(internal.findingFeedbackData.repositoryByGithubId, { githubRepositoryId: args.githubRepositoryId });
    if (!repository) return { recorded: false };
    const result = await ctx.runMutation(internal.findingFeedbackData.recordByIndex, {
      repositoryId: repository.repositoryId, prNumber: args.prNumber, findingIndex: args.findingIndex,
      actorHash: createHash("sha256").update(args.senderLogin.toLowerCase()).digest("hex"), now: Date.now() });
    return { recorded: result.recorded };
  },
});
