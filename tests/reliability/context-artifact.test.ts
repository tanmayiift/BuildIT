import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { chunkRepositorySnapshot } from "../../packages/github/src/repository-chunks";
import { decodeContextArtifact, encodeContextArtifact } from "../../packages/runner/src/contextArtifact";

// A chunk the way the context worker builds one: real source, through the real chunker.
function realChunk() {
  const dir = join(__dirname, "../../packages/github/src");
  const files = readdirSync(dir).filter(name => name.endsWith(".ts")).map(name => {
    const content = readFileSync(join(dir, name), "utf8");
    return { path: `packages/github/src/${name}`, sha: "a".repeat(40), size: Buffer.byteLength(content), content };
  });
  const [chunk] = chunkRepositorySnapshot({ repositoryId: 7, commitSha: "b".repeat(40), files, omitted: [], fetchedBytes: files.reduce((sum, file) => sum + file.size, 0), coverage: "full" });
  return { version: 1, revision: "head", snapshot: chunk };
}

describe("context artifacts", () => {
  it("round-trip, at a fraction of the bytes the upload used to cost", () => {
    const value = realChunk(), plain = Buffer.from(JSON.stringify(value)), stored = encodeContextArtifact(value);
    expect(decodeContextArtifact(stored)).toEqual(value);
    expect(stored.byteLength / plain.byteLength).toBeLessThan(0.35);
  });

  it("still read the plain JSON chunks stored before the change", () => {
    const value = realChunk();
    expect(decodeContextArtifact(Buffer.from(JSON.stringify(value)))).toEqual(value);
  });

  it("refuse to inflate past the ceiling rather than exhaust the function's memory", () => {
    expect(() => decodeContextArtifact(gzipSync(Buffer.alloc(20_000_000, 0x20)))).toThrow();
  });
});
