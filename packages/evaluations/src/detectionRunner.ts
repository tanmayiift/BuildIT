import { createHash } from "node:crypto";
import {
  arbitrateFindings,
  runModelReviewChain,
  validateFindingCandidates,
  type CriticDecision,
  type EvidenceRecord,
  type FindingCandidate,
  type ModelStageInvoker,
} from "@buildit/orchestrator";
import { detectionCases, type DetectionCase } from "./detectionCases.js";
import { scoreDetection, type DetectionReport, type ReviewedFinding } from "./detection.js";

// Drives the real review chain over the corpus, then puts its output through the same validation
// and arbitration a production review uses. Anything less would measure the model rather than the
// product: a finding the validator drops or the critic disproves never reaches a pull request, so
// it must not count as a detection here either.

export type StageInvoker = ModelStageInvoker;

const pinnedHead = "a".repeat(40);
const pinnedBase = "b".repeat(40);

function evidenceFor(item: DetectionCase): EvidenceRecord[] {
  return item.files.map(file => ({
    id: `source-${createHash("sha256").update(file.path).digest("hex").slice(0, 24)}`,
    artifactExists: true, commitSha: pinnedHead, path: file.path, pathExists: true,
    startLine: 1, endLine: Math.max(1, file.content.split("\n").length),
    contentHash: createHash("sha256").update(file.content).digest("hex"),
    lineHashMatches: true, truncated: false, stdout: true,
  }));
}

function untrustedFor(item: DetectionCase, evidence: EvidenceRecord[]) {
  return {
    pull: { title: item.summary, body: "", requirements: [] },
    files: item.files.map((file, index) => ({
      path: file.path, content: file.content, status: "modified",
      evidenceId: evidence[index]!.id,
    })),
    validation: { manager: "pnpm", base: { results: [], outputs: [] }, head: { results: [], outputs: [] } },
  };
}

function asCandidates(value: unknown): FindingCandidate[] {
  const findings = (value as { findings?: unknown } | undefined)?.findings;
  if (!Array.isArray(findings)) return [];
  return findings
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map(item => ({ ...item, origin: "model" }) as unknown as FindingCandidate);
}

function asDecisions(value: unknown): CriticDecision[] {
  const record = value as { decisions?: unknown; accepted?: unknown; rejected?: unknown } | undefined;
  const decisions = record?.decisions;
  if (!Array.isArray(decisions)) return [];
  return decisions.filter((item): item is CriticDecision => Boolean(item) && typeof item === "object");
}

export async function runDetectionCase(item: DetectionCase, invoke: StageInvoker) {
  const evidence = evidenceFor(item);
  const records = await runModelReviewChain({
    invoke,
    pinned: { headSha: pinnedHead, baseSha: pinnedBase, configRevision: "detection-eval" },
    untrusted: untrustedFor(item, evidence),
  });

  const findingsStage = records.find(record => record.stage === "findings")?.value;
  const criticStage = records.find(record => record.stage === "critic")?.value;

  // The same gate production uses: a finding that cites evidence it was not given is dropped here
  // rather than reported, so the eval cannot credit a hallucinated detection.
  const validated = validateFindingCandidates({
    findings: asCandidates(findingsStage),
    criteriaIds: new Set<string>(),
    allowedPaths: new Set(item.files.map(file => file.path)),
    evidence,
    pinnedCommit: pinnedHead,
  });

  const arbitrated = arbitrateFindings(validated, asDecisions(criticStage));
  const findings: ReviewedFinding[] = arbitrated.map(finding => ({
    title: finding.title, path: finding.path, severity: finding.severity,
    blocking: finding.blocking, resolution: finding.resolution,
    explanation: finding.explanation, impact: finding.impact,
  }));
  return { id: item.id, findings };
}

export async function runDetectionSuite(input: {
  invoke: StageInvoker;
  cases?: ReadonlyArray<DetectionCase>;
  onCase?: (id: string, findings: ReviewedFinding[]) => void;
}): Promise<DetectionReport> {
  const cases = input.cases ?? detectionCases;
  const results: Array<{ id: string; findings: ReviewedFinding[] }> = [];
  for (const item of cases) {
    try {
      const result = await runDetectionCase(item, input.invoke);
      input.onCase?.(result.id, result.findings);
      results.push(result);
    } catch {
      // A case that throws is a case that produced no findings, which scoreDetection counts as a
      // miss. Swallowing it here rather than aborting keeps one bad case from hiding the rest.
      input.onCase?.(item.id, []);
    }
  }
  return scoreDetection(results, cases);
}
