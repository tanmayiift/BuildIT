import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compilePathFilters } from "../../packages/github/src/repository-content";

// A path filter narrows what is reviewed. Two things it must never do.
//
// It must not widen: a filter that could pull in files the relevance selection had no reason to
// read would let a repository talk BuildIT into fetching its whole tree, which is the cost problem
// the selection exists to solve.
//
// And it must not silently switch off dependency scanning. A team quietening a vendored directory
// with "!vendor/**" is not asking to stop being told about a known CVE in their lockfile, and a
// scanner that goes quiet without saying so is worse than one that was never configured.
describe("what a path filter cannot do", () => {
  const worker = readFileSync(join(import.meta.dirname, "../../convex/reviewContextWorker.ts"), "utf8");

  it("keeps dependency manifests regardless of what the repository excluded", () => {
    const line = worker.split("\n").find(item => item.includes("const headSelect"));
    expect(line).toBeDefined();
    // The manifest term is disjunctive and comes first, so no filter can reach past it.
    expect(line).toMatch(/dependencyManifest\.test\(path\)\s*$/);
    expect(worker).toContain("|| ((changedPaths.has(path) || isRequirementSourcePath(path)) && allowedByRepository(path))");
  });

  it("applies the filter as a narrowing conjunction, never as an alternative", () => {
    for (const line of worker.split("\n").filter(item => item.includes("allowedByRepository(path)"))) {
      expect(line).toContain("&& allowedByRepository(path)");
      expect(line).not.toMatch(/\|\|\s*allowedByRepository\(path\)/);
    }
  });

  it("rejects a pattern that escapes the repository", () => {
    expect(() => compilePathFilters(["!../secrets/**"])).toThrow("path_filter_invalid");
    expect(() => compilePathFilters(["/etc/passwd"])).toThrow("path_filter_invalid");
  });

  it("bounds how many patterns a repository can set", () => {
    expect(() => compilePathFilters(new Array(101).fill("!x/**"))).toThrow("path_filter_invalid");
    expect(() => compilePathFilters(new Array(100).fill("!x/**"))).not.toThrow();
  });
});
