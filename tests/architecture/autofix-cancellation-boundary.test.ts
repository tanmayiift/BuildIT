import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("convex/reviewAutofixWorker.ts", "utf8");

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
});
