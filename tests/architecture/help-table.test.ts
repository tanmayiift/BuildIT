import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `@buildit help` listed four commands while the parser accepted seven: pause, resume and dismiss were
// usable but undiscoverable from the pull request, which is where commands are typed. Every command
// the parser accepts must appear in the table.
describe("the @buildit help table", () => {
  it("lists every command the comment parser accepts", () => {
    const parser = readFileSync("packages/github/src/index.ts", "utf8"), worker = readFileSync("convex/reviewCommandWorker.ts", "utf8");
    const accepted = new Set<string>();
    for (const match of parser.matchAll(/@buildit\\s\+\((?:\?:)?([a-z|]+)\)/g)) for (const name of match[1]!.split("|")) accepted.add(name);
    for (const match of parser.matchAll(/@buildit\\s\+([a-z]+)\\s/g)) accepted.add(match[1]!);
    accepted.delete("help");
    expect([...accepted].sort()).toEqual(["ask", "autofix", "cancel", "dismiss", "pause", "resume", "review"]);
    for (const name of accepted) expect(worker, `@buildit ${name} is accepted but not in the help table`).toMatch(new RegExp("`@buildit " + name + "[ `]"));
  });
});
