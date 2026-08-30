import { readFile } from "node:fs/promises";
import { parseEvaluationRun, releaseGate } from "./score.js";

const path = process.argv[2];
if (!path || process.argv.length !== 3) throw new Error("usage: buildit-eval <source-free-run.json>");
const run = parseEvaluationRun(JSON.parse(await readFile(path, "utf8")) as unknown);
const result = releaseGate(run);
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.passed ? 0 : 2;
