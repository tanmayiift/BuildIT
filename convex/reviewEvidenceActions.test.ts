import { describe, expect, it } from "vitest";
import { findingDetailsFromAnalysis } from "./reviewEvidenceActions";

const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);

function analysis() {
  return {
    version: 1,
    pinned: { headSha, baseSha },
    arbitrated: [
      {
        id: "finding-1",
        title: "Higher tier taxes the full amount",
        category: "correctness",
        severity: "high",
        confidence: 0.99,
        path: "src/tax.js",
        startLine: 4,
        endLine: 4,
        impact: "Amounts above 100 are overtaxed.",
        explanation: "Apply the higher rate only to the excess above 100.",
        resolution: "accepted",
        blocking: true,
      },
      {
        id: "finding-2",
        title: "Rejected guess",
        category: "quality",
        severity: "info",
        confidence: 0.2,
        path: "src/tax.js",
        startLine: 1,
        endLine: 1,
        impact: "None",
        explanation: "Unsupported",
        resolution: "rejected",
        blocking: false,
      },
    ],
  };
}

describe("authorized review finding details", () => {
  it("returns bounded human-readable accepted or uncertain findings only", () => {
    expect(findingDetailsFromAnalysis(analysis(), { headSha, baseSha })).toEqual([
      {
        id: "finding-1",
        title: "Higher tier taxes the full amount",
        category: "correctness",
        severity: "high",
        confidence: 0.99,
        path: "src/tax.js",
        startLine: 4,
        endLine: 4,
        impact: "Amounts above 100 are overtaxed.",
        explanation: "Apply the higher rate only to the excess above 100.",
        resolution: "accepted",
        blocking: true,
      },
    ]);
  });

  it("fails closed for a stale pin or malformed analysis", () => {
    expect(() => findingDetailsFromAnalysis(analysis(), { headSha: "c".repeat(40), baseSha })).toThrow("finding_detail_pinning_failed");
    expect(() => findingDetailsFromAnalysis({ ...analysis(), arbitrated: "not-an-array" }, { headSha, baseSha })).toThrow("finding_detail_artifact_invalid");
  });

  it("drops malformed entries and bounds display text", () => {
    const value = analysis();
    value.arbitrated = [
      { ...value.arbitrated[0]!, title: "x".repeat(800), explanation: "y".repeat(4_000) },
      { ...value.arbitrated[0]!, id: "bad-lines", startLine: 0 },
    ];
    const [detail] = findingDetailsFromAnalysis(value, { headSha, baseSha });
    expect(detail?.title).toHaveLength(500);
    expect(detail?.explanation).toHaveLength(2_000);
    expect(findingDetailsFromAnalysis(value, { headSha, baseSha })).toHaveLength(1);
  });
});
