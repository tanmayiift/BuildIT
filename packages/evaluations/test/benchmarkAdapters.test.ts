import { describe, expect, it } from "vitest";
import { adaptAacrReview, adaptSweBenchAutofix, blindTask } from "../src/benchmarkAdapters.js";

const aacrSource = { benchmark: "AACR-Bench" as const, version: "frozen-2026-08-30", license: "Apache-2.0" as const, datasetSha256: "a".repeat(64) };
const sweSource = { benchmark: "SWE-bench Verified" as const, version: "frozen-2026-08-30", license: "MIT" as const, datasetSha256: "b".repeat(64) };
const aacr = { change_line_count: 7, project_main_language: "TypeScript", source_commit: "a".repeat(40), target_commit: "b".repeat(40), githubPrUrl: "https://github.com/acme/service/pull/7", comments: [{ is_ai_comment: false, note: "Equality bypasses the stated limit.", path: "src/limit.ts", side: "right", source_model: "", from_line: 6, to_line: 4, category: "Code Defect", context: "Diff Level" }] };
const swe = { instance_id: "acme__service-7", repo: "acme/service", base_commit: "a".repeat(40), problem_statement: "Reject equality at the daily limit.", patch: "diff --git a/limit.py b/limit.py", test_patch: "diff --git a/test.py b/test.py", FAIL_TO_PASS: '["test_limit_equal"]', PASS_TO_PASS: ["test_limit_below"] };

describe("official benchmark contract adapters", () => {
  it("separates AACR task context from hidden review gold", () => {
    const adapted = adaptAacrReview(aacr, aacrSource);
    expect(adapted.task).toMatchObject({ repository: "acme/service", baseSha: "a".repeat(40), headSha: "b".repeat(40) });
    expect(adapted.gold.comments[0]).toMatchObject({ text: "Equality bypasses the stated limit.", startLine: 4, endLine: 6 });
    expect(JSON.stringify(blindTask(adapted))).not.toContain("Equality bypasses");
  });
  it("separates SWE issue and tests from hidden solution patches", () => {
    const adapted = adaptSweBenchAutofix(swe, sweSource);
    expect(adapted.task.failToPass).toEqual(["test_limit_equal"]);
    expect(adapted.gold.patch).toContain("diff --git");
    expect(JSON.stringify(blindTask(adapted))).not.toContain("diff --git");
  });
  it("fails closed on stale ranges, repository mismatch, or unpinned provenance", () => {
    expect(() => adaptAacrReview({ ...aacr, target_commit: "a".repeat(40) }, aacrSource)).toThrow("aacr_commit_range_invalid");
    expect(() => adaptAacrReview({ ...aacr, githubPrUrl: "https://example.com/other/repo/7" }, aacrSource)).toThrow("aacr_pr_url_invalid");
    expect(() => adaptSweBenchAutofix(swe, { ...sweSource, datasetSha256: "latest" })).toThrow("benchmark_source_invalid");
  });
  it("accepts both official SWE test-list encodings and rejects malformed labels", () => {
    expect(adaptSweBenchAutofix(swe, sweSource).task.passToPass).toEqual(["test_limit_below"]);
    expect(() => adaptSweBenchAutofix({ ...swe, FAIL_TO_PASS: "not json" }, sweSource)).toThrow("swe_fail_to_pass_invalid");
    expect(() => adaptAacrReview({ ...aacr, comments: [] }, aacrSource)).toThrow("aacr_gold_invalid");
  });
});
