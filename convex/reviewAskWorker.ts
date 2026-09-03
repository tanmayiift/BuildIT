"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { GitHubAppClient, GitHubRepositoryWriter } from "@buildit/github";
import { issueArtifactGrant, issueModelInvocationGrant } from "@buildit/security";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }

// Answering a question about a review is not reviewing. It starts no workflow, reads no
// repository, and runs no sandbox.
//
// The ground truth is the report BuildIT already published on this pull request. That is a
// deliberate choice rather than a convenience: an answer drawn from the published report can never
// reveal anything the pull request comment did not already say out loud, so there is no new leak
// surface and nothing to redact twice. It also means the honest failure is available - once
// retention has deleted the evidence, there is nothing to answer from, and saying so is better
// than quietly re-reading the repository to cover it up.

// Every model call in BuildIT returns schema-validated structure rather than prose, and an answer
// is no exception. groundedInReview is the important field: the model has to declare whether the
// published review actually contained the answer, so "the review does not say" is a value it
// returns rather than a sentence it might or might not write.
const answerSystem = [
  "You answer questions about a code review that has already been published.",
  "The published review is the whole of what you know. You cannot see the repository.",
  "If the review does not contain the answer, set groundedInReview to false and say what is missing.",
  "Never state a verdict of your own; the review's verdict stands.",
  "Quote the file, line and commit when the review gives them. At most two short paragraphs.",
].join(" ");

const answerSchema = {
  type: "object",
  properties: {
    answer: { type: "string", maxLength: 2_000 },
    groundedInReview: { type: "boolean" },
  },
  required: ["answer", "groundedInReview"],
  additionalProperties: false,
} as const;

const answerInput = (report: string, question: string) => [
  "<published_review>", report, "</published_review>", "", "<question>", question, "</question>",
].join("\n");

export const answer = internalAction({
  args: { organizationId: v.id("organizations"), repositoryId: v.id("repositories"), prNumber: v.number(), question: v.string(), askedBy: v.string() },
  handler: async (ctx, args): Promise<{ answered: boolean; reason?: string }> => {
    const scope = await ctx.runQuery(internal.reviewAskData.askScope, {
      organizationId: args.organizationId, repositoryId: args.repositoryId, prNumber: args.prNumber, now: Date.now(),
    });
    if (!scope) { console.error("buildit_ask_unanswered", { reason: "no_review" }); return { answered: false, reason: "no_review" }; }

    const github = new GitHubAppClient({ appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_APP_PRIVATE_KEY") });
    const tokenScope = { installationId: scope.installationId, repositoryId: scope.githubRepositoryId, stage: "review" as const };
    const token = await github.tokenFor(tokenScope);
    try {
      const writer = new GitHubRepositoryWriter({ repositoryId: scope.githubRepositoryId, installationToken: token });
      const marker = `buildit-review:ask-${scope.askId}:${scope.headSha}`;

      // The evidence is gone, and pretending otherwise would mean reading the repository again to
      // manufacture an answer. Saying what happened is the honest move and the cheap one.
      if (!scope.report) {
        await writer.upsertIssueComment({ prNumber: args.prNumber, marker,
          body: "**No evidence left to answer from.** The source evidence for this review has passed its retention window and been deleted, so BuildIT cannot answer questions about it. Comment `@buildit review` to run a fresh review of this pull request." });
        { console.error("buildit_ask_unanswered", { reason: "evidence_expired" }); return { answered: false, reason: "evidence_expired" }; }
      }

      const brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, "");
      const artifactSecret = Buffer.from(required("ARTIFACT_GRANT_SECRET"), "base64url");
      const grant = issueArtifactGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId),
        artifactId: String(scope.report.id), storageKey: scope.report.storageKey, operation: "read" }, artifactSecret, Date.now());
      const download = await fetch(`${brokerUrl}/api/artifacts`, { headers: { authorization: `Bearer ${grant}` } });
      if (!download.ok) { console.error("buildit_ask_unanswered", { reason: "report_unavailable" }); return { answered: false, reason: "report_unavailable" }; }
      const buffer = Buffer.from(await download.arrayBuffer());
      if (buffer.byteLength !== scope.report.size || createHash("sha256").update(buffer).digest("hex") !== scope.report.checksum) {
        { console.error("buildit_ask_unanswered", { reason: "report_integrity_failed" }); return { answered: false, reason: "report_integrity_failed" }; }
      }

      const request = { model: scope.model, system: answerSystem, input: answerInput(buffer.toString("utf8").slice(0, 40_000), args.question),
        schemaName: "ask_answer", schema: answerSchema, maxOutputTokens: 700 };
      const body = JSON.stringify({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId),
        stage: "ask", credential: scope.credential, request });
      const modelGrant = issueModelInvocationGrant({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId),
        credentialScopeId: scope.credential.id, provider: scope.provider, model: scope.model, stage: "ask",
        requestHash: createHash("sha256").update(body).digest("hex") }, Buffer.from(required("MODEL_GRANT_SECRET"), "base64url"));
      const response = await fetch(`${brokerUrl}/api/model`, { method: "POST",
        headers: { authorization: `Bearer ${modelGrant}`, "content-type": "application/json" }, body,
        signal: AbortSignal.timeout(120_000) });
      // The body is read as text first: a 502 from the edge is HTML, and parsing it as JSON throws
      // a SyntaxError that hides the real status.
      const raw = await response.text();
      let output: { result?: { value?: unknown; inputTokens?: number; outputTokens?: number }; error?: string } = {};
      try { output = JSON.parse(raw) as typeof output; } catch { { console.error("buildit_ask_unanswered", { reason: "model_non_json" }); return { answered: false, reason: "model_non_json" }; } }
      if (!response.ok || !output.result) { console.error("buildit_ask_unanswered", { reason: "model_unavailable", status: response.status, error: output.error }); return { answered: false, reason: "model_unavailable" }; }
      const value = output.result.value as { answer?: unknown; groundedInReview?: unknown } | undefined;
      const text = typeof value?.answer === "string" ? value.answer.trim() : "";
      if (!text) { console.error("buildit_ask_unanswered", { reason: "model_answer_empty" }); return { answered: false, reason: "model_answer_empty" }; }
      // The model said the review does not answer this. Publishing that is the point - it is the
      // difference between an answer and something that sounds like one.
      const grounded = value?.groundedInReview === true;

      await writer.upsertIssueComment({ prNumber: args.prNumber, marker,
        body: [grounded ? text : `**The published review does not answer this.** ${text}`, "",
          `> Answered only from the review published for commit \`${scope.headSha.slice(0, 12)}\`. BuildIT did not read the repository again, and it does not merge.`].join("\n") });
      await ctx.runMutation(internal.reviewAskData.recordAsk, {
        organizationId: args.organizationId, reviewId: scope.reviewId,
        inputTokens: output.result?.inputTokens ?? 0, outputTokens: output.result?.outputTokens ?? 0,
        provider: scope.provider, model: scope.model, now: Date.now(),
      });
      return { answered: true };
    } finally { await github.revoke(tokenScope); }
  },
});
