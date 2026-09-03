import { describe, expect, it } from "vitest";
import { classifyCheckConclusion } from "../src/index.js";

// A published review reported `typecheck  Advisory  **Failed**` and quoted npm's whole complaint
// underneath, including the path to a debug log inside a sandbox nobody can open. The repository
// simply has no typecheck script. Calling that a failure is what teaches a reader to skip the
// table, and the table is the part of the review that is actually evidence.
//
// Every package manager says this differently, so all four are matched. The exit code alone cannot
// distinguish them: npm exits 1 for a missing script and 1 for a type error.

describe("a check whose script does not exist", () => {
  const cases = [
    ["npm", 'npm error Missing script: "typecheck"\nnpm error\nnpm error To see a list of scripts, run:\n npm error   npm run'],
    ["pnpm", 'ERR_PNPM_NO_SCRIPT  Missing script: typecheck'],
    ["yarn", 'error Command "typecheck" not found.'],
    ["yarn berry", 'Usage Error: Couldn\'t find a script named "typecheck".'],
  ] as const;

  for (const [manager, output] of cases) {
    it(`is not configured, not failed, under ${manager}`, () => {
      expect(classifyCheckConclusion({ exitCode: 1, output })).toBe("not_configured");
    });
  }

  it("leaves a genuine failure alone", () => {
    expect(classifyCheckConclusion({ exitCode: 1, output: "src/a.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'." })).toBe("failed");
  });

  it("leaves a pass alone", () => {
    expect(classifyCheckConclusion({ exitCode: 0, output: "" })).toBe("passed");
  });

  // A script that exists and prints the words while failing must still be a failure.
  it("does not excuse a real failure that happens to mention a missing script", () => {
    expect(classifyCheckConclusion({ exitCode: 1, output: "FAIL test/x.test.ts\n  expected \"Missing script: typecheck\" to equal something" })).toBe("failed");
  });
});
