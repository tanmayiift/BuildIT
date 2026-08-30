import { describe, expect, it, vi } from "vitest";
import { RepositoryContentClient } from "../src/repository-content";

const sha = "a".repeat(40);
const blobSha = "b".repeat(40);
const treeSha = "d".repeat(40);
function commit(commitSha = sha) { return new Response(JSON.stringify({ sha: commitSha, tree: { sha: treeSha } }), { status: 200 }); }
function tree(entries: unknown[], extra = {}) { return new Response(JSON.stringify({ sha: treeSha, tree: entries, ...extra }), { status: 200 }); }
function blob(content: string) { return new Response(JSON.stringify({ encoding: "base64", content: Buffer.from(content).toString("base64") }), { status: 200 }); }

describe("exact repository content fetch", () => {
  it("fetches text blobs from the exact requested commit", async () => {
    const http = vi.fn(async (url: string | URL) => String(url).includes("/commits/") ? commit() : String(url).includes("/trees/") ? tree([{ path: "src/index.ts", type: "blob", sha: blobSha, size: 12 }]) : blob("export {}\n"));
    const result = await new RepositoryContentClient(http).fetchExactCommit({ installationToken: "token", repositoryId: 7, commitSha: sha });
    expect(result).toMatchObject({ repositoryId: 7, commitSha: sha, coverage: "full", files: [{ path: "src/index.ts", sha: blobSha, content: "export {}\n" }] });
    expect(http.mock.calls[0]![0]).toContain(`/commits/${sha}`);
    expect(http.mock.calls[1]![0]).toContain(`/trees/${treeSha}?recursive=1`);
  });

  it("fails closed when GitHub truncates or changes the requested tree", async () => {
    await expect(new RepositoryContentClient(vi.fn(async (url: string | URL) => String(url).includes("/commits/") ? commit() : tree([], { truncated: true }))).fetchExactCommit({ installationToken: "token", repositoryId: 7, commitSha: sha })).rejects.toThrow("github_tree_truncated");
    await expect(new RepositoryContentClient(vi.fn(async (url: string | URL) => String(url).includes("/commits/") ? commit() : new Response(JSON.stringify({ sha: "c".repeat(40), tree: [] })))).fetchExactCommit({ installationToken: "token", repositoryId: 7, commitSha: sha })).rejects.toThrow("github_tree_sha_mismatch");
    await expect(new RepositoryContentClient(vi.fn(async () => commit("c".repeat(40)))).fetchExactCommit({ installationToken: "token", repositoryId: 7, commitSha: sha })).rejects.toThrow("github_commit_sha_mismatch");
  });

  it("reports exclusions and budget omissions as partial coverage", async () => {
    const http = vi.fn(async (url: string | URL) => String(url).includes("/commits/") ? commit() : String(url).includes("/trees/") ? tree([
      { path: "node_modules/a.js", type: "blob", sha: blobSha, size: 1 },
      { path: "large.ts", type: "blob", sha: blobSha, size: 101 },
      { path: "src/a.ts", type: "blob", sha: blobSha, size: 10 },
      { path: "src/b.ts", type: "blob", sha: blobSha, size: 10 },
    ]) : blob("1234567890"));
    const result = await new RepositoryContentClient(http).fetchExactCommit({ installationToken: "token", repositoryId: 7, commitSha: sha, limits: { maxFiles: 1, maxFileBytes: 100, maxTotalBytes: 100 } });
    expect(result.coverage).toBe("partial");
    expect(result.omitted.map(item => item.reason)).toEqual(["excluded", "oversized", "budget"]);
    expect(result.files).toHaveLength(1);
  });

  it("rejects unsafe paths before fetching blobs", async () => {
    const http = vi.fn(async (url: string | URL) => String(url).includes("/commits/") ? commit() : tree([{ path: "../secret", type: "blob", sha: blobSha, size: 1 }]));
    await expect(new RepositoryContentClient(http).fetchExactCommit({ installationToken: "token", repositoryId: 7, commitSha: sha })).rejects.toThrow("github_tree_unsafe_path");
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("treats null-containing blobs as binary and never returns their content", async () => {
    const http = vi.fn(async (url: string | URL) => String(url).includes("/commits/") ? commit() : String(url).includes("/trees/") ? tree([{ path: "unknown.dat", type: "blob", sha: blobSha, size: 3 }]) : blob("a\0b"));
    const result = await new RepositoryContentClient(http).fetchExactCommit({ installationToken: "token", repositoryId: 7, commitSha: sha });
    expect(result.files).toEqual([]);
    expect(result.omitted).toEqual([{ path: "unknown.dat", reason: "binary" }]);
  });
});
