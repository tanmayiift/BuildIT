import { detectionCases, type DetectionCase } from "./detectionCases.js";

// Scores one question: given this diff, did the reviewer find this defect? Nothing else in the
// evaluation suite asks it, which is how a false negative on a real pull request went unmeasured.

export type ReviewedFinding = {
  title: string;
  path?: string;
  severity: "info" | "warning" | "high" | "critical";
  blocking: boolean;
  resolution: "accepted" | "rejected" | "uncertain";
  explanation?: string;
  impact?: string;
};

export type CaseOutcome = {
  id: string;
  kind: DetectionCase["kind"];
  passed: boolean;
  // Says what went wrong in the reviewer's terms, so a failing run is actionable without rerunning.
  because: string;
};

export type DetectionReport = {
  total: number;
  defects: number;
  detected: number;
  missed: string[];
  falseBlocking: string[];
  detectionRate: number;
  outcomes: CaseOutcome[];
  passed: boolean;
};

const severityRank = { info: 0, warning: 1, high: 2, critical: 3 } as const;

// A rejected finding is one the critic disproved, so it is not a detection whatever it says.
function surviving(findings: readonly ReviewedFinding[]) {
  return findings.filter(finding => finding.resolution !== "rejected");
}

function textOf(finding: ReviewedFinding) {
  return [finding.title, finding.explanation, finding.impact].filter(Boolean).join(" ").toLowerCase();
}

export function findDetection(item: DetectionCase, findings: readonly ReviewedFinding[]) {
  if (!item.expect) return undefined;
  const expect = item.expect;
  return surviving(findings).find(finding =>
    finding.path === expect.path
    && severityRank[finding.severity] >= severityRank[expect.severityAtLeast]
    && (!expect.blocking || finding.blocking)
    // Matching the defect's own vocabulary is what separates understanding it from noticing the
    // file changed.
    && expect.anyOf.some(phrase => textOf(finding).includes(phrase.toLowerCase())));
}

export function scoreCase(item: DetectionCase, findings: readonly ReviewedFinding[]): CaseOutcome {
  if (item.kind === "clean") {
    const blocking = surviving(findings).filter(finding => finding.blocking);
    return {
      id: item.id, kind: item.kind, passed: blocking.length === 0,
      because: blocking.length === 0
        ? "no blocking finding on correct code"
        : `blocked correct code: ${blocking.map(finding => finding.title).join("; ")}`,
    };
  }

  const hit = findDetection(item, findings);
  if (hit) return { id: item.id, kind: item.kind, passed: true, because: `found: ${hit.title}` };

  const expect = item.expect!;
  const onPath = surviving(findings).filter(finding => finding.path === expect.path);
  const because = onPath.length === 0
    ? `nothing reported on ${expect.path}`
    : `reported on ${expect.path} but not this defect: ${onPath.map(finding => finding.title).join("; ")}`;
  return { id: item.id, kind: item.kind, passed: false, because };
}

export function scoreDetection(results: ReadonlyArray<{ id: string; findings: readonly ReviewedFinding[] }>, cases: ReadonlyArray<DetectionCase> = detectionCases): DetectionReport {
  const outcomes = cases.map(item => {
    const result = results.find(entry => entry.id === item.id);
    // A case with no result is a miss, not an omission - otherwise a broken runner reads as a pass.
    if (!result) return { id: item.id, kind: item.kind, passed: false, because: "no result was produced for this case" };
    return scoreCase(item, result.findings);
  });

  const defects = outcomes.filter(outcome => outcome.kind === "defect");
  const detected = defects.filter(outcome => outcome.passed).length;
  return {
    total: outcomes.length,
    defects: defects.length,
    detected,
    missed: defects.filter(outcome => !outcome.passed).map(outcome => outcome.id),
    falseBlocking: outcomes.filter(outcome => outcome.kind === "clean" && !outcome.passed).map(outcome => outcome.id),
    detectionRate: defects.length === 0 ? 0 : detected / defects.length,
    outcomes,
    passed: outcomes.every(outcome => outcome.passed),
  };
}

// A gate needs a threshold rather than perfection: detection varies run to run, which is the whole
// reason this exists. Blocking correct code is never acceptable, at any rate.
export function detectionGate(report: DetectionReport, minimumRate = 0.8) {
  const reasons: string[] = [];
  if (report.falseBlocking.length) reasons.push(`blocked correct code: ${report.falseBlocking.join(", ")}`);
  if (report.detectionRate < minimumRate) reasons.push(`detection ${(report.detectionRate * 100).toFixed(0)}% below the ${(minimumRate * 100).toFixed(0)}% floor; missed ${report.missed.join(", ") || "none"}`);
  return { passed: reasons.length === 0, minimumRate, detectionRate: report.detectionRate, reasons };
}
