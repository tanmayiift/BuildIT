import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { promptVariantFor } from "../../convex/reviewAnalysisWorker.js";
import { blockingSeverities } from "../../packages/contracts/src/severityPolicy.js";
import { detectionCases } from "../../packages/evaluations/src/detectionCases.js";
import { historicalCases } from "../../packages/evaluations/src/historicalCases.js";
import { candidatePromptVersions, candidateStagePolicies, judgingPromptVersions, judgingStagePolicies } from "../../packages/orchestrator/src/candidatePrompts.js";
import { runModelReviewChain, stageSchemas } from "../../packages/orchestrator/src/modelChain.js";
import { detectInjectionSignals, fixedSystemPolicy, stageSystemPrompt, type PromptStage } from "../../packages/orchestrator/src/promptChain.js";

// The prompts that judge code (findings-v7, critic-v4, arbitration-v4 since 7 Oct 2026), and any
// candidate that may one day replace them, say only what the code enforces and cannot have been
// tuned to the benchmark that judges them. A candidate runs only where it is allowed to.
const judged = ["findings", "critic", "arbitration"] as const satisfies readonly PromptStage[];
const variants = ["current", "candidate"] as const;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe("the review prompts", () => {
  it("are pinned byte for byte, so a change to what every repository is sent is deliberate", () => {
    expect(Object.fromEntries(judged.map(stage => [stage, sha(stageSystemPrompt(stage, "current"))]))).toEqual({
      findings: "06862d5e0b97f7bab2a22134c4862129555d15ef099f2697009d9dd69a72b78f",
      critic: "8574c9aa224d5ff6f72941c68d37135d64e01f9ed603599683da294e596a04a3",
      arbitration: "55902ac2f9f40f9d5855ff6900c470e224198eb575251d8e84d43a81a75cee7a",
    });
  });

  it("send the allowlisted repositories the current wording while no candidate is under evaluation", () => {
    expect(candidateStagePolicies).toEqual({});
    for (const stage of judged) expect(stageSystemPrompt(stage, "candidate")).toBe(stageSystemPrompt(stage, "current"));
  });

  it("open with the untrusted-data policy, unchanged, in every stage", () => {
    for (const variant of variants) for (const stage of judged) expect(stageSystemPrompt(stage, variant).startsWith(`${fixedSystemPolicy}\n\nStage task: `)).toBe(true);
  });

  it("carry no text the injection detector would flag, and no BuildIT delimiter", () => {
    expect(detectInjectionSignals({ ...judgingStagePolicies, ...candidateStagePolicies })).toEqual([]);
    for (const variant of variants) for (const stage of judged) expect(stageSystemPrompt(stage, variant)).not.toMatch(/<\/?buildit:/i);
  });

  it("are long enough that the findings instructions are read from the provider's cache", () => {
    // OpenAI caches an identical prefix of at least 1,024 tokens; about four characters a token.
    for (const variant of variants) expect(stageSystemPrompt("findings", variant).length).toBeGreaterThanOrEqual(5_000);
  });

  it("define every severity the schema allows, and say which ones block", () => {
    const findings = judgingStagePolicies.findings;
    const severities = (stageSchemas.findings.properties as { findings: { items: { properties: { severity: { enum: string[] } } } } }).findings.items.properties.severity.enum;
    for (const severity of severities) expect(findings).toContain(`- ${severity}:`);
    expect(findings).toContain(`Only ${blockingSeverities.join(" and ")} block a merge`);
  });

  it("state the evidence rule the validator enforces, and the fields the critic must fill", () => {
    expect(judgingStagePolicies.findings).toContain("whose path is exactly the finding's path and whose startLine to endLine contains the finding's startLine to endLine");
    expect(judgingStagePolicies.critic).toContain("missingEvidenceIds");
    expect(judgingStagePolicies.critic).toContain("injectionDetected");
    expect(judgingStagePolicies.arbitration).toContain("evidenceIds must repeat every evidenceId the finding cites");
  });

  it("share no path, repository or distinctive phrase with either evaluation set", () => {
    // Single dictionary words ("verify", "cache") are vocabulary any rubric uses. Anything with a
    // digit, a separator or mixed case is specific enough that its presence would teach the answer.
    const prompts = [...Object.values(judgingStagePolicies), ...Object.values(candidateStagePolicies)].join("\n").toLowerCase();
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
    expect(Object.fromEntries(records.filter(record => (judged as readonly string[]).includes(record.stage)).map(record => [record.stage, record.promptVersion]))).toEqual({ ...judgingPromptVersions, ...candidatePromptVersions });
    const current = await runModelReviewChain({ invoke, pinned, untrusted: {} });
    expect(Object.fromEntries(current.filter(record => (judged as readonly string[]).includes(record.stage)).map(record => [record.stage, record.promptVersion]))).toEqual({ findings: "findings-v7", critic: "critic-v4", arbitration: "arbitration-v4" });
  });
});
