// Visual baselines must be Linux renders: CI runs on Ubuntu, and a macOS render differs by more than
// the tolerance on some pages (fbe1a86, df0d273). Regenerating them locally meant a Docker image and
// a full Linux install. CI already renders every page and, on failure, uploads what it rendered.
//
//   pnpm snapshots:from-ci <ci-run-id>
//
// downloads that run's browser-failure-evidence and copies each `<name>-actual.png` over the baseline
// Playwright compared it with. Review the images before committing: this accepts what CI drew.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const runId = process.argv[2];
if (!/^\d+$/.test(runId ?? "")) { console.error("usage: pnpm snapshots:from-ci <ci-run-id>"); process.exit(2); }
const work = mkdtempSync(join(tmpdir(), "buildit-snapshots-"));
try {
  execFileSync("gh", ["run", "download", runId, "-n", "browser-failure-evidence", "-D", work], { stdio: "inherit" });
  const walk = dir => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });
  const projects = ["desktop", "mobile", "onboarding"];
  let updated = 0;
  for (const actual of walk(work).filter(path => path.endsWith("-actual.png"))) {
    // test-results/<test>-<project>/<arg>-actual.png → tests/e2e/<spec>-snapshots/<arg>-<project>.png
    const folder = basename(dirname(actual)), project = projects.find(name => folder.endsWith(`-${name}`));
    const arg = basename(actual).replace(/-actual\.png$/, "");
    const target = ["tests/e2e/accessibility.spec.ts-snapshots", "tests/e2e/email-template.spec.ts-snapshots"]
      .map(dir => join(dir, `${arg}-${project}.png`)).find(path => existsSync(path));
    if (!project || !target) { console.warn(`no baseline for ${folder}/${basename(actual)}; skipped`); continue; }
    copyFileSync(actual, target);
    console.log(`updated ${target}`);
    updated++;
  }
  console.log(`${updated} baseline(s) replaced from run ${runId}. Inspect them, then commit.`);
} finally { rmSync(work, { recursive: true, force: true }); }
