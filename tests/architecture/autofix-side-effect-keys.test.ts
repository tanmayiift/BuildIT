import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sideEffectKey } from "@buildit/github";

// Every Autofix side effect keyed on a constant "autofix" slot, so the key was identical for
// every review of the same pull request at the same head SHA. reviewState.reserveSideEffect
// throws idempotency_key_conflict when the stored row belongs to a different review, so a single
// failed Autofix attempt made that head SHA permanently un-retryable for the repository - the
// user's only recovery was to push a new commit.

const worker = readFileSync("convex/reviewAutofixWorker.ts", "utf8");
const publication = readFileSync("convex/reviewPublicationWorker.ts", "utf8");

describe("Autofix side-effect keys", () => {
  it("keys nothing on a constant slot", () => {
    expect(worker).not.toMatch(/:(?:branch|stacked_pr|check|comment):autofix`/);
    expect(worker.match(/slot: `autofix:\$\{scope\.reviewId\}`/g) ?? []).toHaveLength(5);
  });

  it("gives two reviews of the same commit distinct keys", () => {
    const base = { repositoryId: 42, prNumber: 7, headSha: "a".repeat(40), kind: "branch" as const };
    expect(sideEffectKey({ ...base, slot: "autofix:review-1" })).not.toBe(sideEffectKey({ ...base, slot: "autofix:review-2" }));
  });

  // The review publication slots on the bare review id, so the Autofix prefix is what keeps the
  // Autofix check and comment from colliding with the review's own check and comment.
  it("does not collide with the review's own check and comment", () => {
    expect(publication).toContain("const slot = String(scope.reviewId)");
    const base = { repositoryId: 42, prNumber: 7, headSha: "a".repeat(40) };
    for (const kind of ["check", "comment"] as const) {
      expect(sideEffectKey({ ...base, kind, slot: "review-1" })).not.toBe(sideEffectKey({ ...base, kind, slot: "autofix:review-1" }));
    }
  });

  // nextAutofix restated the round, attempt and spend bounds that assertAutofixBounds already
  // enforces before every round, and nothing called it. One statement of the rule, not two.
  it("bounds every Autofix round through the one enforced check", () => {
    expect(worker).toContain("assertAutofixBounds({");
    const orchestrator = readFileSync("packages/orchestrator/src/index.ts", "utf8");
    expect(orchestrator).not.toContain("export function nextAutofix");
    expect(orchestrator).not.toContain("export function deliveryAllowed");
  });
});
