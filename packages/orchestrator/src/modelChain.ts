import { createHash } from "node:crypto";
import { validateSchemaValue, type JsonSchema, type ProviderName, type ProviderResult } from "@buildit/providers";
import { redactForModel } from "@buildit/security";
import { partitionFiles, planReview, type ReviewPlan } from "./reviewPlan.js";
import { autofixPromptStages, promptStages, reviewPromptStages, runPromptChain, type InjectionScope, type InjectionSignal, type PromptStage, type StageDefinition } from "./promptChain.js";

const string = { type: "string" } as const;
const stringArray = { type: "array", items: string } as const;
const object = (properties: Record<string, unknown>, required = Object.keys(properties)): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const array = (items: JsonSchema): JsonSchema => ({ type: "array", items });

export const stageSchemas: Record<PromptStage, JsonSchema> = {
  requirements: object({ requirements: array(object({ id: string, statement: string, evidenceIds: stringArray, status: { type: "string", enum: ["resolved", "missing", "inaccessible", "conflicting", "excluded"] }, confidence: { type: "number" }, uncertainty: string })) }),
  review_plan: object({ checks: stringArray, evidenceOperations: stringArray, riskAreas: stringArray, exclusions: stringArray }),
  findings: object({ findings: array(object({ id: string, title: string, category: { type: "string", enum: ["correctness", "security", "requirement", "architecture", "quality", "dependency", "test"] }, severity: { type: "string", enum: ["critical", "high", "warning", "info"] }, confidence: { type: "number" }, criterionId: string, path: string, startLine: { type: "number" }, endLine: { type: "number" }, evidenceIds: stringArray, impact: string, explanation: string })) }),
  critic: object({ decisions: array(object({ findingId: string, verdict: { type: "string", enum: ["supported", "unsupported", "uncertain"] }, missingEvidenceIds: stringArray, injectionDetected: { type: "boolean" }, explanation: string })) }),
  arbitration: object({ findings: array(object({ id: string, resolution: { type: "string", enum: ["accepted", "rejected", "uncertain"] }, evidenceIds: stringArray, reason: string })) }),
  patch: object({ patches: array(object({ path: string, rationale: string, findingIds: stringArray, expectedContentHash: string, replacementContent: string })) }),
  report: object({ claims: array(object({ text: string, evidenceIds: stringArray, uncertainty: { type: "string", enum: ["certain", "uncertain"] } })) }),
};

export type ModelStageRequest = {
  stage: PromptStage;
  schemaName: string;
  schema: JsonSchema;
  system: string;
  input: string;
  repairOf?: unknown;
  maxOutputTokens: number;
};
export type ModelStageInvoker = (request: ModelStageRequest) => Promise<ProviderResult>;
// durationMs is measured around the provider call itself. It is the only honest per-stage timing
// available: the durable workflow stamps its checkpoints as startedAt + index so replay stays
// deterministic, so nothing derived from those timestamps is a real elapsed time. Without this the
// product could say what a review cost but never how long it took - which is exactly the gap the
// review of BuildIT called out, and why /proof publishes no duration at all.
export type StageUsage = Pick<ProviderResult, "provider" | "model" | "finishReason" | "inputTokens" | "outputTokens" | "requestId"> & { stage: PromptStage;promptVersion:string;schemaVersion:string;requestFingerprint:string;attempt:number;outcome:"valid"|"schema_invalid";durationMs:number };

const repairOutputLimit = 16_000;
function repairInput(input: string, repairOf: unknown) {
  const redacted = JSON.stringify(repairOf, (_key, value) => typeof value === "string" ? redactForModel(value) : value);
  if (Buffer.byteLength(redacted, "utf8") > repairOutputLimit) throw new Error("schema_repair_output_too_large");
  const quoted = redacted.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
  return `${input}\n<buildit:invalid-output>\n${quoted}\n</buildit:invalid-output>\nCorrect only the invalid output above. Return exactly the requested schema; do not add prose or new evidence.`;
}

function strictDefinition(stage: PromptStage): StageDefinition {
  const schema = stageSchemas[stage];
  return {
    stage,
    promptVersion: `${stage}-v1`,
    schemaVersion: `${stage}-schema-v1`,
    maxInputBytes: 250_000,
    validate(value) {
      if (!validateSchemaValue(value, schema)) throw new Error("strict_stage_schema_invalid");
      return structuredClone(value as Record<string, unknown>);
    },
  };
}

export const strictModelChain = reviewPromptStages.map(strictDefinition);
export const strictPatchChain = autofixPromptStages.map(strictDefinition);

export async function runModelReviewChain(input: {
  invoke: ModelStageInvoker;
  pinned: { headSha: string; baseSha: string; configRevision: string };
  untrusted: Record<string, unknown>;
  onUsage?: (usage: StageUsage) => Promise<void> | void;
  onInjection?: (report: { signals: InjectionSignal[]; scope: InjectionScope }) => Promise<void> | void;
  plan?: ReviewPlan;
  onPlan?: (plan: ReviewPlan) => Promise<void> | void;
}) {
  const attempts=new Map<PromptStage,Array<Omit<StageUsage,"promptVersion"|"schemaVersion"|"attempt"|"outcome">>>();
  const plan = input.plan ?? planReview(input.untrusted);
  const definitions = plan.stages.map(strictDefinition);
  const files = input.untrusted.files;
  const slices = plan.findingsSpecialists > 1 && Array.isArray(files)
    ? partitionFiles(files, plan.findingsSpecialists).map(part => ({ ...input.untrusted, files: part }))
    : [input.untrusted];
  await input.onPlan?.(plan);
  return runPromptChain({
    definitions,
    expectedStages: plan.stages,
    pinned: input.pinned,
    untrusted: input.untrusted,
    maxSchemaRepairs: 1,
    ...(slices.length > 1 ? { partition: (stage: PromptStage) => stage === "findings" ? slices : undefined } : {}),
    ...(input.onInjection ? { onInjection: input.onInjection } : {}),
    onAttempt: async attempt=>{const queue=attempts.get(attempt.stage),usage=queue?.shift();if(!usage)throw new Error("model_stage_usage_missing");await input.onUsage?.({...usage,promptVersion:attempt.promptVersion,schemaVersion:attempt.schemaVersion,attempt:attempt.attempt,outcome:attempt.outcome})},
    executor: async request => {
      const providerInput = request.repairOf === undefined ? request.input : repairInput(request.input, request.repairOf);
      const startedAt = Date.now();
      const result = await input.invoke({
        ...request,
        input: providerInput,
        schemaName: `buildit_${request.stage}_v1`,
        schema: stageSchemas[request.stage],
        maxOutputTokens: request.stage === "findings" || request.stage === "patch" ? 8_000 : 4_000,
      });
      const usage={
        stage: request.stage,
        provider: result.provider,
        model: result.model,
        finishReason: result.finishReason,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        // Measured around the provider call and nothing else, so a slow stage is distinguishable
        // from a slow queue. Math.max guards a non-monotonic clock rather than trusting the host.
        durationMs: Math.max(0, Date.now() - startedAt),
        requestFingerprint:createHash("sha256").update(request.system).update("\0").update(providerInput).update("\0").update(JSON.stringify(stageSchemas[request.stage])).digest("hex"),
        ...(result.requestId ? { requestId: result.requestId } : {}),
      };attempts.set(request.stage,[...(attempts.get(request.stage)??[]),usage]);
      return result.value;
    },
  });
}

export async function runModelPatchChain(input: {
  invoke: ModelStageInvoker;
  pinned: { headSha: string; baseSha: string; configRevision: string };
  untrusted: Record<string, unknown>;
  onUsage?: (usage: StageUsage) => Promise<void> | void;
}) {
  const attempts:Array<Omit<StageUsage,"promptVersion"|"schemaVersion"|"attempt"|"outcome">>=[];
  return runPromptChain({
    definitions: strictPatchChain,
    expectedStages: autofixPromptStages,
    pinned: input.pinned,
    untrusted: input.untrusted,
    maxSchemaRepairs: 1,
    onAttempt: async attempt=>{const usage=attempts.shift();if(!usage)throw new Error("model_stage_usage_missing");await input.onUsage?.({...usage,promptVersion:attempt.promptVersion,schemaVersion:attempt.schemaVersion,attempt:attempt.attempt,outcome:attempt.outcome})},
    executor: async request => {
      const providerInput = request.repairOf === undefined ? request.input : repairInput(request.input, request.repairOf);
      const startedAt = Date.now();
      const result = await input.invoke({ ...request, input: providerInput, schemaName: "buildit_patch_v1", schema: stageSchemas.patch, maxOutputTokens: 8_000 });
      attempts.push({ stage: "patch", durationMs: Math.max(0, Date.now() - startedAt), provider: result.provider, model: result.model, finishReason: result.finishReason, inputTokens: result.inputTokens, outputTokens: result.outputTokens,requestFingerprint:createHash("sha256").update(request.system).update("\0").update(providerInput).update("\0").update(JSON.stringify(stageSchemas.patch)).digest("hex"), ...(result.requestId ? { requestId: result.requestId } : {}) });
      return result.value;
    },
  });
}

export type ModelRoute = { provider: ProviderName; model: string; credentialId: string };
export function validateRoutes(routes: Record<PromptStage, ModelRoute>) {
  for (const stage of promptStages) {
    const route = routes[stage];
    if (!route?.credentialId || !route.model) throw new Error(`model_route_missing:${stage}`);
  }
  if (routes.critic.credentialId === routes.findings.credentialId && routes.critic.model === routes.findings.model) {
    throw new Error("critic_not_independent");
  }
  return routes;
}
