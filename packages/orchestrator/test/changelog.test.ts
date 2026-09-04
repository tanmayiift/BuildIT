import { describe, expect, it } from "vitest";
import { changelogEntry, insertChangelogEntry } from "../src/changelog.js";

// A changelog entry BuildIT writes has the same constraint as everything else it writes: it may
// only say what it can show. It is built from the merged pull request and that review's own
// findings, so it cannot describe a fix that did not happen or a problem nobody found.
//
// And it lands in a pull request a person merges. BuildIT does not push to the default branch and
// does not merge its own changelog - the same boundary as autofix, for the same reason.

describe("what an entry says", () => {
  it("names the pull request and its title", () => {
    const entry = changelogEntry({ prNumber: 42, title: "Add a rates client", mergedAt: Date.UTC(2026, 8, 4), fixedFindings: [] });
    expect(entry).toContain("#42");
    expect(entry).toContain("Add a rates client");
    expect(entry).toContain("2026-09-04");
  });

  it("names what BuildIT fixed on the way, when it fixed something", () => {
    const entry = changelogEntry({ prNumber: 42, title: "Add a rates client", mergedAt: Date.UTC(2026, 8, 4),
      fixedFindings: ["TLS certificate verification is disabled"] });
    expect(entry).toContain("TLS certificate verification is disabled");
  });

  it("says nothing about fixes when there were none", () => {
    const entry = changelogEntry({ prNumber: 42, title: "Add a rates client", mergedAt: Date.UTC(2026, 8, 4), fixedFindings: [] });
    expect(entry.toLowerCase()).not.toContain("fixed");
  });

  it("keeps a title that tries to break the file out of the entry", () => {
    const entry = changelogEntry({ prNumber: 1, title: "Add\n## Unreleased\n- fake", mergedAt: 0, fixedFindings: [] });
    expect(entry.split("\n").filter(line => line.startsWith("##"))).toHaveLength(0);
  });
});

describe("where an entry goes in the file", () => {
  it("starts a file that does not exist yet", () => {
    const next = insertChangelogEntry(undefined, "- 2026-09-04 #42 Add a rates client");
    expect(next).toBeDefined();
    expect(next!).toContain("# Changelog");
    expect(next!).toContain("#42");
  });

  it("adds to the top of the existing list, under the heading", () => {
    const existing = "# Changelog\n\n- 2026-09-01 #40 Older thing\n";
    const next = insertChangelogEntry(existing, "- 2026-09-04 #42 Newer thing");
    expect(next).toBeDefined();
    expect(next!.indexOf("#42")).toBeLessThan(next!.indexOf("#40"));
    expect(next!.indexOf("# Changelog")).toBeLessThan(next!.indexOf("#42"));
  });

  it("keeps everything that was already there", () => {
    const existing = "# Changelog\n\nSome preamble a person wrote.\n\n- 2026-09-01 #40 Older thing\n";
    const next = insertChangelogEntry(existing, "- 2026-09-04 #42 Newer thing");
    expect(next).toBeDefined();
    expect(next!).toContain("Some preamble a person wrote.");
    expect(next!).toContain("#40");
  });

  it("does not add the same pull request twice", () => {
    const existing = "# Changelog\n\n- 2026-09-04 #42 Newer thing\n";
    expect(insertChangelogEntry(existing, "- 2026-09-04 #42 Newer thing")).toBeUndefined();
  });
});
