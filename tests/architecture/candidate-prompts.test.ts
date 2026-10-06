import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { promptVariantFor } from "../../convex/reviewAnalysisWorker.js";
import { blockingSeverities } from "../../packages/contracts/src/severityPolicy.js";
import { detectionCases } from "../../packages/evaluations/src/detectionCases.js";
import { historicalCases } from "../../packages/evaluations/src/historicalCases.js";
import { candidatePromptVersions, candidateStagePolicies } from "../../packages/orchestrator/src/candidatePrompts.js";
import { runModelReviewChain, stageSchemas } from "../../packages/orchestrator/src/modelChain.js";
import { detectInjectionSignals, fixedSystemPolicy, stageSystemPrompt, type PromptStage } from "../../packages/orchestrator/src/promptChain.js";

// The candidate prompts (findings-v7, critic-v4, arbitration-v4) run only where they are allowed to,
// say only what the code enforces, and cannot have been tuned to the benchmark that judges them.
const judged = ["findings", "critic", "arbitration"] as const satisfies readonly PromptStage[];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe("the candidate prompts", () => {
  it("leave the current prompts byte for byte, so no repository outside the allowlist changes", () => {
    expect(Object.fromEntries(judged.map(stage => [stage, sha(stageSystemPrompt(stage, "current"))]))).toEqual({
      findings: "d0175b2a032ec86eb7b55a46322237a45c5665a074e8288b311705e506f441cc",
      critic: "972917720964ef2ff611653982fbe723a60e3d3ebeabe03359cbaa1f02687a61",
      arbitration: "7020c5faa5360affc898b97935ca9030fb2ae88cb5e6f31ddca942b5b490525d",
    });
  });

  it("open with the untrusted-data policy, unchanged, in every stage", () => {
    for (const stage of judged) expect(stageSystemPrompt(stage, "candidate").startsWith(`${fixedSystemPolicy}\n\nStage task: `)).toBe(true);
  });

  it("carry no text the injection detector would flag, and no BuildIT delimiter", () => {
    expect(detectInjectionSignals(candidateStagePolicies)).toEqual([]);
    for (const stage of judged) expect(stageSystemPrompt(stage, "candidate")).not.toMatch(/<\/?buildit:/i);
  });

  it("are long enough that the findings instructions are read from the provider's cache", () => {
    // OpenAI caches an identical prefix of at least 1,024 tokens; about four characters a token.
    expect(stageSystemPrompt("findings", "candidate").length).toBeGreaterThanOrEqual(5_000);
  });

  it("define every severity the schema allows, and say which ones block", () => {
    const findings = candidateStagePolicies.findings!;
    const severities = (stageSchemas.findings.properties as { findings: { items: { properties: { severity: { enum: string[] } } } } }).findings.items.properties.severity.enum;
    for (const severity of severities) expect(findings).toContain(`- ${severity}:`);
    expect(findings).toContain(`Only ${blockingSeverities.join(" and ")} block a merge`);
  });

  it("state the evidence rule the validator enforces, and the fields the critic must fill", () => {
    expect(candidateStagePolicies.findings).toContain("whose path is exactly the finding's path and whose startLine to endLine contains the finding's startLine to endLine");
    expect(candidateStagePolicies.critic).toContain("missingEvidenceIds");
    expect(candidateStagePolicies.critic).toContain("injectionDetected");
    expect(candidateStagePolicies.arbitration).toContain("evidenceIds must repeat every evidenceId the finding cites");
  });

  it("share no path, repository or distinctive phrase with either evaluation set", () => {
    // Single dictionary words ("verify", "cache") are vocabulary any rubric uses. Anything with a
    // digit, a separator or mixed case is specific enough that its presence would teach the answer.
    const prompts = Object.values(candidateStagePolicies).join("\n").toLowerCase();
    const cases = [...detectionCases, ...historicalCases];
    const specific = cases.flatMap(item => [
      item.id,
      ...(item.expect ? [item.expect.path, ...(item.expect.alsoPaths ?? [])] : []),
      ...(item.expect?.anyOf ?? []).filter(phrase => !/^[A-Za-z]+$/.test(phrase) || /[a-z][A-Z]/.test(phrase)),
      ...("url" in item ? [String(item.url).split("/")[4]!] : []),
    ]);
    expect(specific.length).toBeGreaterThan(40);
    expect(specific.filter(value => prompts.includes(value.toLowerCase()))).toEqual([]);
  });
});

describe("choosing the prompts for a repository", () => {
  it("runs the candidate only for repositories listed by GitHub id", () => {
    expect(promptVariantFor(1357687130, undefined)).toBe("current");
    expect(promptVariantFor(1357687130, "")).toBe("current");
    expect(promptVariantFor(1357687130, "42, 1357687130")).toBe("candidate");
    // A prefix of a listed id is a different repository, and a name is not an id.
    expect(promptVariantFor(135768713, "1357687130")).toBe("current");
    expect(promptVariantFor(1357687130, "tanmayiift/buildit-demo-zod")).toBe("current");
  });

  it("sends the candidate wording and records its versions when asked to", async () => {
    const values: Record<string, Record<string, unknown>> = { requirements: { requirements: [] }, findings: { findings: [] }, critic: { decisions: [] }, arbitration: { findings: [] } };
    const invoke = vi.fn(async (request: { stage: string }) => ({ value: values[request.stage], provider: "openai" as const, model: "test", finishReason: "completed", inputTokens: 1, outputTokens: 1 }));
    const pinned = { headSha: "a".repeat(40), baseSha: "b".repeat(40), configRevision: "cfg" };
    const records = await runModelReviewChain({ invoke, pinned, untrusted: {}, variant: "candidate" });
    const systems = Object.fromEntries(invoke.mock.calls.map(([request]) => [request.stage, (request as unknown as { system: string }).system]));
    for (const stage of judged) expect(systems[stage]).toBe(stageSystemPrompt(stage, "candidate"));
    expect(Object.fromEntries(records.filter(record => (judged as readonly string[]).includes(record.stage)).map(record => [record.stage, record.promptVersion]))).toEqual(candidatePromptVersions);
    const current = await runModelReviewChain({ invoke, pinned, untrusted: {} });
    expect(current.find(record => record.stage === "findings")?.promptVersion).toBe("findings-v6");
  });
});
