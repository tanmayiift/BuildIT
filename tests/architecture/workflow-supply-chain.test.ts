import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A mutable tag is resolved at run time, so it decides nothing about which code actually runs.
// gitleaks-action ran on a floating v2 in a job that has GITHUB_TOKEN in env and, through
// fetch-depth: 0, the repository's complete history - precisely the material that job exists to
// scan. Same class, lower risk for the GitHub-owned actions.

const workflows = readdirSync(".github/workflows")
  .filter(name => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map(name => ({ name, source: readFileSync(join(".github/workflows", name), "utf8") }));

describe("workflow supply chain", () => {
  it("has workflows to check", () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  it("pins every third-party action to a full commit SHA", () => {
    const floating: string[] = [];
    for (const { name, source } of workflows) {
      for (const [, ref] of source.matchAll(/uses:\s*(\S+)/g)) {
        if (ref.startsWith("./")) continue;
        if (!/@[0-9a-f]{40}$/.test(ref)) floating.push(`${name}: ${ref}`);
      }
    }
    expect(floating).toEqual([]);
  });

  // A SHA with no tag comment is unreadable and unmaintainable; the comment says what it was.
  it("records the tag each SHA came from", () => {
    const unlabelled: string[] = [];
    for (const { name, source } of workflows) {
      for (const line of source.split("\n")) {
        if (!/uses:\s*\S+@[0-9a-f]{40}/.test(line)) continue;
        if (!/#\s*v?\d/.test(line)) unlabelled.push(`${name}: ${line.trim()}`);
      }
    }
    expect(unlabelled).toEqual([]);
  });

  // Pinning without a bump path just freezes the actions at today's code.
  it("keeps the pins updatable", () => {
    const dependabot = readFileSync(".github/dependabot.yml", "utf8");
    expect(dependabot).toContain("github-actions");
  });
});
