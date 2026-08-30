import { describe, expect, it, vi } from "vitest";
import { promptStages } from "../src/promptChain";
import { runModelReviewChain, stageSchemas, validateRoutes } from "../src/modelChain";

const values: Record<string, Record<string, unknown>> = {
  requirements: { requirements: [] }, review_plan: { checks: [], evidenceOperations: [] }, findings: { findings: [] },
  critic: { accepted: [], rejected: [], uncertain: [] }, arbitration: { findings: [] }, patch: { patches: [] }, report: { claims: [] },
};
const pinned = { headSha: "a".repeat(40), baseSha: "b".repeat(40), configRevision: "cfg" };

describe("executable model review chain", () => {
  it("invokes all seven strict stages and records metadata-only usage", async () => {
    const usage: unknown[] = [];
    const invoke = vi.fn(async request => ({ value: values[request.stage], provider: "gemini" as const, model: "gemini-test", finishReason: "STOP", inputTokens: 10, outputTokens: 2, requestId: "request-1" }));
    const records = await runModelReviewChain({ invoke, pinned, untrusted: { source: "untrusted" }, onUsage: item => { usage.push(item); } });
    expect(invoke.mock.calls.map(([request]) => request.stage)).toEqual(promptStages);
    expect(records).toHaveLength(7);
    expect(usage).toHaveLength(7);
    expect(JSON.stringify(usage)).not.toContain("untrusted");
    expect(invoke.mock.calls[0]![0].schema).toEqual(stageSchemas.requirements);
  });

  it("repairs one malformed provider response and then fails closed", async () => {
    const invoke = vi.fn(async request => ({ value: request.stage === "findings" ? { findings: [{ invented: true }] } : values[request.stage], provider: "openai" as const, model: "test", finishReason: "completed", inputTokens: 1, outputTokens: 1 }));
    await expect(runModelReviewChain({ invoke, pinned, untrusted: {} })).rejects.toThrow("stage_schema_invalid:findings");
    expect(invoke.mock.calls.filter(([request]) => request.stage === "findings")).toHaveLength(2);
    expect(invoke.mock.calls.some(([request]) => request.stage === "critic")).toBe(false);
  });

  it("requires the critic to use a different model or credential", () => {
    const routes = Object.fromEntries(promptStages.map(stage => [stage, { provider: "anthropic", model: "same", credentialId: "credential-a" }])) as Parameters<typeof validateRoutes>[0];
    expect(() => validateRoutes(routes)).toThrow("critic_not_independent");
    routes.critic = { provider: "openai", model: "critic", credentialId: "credential-b" };
    expect(validateRoutes(routes)).toBe(routes);
  });
});
