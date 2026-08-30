"use node";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { DataModel } from "./_generated/dataModel";
import type { GenericActionCtx } from "convex/server";
import {
  GitHubAppClient,
  GitHubRepositoryWriter,
  RepositoryContentClient,
  chunkRepositorySnapshot,
} from "@buildit/github";
import {
  assertAutofixBounds,
  conservativeModelCost,
  candidateWorsened,
  contentHash,
  runModelPatchChain,
  stageSchemas,
  validatePatchProposals,
  type PatchProposal,
} from "@buildit/orchestrator";
import { defaultExecutionPlans } from "@buildit/runner";
import {
  issueArtifactGrant,
  issueExecutionGrant,
  issueModelInvocationGrant,
  redact,
  redactForModel,
} from "@buildit/security";
import type { ProviderResult } from "@buildit/providers";
import {
  detectPackageManager,
  sha256Json,
  summarizeExecution,
  type ExecutionResponse,
} from "./lib/validationEvidence";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}
type ArtifactRef = {
  id: Id<"artifacts">;
  storageKey: string;
  checksum: string;
  size: number;
};
type Scope = {
  organizationId: Id<"organizations">;
  repositoryId: Id<"repositories">;
  reviewId: Id<"reviews">;
  installationId: number;
  githubRepositoryId: number;
  prNumber: number;
  headSha: string;
  baseSha: string;
  createdAt: number;
  startedAt:number;
  budgetLimit:number;
  budgetConsumed:number;
  configRevisionId: Id<"configRevisions">;
  runnerImageVersion: string;
  provider: "anthropic" | "openai" | "gemini";
  model: string;
  credentialDocumentId: Id<"providerCredentials">;
  credential: {
    id: string;
    organizationId: string;
    repositoryId?: string;
    provider: "anthropic" | "openai" | "gemini";
    ciphertext: string;
    nonce: string;
    tag: string;
    wrappedDataKey: string;
    kmsKeyId: string;
    envelopeVersion: 1;
    keyVersion: number;
    aadDigest: string;
    maskedSuffix: string;
    status: "valid";
    createdBy: string;
    createdAt: number;
    lastValidatedAt: number;
  };
  analysis: ArtifactRef;
  contexts: ArtifactRef[];
  patchFingerprints: string[];
  rounds: Array<{
    roundNumber: number;
    candidateCommitSha: string;
    outcome: string;
    validation?: ArtifactRef;
  }>;
};
type SnapshotChunk = {
  revision?: "base" | "head";
  snapshot?: {
    commitSha?: string;
    files?: Array<{ path: string; content: string; size: number }>;
  };
};
type Analysis = {
  version?: number;
  pinned?: { headSha?: string; baseSha?: string };
  records?: Array<{ stage?: string; value?: { patches?: PatchProposal[] } }>;
  validation?: { head?: { results?: unknown[]; outputs?: Array<{ planId?: string; text?: string }> };scanners?:{head?:{findings?:Array<{severity?:string}>}} };
  arbitrated?: Array<{
    id?: string;
    resolution?: string;
    path?: string;
    title?: string;
    explanation?: string;
  }>;
};
export function redactAutofixSources<T extends { content: string }>(sources: T[]) {
  return sources.map(item => ({ ...item, content: redactForModel(item.content) }));
}
export function buildAutofixPromptContext(input: {
  originalHeadSha: string;
  parentCandidateSha: string;
  acceptedFindings: unknown[];
  files: Array<{ path: string; content: string; contentHash: string }>;
  latestChecks: { results?: unknown[]; outputs?: Array<{ planId?: string; text?: string }> };
}) {
  return {
    authorizedAutofix: true,
    originalHeadSha: input.originalHeadSha,
    parentCandidateSha: input.parentCandidateSha,
    acceptedFindings: input.acceptedFindings,
    files: redactAutofixSources(input.files),
    latestChecks: {
      results: input.latestChecks.results ?? [],
      outputs: (input.latestChecks.outputs ?? []).map(item => ({ planId: item.planId, text: redact(item.text ?? "").slice(0, 10_000) })),
    },
  };
}

async function readArtifact(
  scope: Scope,
  artifact: ArtifactRef,
  brokerUrl: string,
  secret: Buffer,
) {
  const grant = issueArtifactGrant(
    {
      organizationId: String(scope.organizationId),
      repositoryId: String(scope.repositoryId),
      reviewId: String(scope.reviewId),
      artifactId: String(artifact.id),
      storageKey: artifact.storageKey,
      operation: "read",
    },
    secret,
  );
  const response = await fetch(`${brokerUrl}/api/artifacts`, {
    headers: { authorization: `Bearer ${grant}` },
  });
  if (!response.ok)
    throw new Error(`autofix_artifact_download_${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (
    body.byteLength !== artifact.size ||
    createHash("sha256").update(body).digest("hex") !== artifact.checksum
  )
    throw new Error("autofix_artifact_integrity_failed");
  return body;
}

async function storeArtifact(
  ctx: GenericActionCtx<DataModel>,
  scope: Scope,
  args: {
    organizationId: Id<"organizations">;
    reviewId: Id<"reviews">;
    expectedHeadSha: string;
    expectedGeneration: number;
  },
  input: {
    roundNumber: number;
    slot: string;
    type: "patch" | "command_output" | "review_message";
    body: Buffer;
  },
  brokerUrl: string,
  secret: Buffer,
) {
  const checksum = createHash("sha256").update(input.body).digest("hex"),
    now = Date.now();
  const reserved: { artifactId: Id<"artifacts">; storageKey: string } =
    await ctx.runMutation(internal.reviewAutofixData.reserveArtifact, {
      ...args,
      roundNumber: input.roundNumber,
      slot: input.slot,
      type: input.type,
      checksum,
      size: input.body.byteLength,
      now,
    });
  const grant = issueArtifactGrant(
    {
      organizationId: String(scope.organizationId),
      repositoryId: String(scope.repositoryId),
      reviewId: String(scope.reviewId),
      artifactId: String(reserved.artifactId),
      storageKey: reserved.storageKey,
      operation: "write",
    },
    secret,
    now,
  );
  const upload = await fetch(`${brokerUrl}/api/artifacts`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${grant}`,
      "content-type": "application/octet-stream",
      "x-buildit-sha256": checksum,
    },
    body: new Uint8Array(input.body),
  });
  if (!upload.ok) throw new Error(`autofix_artifact_upload_${upload.status}`);
  await ctx.runMutation(internal.reviewAutofixData.completeArtifact, {
    ...args,
    artifactId: reserved.artifactId,
    checksum,
    size: input.body.byteLength,
  });
  return {
    id: reserved.artifactId,
    storageKey: reserved.storageKey,
    checksum,
    size: input.body.byteLength,
  };
}
async function assertActive(
  ctx: GenericActionCtx<DataModel>,
  args: {
    organizationId: Id<"organizations">;
    reviewId: Id<"reviews">;
    expectedHeadSha: string;
    expectedGeneration: number;
  },
) {
  await ctx.runQuery(internal.reviewAutofixData.assertActive, args);
}

export const runConvergence = internalAction({
  args: {
    organizationId: v.id("organizations"),
    reviewId: v.id("reviews"),
    expectedHeadSha: v.string(),
    expectedGeneration: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    candidateCommitSha: string;
    outcome: "passed" | "failed" | "incomplete";
    roundNumber: number;
  }> => {
    const scope: Scope = await ctx.runQuery(
      internal.reviewAutofixData.scope,
      args,
    );
    const passed = scope.rounds.find((item) => item.outcome === "passed");
    if (passed)
      return {
        candidateCommitSha: passed.candidateCommitSha,
        outcome: "passed",
        roundNumber: passed.roundNumber,
      };
    if (scope.rounds.length >= 3) {
      const last = scope.rounds.sort(
        (a, b) => b.roundNumber - a.roundNumber,
      )[0]!;
      return {
        candidateCommitSha: last.candidateCommitSha,
        outcome: last.outcome as "failed" | "incomplete",
        roundNumber: last.roundNumber,
      };
    }
    const brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""),
      artifactSecret = Buffer.from(
        required("ARTIFACT_GRANT_SECRET"),
        "base64url",
      ),
      executionSecret = Buffer.from(
        required("EXECUTION_GRANT_SECRET"),
        "base64url",
      ),
      modelSecret = Buffer.from(required("MODEL_GRANT_SECRET"), "base64url");
    const [analysisBody, ...contextBodies] = await Promise.all([
      readArtifact(scope, scope.analysis, brokerUrl, artifactSecret),
      ...scope.contexts.map((item) =>
        readArtifact(scope, item, brokerUrl, artifactSecret),
      ),
    ]);
    const analysis = JSON.parse(analysisBody.toString("utf8")) as Analysis;
    if (
      analysis.version !== 1 ||
      analysis.pinned?.headSha !== scope.headSha ||
      analysis.pinned?.baseSha !== scope.baseSha ||
      !Array.isArray(analysis.records) ||
      !Array.isArray(analysis.arbitrated)
    )
      throw new Error("autofix_analysis_pinning_failed");
    const chunks = contextBodies.map(
        (body) => JSON.parse(body.toString("utf8")) as SnapshotChunk,
      ),
      originalHeadFiles = chunks
        .filter((item) => item.revision === "head")
        .flatMap((item) => item.snapshot?.files ?? []),
      acceptedFindings = analysis.arbitrated.filter(
        (item) =>
          item.resolution === "accepted" &&
          typeof item.id === "string" &&
          typeof item.path === "string",
      ),
      acceptedFindingIds = new Set(acceptedFindings.map((item) => item.id!));
    if (!acceptedFindingIds.size)
      throw new Error("autofix_no_accepted_findings");
    const github = new GitHubAppClient({
        appId: required("GITHUB_APP_ID"),
        privateKey: required("GITHUB_APP_PRIVATE_KEY"),
      }),
      tokenScope = {
        installationId: scope.installationId,
        repositoryId: scope.githubRepositoryId,
        stage: "autofix_delivery" as const,
      },
      token = await github.tokenFor(tokenScope),
      writer = new GitHubRepositoryWriter({
        repositoryId: scope.githubRepositoryId,
        installationToken: token,
      });
    try {
      let parentSha =
          scope.rounds.sort((a, b) => a.roundNumber - b.roundNumber).at(-1)
            ?.candidateCommitSha ?? scope.headSha,
        lastOutcome: "failed" | "incomplete" = "incomplete",
        lastValidation: ExecutionResponse | undefined;
      const seenFingerprints = new Set(scope.patchFingerprints);let budgetConsumed=scope.budgetConsumed;
      for (
        let roundNumber = scope.rounds.length + 1;
        roundNumber <= 3;
        roundNumber++
      ) {
        assertAutofixBounds({completedRounds:roundNumber-1,modelAttempts:(roundNumber-1)*2,startedAt:scope.startedAt,now:Date.now(),budgetConsumed,budgetLimit:scope.budgetLimit});
        await assertActive(ctx, args);
        const pullResponse = await fetch(
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
        if (!pullResponse.ok)
          throw new Error(`github_pull_${pullResponse.status}`);
        const pull = (await pullResponse.json()) as { head?: { sha?: string } };
        if (pull.head?.sha !== scope.headSha) throw new Error("stale_head");
        const parent =
            parentSha === scope.headSha
              ? null
              : await new RepositoryContentClient().fetchExactCommit({
                  installationToken: token,
                  repositoryId: scope.githubRepositoryId,
                  commitSha: parentSha,
                  limits: {
                    maxFiles: 10_000,
                    maxFileBytes: 1_000_000,
                    maxTotalBytes: 40_000_000,
                  },
                }),
          sourceFiles = parent?.files ?? originalHeadFiles,
          sources = sourceFiles.map((file) => ({
            path: file.path,
            content: file.content,
            contentHash: contentHash(file.content),
          }));
        const relevantPaths = new Set(
              acceptedFindings.map((item) => item.path!),
            ),
            relevant = sources
              .filter((item) => relevantPaths.has(item.path))
              .slice(0, 20),
            prior = scope.rounds.find(
              (item) => item.roundNumber === roundNumber - 1,
            ),
            stored = prior?.validation
              ? (JSON.parse(
                  (
                    await readArtifact(
                      scope,
                      prior.validation,
                      brokerUrl,
                      artifactSecret,
                    )
                  ).toString("utf8"),
                ) as { output?: ExecutionResponse })
              : undefined,
            failure = lastValidation ?? stored?.output,
            latestChecks = failure?.head ?? analysis.validation?.head ?? { results: [], outputs: [] },
            patchRecords = await runModelPatchChain({
              pinned: { headSha: parentSha, baseSha: scope.baseSha, configRevision: String(scope.configRevisionId) },
              untrusted: buildAutofixPromptContext({ originalHeadSha: scope.headSha, parentCandidateSha: parentSha, acceptedFindings, files: relevant, latestChecks }),
              invoke: async request => {
                const requestBody = JSON.stringify({ organizationId: String(scope.organizationId), repositoryId: String(scope.repositoryId), reviewId: String(scope.reviewId), stage: "patch", credential: scope.credential,
                  request: { model: scope.model, system: request.system, input: request.input, schemaName: request.schemaName, schema: stageSchemas.patch, maxOutputTokens: request.maxOutputTokens } });
                const grant = issueModelInvocationGrant(
              {
                organizationId: String(scope.organizationId),
                repositoryId: String(scope.repositoryId),
                reviewId: String(scope.reviewId),
                credentialScopeId: scope.credential.id,
                provider: scope.provider,
                model: scope.model,
                stage: "patch",
                requestHash: createHash("sha256").update(requestBody).digest("hex"),
              },
              modelSecret,
                );
                await assertActive(ctx, args);
                const response = await fetch(`${brokerUrl}/api/model`, {
              method: "POST",
              headers: {
                authorization: `Bearer ${grant}`,
                "content-type": "application/json",
              },
              body: requestBody,
                });
                const result = await response.json() as { result?: ProviderResult; error?: string };
                if (!response.ok || !result.result){await ctx.runMutation(internal.reviewModelData.recordStageRun,{...args,roundNumber,stage:"patch",provider:scope.provider,model:scope.model,promptVersion:"patch-v1",schemaVersion:"patch-schema-v1",finishReason:(result.error??`http_${response.status}`).slice(0,100),requestHash:createHash("sha256").update(request.system).update("\0").update(request.input).update("\0").update(JSON.stringify(stageSchemas.patch)).digest("hex"),attempt:request.repairOf===undefined?1:2,outcome:"provider_error",inputTokens:0,outputTokens:0,now:Date.now()});throw new Error(result.error ?? `autofix_model_${response.status}`)}
                return result.result;
              },
              onUsage: async result => { await ctx.runMutation(internal.reviewModelData.recordStageRun,{...args,roundNumber,stage:result.stage,provider:result.provider,model:result.model,promptVersion:result.promptVersion,schemaVersion:result.schemaVersion,finishReason:result.finishReason,requestHash:result.requestFingerprint,...(result.requestId?{requestId:result.requestId}:{}),attempt:result.attempt,outcome:result.outcome,inputTokens:result.inputTokens,outputTokens:result.outputTokens,now:Date.now()});await ctx.runMutation(internal.reviewAutofixData.recordModelUsage, {
            ...args,
            credentialId: scope.credentialDocumentId,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            now: Date.now(),
              });budgetConsumed+=conservativeModelCost(result.inputTokens,result.outputTokens); },
            }),
            proposals = (patchRecords[0]?.value.patches as PatchProposal[] | undefined);
        if (!Array.isArray(proposals) || !proposals.length)
          throw new Error("autofix_patch_unavailable");
        const patches = validatePatchProposals({
            proposals,
            sources,
            acceptedFindingIds,
          }),
          patchFingerprint = createHash("sha256")
            .update(
              JSON.stringify(
                patches.map((item) => ({
                  path: item.path,
                  expectedContentHash: item.expectedContentHash,
                  replacementHash: contentHash(item.replacementContent),
                  findingIds: item.findingIds,
                })),
              ),
            )
            .digest("hex");
        if (seenFingerprints.has(patchFingerprint))
          throw new Error("autofix_repeated_patch");
        seenFingerprints.add(patchFingerprint);
        await assertActive(ctx, args);
        const candidateCommitSha = await writer.createCandidateCommit({
          pinnedHead: parentSha,
          currentHead: parentSha,
          message: `BuildIT Autofix for PR #${scope.prNumber} · round ${roundNumber}`,
          patches: patches.map((item) => ({
            path: item.path,
            content: item.replacementContent,
          })),
          identity: {
            name: "BuildIT",
            email: "buildit@users.noreply.github.com",
            date: new Date(scope.createdAt + roundNumber).toISOString(),
          },
        });
        const candidate = await new RepositoryContentClient().fetchExactCommit({
          installationToken: token,
          repositoryId: scope.githubRepositoryId,
          commitSha: candidateCommitSha,
          limits: {
            maxFiles: 10_000,
            maxFileBytes: 1_000_000,
            maxTotalBytes: 40_000_000,
          },
        });
        if (candidate.coverage !== "full")
          throw new Error("autofix_candidate_context_partial");
        const candidateArtifacts: Array<{
          id: Id<"artifacts">;
          storageKey: string;
          checksum: string;
          size: number;
        }> = [];
        for (const chunk of chunkRepositorySnapshot(candidate, 3_700_000))
          candidateArtifacts.push(
            await storeArtifact(
              ctx,
              scope,
              args,
              {
                roundNumber,
                slot: `candidate-${chunk.chunkIndex}`,
                type: "patch",
                body: Buffer.from(
                  JSON.stringify({
                    version: 1,
                    revision: "head",
                    snapshot: chunk,
                  }),
                ),
              },
              brokerUrl,
              artifactSecret,
            ),
          );
        const baseContexts = scope.contexts
            .map((context, index) => ({ context, body: chunks[index]! }))
            .filter((item) => item.body.revision === "base"),
          paths = {
            base: new Set(
              baseContexts.flatMap(
                (item) =>
                  item.body.snapshot?.files?.map((file) => file.path) ?? [],
              ),
            ),
            head: new Set(candidate.files.map((file) => file.path)),
          },
          manager = detectPackageManager(paths),
          { install, checks } = defaultExecutionPlans(manager),
          runtime = "node24" as const;
        const baseDescriptors = baseContexts.map(({ context }) => ({
          revision: "base" as const,
          artifactId: String(context.id),
          storageKey: context.storageKey,
          checksum: context.checksum,
          size: context.size,
          readGrant: issueArtifactGrant(
            {
              organizationId: String(scope.organizationId),
              repositoryId: String(scope.repositoryId),
              reviewId: String(scope.reviewId),
              artifactId: String(context.id),
              storageKey: context.storageKey,
              operation: "read",
            },
            artifactSecret,
          ),
        }));
        const candidateDescriptors = candidateArtifacts.map((item) => ({
            revision: "head" as const,
            artifactId: String(item.id),
            storageKey: item.storageKey,
            checksum: item.checksum,
            size: item.size,
            readGrant: issueArtifactGrant(
              {
                organizationId: String(scope.organizationId),
                repositoryId: String(scope.repositoryId),
                reviewId: String(scope.reviewId),
                artifactId: String(item.id),
                storageKey: item.storageKey,
                operation: "read",
              },
              artifactSecret,
            ),
          })),
          descriptors = [...baseDescriptors, ...candidateDescriptors];
        const artifactsHash = sha256Json(
            descriptors.map(({ readGrant: _, ...item }) => item),
          ),
          plansHash = sha256Json({
            runnerImageVersion: scope.runnerImageVersion,
            runtime,
            install,
            checks,
          }),
          executionGrant = issueExecutionGrant(
            {
              organizationId: String(scope.organizationId),
              repositoryId: String(scope.repositoryId),
              reviewId: String(scope.reviewId),
              baseSha: scope.baseSha,
              headSha: candidateCommitSha,
              artifactsHash,
              plansHash,
              ttlMs: 120_000,
            },
            executionSecret,
          );
        await assertActive(ctx, args);
        const executionResponse = await fetch(`${brokerUrl}/api/execute`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${executionGrant}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            organizationId: String(scope.organizationId),
            repositoryId: String(scope.repositoryId),
            reviewId: String(scope.reviewId),
            baseSha: scope.baseSha,
            headSha: candidateCommitSha,
            runnerImageVersion: scope.runnerImageVersion,
            runtime,
            artifacts: descriptors,
            install,
            checks,
          }),
        });
        const output = (await executionResponse.json()) as ExecutionResponse & {
          error?: string;
        };
        if (!executionResponse.ok)
          throw new Error(
            output.error ?? `autofix_execution_${executionResponse.status}`,
          );
        const allSummaries = summarizeExecution(
            output,
            scope.baseSha,
            candidateCommitSha,
          ),
          headSummaries = allSummaries
            .filter((item) => item.revision === "head")
            .map((item) => ({
              commitSha: item.commitSha,
              planId: item.planId,
              kind: item.kind,
              required: item.required,
              conclusion: item.conclusion,
              ...("exitCode" in item && item.exitCode !== undefined
                ? { exitCode: item.exitCode }
                : {}),
              durationMs: item.durationMs,
              commandFingerprint: item.commandFingerprint,
              nameHash: createHash("sha256").update(item.planId).digest("hex"),
              credentialTeardownProved: item.credentialTeardownProved,
              sandboxStopped: item.sandboxStopped,
            }));
        const requiredRuns = headSummaries.filter((item) => item.required),
          outcome = requiredRuns.some(
            (item) => !["passed", "failed"].includes(item.conclusion),
          )
            ? ("incomplete" as const)
            : requiredRuns.some((item) => item.conclusion === "failed")
              ? ("failed" as const)
              : ("passed" as const);
        const parentChecks=((failure?.head.results??analysis.validation?.head?.results??[]) as Array<{planId:string;required:boolean;conclusion:"passed"|"failed"|"not_run"|"timed_out"|"truncated"|"flaky"}>),parentCritical=(failure?.scanners.head.findings??analysis.validation?.scanners?.head?.findings??[]).filter(item=>item.severity==="critical").length,candidateCritical=output.scanners.head.findings.filter(item=>item.severity==="critical").length,worsening=candidateWorsened({parent:parentChecks,candidate:headSummaries,parentCriticalFindings:parentCritical,candidateCriticalFindings:candidateCritical});
        if(worsening.worsened)throw new Error(`autofix_worsened:${worsening.reason}`);
        const validationBody = Buffer.from(
            JSON.stringify({
              version: 1,
              roundNumber,
              pinned: {
                baseSha: scope.baseSha,
                originalHeadSha: scope.headSha,
                candidateCommitSha,
                configRevisionId: String(scope.configRevisionId),
                runnerImageVersion: scope.runnerImageVersion,
              },
              manager,
              output,
            }),
          ),
          validationArtifact = await storeArtifact(
            ctx,
            scope,
            args,
            {
              roundNumber,
              slot: "validation",
              type: "command_output",
              body: validationBody,
            },
            brokerUrl,
            artifactSecret,
          );
        await ctx.runMutation(internal.reviewAutofixData.completeRound, {
          ...args,
          roundNumber,
          candidateCommitSha,
          patchFingerprint,
          patchArtifactId: candidateArtifacts[0]!.id,
          validationArtifactId: validationArtifact.id,
          summaries: headSummaries,
          outcome,
          now: Date.now(),
        });
        if (outcome === "passed")
          return { candidateCommitSha, outcome, roundNumber };
        parentSha = candidateCommitSha;
        lastOutcome = outcome;
        lastValidation = output;
      }
      return {
        candidateCommitSha: parentSha,
        outcome: lastOutcome,
        roundNumber: 3,
      };
    } finally {
      github.revoke(tokenScope);
    }
  },
});

export function autofixScannerLines(run: ExecutionResponse["scanners"]["head"]) {
  const labels: Record<string, string> = { builditRules: "buildit-rules", gitleaks: "gitleaks", osvScanner: "osv-scanner" }, expected = Object.keys(labels), runs = run.runs ?? [];
  if (!run.complete || runs.length !== expected.length || new Set(runs.map(item => item.scanner)).size !== expected.length || runs.some(item => !labels[item.scanner]) || expected.some(scanner => !runs.some(item => item.scanner === scanner)) || run.findings.some(finding => !finding.scanner || !labels[finding.scanner])) throw new Error("autofix_scanner_inventory_invalid");
  return runs.map(item => {
    const findings = run.findings.filter(finding => finding.scanner === item.scanner), counts = { critical: 0, warning: 0, info: 0 };
    for (const finding of findings) counts[finding.severity] += 1;
    const conclusion = counts.critical ? "failed" : "passed", detail = (["critical", "warning", "info"] as const).filter(level => counts[level]).map(level => `${counts[level]} ${level[0]!.toUpperCase()}${level.slice(1)}`).join(", ") || "no findings";
    return `- ${labels[item.scanner]}: **${conclusion}** — ${detail}`;
  });
}

export const deliverPassed = internalAction({
  args: {
    organizationId: v.id("organizations"),
    reviewId: v.id("reviews"),
    expectedHeadSha: v.string(),
    expectedGeneration: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    pullRequestNumber: number;
    pullRequestUrl: string;
    candidateCommitSha: string;
  }> => {
    const scope: Scope = await ctx.runQuery(
        internal.reviewAutofixData.scope,
        args,
      ),
      passed = scope.rounds.find((item) => item.outcome === "passed");
    if (!passed?.validation) throw new Error("autofix_passed_round_missing");
    const brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""),
      artifactSecret = Buffer.from(
        required("ARTIFACT_GRANT_SECRET"),
        "base64url",
      ),
      validation = JSON.parse(
        (
          await readArtifact(
            scope,
            passed.validation,
            brokerUrl,
            artifactSecret,
          )
        ).toString("utf8"),
      ) as {
        pinned?: { candidateCommitSha?: string };
        output?: ExecutionResponse;
      };
    if (
      validation.pinned?.candidateCommitSha !== passed.candidateCommitSha ||
      !validation.output
    )
      throw new Error("autofix_delivery_evidence_invalid");
    const github = new GitHubAppClient({
        appId: required("GITHUB_APP_ID"),
        privateKey: required("GITHUB_APP_PRIVATE_KEY"),
      }),
      tokenScope = {
        installationId: scope.installationId,
        repositoryId: scope.githubRepositoryId,
        stage: "autofix_delivery" as const,
      },
      token = await github.tokenFor(tokenScope),
      writer = new GitHubRepositoryWriter({
        repositoryId: scope.githubRepositoryId,
        installationToken: token,
      });
    const branch = `buildit/pr-${scope.prNumber}/${String(scope.reviewId)
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 24)}`;
    let branchReady = false,
      stackedAttempted = false;
    try {
      await assertActive(ctx, args);
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
      const pull = (await current.json()) as {
        head?: { sha?: string; ref?: string };
      };
      if (pull.head?.sha !== scope.headSha || !pull.head.ref)
        throw new Error("stale_head");
      const branchHash = createHash("sha256")
          .update(`${branch}\0${passed.candidateCommitSha}`)
          .digest("hex"),
        now = Date.now(),
        branchKey = `${scope.githubRepositoryId}:${scope.prNumber}:${scope.headSha}:branch:autofix`,
        branchEffect: Id<"githubSideEffects"> = await ctx.runMutation(
          internal.reviewState.reserveSideEffect,
          {
            organizationId: scope.organizationId,
            reviewId: scope.reviewId,
            expectedHeadSha: args.expectedHeadSha,
            expectedGeneration: args.expectedGeneration,
            operationKey: branchKey,
            type: "branch_create",
            requestHash: branchHash,
            now,
          },
        );
      await assertActive(ctx, args);
      await writer.upsertBranch({
        name: branch,
        sha: passed.candidateCommitSha,
      });
      branchReady = true;
      await ctx.runMutation(internal.reviewPublicationData.completeSideEffect, {
        ...args,
        sideEffectId: branchEffect,
        requestHash: branchHash,
        externalId: branch,
        status: "completed",
        now: Date.now(),
      });
      const prHash = createHash("sha256")
          .update(`${branch}\0${pull.head.ref}\0${passed.candidateCommitSha}`)
          .digest("hex"),
        prKey = `${scope.githubRepositoryId}:${scope.prNumber}:${scope.headSha}:stacked_pr:autofix`,
        prEffect: Id<"githubSideEffects"> = await ctx.runMutation(
          internal.reviewState.reserveSideEffect,
          {
            organizationId: scope.organizationId,
            reviewId: scope.reviewId,
            expectedHeadSha: args.expectedHeadSha,
            expectedGeneration: args.expectedGeneration,
            operationKey: prKey,
            type: "stacked_pr_create",
            requestHash: prHash,
            now: Date.now(),
          },
        );
      await assertActive(ctx, args);
      stackedAttempted = true;
      const stacked = await writer.upsertStackedPullRequest({
        head: branch,
        base: pull.head.ref,
        title: `BuildIT fixes for PR #${scope.prNumber}`,
        body: `Validated candidate \`${passed.candidateCommitSha}\` after ${passed.roundNumber} bounded Autofix round${passed.roundNumber === 1 ? "" : "s"}. BuildIT cannot merge this pull request; a human owns the merge decision.`,
      });
      await ctx.runMutation(internal.reviewPublicationData.completeSideEffect, {
        ...args,
        sideEffectId: prEffect,
        requestHash: prHash,
        externalId: String(stacked.number),
        status: "completed",
        now: Date.now(),
      });
      const results = validation.output.head.results,
        reportText = [
          `## BuildIT Autofix: delivered for human review`,
          `Original PR head: \`${scope.headSha}\``,
          `Candidate: \`${passed.candidateCommitSha}\``,
          `Stacked PR: ${stacked.url}`,
          `Rounds completed: **${passed.roundNumber} of 3 maximum**`,
          ``,
          `### Final required checks`,
          ...results
            .filter((item) => item.required)
            .map((item) => `- ${item.planId}: **${item.conclusion}**`),
          ...autofixScannerLines(validation.output.scanners.head),
          ``,
          `BuildIT did not merge either pull request. A human must inspect and merge the stacked PR.`,
        ].join("\n"),
        reportBody = Buffer.from(reportText);
      if (reportBody.byteLength > 60_000)
        throw new Error("autofix_report_too_large");
      const report = await storeArtifact(
          ctx,
          scope,
          args,
          {
            roundNumber: passed.roundNumber,
            slot: "handoff",
            type: "review_message",
            body: reportBody,
          },
          brokerUrl,
          artifactSecret,
        ),
        publicationHash = createHash("sha256").update(reportText).digest("hex"),
        checkKey = `${scope.githubRepositoryId}:${scope.prNumber}:${scope.headSha}:check:autofix`,
        checkEffect: Id<"githubSideEffects"> = await ctx.runMutation(
          internal.reviewState.reserveSideEffect,
          {
            organizationId: scope.organizationId,
            reviewId: scope.reviewId,
            expectedHeadSha: args.expectedHeadSha,
            expectedGeneration: args.expectedGeneration,
            operationKey: checkKey,
            type: "check_update",
            requestHash: publicationHash,
            now: Date.now(),
          },
        );
      await assertActive(ctx, args);
      const check = await writer.upsertCheckRun({
        name: "BuildIT / Autofix",
        headSha: passed.candidateCommitSha,
        conclusion: "success",
        title: "Validated candidate ready for human review",
        summary: reportText,
      });
      await ctx.runMutation(internal.reviewPublicationData.completeSideEffect, {
        ...args,
        sideEffectId: checkEffect,
        requestHash: publicationHash,
        externalId: String(check.id),
        status: "completed",
        now: Date.now(),
      });
      const commentKey = `${scope.githubRepositoryId}:${scope.prNumber}:${scope.headSha}:comment:autofix`,
        commentEffect: Id<"githubSideEffects"> = await ctx.runMutation(
          internal.reviewState.reserveSideEffect,
          {
            organizationId: scope.organizationId,
            reviewId: scope.reviewId,
            expectedHeadSha: args.expectedHeadSha,
            expectedGeneration: args.expectedGeneration,
            operationKey: commentKey,
            type: "comment_update",
            requestHash: publicationHash,
            now: Date.now(),
          },
        );
      await assertActive(ctx, args);
      const comment = await writer.upsertIssueComment({
        prNumber: scope.prNumber,
        marker: `buildit-autofix:${scope.reviewId}:${scope.headSha}`,
        body: reportText,
      });
      await ctx.runMutation(internal.reviewPublicationData.completeSideEffect, {
        ...args,
        sideEffectId: commentEffect,
        requestHash: publicationHash,
        externalId: String(comment.id),
        status: "completed",
        now: Date.now(),
      });
      await ctx.runMutation(internal.reviewAutofixData.completeDelivery, {
        ...args,
        roundNumber: passed.roundNumber,
        candidateCommitSha: passed.candidateCommitSha,
        reportArtifactId: report.id,
        now: Date.now(),
      });
      return {
        pullRequestNumber: stacked.number,
        pullRequestUrl: stacked.url,
        candidateCommitSha: passed.candidateCommitSha,
      };
    } catch (error) {
      if (branchReady && !stackedAttempted) {
        try {
          await writer.deleteBranchIfExact({
            name: branch,
            sha: passed.candidateCommitSha,
          });
        } catch (cleanupError) {
          throw new Error("autofix_branch_cleanup_failed", {
            cause: cleanupError,
          });
        }
      }
      throw error;
    } finally {
      github.revoke(tokenScope);
    }
  },
});

export const publishFailure = internalAction({
  args: {
    organizationId: v.id("organizations"),
    reviewId: v.id("reviews"),
    expectedHeadSha: v.string(),
    expectedGeneration: v.number(),
  },
  handler: async (ctx, args): Promise<{ candidateCommitSha: string }> => {
    const scope: Scope = await ctx.runQuery(
        internal.reviewAutofixData.scope,
        args,
      ),
      rounds = [...scope.rounds].sort((a, b) => a.roundNumber - b.roundNumber),
      last = rounds.at(-1);
    if (
      rounds.length !== 3 ||
      rounds.some((item) => item.outcome === "passed") ||
      !last?.validation
    )
      throw new Error("autofix_failure_not_ready");
    const brokerUrl = required("BUILDIT_BROKER_URL").replace(/\/$/, ""),
      artifactSecret = Buffer.from(
        required("ARTIFACT_GRANT_SECRET"),
        "base64url",
      ),
      validation = JSON.parse(
        (
          await readArtifact(scope, last.validation, brokerUrl, artifactSecret)
        ).toString("utf8"),
      ) as { output?: ExecutionResponse };
    if (!validation.output) throw new Error("autofix_failure_evidence_invalid");
    const failed = validation.output.head.results
        .filter((item) => item.required && item.conclusion !== "passed")
        .map((item) => `${item.planId}: ${item.conclusion}`),
      reportText = [
        "## BuildIT Autofix: stopped after 3 rounds",
        `Original PR head: \`${scope.headSha}\``,
        `Last candidate: \`${last.candidateCommitSha}\``,
        "",
        "### Unresolved required checks",
        ...(failed.length
          ? failed.map((item) => `- ${item}`)
          : ["- Required scanner or evidence validation remained incomplete."]),
        "",
        "No stacked PR was opened because final validation did not pass.",
        "BuildIT did not merge or modify the original PR branch. A human owns the next decision.",
      ].join("\n"),
      report = await storeArtifact(
        ctx,
        scope,
        args,
        {
          roundNumber: 3,
          slot: "failure-handoff",
          type: "review_message",
          body: Buffer.from(reportText),
        },
        brokerUrl,
        artifactSecret,
      ),
      github = new GitHubAppClient({
        appId: required("GITHUB_APP_ID"),
        privateKey: required("GITHUB_APP_PRIVATE_KEY"),
      }),
      tokenScope = {
        installationId: scope.installationId,
        repositoryId: scope.githubRepositoryId,
        stage: "review" as const,
      },
      token = await github.tokenFor(tokenScope);
    try {
      await assertActive(ctx, args);
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
      const pull = (await current.json()) as { head?: { sha?: string } };
      if (pull.head?.sha !== scope.headSha) throw new Error("stale_head");
      const writer = new GitHubRepositoryWriter({
          repositoryId: scope.githubRepositoryId,
          installationToken: token,
        }),
        requestHash = createHash("sha256").update(reportText).digest("hex"),
        operationKey = `${scope.githubRepositoryId}:${scope.prNumber}:${scope.headSha}:comment:autofix`,
        effect: Id<"githubSideEffects"> = await ctx.runMutation(
          internal.reviewState.reserveSideEffect,
          {
            organizationId: scope.organizationId,
            reviewId: scope.reviewId,
            expectedHeadSha: args.expectedHeadSha,
            expectedGeneration: args.expectedGeneration,
            operationKey,
            type: "comment_update",
            requestHash,
            now: Date.now(),
          },
        );
      await assertActive(ctx, args);
      const comment = await writer.upsertIssueComment({
        prNumber: scope.prNumber,
        marker: `buildit-autofix:${scope.reviewId}:${scope.headSha}`,
        body: reportText,
      });
      await ctx.runMutation(internal.reviewPublicationData.completeSideEffect, {
        ...args,
        sideEffectId: effect,
        requestHash,
        externalId: String(comment.id),
        status: "completed",
        now: Date.now(),
      });
      await ctx.runMutation(internal.reviewAutofixData.completeFailure, {
        ...args,
        reportArtifactId: report.id,
        now: Date.now(),
      });
      return { candidateCommitSha: last.candidateCommitSha };
    } finally {
      github.revoke(tokenScope);
    }
  },
});
