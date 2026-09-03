import { describe, expect, it, vi } from "vitest";
import { promptStages, reviewPromptStages } from "../src/promptChain";
import { runModelPatchChain, runModelReviewChain, stageSchemas, validateRoutes } from "../src/modelChain";
import { assertStrictSchema } from "@buildit/providers";

const values: Record<string, Record<string, unknown>> = {
  requirements: { requirements: [] }, review_plan: { checks: [], evidenceOperations: [], riskAreas: [], exclusions: [] }, findings: { findings: [] },
  critic: { decisions: [] }, arbitration: { findings: [] }, patch: { patches: [] }, report: { claims: [] },
};
const pinned = { headSha: "a".repeat(40), baseSha: "b".repeat(40), configRevision: "cfg" };

describe("executable model review chain", () => {
  it("keeps every provider schema compatible with OpenAI strict structured output", () => {
    for (const schema of Object.values(stageSchemas)) expect(() => assertStrictSchema(schema)).not.toThrow();
  });
  it("invokes six strict review stages and never requests a patch", async () => {
    const usage: unknown[] = [];
    const invoke = vi.fn(async request => ({ value: values[request.stage], provider: "gemini" as const, model: "gemini-test", finishReason: "STOP", inputTokens: 10, outputTokens: 2, requestId: "request-1" }));
    const records = await runModelReviewChain({ invoke, pinned, untrusted: { source: "untrusted", requirements: [{ id: "REQ-1", text: "round tax to two decimals" }] }, onUsage: item => { usage.push(item); } });
    expect(invoke.mock.calls.map(([request]) => request.stage)).toEqual(reviewPromptStages);
    expect(records).toHaveLength(6);
    expect(usage).toHaveLength(6);
    expect(JSON.stringify(usage)).not.toContain("untrusted");
    expect(usage[0]).toMatchObject({ stage: "requirements", provider: "gemini", model: "gemini-test", promptVersion: "requirements-v1", schemaVersion: "requirements-schema-v1", finishReason: "STOP", inputTokens: 10, outputTokens: 2, attempt: 1, outcome: "valid" });
    expect((usage[0] as {requestFingerprint:string}).requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(invoke.mock.calls[0]![0].schema).toEqual(stageSchemas.requirements);
  });

  it("gives each stage an explicit grounding task instead of relying on the stage name", async () => {
    const invoke = vi.fn(async request => ({ value: values[request.stage], provider: "openai" as const, model: "test", finishReason: "completed", inputTokens: 1, outputTokens: 1 }));
    await runModelReviewChain({ invoke, pinned, untrusted: { requirements: [{ id: "REQ-1", text: "round tax" }] } });
    const systems=Object.fromEntries(invoke.mock.calls.map(([request])=>[request.stage,request.system]));
    expect(systems.requirements).toContain("Preserve each supplied requirement id exactly");
    expect(systems.requirements).toContain("return an empty requirements array");
    expect(systems.findings).toContain("criterionId must be an exact id");
    expect(systems.findings).toContain("use the empty string");
    expect(systems.critic).toContain("one decision for every supplied finding id");
    expect(systems.arbitration).toContain("Do not invent or rename finding ids");
    expect(systems.report).toContain("Do not claim a passing check without supplied stdout evidence");
  });

  it("runs the patch stage only through the separate Autofix chain", async () => {
    const invoke = vi.fn(async request => ({ value: values[request.stage], provider: "gemini" as const, model: "gemini-test", finishReason: "STOP", inputTokens: 3, outputTokens: 2 }));
    const records = await runModelPatchChain({ invoke, pinned, untrusted: { authorized: true, acceptedFindings: [], files: [], latestChecks: [] } });
    expect(invoke.mock.calls.map(([request]) => request.stage)).toEqual(["patch"]);
    expect(records).toHaveLength(1);
  });

  it("repairs one malformed provider response and then fails closed", async () => {
    const invoke = vi.fn(async request => ({ value: request.stage === "findings" ? { findings: [{ invented: true }] } : values[request.stage], provider: "openai" as const, model: "test", finishReason: "completed", inputTokens: 1, outputTokens: 1 }));
    await expect(runModelReviewChain({ invoke, pinned, untrusted: { requirements: [{ id: "REQ-1", text: "round tax" }] } })).rejects.toThrow("stage_schema_invalid:findings");
    expect(invoke.mock.calls.filter(([request]) => request.stage === "findings")).toHaveLength(2);
    expect(invoke.mock.calls.some(([request]) => request.stage === "critic")).toBe(false);
    expect(invoke.mock.calls.filter(([request]) => request.stage === "findings")[1]?.[0].input).toContain("<buildit:invalid-output>");
    expect(invoke.mock.calls.filter(([request]) => request.stage === "findings")[1]?.[0].input).toContain("Correct only the invalid output above");
  });

  it("redacts the invalid output before asking for one bounded repair", async () => {
    // Assembled at runtime rather than written as a literal. A correctly shaped token in a source
    // file is indistinguishable from a real one to a secret scanner, and BuildIT's own pinned
    // gitleaks scans the whole tree rather than the diff - a fixture that fails the scan blocks
    // every review of this repository.
    const secret = ["AIza", "SyA", "1234567890", "1234567890", "1234567890"].join(""), calls: string[] = [];
    let malformed = true;
    await runModelReviewChain({ invoke: async request => {
      calls.push(request.input);
      if (request.stage === "requirements" && malformed) { malformed = false; return { value: { leaked: secret }, provider: "gemini", model: "test", finishReason: "STOP", inputTokens: 1, outputTokens: 1 }; }
      return { value: values[request.stage], provider: "gemini", model: "test", finishReason: "STOP", inputTokens: 1, outputTokens: 1 };
    }, pinned, untrusted: { requirements: [{ id: "REQ-1", text: "round tax" }] } });
    expect(calls[1]).toContain("[REDACTED]");
    expect(calls[1]).not.toContain(secret);
  });

  it("does not resend an oversized invalid response", async () => {
    const invoke = vi.fn(async request => ({ value: request.stage === "requirements" ? { invalid: "x".repeat(16_001) } : values[request.stage], provider: "gemini" as const, model: "test", finishReason: "STOP", inputTokens: 1, outputTokens: 1 }));
    await expect(runModelReviewChain({ invoke, pinned, untrusted: { requirements: [{ id: "REQ-1", text: "round tax" }] } })).rejects.toThrow("schema_repair_output_too_large");
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
    await expect(runModelReviewChain({ invoke, pinned, untrusted: { requirements: [{ id: "REQ-1", text: "round tax" }] } })).rejects.toThrow("stage_schema_invalid:findings");
  });
});
