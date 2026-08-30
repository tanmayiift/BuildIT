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
    expectFreshFenceBefore("fetch(`${brokerUrl}/api/model`");
    expectFreshFenceBefore("writer.createCandidateCommit(");
    expectFreshFenceBefore("fetch(`${brokerUrl}/api/execute`");
  });

  it("rechecks the active generation before every GitHub publication", () => {
    expectFreshFenceBefore("writer.upsertBranch(");
    expectFreshFenceBefore("writer.upsertStackedPullRequest(");
    expectFreshFenceBefore("writer.upsertCheckRun(");
    expectFreshFenceBefore("writer.upsertIssueComment(", 1);
    expectFreshFenceBefore("writer.upsertIssueComment(", 2);
  });

  it("cleans an exact candidate branch only before a stacked PR exists", () => {
    expect(source).toContain("if (branchReady && !stackedEstablished)");
    expect(source).toContain("await writer.deleteBranchIfExact({");
    expect(source).toContain('throw new Error("autofix_branch_cleanup_failed"');
  });
});

describe("normal review cancellation boundary", () => {
  it("fences costly and write-capable external stages", () => {
    expectReviewFence("convex/reviewContextWorker.ts", "github.tokenFor(");
    expectReviewFence("convex/reviewContextWorker.ts", "Promise.all([");
    expectReviewFence("convex/reviewContextWorker.ts", "fetch(`${brokerUrl}/api/artifacts`");
    expectReviewFence("convex/reviewValidationWorker.ts", "fetch(`${brokerUrl}/api/execute`");
    expectReviewFence("convex/reviewValidationWorker.ts", "method: \"PUT\"");
    expectReviewFence("convex/reviewAnalysisWorker.ts", "fetch(`${brokerUrl}/api/model`");
    expectReviewFence("convex/reviewAnalysisWorker.ts", "method: \"PUT\"");
    expectReviewFence("convex/reviewReportWorker.ts", "method: \"PUT\"");
  });
});
