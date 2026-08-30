import { auditDeterministicGrader } from "./grader.js";
import { releaseGate, type EvaluationRun } from "./score.js";

export type PopulationArtifact = { name: string; immutableRevision: string; url: string; sha256: string; license: "Apache-2.0" | "MIT"; cases: number; role: "positive" | "no_defect" | "autofix" };
export type PopulationManifest = { version: string; reviewedAt: string; artifacts: PopulationArtifact[]; languages: Record<string, number>; contamination: { goldSeparated: true; hiddenHoldout: true; modelInputExcludesGold: true } };
export type HumanVote = { reviewerHash: string; expected: boolean };
export type HumanLabelCase = { caseId: string; severity: "low" | "medium" | "high" | "critical"; finalExpected: boolean; votes: HumanVote[]; adjudicatorHash?: string; labelledAt: number; synthetic: false };
export type HumanLabelManifest = { version: string; modelRunStartedAt: number; blindToModelOutput: true; hiddenHoldout: true; cases: HumanLabelCase[] };
export type ModelGraderCalibration = { used: boolean; humanLabelledCases: number; falseAccepts: number; falseRejects: number; maximumFalseAcceptRate: number };

export const officialPopulation: PopulationManifest = {
  version: "buildit-official-population-2026-08-30",
  reviewedAt: "2026-08-30",
  artifacts: [
    { name: "AACR-Bench positive", immutableRevision: "68a569759289a83654a59d06db2a72910edf0a4a", url: "https://raw.githubusercontent.com/alibaba/aacr-bench/68a569759289a83654a59d06db2a72910edf0a4a/dataset/positive_samples.json", sha256: "7a4a0e7046ffd1b8f41f951480bbb618d23d38d9f67364f38aabcda121a50be3", license: "Apache-2.0", cases: 196, role: "positive" },
    { name: "AACR-Bench negative", immutableRevision: "68a569759289a83654a59d06db2a72910edf0a4a", url: "https://raw.githubusercontent.com/alibaba/aacr-bench/68a569759289a83654a59d06db2a72910edf0a4a/dataset/negative_samples.json", sha256: "3859efe063c0e59852113c64feb81c18b1a1fcd2ce9d92d08a48e9d8d9879ebd", license: "Apache-2.0", cases: 155, role: "no_defect" },
    { name: "SWE-bench Verified", immutableRevision: "78f471bf655a3137b2e8a75af1501690ec009ec3", url: "https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified/resolve/78f471bf655a3137b2e8a75af1501690ec009ec3/data/test-00000-of-00001.parquet", sha256: "030cfd7f2a704c4c0226e7f104c725a3b41230b1d3517f9c915ad7ea5be3fa25", license: "MIT", cases: 500, role: "autofix" },
  ],
  languages: { C: 35, "C#": 16, "C++": 64, Go: 40, Java: 48, JavaScript: 20, PHP: 18, Python: 36, Rust: 19, TypeScript: 55 },
  contamination: { goldSeparated: true, hiddenHoldout: true, modelInputExcludesGold: true },
};

const hash = /^[0-9a-f]{64}$/;
export function populationFailures(value: PopulationManifest) {
  const failures: string[] = [], names = new Set<string>();
  if (!value.version || !/^\d{4}-\d{2}-\d{2}$/.test(value.reviewedAt)) failures.push("population_version_invalid");
  if (value.artifacts.length < 3) failures.push("population_artifacts_missing");
  for (const item of value.artifacts) { if (names.has(item.name)) failures.push("population_artifact_duplicate"); names.add(item.name); if (!/^[0-9a-f]{40}$/.test(item.immutableRevision) || !hash.test(item.sha256) || !item.url.includes(item.immutableRevision) || item.cases < 1) failures.push("population_artifact_unpinned"); }
  if (!value.artifacts.some(item => item.role === "positive") || !value.artifacts.some(item => item.role === "no_defect") || !value.artifacts.some(item => item.role === "autofix")) failures.push("population_roles_incomplete");
  if (Object.keys(value.languages).length < 3 || Object.values(value.languages).some(count => !Number.isSafeInteger(count) || count < 1)) failures.push("population_languages_incomplete");
  if (!value.contamination.goldSeparated || !value.contamination.hiddenHoldout || !value.contamination.modelInputExcludesGold) failures.push("population_contamination_boundary_missing");
  return [...new Set(failures)].sort();
}

export function humanLabelFailures(labels: HumanLabelManifest, run: EvaluationRun) {
  const failures: string[] = [], byCase = new Map(labels.cases.map(item => [item.caseId, item]));
  if (!labels.blindToModelOutput || !labels.hiddenHoldout) failures.push("human_labels_not_blind");
  for (const item of labels.cases) {
    if (item.synthetic !== false) failures.push("synthetic_label_forbidden");
    if (item.labelledAt >= labels.modelRunStartedAt) failures.push("label_created_after_model_run");
    if (!item.votes.length || item.votes.some(vote => !hash.test(vote.reviewerHash)) || new Set(item.votes.map(vote => vote.reviewerHash)).size !== item.votes.length) failures.push("reviewer_identity_invalid");
    const disagreed = new Set(item.votes.map(vote => vote.expected)).size > 1;
    if (item.severity === "critical" && item.votes.length < 2) failures.push("critical_requires_two_reviewers");
    if (disagreed && (!item.adjudicatorHash || !hash.test(item.adjudicatorHash) || item.votes.some(vote => vote.reviewerHash === item.adjudicatorHash))) failures.push("label_disagreement_unadjudicated");
  }
  for (const row of run.findings.filter(item => item.repetition === 0)) { const label = byCase.get(row.caseId); if (!label) failures.push("run_case_missing_human_label"); else if (label.finalExpected !== row.expected) failures.push("run_label_mismatch"); }
  return [...new Set(failures)].sort();
}

export function releaseEvidenceGate(input: { run: EvaluationRun; population: PopulationManifest; labels: HumanLabelManifest; modelGrader: ModelGraderCalibration }) {
  const failures = [...populationFailures(input.population), ...humanLabelFailures(input.labels, input.run)];
  const deterministic = auditDeterministicGrader(); if (!deterministic.passed) failures.push("deterministic_grader_uncalibrated");
  if (input.modelGrader.used) { const rate = input.modelGrader.humanLabelledCases ? input.modelGrader.falseAccepts / input.modelGrader.humanLabelledCases : 1; if (input.modelGrader.humanLabelledCases < 50 || rate > input.modelGrader.maximumFalseAcceptRate || input.modelGrader.falseRejects < 0) failures.push("model_grader_uncalibrated"); }
  const evaluation = releaseGate(input.run); failures.push(...evaluation.failures);
  return { passed: failures.length === 0, failures: [...new Set(failures)].sort(), evaluation, deterministicGrader: deterministic };
}
