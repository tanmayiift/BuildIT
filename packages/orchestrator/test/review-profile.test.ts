import { describe, expect, it } from "vitest";
import { selectInlineFindings } from "../src/report.js";

// Noise is the standard complaint about this category of tool, and inline comments are exactly how
// a reviewer becomes noisy: one comment per finding, on every file, every push. BuildIT's evidence
// gate already keeps the volume low - a finding it cannot verify never exists - so this is about
// letting a team choose how much of what survived that gate they want on their diff.
//
// The summary comment always carries everything. The profile only decides what is loud.

const finding = (over: Partial<{ id: string; severity: string; blocking: boolean; resolution: string }> = {}) => ({
  id: "f", path: "a.ts", startLine: 1, endLine: 1, severity: "warning",
  blocking: false, resolution: "accepted", ...over,
});

describe("choosing what goes on the diff", () => {
  const findings = [
    finding({ id: "block", severity: "critical", blocking: true }),
    finding({ id: "high", severity: "high" }),
    finding({ id: "warn", severity: "warning" }),
    finding({ id: "info", severity: "info" }),
  ];

  it("quiet posts only what actually blocks the merge", () => {
    expect(selectInlineFindings(findings, "quiet").map(item => item.id)).toEqual(["block"]);
  });

  it("balanced adds the serious findings that did not block", () => {
    expect(selectInlineFindings(findings, "balanced").map(item => item.id)).toEqual(["block", "high"]);
  });

  it("thorough posts everything that survived the gate", () => {
    expect(selectInlineFindings(findings, "thorough").map(item => item.id)).toEqual(["block", "high", "warn", "info"]);
  });

  it("defaults to balanced when a repository has never chosen", () => {
    expect(selectInlineFindings(findings, undefined).map(item => item.id)).toEqual(["block", "high"]);
  });

  // A rejected finding is one the critic disproved. No profile may resurrect it onto a line.
  it("never posts a finding the critic rejected, at any profile", () => {
    const rejected = [finding({ id: "gone", severity: "critical", blocking: true, resolution: "rejected" })];
    for (const profile of ["quiet", "balanced", "thorough"] as const) {
      expect(selectInlineFindings(rejected, profile)).toEqual([]);
    }
  });

  // An uncertain finding is one BuildIT could not settle. Saying it out loud on a line overstates it.
  it("keeps uncertain findings out of quiet, where only decided things belong", () => {
    const uncertain = [finding({ id: "maybe", severity: "critical", blocking: true, resolution: "uncertain" })];
    expect(selectInlineFindings(uncertain, "quiet")).toEqual([]);
    expect(selectInlineFindings(uncertain, "thorough").map(item => item.id)).toEqual(["maybe"]);
  });
});
