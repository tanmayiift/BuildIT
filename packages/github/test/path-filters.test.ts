import { describe, expect, it } from "vitest";
import { compilePathFilters } from "../src/repository-content.js";

// Every comparable tool lets a repository say what not to review, and the reason is noise: a
// vendored directory or a generated client produces findings nobody will ever act on, and a
// reviewer who scrolls past those stops reading the ones that matter.
//
// BuildIT already skips node_modules, dist, lockfiles, images and minified bundles. What it could
// not do is take an instruction from the team that owns the code - every repository has a folder
// its own engineers would never review.
//
// Deliberately a small glob dialect rather than full regex: a pattern in configuration is written
// once and read for years, and a regex there is a footgun that silently drops half a repository.

describe("path filters a repository can set", () => {
  it("keeps everything when nothing is configured", () => {
    const keep = compilePathFilters([]);
    expect(keep("src/a.ts")).toBe(true);
    expect(keep("vendor/x.go")).toBe(true);
  });

  it("excludes a directory subtree", () => {
    const keep = compilePathFilters(["!vendor/**"]);
    expect(keep("vendor/lib/x.go")).toBe(false);
    expect(keep("src/a.ts")).toBe(true);
  });

  it("excludes by extension anywhere in the tree", () => {
    const keep = compilePathFilters(["!**/*.generated.ts"]);
    expect(keep("src/api/client.generated.ts")).toBe(false);
    expect(keep("src/api/client.ts")).toBe(true);
  });

  it("treats a bare include list as an allowlist", () => {
    const keep = compilePathFilters(["src/**"]);
    expect(keep("src/a.ts")).toBe(true);
    expect(keep("scripts/build.js")).toBe(false);
  });

  // Order matters the way .gitignore's does: a later rule refines an earlier one.
  it("lets a later include rescue a path an earlier exclude dropped", () => {
    const keep = compilePathFilters(["!generated/**", "generated/schema.ts"]);
    expect(keep("generated/client.ts")).toBe(false);
    expect(keep("generated/schema.ts")).toBe(true);
  });

  it("matches a single segment with * and any depth with **", () => {
    const keep = compilePathFilters(["!src/*/test.ts"]);
    expect(keep("src/a/test.ts")).toBe(false);
    expect(keep("src/a/b/test.ts")).toBe(true);
  });

  // A filter is written by a person and must never be able to hang the review that reads it.
  it("refuses a pattern that could not be compiled safely", () => {
    expect(() => compilePathFilters(["!../../etc/**"])).toThrow("path_filter_invalid");
    expect(() => compilePathFilters(["!" + "a".repeat(300)])).toThrow("path_filter_invalid");
    expect(() => compilePathFilters(new Array(101).fill("!x/**"))).toThrow("path_filter_invalid");
  });

  // Regex metacharacters in a glob are literal, or a stray dot silently widens the rule.
  it("treats regex metacharacters as literal text", () => {
    const keep = compilePathFilters(["!src/a.b.ts"]);
    expect(keep("src/a.b.ts")).toBe(false);
    expect(keep("src/axbxts")).toBe(true);
  });
});
