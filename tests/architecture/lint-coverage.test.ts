import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `pnpm lint` was `pnpm -r lint`, and every package's "lint" was `tsc --noEmit` - the same command
// as its "typecheck". So `pnpm verify` ran the compiler twice and linted nothing, and convex/,
// tests/ and scripts/ were invisible to it entirely because they are not pnpm workspaces. That
// is every Autofix, retention and tenancy path in the product.

const root = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

function lintedFiles() {
  const out = execFileSync("node", ["node_modules/eslint/bin/eslint.js", ".", "-f", "json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return new Set((JSON.parse(out) as Array<{ filePath: string }>).map(entry => entry.filePath));
}

describe("lint coverage", () => {
  it("runs a linter, not the compiler a second time", () => {
    expect(root.scripts.lint).toBe("eslint .");
    expect(root.scripts.verify).toContain("pnpm lint");
    expect(root.scripts.typecheck).toContain("typecheck:convex");
  });

  const linted = lintedFiles();
  const covers = (suffix: string) => [...linted].some(path => path.endsWith(suffix));

  // The directories that belong to no pnpm workspace, and so were never linted.
  it("covers convex, tests and scripts", () => {
    expect(covers("convex/reviewAutofixWorker.ts")).toBe(true);
    expect(covers("convex/artifactCleanupData.ts")).toBe(true);
    expect(covers("tests/architecture/lint-coverage.test.ts")).toBe(true);
    expect(covers("scripts/deploy-buildit-web.mjs")).toBe(true);
  });

  it("still covers every workspace package and the web app", () => {
    expect(covers("packages/orchestrator/src/promptChain.ts")).toBe(true);
    expect(covers("packages/broker/src/artifacts.ts")).toBe(true);
    expect(covers("apps/web/src/instrumentation.ts")).toBe(true);
  });

  // 1.8 GB of gitignored working trees produced 8,172 findings on the first run and buried the
  // 21 real ones.
  it("does not lint gitignored working trees or build output", () => {
    expect([...linted].some(path => path.includes("/.local/") || path.includes("/.next/") || path.includes("/dist/"))).toBe(false);
  });
});
