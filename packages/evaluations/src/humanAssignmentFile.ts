import { link, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createBlindAssignments, type BlindCase } from "./humanLabels.js";

export type BlindAssignmentInput = {
  version: string;
  cases: BlindCase[];
  reviewerHashes: string[];
  adjudicatorHashes: string[];
};

const HASH = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const SEVERITY = new Set(["low", "medium", "high", "critical"]);
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join("|") === [...keys].sort().join("|");

export function parseBlindAssignmentInput(value: unknown): BlindAssignmentInput {
  if (!object(value) || !exactKeys(value, ["version", "cases", "reviewerHashes", "adjudicatorHashes"]) || typeof value.version !== "string" || !SAFE_ID.test(value.version) || !Array.isArray(value.cases) || !Array.isArray(value.reviewerHashes) || !Array.isArray(value.adjudicatorHashes)) throw new Error("blind_assignment_manifest_invalid");
  if (!value.cases.length || value.cases.some(item => !object(item) || !exactKeys(item, ["caseId", "severity"]) || typeof item.caseId !== "string" || !SAFE_ID.test(item.caseId) || !SEVERITY.has(String(item.severity)))) throw new Error("blind_assignment_case_invalid");
  if (new Set(value.cases.map(item => (item as { caseId: string }).caseId)).size !== value.cases.length) throw new Error("blind_assignment_case_invalid");
  if (value.reviewerHashes.length < 2 || !value.adjudicatorHashes.length || [...value.reviewerHashes, ...value.adjudicatorHashes].some(item => typeof item !== "string" || !HASH.test(item)) || new Set([...value.reviewerHashes, ...value.adjudicatorHashes]).size !== value.reviewerHashes.length + value.adjudicatorHashes.length) throw new Error("blind_assignment_input_invalid");
  return value as unknown as BlindAssignmentInput;
}

export async function writeBlindAssignmentFile(value: unknown, outputPath: string) {
  const input = parseBlindAssignmentInput(value);
  const assignment = createBlindAssignments(input);
  const temporaryPath = join(dirname(outputPath), `.buildit-assignment-${process.pid}-${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(assignment, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporaryPath, outputPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  return { cases: assignment.assignments.length, criticalCases: assignment.assignments.filter(item => item.severity === "critical").length };
}
