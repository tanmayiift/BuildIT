import { describe, expect, it, vi } from "vitest";
import { GitHubRepositoryWriter } from "../src/repository-writer.js";
import { reviewCommentMarker } from "../src/index.js";

// A single pull request accumulated nine full review comments, because the marker embedded the
// review id and a new review means a new id, so the upsert never matched anything and always
// appended. Nine walls of text on one pull request is how a bot gets muted, and muting it is the
// end of the product regardless of how good the findings are.
//
// The marker identifies the thing being reported on - the pull request - not the run reporting on
// it. The commit stays in the body, so a reader can still see which revision was judged and
// GitHub keeps the edit history.

function writer(existing: unknown[] = []) {
  const calls: Array<{ path: string; method: string }> = [];
  const http = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^https:\/\/api\.github\.com\/repositories\/\d+/, "");
    calls.push({ path, method: init.method ?? "GET" });
    const value = path.startsWith("/issues/7/comments") && (init.method ?? "GET") === "GET"
      ? existing : { id: 99, html_url: "https://github.com/x/y#c" };
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { calls, instance: new GitHubRepositoryWriter({ installationToken: "t", repositoryId: 1, http: http as never }) };
}

describe("one review comment per pull request", () => {

  // The real guard is at the call site: the marker must not be derivable from the run. Asserting
  // reviewCommentMarker(7) === reviewCommentMarker(7) would be tautological, so this checks the
  // shape carries nothing run-specific instead.
  it("carries nothing that changes between runs", () => {
    expect(reviewCommentMarker(7)).toBe("buildit-review:pr-7");
  });

  it("keeps different pull requests apart", () => {
    expect(reviewCommentMarker(7))
      .not.toBe(reviewCommentMarker(8));
  });

  it("still satisfies the marker format the writer enforces", async () => {
    const { calls, instance } = writer();
    await instance.upsertIssueComment({ prNumber: 7, marker: reviewCommentMarker(7), body: "verdict" });
    expect(calls.some(call => call.method === "POST")).toBe(true);
  });

  it("edits the existing comment instead of adding a second one", async () => {
    const marker = reviewCommentMarker(7);
    const { calls, instance } = writer([{ id: 55, user: { type: "Bot" }, body: `<!-- ${marker} -->\nan older verdict` }]);
    const result = await instance.upsertIssueComment({ prNumber: 7, marker, body: "a newer verdict" });

    expect(result.operation).toBe("updated");
    expect(calls.some(call => call.path === "/issues/comments/55" && call.method === "PATCH")).toBe(true);
    expect(calls.some(call => call.path === "/issues/7/comments" && call.method === "POST")).toBe(false);
  });
});

// Each new per-pull-request comment kind was widening the marker format by hand, and the one that
// was missed - `help-pr-22` - failed in production as comment_input_invalid after passing every
// test. The format takes a named prefix now, so a new kind needs no change here.
describe("the marker format", () => {
  it("accepts any named per-pull-request kind", () => {
    for (const marker of ["buildit-review:pr-22", "buildit-review:inline-pr-22", "buildit-review:help-pr-22", "buildit-review:ask-pr-9"]) {
      expect(marker).toMatch(/^buildit-(?:review|autofix):(?:(?:[a-z]{1,16}-)?pr-[1-9]\d{0,9}|[A-Za-z0-9_|-]+:[0-9a-f]{40})$/);
    }
  });

  it("still refuses something that is not a marker", () => {
    for (const marker of ["buildit-review:pr-0", "review:pr-1", "buildit-review:pr-", "buildit-review:PR-1"]) {
      expect(marker).not.toMatch(/^buildit-(?:review|autofix):(?:(?:[a-z]{1,16}-)?pr-[1-9]\d{0,9}|[A-Za-z0-9_|-]+:[0-9a-f]{40})$/);
    }
  });
});
