import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("convex/reviewAutofixWorker.ts", "utf8");

function expectReviewFence(file: string, marker: string) {
  const worker = readFileSync(file, "utf8");
  const markerIndex = worker.indexOf(marker);
  expect(markerIndex, `${file}: ${marker}`).toBeGreaterThan(-1);
  const fenceIndex = worker.lastIndexOf(
    "ctx.runQuery(internal.durableReview.assertActive, args)",
    markerIndex,
  );
  expect(fenceIndex, `${file}: ${marker} has a fence`).toBeGreaterThan(-1);
  expect(markerIndex - fenceIndex, `${file}: ${marker} uses a fresh fence`).toBeLessThan(
    350,
  );
}


// The `/api/execute` fetch moved into the shared segment driver, so the fence that guards it moved
// with it. Checking the driver alone would not be enough - it calls an injected `assertActive`, and
// an injected callback can be a no-op - so this asserts both halves: the loop fences every segment,
// and each caller passes a real liveness query rather than something that always resolves.
function expectSegmentDriverFence() {
  const driver = readFileSync("convex/lib/executionSegmentDriver.ts", "utf8");
  const markerIndex = driver.indexOf("doFetch(`${input.brokerUrl}/api/execute`");
  expect(markerIndex, "driver: /api/execute").toBeGreaterThan(-1);
  const fenceIndex = driver.lastIndexOf("await input.assertActive();", markerIndex);
  expect(fenceIndex, "driver: /api/execute has a fence").toBeGreaterThan(-1);
  expect(markerIndex - fenceIndex, "driver: /api/execute uses a fresh fence").toBeLessThan(350);
}

function expectCallerPassesRealFence(file: string, query: string) {
  const caller = readFileSync(file, "utf8");
  const callIndex = caller.indexOf("driveExecutionSegments({");
  expect(callIndex, `${file}: drives segments`).toBeGreaterThan(-1);
  const fence = caller.indexOf("assertActive: async () => { await ctx.runQuery(" + query, callIndex);
  expect(fence, `${file}: passes a real assertActive`).toBeGreaterThan(-1);
}

function expectFreshFenceBefore(marker: string, occurrence = 1) {
  let markerIndex = -1;
  for (let index = 0; index < occurrence; index += 1) {
    markerIndex = source.indexOf(marker, markerIndex + 1);
  }
  expect(markerIndex, `${marker} occurrence ${occurrence}`).toBeGreaterThan(-1);
  const fenceIndex = source.lastIndexOf("await assertActive(ctx, args);", markerIndex);
  expect(fenceIndex, `${marker} occurrence ${occurrence} has a fence`).toBeGreaterThan(-1);
  expect(markerIndex - fenceIndex, `${marker} occurrence ${occurrence} uses a fresh fence`).toBeLessThan(300);
}

describe("Autofix cancellation boundary", () => {
  it("rechecks the active generation before expensive external work", () => {
    expectFreshFenceBefore("invokeAccountedModel(ctx");
    expectFreshFenceBefore("writer.createCandidateCommit(");
    expectSegmentDriverFence();
    expectCallerPassesRealFence("convex/reviewAutofixWorker.ts", "internal.reviewAutofixData.assertActive");
  });

  it("rechecks the active generation before every GitHub publication", () => {
    expectFreshFenceBefore("writer.upsertBranch(");
    expectFreshFenceBefore("writer.upsertStackedPullRequest(");
    expectFreshFenceBefore("writer.upsertCheckRun(");
    expectFreshFenceBefore("writer.upsertIssueComment(", 1);
    expectFreshFenceBefore("writer.upsertIssueComment(", 2);
  });

  it("cleans an exact candidate branch only before a stacked PR exists", () => {
    expect(source).toContain("stackedAttempted = true;");
    expect(source.indexOf("stackedAttempted = true;")).toBeLessThan(source.indexOf("writer.upsertStackedPullRequest("));
    expect(source).toContain("if (branchReady && !stackedAttempted)");
    expect(source).toContain("await writer.deleteBranchIfExact({");
    expect(source).toContain('throw new Error("autofix_branch_cleanup_failed"');
  });
});

describe("normal review cancellation boundary", () => {
  it("finishes cancellation even when the workflow already stopped", () => {
    const durableReview = readFileSync("convex/durableReview.ts", "utf8");
    expect(durableReview).toMatch(/try\s*{\s*await reviewWorkflowManager\.cancel/);
    expect(durableReview).toMatch(/catch\s*{[\s\S]*?executionGeneration: review\.executionGeneration \+ 1/);
    expect(durableReview).toContain('status: "cancelled"');
  });

  it("fences costly and write-capable external stages", () => {
    expectReviewFence("convex/reviewContextWorker.ts", "github.tokenFor(");
    expectReviewFence("convex/reviewContextWorker.ts", "Promise.all([");
    expectReviewFence("convex/reviewContextWorker.ts", "fetch(`${brokerUrl}/api/artifacts`");
    expectCallerPassesRealFence("convex/reviewValidationWorker.ts", "internal.durableReview.assertActive");
    expectReviewFence("convex/reviewValidationWorker.ts", "method: \"PUT\"");
    expectReviewFence("convex/reviewAnalysisWorker.ts", "invokeAccountedModel(ctx");
    expectReviewFence("convex/reviewAnalysisWorker.ts", "method: \"PUT\"");
    expectReviewFence("convex/reviewReportWorker.ts", "method: \"PUT\"");
  });
});
