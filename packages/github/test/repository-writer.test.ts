import { describe, expect, it, vi } from "vitest";
import { GitHubRepositoryWriter } from "../src/repository-writer";

const head = "a".repeat(40), treeSha = "b".repeat(40), blobSha = "c".repeat(40), candidate = "d".repeat(40);
describe("GitHub candidate writer", () => {
  it("creates a bounded candidate commit on the pinned parent", async () => {
    const bodies: unknown[] = [], http = vi.fn(async (url: string | URL, init?: RequestInit) => {
      bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      const path = String(url); const value = path.endsWith(`/git/commits/${head}`) ? { tree: { sha: treeSha } } : path.endsWith("/git/blobs") ? { sha: blobSha } : path.endsWith("/git/trees") ? { sha: treeSha } : { sha: candidate };
      return new Response(JSON.stringify(value), { status: path.endsWith(`/git/commits/${head}`) ? 200 : 201 });
    });
    const writer = new GitHubRepositoryWriter({ repositoryId: 7, installationToken: "token", http });
    await expect(writer.createCandidateCommit({ pinnedHead: head, currentHead: head, message: "Fix regression", patches: [{ path: "src/tax.js", content: "fixed" }] })).resolves.toBe(candidate);
    expect(bodies.at(-1)).toEqual({ message: "Fix regression", tree: treeSha, parents: [head] });
  });
  it("refuses stale heads and unsafe or oversized patches before GitHub writes", async () => {
    const http = vi.fn(), writer = new GitHubRepositoryWriter({ repositoryId: 7, installationToken: "token", http });
    await expect(writer.createCandidateCommit({ pinnedHead: head, currentHead: candidate, message: "Fix", patches: [{ path: "a", content: "x" }] })).rejects.toThrow("stale_head");
    await expect(writer.createCandidateCommit({ pinnedHead: head, currentHead: head, message: "Fix", patches: [{ path: "../escape", content: "x" }] })).rejects.toThrow("candidate_path_invalid");
    expect(http).not.toHaveBeenCalled();
  });
  it("creates only a branch and pull request delivery", async () => {
    const http = vi.fn(async (url: string | URL) => new Response(JSON.stringify(String(url).endsWith("/pulls") ? { number: 4, html_url: "https://github.test/pr/4" } : {}), { status: 201 }));
    const writer = new GitHubRepositoryWriter({ repositoryId: 7, installationToken: "token", http });
    await writer.createBranch({ name: "buildit/pr-2/proof", sha: candidate });
    await expect(writer.createPullRequest({ head: "buildit/pr-2/proof", base: "feature", title: "Fix", body: "Human merge required" })).resolves.toEqual({ number: 4, url: "https://github.test/pr/4" });
    expect(http).toHaveBeenCalledTimes(2);
  });
});
