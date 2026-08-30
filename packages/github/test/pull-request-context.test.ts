import { describe, expect, it, vi } from "vitest";
import { PullRequestContextClient } from "../src/pull-request-context";

const head = "a".repeat(40), base = "b".repeat(40), metadata = { title: "Fix limits", body: "Closes #12", html_url: "https://github.com/o/r/pull/1", head: { sha: head }, base: { sha: base } };
describe("pinned pull request context", () => {
  it("fetches changed patches only after exact base/head verification", async () => {
    const http = vi.fn(async (url: string | URL) => String(url).includes("/files?") ? Response.json([{ filename: "src/a.ts", status: "modified", additions: 2, deletions: 1, changes: 3, patch: "@@ change" }]) : Response.json(metadata));
    await expect(new PullRequestContextClient(http).fetch({ installationToken: "token", repositoryId: 1, prNumber: 1, expectedHeadSha: head, expectedBaseSha: base })).resolves.toMatchObject({ headSha: head, baseSha: base, coverage: "full", files: [{ path: "src/a.ts", patch: "@@ change" }] });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the PR moved to another commit", async () => {
    const http = vi.fn(async () => Response.json({ ...metadata, head: { sha: "c".repeat(40) } }));
    await expect(new PullRequestContextClient(http).fetch({ installationToken: "token", repositoryId: 1, prNumber: 1, expectedHeadSha: head, expectedBaseSha: base })).rejects.toThrow("pull_request_commit_mismatch");
  });

  it("reports missing and over-budget patches without hiding changed files", async () => {
    const http = vi.fn(async (url: string | URL) => String(url).includes("/files?") ? Response.json([{ filename: "src/a.ts", status: "modified", patch: "x".repeat(20) }, { filename: "src/b.ts", status: "added" }]) : Response.json(metadata));
    const result = await new PullRequestContextClient(http).fetch({ installationToken: "token", repositoryId: 1, prNumber: 1, expectedHeadSha: head, expectedBaseSha: base, maxPatchBytesPerFile: 10 });
    expect(result.files).toHaveLength(2);
    expect(result.omitted).toEqual([{ path: "src/a.ts", reason: "patch_too_large" }, { path: "src/b.ts", reason: "patch_unavailable" }]);
    expect(result.coverage).toBe("partial");
  });

  it("rejects unsafe paths and invalid limits", async () => {
    const http = vi.fn(async (url: string | URL) => String(url).includes("/files?") ? Response.json([{ filename: "../secret", status: "modified", patch: "x" }]) : Response.json(metadata));
    await expect(new PullRequestContextClient(http).fetch({ installationToken: "token", repositoryId: 1, prNumber: 1, expectedHeadSha: head, expectedBaseSha: base })).rejects.toThrow("github_pull_file_unsafe");
    await expect(new PullRequestContextClient(http).fetch({ installationToken: "token", repositoryId: 1, prNumber: 0, expectedHeadSha: head, expectedBaseSha: base })).rejects.toThrow("invalid_pull_request_context_limits");
  });
});
