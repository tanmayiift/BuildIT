import { validateSchemaValue, type JsonSchema, type ProviderName, type ProviderResult } from "@buildit/providers";
import { promptStages, runPromptChain, type PromptStage, type StageDefinition } from "./promptChain.js";

const string = { type: "string" } as const;
const stringArray = { type: "array", items: string } as const;
const object = (properties: Record<string, unknown>, required = Object.keys(properties)): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const array = (items: JsonSchema): JsonSchema => ({ type: "array", items });

export const stageSchemas: Record<PromptStage, JsonSchema> = {
  requirements: object({ requirements: array(object({ id: string, statement: string, evidenceIds: stringArray, status: { type: "string", enum: ["resolved", "missing", "inaccessible", "conflicting", "excluded"] }, confidence: { type: "number" }, uncertainty: string })) }),
  review_plan: object({ checks: stringArray, evidenceOperations: stringArray, riskAreas: stringArray, exclusions: stringArray }),
  findings: object({ findings: array(object({ id: string, title: string, category: { type: "string", enum: ["correctness", "security", "requirement", "architecture", "quality", "dependency", "test"] }, severity: { type: "string", enum: ["critical", "high", "warning", "info"] }, confidence: { type: "number" }, criterionId: string, path: string, startLine: { type: "number" }, endLine: { type: "number" }, evidenceIds: stringArray, impact: string, explanation: string }, ["id", "title", "category", "severity", "confidence", "path", "startLine", "endLine", "evidenceIds", "impact", "explanation"])) }),
  critic: object({ decisions: array(object({ findingId: string, verdict: { type: "string", enum: ["supported", "unsupported", "uncertain"] }, missingEvidenceIds: stringArray, injectionDetected: { type: "boolean" }, explanation: string })) }),
  arbitration: object({ findings: array(object({ id: string, resolution: { type: "string", enum: ["accepted", "rejected", "uncertain"] }, evidenceIds: stringArray, reason: string })) }),
  patch: object({ patches: array(object({ path: string, rationale: string, findingIds: stringArray, unifiedDiff: string })) }),
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
export type StageUsage = Pick<ProviderResult, "provider" | "model" | "finishReason" | "inputTokens" | "outputTokens" | "requestId"> & { stage: PromptStage };

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

export const strictModelChain = promptStages.map(strictDefinition);

export async function runModelReviewChain(input: {
  invoke: ModelStageInvoker;
  pinned: { headSha: string; baseSha: string; configRevision: string };
  untrusted: Record<string, unknown>;
  onUsage?: (usage: StageUsage) => Promise<void> | void;
}) {
  return runPromptChain({
    definitions: strictModelChain,
    pinned: input.pinned,
    untrusted: input.untrusted,
    maxSchemaRepairs: 1,
    executor: async request => {
      const result = await input.invoke({
        ...request,
        schemaName: `buildit_${request.stage}_v1`,
        schema: stageSchemas[request.stage],
        maxOutputTokens: request.stage === "findings" || request.stage === "patch" ? 8_000 : 4_000,
      });
      await input.onUsage?.({
        stage: request.stage,
        provider: result.provider,
        model: result.model,
        finishReason: result.finishReason,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        ...(result.requestId ? { requestId: result.requestId } : {}),
      });
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
