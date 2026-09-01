import { readFile } from "node:fs/promises";
import { writeBlindAssignmentFile } from "./humanAssignmentFile.js";

const args = process.argv.slice(2).filter(value => value !== "--");
if (args.length !== 2) throw new Error("usage: buildit-human-assignments <source-free-input.json> <new-output.json>");
const input = JSON.parse(await readFile(args[0]!, "utf8")) as unknown;
const result = await writeBlindAssignmentFile(input, args[1]!);
process.stdout.write(`${JSON.stringify({ created: true, ...result })}\n`);
