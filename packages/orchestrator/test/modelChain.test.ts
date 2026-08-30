import { describe, expect, it, vi } from "vitest";
import { promptStages, reviewPromptStages } from "../src/promptChain";
import { runModelPatchChain, runModelReviewChain, stageSchemas, validateRoutes } from "../src/modelChain";

const values: Record<string, Record<string, unknown>> = {
  requirements: { requirements: [] }, review_plan: { checks: [], evidenceOperations: [], riskAreas: [], exclusions: [] }, findings: { findings: [] },
  critic: { decisions: [] }, arbitration: { findings: [] }, patch: { patches: [] }, report: { claims: [] },
};
const pinned = { headSha: "a".repeat(40), baseSha: "b".repeat(40), configRevision: "cfg" };

describe("executable model review chain", () => {
  it("invokes six strict review stages and never requests a patch", async () => {
    const usage: unknown[] = [];
    const invoke = vi.fn(async request => ({ value: values[request.stage], provider: "gemini" as const, model: "gemini-test", finishReason: "STOP", inputTokens: 10, outputTokens: 2, requestId: "request-1" }));
    const records = await runModelReviewChain({ invoke, pinned, untrusted: { source: "untrusted" }, onUsage: item => { usage.push(item); } });
    expect(invoke.mock.calls.map(([request]) => request.stage)).toEqual(reviewPromptStages);
    expect(records).toHaveLength(6);
    expect(usage).toHaveLength(6);
    expect(JSON.stringify(usage)).not.toContain("untrusted");
    expect(usage[0]).toMatchObject({ stage: "requirements", provider: "gemini", model: "gemini-test", promptVersion: "requirements-v1", schemaVersion: "requirements-schema-v1", finishReason: "STOP", inputTokens: 10, outputTokens: 2, attempt: 1, outcome: "valid" });
    expect((usage[0] as {requestFingerprint:string}).requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(invoke.mock.calls[0]![0].schema).toEqual(stageSchemas.requirements);
  });

  it("runs the patch stage only through the separate Autofix chain", async () => {
    const invoke = vi.fn(async request => ({ value: values[request.stage], provider: "gemini" as const, model: "gemini-test", finishReason: "STOP", inputTokens: 3, outputTokens: 2 }));
    const records = await runModelPatchChain({ invoke, pinned, untrusted: { authorized: true, acceptedFindings: [], files: [], latestChecks: [] } });
    expect(invoke.mock.calls.map(([request]) => request.stage)).toEqual(["patch"]);
    expect(records).toHaveLength(1);
  });

  it("repairs one malformed provider response and then fails closed", async () => {
    const invoke = vi.fn(async request => ({ value: request.stage === "findings" ? { findings: [{ invented: true }] } : values[request.stage], provider: "openai" as const, model: "test", finishReason: "completed", inputTokens: 1, outputTokens: 1 }));
    await expect(runModelReviewChain({ invoke, pinned, untrusted: {} })).rejects.toThrow("stage_schema_invalid:findings");
    expect(invoke.mock.calls.filter(([request]) => request.stage === "findings")).toHaveLength(2);
    expect(invoke.mock.calls.some(([request]) => request.stage === "critic")).toBe(false);
    expect(invoke.mock.calls.filter(([request]) => request.stage === "findings")[1]?.[0].input).toContain("<buildit:invalid-output>");
    expect(invoke.mock.calls.filter(([request]) => request.stage === "findings")[1]?.[0].input).toContain("Correct only the invalid output above");
  });

  it("redacts the invalid output before asking for one bounded repair", async () => {
    const secret = "AIzaSyA123456789012345678901234567890", calls: string[] = [];
    let malformed = true;
    await runModelReviewChain({ invoke: async request => {
      calls.push(request.input);
      if (request.stage === "requirements" && malformed) { malformed = false; return { value: { leaked: secret }, provider: "gemini", model: "test", finishReason: "STOP", inputTokens: 1, outputTokens: 1 }; }
      return { value: values[request.stage], provider: "gemini", model: "test", finishReason: "STOP", inputTokens: 1, outputTokens: 1 };
    }, pinned, untrusted: {} });
    expect(calls[1]).toContain("[REDACTED]");
    expect(calls[1]).not.toContain(secret);
  });

  it("does not resend an oversized invalid response", async () => {
    const invoke = vi.fn(async request => ({ value: request.stage === "requirements" ? { invalid: "x".repeat(16_001) } : values[request.stage], provider: "gemini" as const, model: "test", finishReason: "STOP", inputTokens: 1, outputTokens: 1 }));
    await expect(runModelReviewChain({ invoke, pinned, untrusted: {} })).rejects.toThrow("schema_repair_output_too_large");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("requires the critic to use a different model or credential", () => {
    const routes = Object.fromEntries(promptStages.map(stage => [stage, { provider: "anthropic", model: "same", credentialId: "credential-a" }])) as Parameters<typeof validateRoutes>[0];
    expect(() => validateRoutes(routes)).toThrow("critic_not_independent");
    routes.critic = { provider: "openai", model: "critic", credentialId: "credential-b" };
    expect(validateRoutes(routes)).toBe(routes);
  });

  it("rejects a plausible finding that lacks inspectable location and impact", async () => {
    const invoke = vi.fn(async request => ({ value: request.stage === "findings" ? { findings: [{ id: "f-1", title: "Bug", severity: "high", evidenceIds: ["source-1"], explanation: "Maybe broken" }] } : values[request.stage], provider: "gemini" as const, model: "test", finishReason: "STOP", inputTokens: 1, outputTokens: 1 }));
    await expect(runModelReviewChain({ invoke, pinned, untrusted: {} })).rejects.toThrow("stage_schema_invalid:findings");
  });
});
