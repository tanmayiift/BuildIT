"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { GitHubAppClient, GitHubRepositoryWriter } from "@buildit/github";
import { neverMergedSentence } from "@buildit/orchestrator";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }

// A user had no way to learn that `@buildit ask` exists. The commands were documented on a web page
// nobody reads while looking at a pull request, which is exactly where the commands are typed.
const helpBody = [
  "**BuildIT commands**",
  "",
  "| Command | What it does | Needs |",
  "| --- | --- | --- |",
  "| `@buildit review` | Review this pull request now | Triage |",
  "| `@buildit ask <question>` | Answer from the review already published here | Triage |",
  "| `@buildit autofix` | Open a stacked pull request with a tested fix | Write |",
  "| `@buildit cancel` | Stop the review that is running | Write |",
  "",
  `${neverMergedSentence} A human owns the merge decision.`,
].join("\n");

export const respond = internalAction({
  args: { organizationId: v.id("organizations"), repositoryId: v.id("repositories"), prNumber: v.number(),
    kind: v.union(v.literal("help"), v.literal("pause"), v.literal("resume")), actor: v.string() },
  handler: async (ctx, args): Promise<{ posted: boolean }> => {
    const scope = await ctx.runQuery(internal.reviewCommandData.commandScope, {
      organizationId: args.organizationId, repositoryId: args.repositoryId });
    if (!scope) return { posted: false };

    if (args.kind !== "help") {
      await ctx.runMutation(internal.automaticReviewData.setPause, { organizationId: args.organizationId,
        repositoryId: args.repositoryId, prNumber: args.prNumber, paused: args.kind === "pause",
        actor: args.actor, now: Date.now() });
    }

    const github = new GitHubAppClient({ appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_APP_PRIVATE_KEY") });
    const tokenScope = { installationId: scope.installationId, repositoryId: scope.githubRepositoryId, stage: "review" as const };
    const token = await github.tokenFor(tokenScope);
    try {
      const writer = new GitHubRepositoryWriter({ repositoryId: scope.githubRepositoryId, installationToken: token });
      // Keyed by kind, so asking for help twice edits one comment rather than leaving a trail -
      // the same reason the review comment is keyed on the pull request.
      await writer.upsertIssueComment({ prNumber: args.prNumber,
        marker: `buildit-review:${args.kind}-pr-${args.prNumber}`,
        body: args.kind === "help" ? helpBody
          : args.kind === "pause" ? "**Automatic reviews paused on this pull request.** Pushes will not start one here; other pull requests are unaffected. Comment `@buildit resume` to start again, or `@buildit review` to run one now without resuming."
          : "**Automatic reviews resumed on this pull request.** The next push will be reviewed." });
      return { posted: true };
    } finally { await github.revoke(tokenScope); }
  },
});
