import { describe, expect, it } from "vitest";
import { composeVerifiedReport, type EvidenceRecord } from "../../packages/orchestrator/src/index.js";
import { crossCheck, parseReportFindings } from "../../packages/evaluations/src/productionBenchmark.js";

// The production benchmark scores what BuildIT published, so its parser has to be the exact inverse
// of the report it reads. These compose real reports - escapes and all - and read them back.
const head = "c".repeat(40);
const evidence: EvidenceRecord = { id: "ev-1", artifactExists: true, commitSha: head, path: "src/a.ts", pathExists: true, startLine: 1, endLine: 2, contentHash: "hash", lineHashMatches: true, truncated: false, stdout: true };
const report = (findings: Parameters<typeof composeVerifiedReport>[0]["findings"], checks: Parameters<typeof composeVerifiedReport>[0]["checks"] = [{ name: "test", required: true, conclusion: "passed", evidenceComplete: true }]) => composeVerifiedReport({
  repository: "acme/api", prNumber: 7, headSha: head, baseSha: "d".repeat(40), configRevision: "cfg:1", coverage: "complete",
  checks, findings, claims: [], evidence: [evidence], environmentAvailable: true, isStale: false, costUsd: 0.1, retentionExpiresAt: 0,
});

describe("reading a published report back", () => {
  it("recovers every finding field the scorer uses, through the report's own escaping", () => {
    const { body, decision } = report([
      { title: "int16 accepts 32768 [off-by-one] (see @maintainer)", severity: "high", resolution: "accepted", blocking: true, evidenceIds: ["ev-1"],
        path: "packages/zod/src/v4/core/util.ts", startLine: 744, endLine: 747,
        impact: "z.int16() accepts 32768, outside [-32768, 32767].", explanation: "Fix NUMBER_FORMAT_RANGES and the compiled bound." },
      { title: "Same bound repeated", severity: "warning", resolution: "uncertain", blocking: false, evidenceIds: ["ev-1"],
        path: "src/(group)/compile.ts", startLine: 12, endLine: 12 },
      { title: "No location given", severity: "info", resolution: "accepted", blocking: false, evidenceIds: ["ev-1"], path: "src/x.ts" },
      { title: "Disproved by the critic", severity: "critical", resolution: "rejected", blocking: false, evidenceIds: ["ev-1"], path: "src/y.ts", startLine: 1, endLine: 1 },
    ]);
    const parsed = parseReportFindings(body);
    expect(parsed.status).toBe(decision.status);
    expect(parsed.findings).toEqual([
      { title: "int16 accepts 32768 [off-by-one] (see @maintainer)", severity: "high", blocking: true, resolution: "accepted",
        path: "packages/zod/src/v4/core/util.ts", startLine: 744, endLine: 747,
        impact: "z.int16() accepts 32768, outside [-32768, 32767].", explanation: "Fix NUMBER_FORMAT_RANGES and the compiled bound." },
      { title: "Same bound repeated", severity: "warning", blocking: false, resolution: "uncertain", path: "src/(group)/compile.ts", startLine: 12, endLine: 12 },
      // A finding without lines is published without its path, so the scorer cannot credit it to a file.
      { title: "No location given", severity: "info", blocking: false, resolution: "accepted" },
    ]);
  });

  it("reads each verdict heading, and a report with no findings as none", () => {
    expect(parseReportFindings(report([]).body)).toEqual({ status: "checks_passed", findings: [] });
    const failing = report([], [{ name: "test", required: true, conclusion: "failed", evidenceComplete: true }]);
    expect(parseReportFindings(failing.body).status).toBe(failing.decision.status);
  });

  it("refuses a report it cannot fully read instead of dropping a finding", () => {
    const { body } = report([{ title: "A", severity: "high", resolution: "accepted", blocking: true, evidenceIds: ["ev-1"], path: "a.ts", startLine: 1, endLine: 1 }]);
    expect(() => parseReportFindings(body.replace("**High · Blocking", "**Severe · Blocking"))).toThrow(/report_finding_malformed/);
    expect(() => parseReportFindings(body.replace(/^## .*$/m, "## Something new"))).toThrow(/report_heading_unknown/);
  });

  it("trusts a parse only when it agrees with what the review stored", () => {
    const { body } = report([{ title: "A", severity: "high", resolution: "accepted", blocking: true, evidenceIds: ["ev-1"], path: "a.ts", startLine: 3, endLine: 5 }]);
    const parsed = parseReportFindings(body);
    // The table stores a confirmed finding as "open" - the value production actually writes.
    const stored = { status: "changes_requested", findings: [{ severity: "high", blocking: true, resolution: "open", lines: [3, 5] }] };
    expect(crossCheck(parsed, stored)).toBeUndefined();
    // And as people act on it, "dismissed" or "fixed" - still the finding the report published as confirmed.
    for (const resolution of ["accepted", "dismissed", "fixed"]) expect(crossCheck(parsed, { ...stored, findings: [{ ...stored.findings[0]!, resolution }] })).toBeUndefined();
    expect(crossCheck(parsed, { ...stored, findings: [{ ...stored.findings[0]!, resolution: "uncertain" }] })).toMatch(/^published_not_stored/);
    // A rejected row is never published, so it is not a disagreement.
    expect(crossCheck(parsed, { ...stored, findings: [...stored.findings, { severity: "critical", blocking: false, resolution: "rejected", lines: [1, 1] }] })).toBeUndefined();
    expect(crossCheck(parsed, { ...stored, status: "checks_passed" })).toMatch(/^status:/);
    expect(crossCheck(parsed, { ...stored, findings: [{ ...stored.findings[0]!, lines: [3, 6] }] })).toMatch(/^published_not_stored/);
    expect(crossCheck(parsed, { ...stored, findings: [...stored.findings, { severity: "warning", blocking: false, resolution: "uncertain", lines: [9, 9] }] })).toMatch(/^stored_not_published/);
  });
});
