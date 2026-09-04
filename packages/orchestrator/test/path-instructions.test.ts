import { describe, expect, it } from "vitest";
import { instructionsForPaths } from "../src/repositoryConfig.js";

// Per-path instructions let a team say what to pay attention to where. They are also text a
// repository controls that ends up in a model prompt, which makes them the same class of input as
// a pull request description - and BuildIT already treats that as a narrative injection surface.
//
// So an instruction may steer attention and nothing else. It cannot lift the evidence gate, weaken
// a scanner result, or change a verdict, because none of those read it: the gate runs on evidence
// after the model has spoken, and scanners never see a prompt at all. What this file guards is the
// step before that - which instructions reach the prompt, and how many.

const instructions = [
  { path: "src/auth/**", instructions: "Pay attention to input validation." },
  { path: "**/*.sql", instructions: "Check for interpolation." },
  { path: "docs/**", instructions: "Prose only." },
];

describe("which instructions reach a review", () => {
  it("selects only the ones whose paths the change actually touched", () => {
    const selected = instructionsForPaths(instructions, ["src/auth/login.ts"]);
    expect(selected).toEqual(["Pay attention to input validation."]);
  });

  it("selects several when a change spans them", () => {
    const selected = instructionsForPaths(instructions, ["src/auth/login.ts", "db/migrate.sql"]);
    expect(selected).toHaveLength(2);
    expect(selected).toContain("Check for interpolation.");
  });

  it("selects nothing when no path matches, rather than falling back to all of them", () => {
    expect(instructionsForPaths(instructions, ["README.md"])).toEqual([]);
  });

  it("says each instruction once however many files matched it", () => {
    const selected = instructionsForPaths(instructions, ["src/auth/a.ts", "src/auth/b.ts", "src/auth/c.ts"]);
    expect(selected).toEqual(["Pay attention to input validation."]);
  });

  // The prompt has a budget, and a repository controls this text.
  it("bounds how much instruction text can reach the prompt", () => {
    const many = Array.from({ length: 50 }, (_, index) => ({ path: "src/**", instructions: `Rule ${index} ${"x".repeat(500)}` }));
    const selected = instructionsForPaths(many, ["src/a.ts"]);
    expect(selected.join("").length).toBeLessThanOrEqual(4_000);
  });

  it("takes no instructions at all in its stride", () => {
    expect(instructionsForPaths(undefined, ["src/a.ts"])).toEqual([]);
    expect(instructionsForPaths([], ["src/a.ts"])).toEqual([]);
  });
});
