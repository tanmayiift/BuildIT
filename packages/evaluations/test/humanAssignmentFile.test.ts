import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBlindAssignmentInput, writeBlindAssignmentFile } from "../src/humanAssignmentFile.js";

const folders: string[] = [];
const hash = (value: string) => value.padStart(64, "0");
const valid = {
  version: "release-v1",
  cases: [{ caseId: "tax-tier-critical", severity: "critical" }, { caseId: "empty-cart", severity: "low" }],
  reviewerHashes: [hash("a"), hash("b")],
  adjudicatorHashes: [hash("c")],
};

afterEach(async () => Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))));

describe("blind assignment file", () => {
  it("parses only source-free case and role hashes", () => {
    expect(parseBlindAssignmentInput(valid)).toEqual(valid);
    expect(() => parseBlindAssignmentInput({ ...valid, reviewerEmail: "reviewer@example.com" })).toThrow("blind_assignment_manifest_invalid");
    expect(() => parseBlindAssignmentInput({ ...valid, cases: [{ caseId: "owner/repository", severity: "critical" }] })).toThrow("blind_assignment_case_invalid");
  });

  it("rejects duplicate cases and overlapping reviewer/adjudicator roles", () => {
    expect(() => parseBlindAssignmentInput({ ...valid, cases: [valid.cases[0], valid.cases[0]] })).toThrow("blind_assignment_case_invalid");
    expect(() => parseBlindAssignmentInput({ ...valid, adjudicatorHashes: [valid.reviewerHashes[0]] })).toThrow("blind_assignment_input_invalid");
  });

  it("writes hidden assignments once and never includes expected answers", async () => {
    const folder = await mkdtemp(join(tmpdir(), "buildit-blind-assignment-")); folders.push(folder);
    const output = join(folder, "assignment.json");
    await writeBlindAssignmentFile(valid, output);
    const text = await readFile(output, "utf8");
    expect(JSON.parse(text)).toMatchObject({ version: "release-v1", hiddenHoldout: true });
    expect(text).not.toContain("expected");
    await expect(writeBlindAssignmentFile(valid, output)).rejects.toMatchObject({ code: "EEXIST" });
  });
});
