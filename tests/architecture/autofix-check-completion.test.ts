import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The acknowledgement posts "BuildIT / review" in_progress on the pull request head the moment a
// review starts, and only reviewPublicationWorker.publish ever completed it. The autofix branch of
// durableReview never calls publish - and publish would refuse it anyway, because it requires a
// status of checks_passed | changes_requested | inconclusive and autofix ends `delivered` or
// `failed_after_bounds`.
//
// So a *successful* autofix left that check spinning forever. Where it is a required status check,
// BuildIT was the reason the pull request could not merge. The safe-decline path does publish
// correctly, which is why this survived every test that ran autofix.
const worker = readFileSync(join(process.cwd(), "convex/reviewAutofixWorker.ts"), "utf8");

function completesHeadCheck(exportName: string) {
  const start = worker.indexOf(`export const ${exportName}`);
  expect(start, `${exportName} exists`).toBeGreaterThan(-1);
  const next = worker.indexOf("\nexport const ", start + 1);
  const body = worker.slice(start, next === -1 ? worker.length : next);
  return /upsertCheckRun\(\{\s*name:\s*"BuildIT \/ review",\s*headSha:\s*scope\.headSha/.test(body);
}

describe("autofix finishes the check it started", () => {
  // Both terminal paths, because either one left alone strands the check.
  it("completes BuildIT / review on the pull request head when it delivers", () => {
    expect(completesHeadCheck("deliverPassed"), "a delivered autofix must not leave the head check in_progress").toBe(true);
  });

  it("completes BuildIT / review on the pull request head when it stops at its bounds", () => {
    expect(completesHeadCheck("publishFailure"), "a comment explaining the stop is no use beside a check that still says BuildIT is working").toBe(true);
  });

  // The Autofix check is about the candidate commit and stays that way - it answers a different
  // question and must not be retargeted onto the head to satisfy the rule above.
  it("keeps the Autofix check on the candidate commit", () => {
    expect(worker).toMatch(/name:\s*"BuildIT \/ Autofix",\s*headSha:\s*passed\.candidateCommitSha/);
  });
});
