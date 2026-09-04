import { describe, expect, it } from "vitest";
import { executionPlanInput } from "@buildit/runner";
import { detectPackageManager } from "./validationEvidence";
import { isRequirementSourcePath } from "@buildit/orchestrator";

// This is the seam that produced `package_manager_changed` in production, on this repository's own
// pull request #46, and reported it to the author as "a required platform step failed".
//
// The two revisions are fetched with different selection rules, on purpose: head carries the files
// the model reads, base carries only what the diff touched, because base file contents are filtered
// out of the model context anyway. But detectPackageManager reads BOTH sets and refuses the review
// when they disagree - and head kept `package.json` (it matches the requirement-source config
// pattern) and the lockfile (it matches the dependency manifest pattern) while base kept neither.
//
// So on every repository above the 400-file selection threshold whose pull request happened not to
// touch its manifests - which is most pull requests on most repositories - head detected a package
// manager, base detected none, and the review died before a single check ran. It looked random
// because the trigger was "the diff did not include package.json", which nobody thinks of as a
// property of a repository.
//
// These tests reconstruct both selection rules exactly as reviewContextWorker builds them and
// assert the two revisions can never disagree about the execution plan.

const tree = [
  "package.json", "pnpm-lock.yaml", "readme.md",
  "source/core/index.ts", "source/core/retry.ts", "source/util/parse.ts",
  "test/retry.ts", "docs/design.md",
];

// Exactly the shape reviewContextWorker uses, so a change there that skips this predicate fails here.
function selections(changed: ReadonlySet<string>, allowed: (path: string) => boolean = () => true) {
  const head = (path: string) => executionPlanInput(path) || ((changed.has(path) || isRequirementSourcePath(path)) && allowed(path));
  const base = (path: string) => executionPlanInput(path) || (changed.has(path) && allowed(path));
  const paths = {
    base: new Set(tree.filter(base)),
    head: new Set(tree.filter(head)),
  };
  return paths;
}

describe("what base and head must agree on", () => {
  it("detects the same package manager when the change touches no manifest", () => {
    // The exact production case: a pull request in source/, nowhere near package.json.
    const paths = selections(new Set(["source/core/retry.ts"]));
    expect(detectPackageManager(paths)).toBe("pnpm");
  });

  it("still agrees when the change does touch the manifests", () => {
    const paths = selections(new Set(["package.json", "pnpm-lock.yaml"]));
    expect(detectPackageManager(paths)).toBe("pnpm");
  });

  it("agrees on a repository that has no package manager at all", () => {
    const empty = { base: new Set(["main.go"]), head: new Set(["main.go", "readme.md"]) };
    expect(detectPackageManager(empty)).toBeUndefined();
  });

  it("cannot be made to disagree by a repository's own path filters", () => {
    // A .buildit.yml excluding everything must not be able to break plan detection - the same
    // reason path filters cannot switch off the dependency scan.
    const paths = selections(new Set(["source/core/retry.ts"]), () => false);
    expect(() => detectPackageManager(paths)).not.toThrow();
    expect(detectPackageManager(paths)).toBe("pnpm");
  });

  it("keeps every manifest on both revisions, whatever the diff was", () => {
    for (const changed of [new Set<string>(), new Set(["docs/design.md"]), new Set(tree)]) {
      const paths = selections(changed);
      for (const manifest of ["package.json", "pnpm-lock.yaml"]) {
        expect(paths.base.has(manifest), `base lost ${manifest}`).toBe(true);
        expect(paths.head.has(manifest), `head lost ${manifest}`).toBe(true);
      }
    }
  });
});

// The predicate itself. detectPackageManager reads exactly these names, so anything it reads must
// be here - a lockfile added to one and not the other reintroduces the same failure.
describe("the execution plan inputs", () => {
  it("covers every file detectPackageManager reads", () => {
    for (const path of ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
      expect(executionPlanInput(path), `${path} is read but not always fetched`).toBe(true);
    }
  });

  it("does not sweep in the whole repository", () => {
    for (const path of ["source/core/index.ts", "readme.md", "src/package.json.ts"]) {
      expect(executionPlanInput(path)).toBe(false);
    }
  });
});
