import { describe, expect, it, vi } from "vitest";
import { GitHubRepositoryWriter } from "../src/repository-writer.js";

// BuildIT's headline promise is that every finding names the file, the line and the commit it was
// checked against - and until now it never put the finding on that line. Everything went into one
// issue comment, so a reviewer read a verdict in one place and hunted for the code in another.
// Every competitor anchors findings inline; BuildIT already has path, startLine, endLine and the
// pinned commit on every finding, so this is delivery, not new analysis.
//
// Two rules keep it honest. A finding only reaches a line if its evidence verified - the same gate
// that decides what may block - and it is anchored to the commit the review pinned, never to
// whatever HEAD happens to be now. An inline comment on the wrong line is worse than none.

const sha = "a".repeat(40);

function writer(responses: Record<string, unknown> = {}) {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const http = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^https:\/\/api\.github\.com\/repositories\/\d+/, "");
    calls.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(responses).find(candidate => path.startsWith(candidate));
    const value = key ? responses[key] : { id: 1, html_url: "https://github.com/x/y#c" };
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { calls, instance: new GitHubRepositoryWriter({ installationToken: "t", repositoryId: 7, http: http as never }) };
}

const finding = (over: Record<string, unknown> = {}) => ({
  id: "f1", path: "src/rates.js", startLine: 4, endLine: 4, severity: "critical",
  title: "Rate lookup returns undefined", body: "The cited line returns before the guard.", ...over,
});

describe("publishing findings on the lines they cite", () => {
  it("anchors each finding to its path and the commit the review pinned", async () => {
    const { calls, instance } = writer();
    await instance.publishInlineFindings({ prNumber: 1, headSha: sha, marker: `buildit-review:inline:${sha}`, findings: [finding()] });

    const review = calls.find(call => call.path.startsWith("/pulls/1/reviews") && call.method === "POST");
    expect(review).toBeDefined();
    const payload = review!.body as { commit_id: string; event: string; comments: Array<Record<string, unknown>> };
    expect(payload.commit_id).toBe(sha);
    // Never REQUEST_CHANGES: the check run carries the verdict, and BuildIT does not block a merge
    // through the review API.
    expect(payload.event).toBe("COMMENT");
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0]).toMatchObject({ path: "src/rates.js", line: 4, side: "RIGHT" });
  });

  it("uses a line range when the finding spans more than one line", async () => {
    const { calls, instance } = writer();
    await instance.publishInlineFindings({ prNumber: 1, headSha: sha, marker: `buildit-review:inline:${sha}`,
      findings: [finding({ startLine: 10, endLine: 14 })] });

    const payload = calls.find(call => call.method === "POST")!.body as { comments: Array<Record<string, unknown>> };
    expect(payload.comments[0]).toMatchObject({ start_line: 10, line: 14 });
  });

  it("carries the marker so a re-review can find its own comments", async () => {
    const { calls, instance } = writer();
    await instance.publishInlineFindings({ prNumber: 1, headSha: sha, marker: `buildit-review:inline:${sha}`, findings: [finding()] });

    const payload = calls.find(call => call.method === "POST")!.body as { comments: Array<{ body: string }> };
    expect(payload.comments[0]!.body).toContain(`<!-- buildit-review:inline:${sha}:f1 -->`);
  });

  it("does not open a review at all when nothing survived the gate", async () => {
    const { calls, instance } = writer();
    const result = await instance.publishInlineFindings({ prNumber: 1, headSha: sha, marker: `buildit-review:inline:${sha}`, findings: [] });

    expect(calls.some(call => call.method === "POST")).toBe(false);
    expect(result).toEqual({ posted: 0, skipped: 0 });
  });

  it("skips a finding with no line to anchor to rather than guessing one", async () => {
    const { calls, instance } = writer();
    const result = await instance.publishInlineFindings({ prNumber: 1, headSha: sha, marker: `buildit-review:inline:${sha}`,
      findings: [finding({ startLine: 0, endLine: 0 }), finding({ id: "f2" })] });

    const payload = calls.find(call => call.method === "POST")!.body as { comments: unknown[] };
    expect(payload.comments).toHaveLength(1);
    expect(result).toEqual({ posted: 1, skipped: 1 });
  });

  it("refuses a commit that is not the pinned head", async () => {
    const { instance } = writer();
    await expect(instance.publishInlineFindings({ prNumber: 1, headSha: "nope", marker: `buildit-review:inline:${sha}`, findings: [finding()] }))
      .rejects.toThrow("inline_findings_input_invalid");
  });

  // A second review of the same commit must not stack a duplicate on every line.
  it("removes its own previous comments for this commit before posting again", async () => {
    const { calls, instance } = writer({
      "/pulls/1/comments": [
        { id: 55, user: { type: "Bot" }, body: `<!-- buildit-review:inline:${sha}:f1 -->\nold text` },
        { id: 56, user: { type: "User" }, body: "a person's comment" },
      ],
    });
    await instance.publishInlineFindings({ prNumber: 1, headSha: sha, marker: `buildit-review:inline:${sha}`, findings: [finding()] });

    expect(calls.some(call => call.path === "/pulls/comments/55" && call.method === "DELETE")).toBe(true);
    // A human's comment is never touched.
    expect(calls.some(call => call.path === "/pulls/comments/56")).toBe(false);
  });
});
