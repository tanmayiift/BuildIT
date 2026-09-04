import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// BuildIT merges nothing. That has been true of reviews and of autofix from the start, and a
// changelog is the first thing it writes that nobody asked for in the moment - which makes it
// exactly the place the boundary would erode without anyone deciding to erode it.
const worker = readFileSync(join(import.meta.dirname, "../../convex/changelogWorker.ts"), "utf8");

describe("what the changelog worker may do", () => {
  // Banning the word would flag the sentence promising it never merges - the same mistake as
  // banning ".Labels" in the alert template. What is forbidden is the call, not the noun.
  it("opens a pull request and never merges one", () => {
    const code = worker.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
    expect(code).toContain("upsertStackedPullRequest");
    expect(code).not.toMatch(/["'`][^"'`]*\/merge["'`]/);
    expect(code).not.toMatch(/\.merge(?:PullRequest)?\s*\(/);
    expect(code).not.toMatch(/method:\s*["']PUT["'][^)]*merge/i);
  });

  it("never writes to the default branch, only to its own branch", () => {
    expect(worker).toContain("`buildit/changelog-${args.prNumber}`");
    const upsert = worker.slice(worker.indexOf("upsertBranch("), worker.indexOf("upsertBranch(") + 120);
    expect(upsert).toContain("name: branch");
    expect(upsert).not.toContain("defaultBranch");
  });

  it("says so in the pull request it opens", () => {
    expect(worker).toContain("BuildIT does not merge this");
  });

  it("does not add the same pull request twice when a webhook is redelivered", () => {
    expect(worker).toContain("already_listed");
  });
});
