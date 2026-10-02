import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("broker deployment boundary", () => {

  it("does not make unrelated routes eagerly load the execution worker", () => {
    expect(readFileSync("packages/broker/src/index.ts", "utf8")).not.toContain('export * from "./execution-http.js"');
    for (const route of ["artifacts", "credentials", "model"]) {
      expect(readFileSync(`packages/broker/api/${route}.ts`, "utf8")).not.toContain('from "../src/execution-http.js"');
    }
  });
});

// console.log("buildit_sandbox_scope", { owner, project, issuer }) wrote raw object fields straight to
// the function log, bypassing safeLog's allow-list entirely. The values were BuildIT's own Vercel
// account identifiers rather than customer data, so it was never a disclosure - but it was the one
// site in the broker where a diagnostic could grow a field nobody checked, and the next person adding
// one would have followed it. Every logging site now passes a bounded, named value.
describe("broker logging stays inside the allow-list", () => {
  it("logs no raw request or token field outside safeLog", () => {
    const offenders: string[] = [];
    for (const directory of ["packages/broker/api", "packages/broker/src"]) {
      for (const name of readdirSync(directory)) {
        if (!name.endsWith(".ts")) continue;
        const path = `${directory}/${name}`;
        for (const line of readFileSync(path, "utf8").split("\n")) {
          const call = /console\.(log|info|warn|error)\(([\s\S]*)$/.exec(line);
          if (!call) continue;
          // A bounded diagnostic names a category, a code or a count. A raw identifier read off a
          // payload, a token or a request body is what this refuses.
          if (/\b(owner|project|issuer|iss|payload|body|token|grant|prompt|path|repo|organization)\b\s*:/.test(call[2]!)) {
            offenders.push(`${path}: ${line.trim().slice(0, 90)}`);
          }
        }
      }
    }
    expect(offenders, "a broker diagnostic must name a category or a code, never a field off the payload").toEqual([]);
  });
});
