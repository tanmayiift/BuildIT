"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { GitHubAppClient, GitHubRepositoryWriter, sideEffectKey } from "@buildit/github";
import { neverMergedSentence, selectInlineFindings } from "@buildit/orchestrator";
import { issueArtifactGrant } from "@buildit/security";
import { platformFailureReport, type PlatformFailureReason } from "./lib/platformFailureReport";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
type Scope = { organizationId: Id<"organizations">; repositoryId: Id<"repositories">; reviewId: Id<"reviews">; installationId: number; githubRepositoryId: number; prNumber: number; headSha: string; conclusion: "success" | "failure" | "neutral" | "action_required"; status: string; reason: string; report: { id: Id<"artifacts">; storageKey: string; checksum: string; size: number }; reviewProfile?: "quiet" | "balanced" | "thorough"; analysis?: { id: Id<"artifacts">; storageKey: string; checksum: string; size: number };};

export function assertReportPublicationContract(body: string, headSha: string) {
  if (!body.includes(headSha) || !body.includes(neverMergedSentence)) {
    throw new Error("report_publication_contract_failed");
  }
}

export function publicationTitle(status: string) {
  if (status === "changes_requested") return "Changes need review";
  if (status === "checks_passed") return "Ready for human review";
  return "Review needs attention";
}

export function reviewDetailsUrl(reviewId: string) {
  return new URL(`/reviews/${encodeURIComponent(reviewId)}`, "https://buildit-agentic-review.vercel.app").toString();
}

// Inline delivery is best-effort by design: the verdict is already published on the check run and
// the summary comment before this runs, so a GitHub hiccup here must not fail a review that has
// already decided. It logs and moves on rather than throwing.
async function publishInlineFindings(scope: Scope, token: string) {
  if (!scope.analysis) return;
  try {
    const brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""), secret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url");
    const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId),
      artifactId: String(scope.analysis.id), storageKey: scope.analysis.storageKey, operation: "read" }, secret, Date.now());
    const response = await fetch(`${brokerUrl}/api/artifacts`, { headers: { authorization: `Bearer ${grant}` } });
    if (!response.ok) return;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength !== scope.analysis.size || createHash("sha256").update(buffer).digest("hex") !== scope.analysis.checksum) return;
    const value = JSON.parse(buffer.toString("utf8")) as { arbitrated?: Array<Record<string, unknown>> };
    const findings = selectInlineFindings((value.arbitrated ?? []).filter(item => typeof item.path === "string" && typeof item.id === "string") as Array<Record<string, unknown> & { severity: string; blocking?: boolean; resolution?: string }>, scope.reviewProfile)

      .map(item => ({ id: String(item.id), path: String(item.path), startLine: Number(item.startLine), endLine: Number(item.endLine),
        severity: String(item.severity ?? "warning"),
        title: String(item.title ?? "Finding"),
        body: [item.explanation, item.impact].filter(text => typeof text === "string" && text).join("\n\n") || "See the review summary for detail." }));
    if (!findings.length) return;
    const writer = new GitHubRepositoryWriter({ repositoryId: scope.githubRepositoryId, installationToken: token });
    await writer.publishInlineFindings({ prNumber: scope.prNumber, headSha: scope.headSha,
      marker: `buildit-review:inline-${scope.reviewId}:${scope.headSha}`, findings });
  } catch {
    // Deliberately swallowed: see above. The review has already been published.
  }
}

export const publish = internalAction({
  args: { organizationId: v.id("organizations"), reviewId: v.id("reviews"), expectedHeadSha: v.string(), expectedGeneration: v.number() },
  handler: async (ctx, args): Promise<{ checkId: string; commentId: string }> => {
    const scope: Scope = await ctx.runQuery(internal.reviewPublicationData.publicationScope, args), brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""), artifactSecret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url");
    const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), artifactId: String(scope.report.id), storageKey: scope.report.storageKey, operation: "read" }, artifactSecret);
    const response = await fetch(`${brokerUrl}/api/artifacts`, { headers: { authorization: `Bearer ${grant}` } });
    if (!response.ok) throw new Error(`report_artifact_download_${response.status}`);
    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    if (bodyBuffer.byteLength !== scope.report.size || createHash("sha256").update(bodyBuffer).digest("hex") !== scope.report.checksum) throw new Error("report_artifact_integrity_failed");
    const body = bodyBuffer.toString("utf8");
    assertReportPublicationContract(body, scope.headSha);
    const github = new GitHubAppClient({ appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_APP_PRIVATE_KEY") }), tokenScope = { installationId: scope.installationId, repositoryId: scope.githubRepositoryId, stage: "review" as const }, token = await github.tokenFor(tokenScope);
    try {
      const current = await fetch(`https://api.github.com/repositories/${scope.githubRepositoryId}/pulls/${scope.prNumber}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT" } });
      if (!current.ok) throw new Error(`github_pull_${current.status}`);
      const value = await current.json() as { head?: { sha?: unknown } };
      if (value.head?.sha !== scope.headSha) throw new Error("stale_head");
      const writer = new GitHubRepositoryWriter({ repositoryId: scope.githubRepositoryId, installationToken: token }), requestHash = createHash("sha256").update(`${scope.conclusion}\0${body}`).digest("hex"), now = Date.now();
      const slot = String(scope.reviewId), checkKey = sideEffectKey({ repositoryId: scope.githubRepositoryId, prNumber: scope.prNumber, headSha: scope.headSha, kind: "check", slot }), commentKey = sideEffectKey({ repositoryId: scope.githubRepositoryId, prNumber: scope.prNumber, headSha: scope.headSha, kind: "comment", slot });
      const checkEffect: Id<"githubSideEffects"> = await ctx.runMutation(internal.reviewState.reserveSideEffect, { ...args, operationKey: checkKey, type: "check_update", requestHash, now });
      const check = await writer.upsertCheckRun({ name: "BuildIT / review", headSha: scope.headSha, conclusion: scope.conclusion, title: publicationTitle(scope.status), summary: body, detailsUrl: reviewDetailsUrl(String(scope.reviewId)) });
      await ctx.runMutation(internal.reviewPublicationData.completeSideEffect, { ...args, sideEffectId: checkEffect, requestHash, externalId: String(check.id), status: "completed", now: Date.now() });
      const commentEffect: Id<"githubSideEffects"> = await ctx.runMutation(internal.reviewState.reserveSideEffect, { ...args, operationKey: commentKey, type: "comment_update", requestHash, now });
      const comment = await writer.upsertIssueComment({ prNumber: scope.prNumber, marker: `buildit-review:${scope.reviewId}:${scope.headSha}`, body });
      // The verdict lives in the check run and the summary comment. These put each finding on the
      // line it cites - the thing the headline has always promised and never delivered. Only
      // findings that survived arbitration reach here, so nothing the validator dropped lands on a
      // line, and they are anchored to the pinned commit rather than to whatever HEAD is now.
      await publishInlineFindings(scope, token);
      await ctx.runMutation(internal.reviewPublicationData.completeSideEffect, { ...args, sideEffectId: commentEffect, requestHash, externalId: String(comment.id), status: "completed", now: Date.now() });
      return { checkId: String(check.id), commentId: String(comment.id) };
    } finally { await github.revoke(tokenScope); }
  },
});

type FailureScope = {
  organizationId: Id<"organizations">;
  repositoryId: Id<"repositories">;
  reviewId: Id<"reviews">;
  installationId: number;
  githubRepositoryId: number;
  prNumber: number;
  headSha: string;
  reason: PlatformFailureReason;
  detail?: string;
};

export const publishPlatformFailure = internalAction({
  args: {
    organizationId: v.id("organizations"),
    reviewId: v.id("reviews"),
    expectedHeadSha: v.string(),
    expectedGeneration: v.number(),
  },
  handler: async (ctx, args): Promise<{ checkId: string }> => {
    const scope: FailureScope = await ctx.runQuery(
        internal.reviewPublicationData.platformFailureScope,
        args,
      ),
      report = platformFailureReport({
        headSha: scope.headSha,
        reason: scope.reason,
        ...(scope.detail ? { detail: scope.detail } : {}),
      }),
      github = new GitHubAppClient({
        appId: required("GITHUB_APP_ID"),
        privateKey: required("GITHUB_APP_PRIVATE_KEY"),
      }),
      tokenScope = {
        installationId: scope.installationId,
        repositoryId: scope.githubRepositoryId,
        stage: "review" as const,
      },
      token = await github.tokenFor(tokenScope),
      writer = new GitHubRepositoryWriter({
        repositoryId: scope.githubRepositoryId,
        installationToken: token,
      }),
      requestHash = createHash("sha256")
        .update(`${report.conclusion}\0${report.title}\0${report.summary}`)
        .digest("hex"),
      operationKey = sideEffectKey({
        repositoryId: scope.githubRepositoryId,
        prNumber: scope.prNumber,
        headSha: scope.headSha,
        kind: "check",
        slot: String(scope.reviewId),
      });
    try {
      const current = await fetch(
        `https://api.github.com/repositories/${scope.githubRepositoryId}/pulls/${scope.prNumber}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "BuildIT",
          },
        },
      );
      if (!current.ok) throw new Error(`github_pull_${current.status}`);
      const value = (await current.json()) as { head?: { sha?: unknown } };
      if (value.head?.sha !== scope.headSha) throw new Error("stale_head");
      const sideEffectId: Id<"githubSideEffects"> = await ctx.runMutation(
          internal.reviewState.reserveSideEffect,
          {
            ...args,
            operationKey,
            type: "check_update",
            requestHash,
            now: Date.now(),
          },
        ),
        check = await writer.upsertCheckRun({
          name: "BuildIT / review",
          headSha: scope.headSha,
          conclusion: report.conclusion,
          title: report.title,
          summary: report.summary,
        });
      await ctx.runMutation(
        internal.reviewPublicationData.completeSideEffect,
        {
          ...args,
          sideEffectId,
          requestHash,
          externalId: String(check.id),
          status: "completed",
          now: Date.now(),
        },
      );
      return { checkId: String(check.id) };
    } finally {
      await github.revoke(tokenScope);
    }
  },
});

// Between "@buildit review" and the final report the pull request showed nothing, and on any of the
// paths that end without publishing - no model key connected, execution disabled, a crash, a review
// the sweeper later gives up on - it showed nothing for good. This is the acknowledgement: it goes
// up when the review is queued and is replaced in place by whatever the review concludes.
//
// It never throws into the caller. A review that runs and reports is worth more than one refused
// because GitHub was briefly unavailable for a status update.
export const acknowledge = internalAction({
  args: {
    installationId: v.number(), githubRepositoryId: v.number(), headSha: v.string(),
    title: v.string(), summary: v.string(),
    conclusion: v.optional(v.union(v.literal("neutral"), v.literal("action_required"))),
  },
  handler: async (ctx, args) => {
    const github = new GitHubAppClient({ appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_APP_PRIVATE_KEY") });
    const tokenScope = { installationId: args.installationId, repositoryId: args.githubRepositoryId, stage: "review" as const };
    try {
      const token = await github.tokenFor(tokenScope);
      const writer = new GitHubRepositoryWriter({ repositoryId: args.githubRepositoryId, installationToken: token });
      await writer.createCheckRun({
        name: "BuildIT / review", headSha: args.headSha,
        ...(args.conclusion ? { conclusion: args.conclusion } : {}),
        title: args.title, summary: args.summary,
      });
    } catch {
      // Deliberately swallowed: see above.
    } finally {
      await github.revoke(tokenScope).catch(() => {});
    }
  },
});
