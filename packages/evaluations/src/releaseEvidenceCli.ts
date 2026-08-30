import { readFile } from "node:fs/promises";
import { officialPopulation, parseReleaseEvidenceInput, releaseEvidenceGate } from "./releaseEvidence.js";
import { parseEvaluationRun } from "./score.js";

const path = process.argv[2];
if (!path || process.argv.length !== 3) throw new Error("usage: buildit-release-evidence <source-free-evidence.json>");
const input = parseReleaseEvidenceInput(JSON.parse(await readFile(path, "utf8")) as unknown);
const result = releaseEvidenceGate({ ...input, run: parseEvaluationRun(input.run), population: officialPopulation });
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.passed ? 0 : 2;
