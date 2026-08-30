import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../.."),
  web = readFileSync(resolve(root, "docs/guides/web-launch-guide.md"), "utf8"),
  cli = readFileSync(resolve(root, "docs/guides/cli-launch-guide.md"), "utf8"),
  source = readFileSync(resolve(root, "apps/cli/src/index.ts"), "utf8");

describe("launch guides", () => {
  it("documents every CLI command exposed by the binary", () => {
    for (const command of ["configure", "doctor", "review", "status", "cancel", "autofix"]) {
      expect(source).toContain(`command === "${command}"`);
      expect(cli).toMatch(new RegExp(`(?:dist/index\\.js|BuildIT CLI).*${command}|\\b${command}\\b`, "i"));
    }
  });

  it("keeps secrets and merge authority outside both journeys", () => {
    for (const guide of [web, cli]) {
      expect(guide).toMatch(/(?:never[^.]*key|key[^.]*never)/i);
      expect(guide).toMatch(/human.*merge/i);
      expect(guide).toMatch(/BuildIT never (?:calls GitHub's merge operation|merges)/i);
    }
  });

  it("documents evidence, uncertainty, revocation, cancellation, and exact commits", () => {
    const combined = `${web}\n${cli}`.toLowerCase();
    for (const phrase of ["exact commit", "evidence", "inconclusive", "revoke", "cancel", "three", "stacked pull request"]) {
      expect(combined).toContain(phrase);
    }
  });
});
