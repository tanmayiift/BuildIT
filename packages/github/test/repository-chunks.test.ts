import { describe, expect, it } from "vitest";
import { chunkRepositorySnapshot } from "../src/repository-chunks";

const snapshot = { repositoryId: 10, commitSha: "a".repeat(40), omitted: [], fetchedBytes: 2_400,
  coverage: "full" as const, files: [0, 1, 2].map(index => ({ path: `src/${index}.ts`, sha: String(index).repeat(40), size: 800, content: "x".repeat(800) })) };

describe("repository snapshot chunks", () => {
  it("creates bounded ordered chunks with omissions in the manifest chunk only", () => {
    const chunks = chunkRepositorySnapshot({ ...snapshot, omitted: [{ path: "large.bin", reason: "binary" }] }, 3_000, 4);
    expect(chunks).toHaveLength(2);
    expect(chunks.flatMap(chunk => chunk.files).map(file => file.path)).toEqual(snapshot.files.map(file => file.path));
    expect(chunks.map(chunk => chunk.chunkIndex)).toEqual([0, 1]);
    expect(chunks.every(chunk => chunk.chunkCount === 2)).toBe(true);
    expect(chunks[0]!.omitted).toHaveLength(1);
    expect(chunks[1]!.omitted).toHaveLength(0);
    expect(chunks.every(chunk => Buffer.byteLength(JSON.stringify(chunk)) <= 3_000)).toBe(true);
  });

  // Only head's first chunk shares its artifact with the pull request context. Sizing every chunk
  // for that passenger meant a lockfile that fits any later chunk failed the whole review with
  // snapshot_file_too_large - a platform error in place of the drop it was meant to replace.
  it("moves a file the first chunk cannot hold into the next chunk", () => {
    const lockfile = { path: "package-lock.json", sha: "b".repeat(40), size: 2_000, content: "x".repeat(2_000) };
    const chunks = chunkRepositorySnapshot({ ...snapshot, files: [lockfile] }, 4_000, 4, 1_200);
    expect(chunks.flatMap(chunk => chunk.files).map(file => file.path)).toEqual(["package-lock.json"]);
    expect(Buffer.byteLength(JSON.stringify(chunks[0]))).toBeLessThanOrEqual(1_200);
    expect(chunks.every(chunk => chunk.chunkCount === chunks.length)).toBe(true);
  });

  it("fails rather than silently dropping a file or exceeding the chunk count", () => {
    expect(() => chunkRepositorySnapshot(snapshot, 1_024, 2)).toThrow(/snapshot_(?:file_too_large|chunk_limit_exceeded)/);
    expect(() => chunkRepositorySnapshot(snapshot, 0, 0)).toThrow("invalid_snapshot_chunk_limits");
  });
});
