export type BenchmarkSource = {
  benchmark: "AACR-Bench" | "SWE-bench Verified";
  version: string;
  license: "Apache-2.0" | "MIT";
  datasetSha256: string;
};
export type ReviewTask = { id: string; repository: string; baseSha: string; headSha: string; cloneUrl: string };
export type ReviewGold = { comments: Array<{ path: string; startLine: number; endLine: number; side: "left" | "right"; text: string }> };
export type AutofixTask = { id: string; repository: string; baseSha: string; problem: string; failToPass: string[]; passToPass: string[] };
export type AutofixGold = { patch: string; testPatch: string };

const object = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
};
const text = (value: unknown, code: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value;
};
const sha = (value: unknown, code: string) => {
  const result = text(value, code);
  if (!/^[0-9a-f]{40}$/.test(result)) throw new Error(code);
  return result;
};
const repository = (value: unknown) => {
  const result = text(value, "benchmark_repository_invalid");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(result)) throw new Error("benchmark_repository_invalid");
  return result;
};
const source = (value: BenchmarkSource, benchmark: BenchmarkSource["benchmark"], license: BenchmarkSource["license"]) => {
  if (value.benchmark !== benchmark || value.license !== license || !value.version.trim() || !/^[0-9a-f]{64}$/.test(value.datasetSha256)) throw new Error("benchmark_source_invalid");
  return Object.freeze({ ...value });
};
const tests = (value: unknown, code: string): string[] => {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new Error(code); }
  }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string" || !item.trim())) throw new Error(code);
  return [...parsed];
};

export function adaptAacrReview(value: unknown, provenance: BenchmarkSource) {
  const row = object(value, "aacr_row_invalid"), repo = repository(row.repo), baseSha = sha(row.base_commit, "aacr_base_invalid"), headSha = sha(row.head_commit, "aacr_head_invalid");
  if (baseSha === headSha) throw new Error("aacr_commit_range_invalid");
  const cloneUrl = row.clone_url === undefined ? `https://github.com/${repo}.git` : text(row.clone_url, "aacr_clone_url_invalid");
  if (cloneUrl !== `https://github.com/${repo}.git`) throw new Error("aacr_clone_url_invalid");
  if (!Array.isArray(row.reference_comments) || row.reference_comments.length === 0) throw new Error("aacr_gold_invalid");
  const comments = row.reference_comments.map(value => {
    const item = object(value, "aacr_comment_invalid"), startLine = item.start_line, endLine = item.end_line;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || Number(startLine) < 1 || Number(endLine) < Number(startLine) || !["left", "right"].includes(String(item.side))) throw new Error("aacr_comment_invalid");
    return { path: text(item.path, "aacr_comment_invalid"), startLine: Number(startLine), endLine: Number(endLine), side: item.side as "left" | "right", text: text(item.text, "aacr_comment_invalid") };
  });
  return { source: source(provenance, "AACR-Bench", "Apache-2.0"), task: Object.freeze({ id: text(row.instance_id, "aacr_id_invalid"), repository: repo, baseSha, headSha, cloneUrl }), gold: Object.freeze({ comments }) };
}

export function adaptSweBenchAutofix(value: unknown, provenance: BenchmarkSource) {
  const row = object(value, "swe_row_invalid"), repo = repository(row.repo);
  return {
    source: source(provenance, "SWE-bench Verified", "MIT"),
    task: Object.freeze({ id: text(row.instance_id, "swe_id_invalid"), repository: repo, baseSha: sha(row.base_commit, "swe_base_invalid"), problem: text(row.problem_statement, "swe_problem_invalid"), failToPass: tests(row.FAIL_TO_PASS, "swe_fail_to_pass_invalid"), passToPass: tests(row.PASS_TO_PASS, "swe_pass_to_pass_invalid") }),
    gold: Object.freeze({ patch: text(row.patch, "swe_patch_invalid"), testPatch: text(row.test_patch, "swe_test_patch_invalid") }),
  };
}

export function blindTask<T extends { task: unknown }>(adapted: T) { return adapted.task; }
