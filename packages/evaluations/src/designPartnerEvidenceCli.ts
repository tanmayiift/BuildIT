import { readFile } from "node:fs/promises";
import { designPartnerEvidenceGate, parseDesignPartnerEvidence } from "./designPartnerEvidence.js";

const broadLaunch = process.argv.includes("--broad-launch");
const args = process.argv.slice(2).filter(value => value !== "--" && value !== "--broad-launch");
if (args.length !== 1) throw new Error("usage: buildit-design-partner-evidence [--broad-launch] <source-free-evidence.json>");
const evidence = parseDesignPartnerEvidence(JSON.parse(await readFile(args[0]!, "utf8")) as unknown);
const result = designPartnerEvidenceGate(evidence);
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = broadLaunch ? (result.broadLaunchPassed ? 0 : 2) : (result.evidencePassed ? 0 : 2);
