import { describe, expect, it, vi, afterEach } from "vitest";
import { GitHubRepositoryWriter } from "../src/repository-writer.js";

// The summary comment on a review goes through safe() in @buildit/orchestrator - secrets redacted,
// markdown punctuation escaped, tags stripped, "@" neutralised. The inline comments on the same
// review had none of it, so one review wrote two different trust levels into the same pull request.
// The text is model output summarising repository content an outside contributor can influence, and
// it is posted by a verified GitHub App, so a markdown link in it is a usable phishing surface.
//
// The path is the one field that must stay literal, because GitHub matches it against the diff.
// These cases pin that it is validated rather than escaped, and refused rather than interpolated.
const headSha = "a".repeat(40);
const marker = "buildit-review:pr-7";

function writerWithCapture() {
  const posted: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/comments?per_page=100")) return new Response("[]", { status: 200 });
    if (href.includes("/reviews") && init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response("{}", { status: 201 });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { writer: new GitHubRepositoryWriter({ repositoryId: 1, installationToken: "token-for-test" }), posted };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("what an inline finding comment is allowed to carry", () => {
  it("refuses a path carrying traversal, a newline or markdown punctuation", async () => {
    const { writer, posted } = writerWithCapture();
    const hostile = ["../../etc/passwd", "src/a\nb.ts", "src/`whoami`.ts", "src/[x](https://evil.example).ts", "a".repeat(501)];
    const result = await writer.publishInlineFindings({
      prNumber: 7, headSha, marker,
      findings: hostile.map((path, index) => ({ id: `f${index}`, path, startLine: 1, endLine: 1,
        severity: "warning", title: "t", body: "b" })),
    });
    expect(result, "every hostile path must be skipped, not anchored").toEqual({ posted: 0, skipped: hostile.length });
    expect(posted, "no review may be created when every finding was refused").toEqual([]);
  });

  it("still anchors an ordinary path unchanged, because GitHub matches it against the diff", async () => {
    const { writer, posted } = writerWithCapture();
    const result = await writer.publishInlineFindings({
      prNumber: 7, headSha, marker,
      findings: [{ id: "f1", path: "src/lib/rates.ts", startLine: 4, endLine: 4, severity: "critical", title: "t", body: "b" }],
    });
    expect(result).toEqual({ posted: 1, skipped: 0 });
    const comments = (posted[0] as { comments: Array<{ path: string }> }).comments;
    expect(comments[0]?.path, "the path must not be escaped or rewritten").toBe("src/lib/rates.ts");
  });
});
