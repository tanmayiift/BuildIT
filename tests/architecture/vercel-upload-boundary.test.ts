import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// The installed Vercel CLI's getUserIgnore/getVercelIgnore use the `ignore` package, not
// substring checks or shell globs. Reuse the locked copy already installed with ESLint.
// These rules are tested without .gitignore or Vercel's defaults, so exclusions cannot
// accidentally rely on another layer when this upload configuration is present.
const require = createRequire(import.meta.resolve("eslint"));
const createIgnore = require("ignore") as () => { add(patterns: string): { ignores(path: string): boolean } };
function uploadSelection(paths: readonly string[]) {
  const rules = readFileSync(".vercelignore", "utf8").replace(/(\n|^)\.\//g, "$1");
  const ignored = createIgnore().add(rules);
  return paths.filter(path => !ignored.ignores(path));
}

const privateOrGenerated = [
  ".local/email-captures/message.json", ".local/convex/config.json",
  ".env.local", ".env.production", ".env.local.backup",
  "apps/web/.env.local", "apps/web/.env.local.bak-1788337846", "packages/broker/.env.production",
  ".vercel/project.json", "packages/broker/.vercel/project.json",
  "audit/evidence/connected-e2e-readiness.json", "audit/evidence/buildit-kms-candidate.json", "audit/screenshots/usage.png",
  "build.log", "apps/web/deploy.log", "packages/runner/diagnostics/private.log",
  "coverage/coverage-final.json", "packages/providers/coverage/lcov.info", "apps/web/coverage/index.html",
  "playwright-report/index.html", "apps/web/playwright-report/data/trace.zip",
  "test-results/review/trace.zip", "apps/web/test-results/auth/storage-state.json",
  ".pnpm-store/v10/files/cache", ".claude/launch.json", ".claude/skills/prompt-master/SKILL.md",
] as const;

const requiredBuildInputs = [
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".env.example",
  "apps/web/package.json", "apps/web/next.config.ts", "apps/web/src/app/page.tsx",
  "packages/broker/package.json", "packages/broker/vercel.json", "packages/broker/api/model.ts",
  "packages/providers/src/index.ts", "packages/runner/src/vercelSandbox.ts", "packages/contracts/src/review.ts",
  "convex/schema.ts", "convex/_generated/api.d.ts", "scripts/buildit-production.env",
  "scripts/deploy-buildit-production.mjs", "scripts/lib/convex-production-target.mjs",
] as const;

describe("Vercel upload file selection", () => {
  it.each(privateOrGenerated)("excludes %s using directory and wildcard ignore semantics", path => {
    expect(uploadSelection([path])).toEqual([]);
  });

  it("retains the complete representative build tree and the nonsecret production target", () => {
    const selected = uploadSelection([...privateOrGenerated, ...requiredBuildInputs]);
    expect(selected).toEqual(requiredBuildInputs);
    expect(readFileSync("scripts/buildit-production.env", "utf8")).toMatch(/^CONVEX_DEPLOYMENT=prod:judicious-barracuda-968$/m);
  });

  it("does not turn output patterns into broad substrings that drop source modules", () => {
    const source = ["convex/lib/audit.ts", "convex/lib/coverageGate.ts", "packages/telemetry/src/logger.ts", "apps/web/src/app/audit-view.tsx"];
    expect(uploadSelection(source)).toEqual(source);
  });
});
