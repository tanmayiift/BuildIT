"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { changelogEntry, insertChangelogEntry } from "@buildit/orchestrator";
import { fetchFileAtCommit, GitHubAppClient, GitHubRepositoryWriter } from "@buildit/github";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }

// When a pull request merges, BuildIT can offer a changelog entry describing what merged and what
// it fixed on the way. It opens a pull request for that entry and stops: it never pushes to the
// default branch and never merges its own changelog, the same boundary autofix has and for the same
// reason - a person decides what lands.
export const record = internalAction({
  args: { githubRepositoryId: v.number(), prNumber: v.number(), title: v.string(), mergedAt: v.number() },
  handler: async (ctx, args): Promise<{ opened: boolean; reason?: string }> => {
    const scope = await ctx.runQuery(internal.changelogData.changelogScope, {
      githubRepositoryId: args.githubRepositoryId, prNumber: args.prNumber });
    if (!scope) return { opened: false, reason: "not_enabled" };

    const github = new GitHubAppClient({ appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_APP_PRIVATE_KEY") });
    const tokenScope = { installationId: scope.installationId, repositoryId: args.githubRepositoryId, stage: "autofix_delivery" as const };
    const token = await github.tokenFor(tokenScope);
    try {
      const writer = new GitHubRepositoryWriter({ repositoryId: args.githubRepositoryId, installationToken: token });
      const headSha = await writer.branchHead(scope.defaultBranch);

      const existing = await fetchFileAtCommit({ installationToken: token, repositoryId: args.githubRepositoryId,
        commitSha: headSha, path: "CHANGELOG.md", maxBytes: 400_000 });
      const entry = changelogEntry({ prNumber: args.prNumber, title: args.title, mergedAt: args.mergedAt,
        fixedFindings: scope.fixedFindings });
      const next = insertChangelogEntry(existing.present ? existing.content : undefined, entry);
      // Already listed. A merge webhook can arrive more than once, and a changelog that gains a
      // duplicate line on every redelivery is worse than no changelog.
      if (!next) return { opened: false, reason: "already_listed" };

      const branch = `buildit/changelog-${args.prNumber}`;
      const commitSha = await writer.createCandidateCommit({ pinnedHead: headSha, currentHead: headSha,
        message: `Add a changelog entry for #${args.prNumber}`, patches: [{ path: "CHANGELOG.md", content: next }] });
      await writer.upsertBranch({ name: branch, sha: commitSha });
      const pull = await writer.upsertStackedPullRequest({ head: branch, base: scope.defaultBranch,
        title: `Changelog for #${args.prNumber}`,
        body: [`Adds one line to \`CHANGELOG.md\` for #${args.prNumber}.`, "",
          "Written from what merged and from the findings BuildIT fixed on the way, so it describes nothing it cannot show.",
          "", "BuildIT does not merge this. A human decides whether it lands."].join("\n") });
      return { opened: Boolean(pull.url) };
    } finally { await github.revoke(tokenScope); }
  },
});
