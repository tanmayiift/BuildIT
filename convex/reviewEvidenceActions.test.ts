import { describe, expect, it } from "vitest";
import { citedExcerpt, failedCheckTails, findingDetailsFromAnalysis, reviewEvidenceView } from "./reviewEvidenceActions";

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

// Secret-shaped fixtures are assembled at runtime: BuildIT's own review scans the whole tree.
const join = (...parts: string[]) => parts.join("");
const file = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n");

describe("the cited lines a finding points at", () => {
  it("shows the range with three lines either side, and marks which lines were cited", () => {
    const excerpt = citedExcerpt(file, 10, 11);
    expect(excerpt).toMatchObject({ clipped: false });
    if (typeof excerpt !== "object") throw new Error("expected lines");
    expect(excerpt.lines.map(line => line.number)).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    expect(excerpt.lines.filter(line => line.cited).map(line => line.text)).toEqual(["line 10", "line 11"]);
    // At the top of the file there is nothing above to show.
    if (typeof citedExcerpt(file, 1, 1) !== "object") throw new Error("expected lines");
    expect((citedExcerpt(file, 1, 1) as { lines: Array<{ number: number }> }).lines[0]!.number).toBe(1);
  });

  it("keeps a long range to 40 lines and a long line to 240 characters, and says it clipped", () => {
    const long = citedExcerpt(file, 5, 55) as { lines: Array<{ number: number }>; clipped: boolean };
    expect(long.lines).toHaveLength(40);
    expect(long.clipped).toBe(true);
    const wide = citedExcerpt(`short\n${"x".repeat(500)}\nshort`, 2, 2) as { lines: Array<{ text: string }> };
    expect(wide.lines[1]!.text).toHaveLength(240);
    expect(wide.lines[1]!.text.endsWith("…")).toBe(true);
  });

  it("refuses a range the file does not have instead of showing other lines", () => {
    expect(citedExcerpt(file, 0, 2)).toBeUndefined();
    expect(citedExcerpt(file, 59, 61)).toBeUndefined();
    expect(citedExcerpt(file, 9, 8)).toBeUndefined();
  });

  it("redacts a secret on a line, and withholds an excerpt a multi-line key runs through", () => {
    const token = join("gh", "p_", "A1b2C3d4E5f6G7h8I9j0");
    const single = citedExcerpt(`const a = 1;\nconst token = "${token}";\nconst b = 2;`, 2, 2) as { lines: Array<{ text: string }> };
    expect(single.lines[1]!.text).toBe('const token = "[REDACTED]";');
    expect(JSON.stringify(single)).not.toContain(token);
    const pem = join("-----", "BEGIN ", "PRIVATE KEY", "-----\n", "MIIEvQIBADANBg\n", "-----", "END ", "PRIVATE KEY", "-----");
    expect(citedExcerpt(`const key = \`\n${pem}\n\`;`, 3, 3)).toBe("secret");
  });
});

describe("the output of a failed check", () => {
  it("returns the last 30 lines of each check that failed on the head commit, redacted", () => {
    const token = join("gh", "p_", "A1b2C3d4E5f6G7h8I9j0");
    const log = [...Array.from({ length: 40 }, (_, index) => `test ${index + 1} ok`), `AssertionError: expected 2 got 3 ${token}`].join("\n");
    const tails = failedCheckTails({ head: {
      results: [{ planId: "test", conclusion: "failed" }, { planId: "lint", conclusion: "passed" }],
      outputs: [{ planId: "test", text: `${log}\n\n`, truncated: false }, { planId: "lint", text: "all good" }],
    }, base: { results: [{ planId: "test", conclusion: "passed" }], outputs: [{ planId: "test", text: "base output" }] } });
    expect(tails).toHaveLength(1);
    expect(tails[0]).toMatchObject({ planId: "test", truncated: true });
    expect(tails[0]!.lines).toHaveLength(30);
    expect(tails[0]!.lines.at(-1)).toBe("AssertionError: expected 2 got 3 [REDACTED]");
    expect(failedCheckTails(undefined)).toEqual([]);
  });
});

describe("assembling a review's evidence", () => {
  const chunk = (revision: string, content: string) => ({ revision, snapshot: { files: [{ path: "src/tax.js", content, size: content.length }] } });
  const source = ["function tax(amount) {", "  if (amount <= 100) return amount * 0.1;", "  return 10 + amount * 0.2;", "  // tier", "}"].join("\n");

  it("reads the cited lines from the head snapshot only", () => {
    const view = reviewEvidenceView(analysis(), [chunk("head", source)], { headSha, baseSha });
    expect(view.state).toBe("shown");
    if (view.state !== "shown") throw new Error("expected evidence");
    expect(view.excerpts).toHaveLength(1);
    expect(view.excerpts[0]).toMatchObject({ findingId: "finding-1", path: "src/tax.js", clipped: false });
    expect(() => reviewEvidenceView(analysis(), [chunk("base", source)], { headSha, baseSha })).toThrow("finding_evidence_snapshot_invalid");
  });

  it("says a file is unavailable rather than guessing when the snapshot does not hold the lines", () => {
    const view = reviewEvidenceView(analysis(), [chunk("head", "one line")], { headSha, baseSha });
    expect(view.state === "shown" && view.excerpts[0]).toEqual({ findingId: "finding-1", path: "src/tax.js", withheld: "unavailable" });
  });

  it("refuses evidence pinned to another commit", () => {
    expect(() => reviewEvidenceView(analysis(), [chunk("head", source)], { headSha: "c".repeat(40), baseSha })).toThrow("finding_detail_pinning_failed");
  });
});
