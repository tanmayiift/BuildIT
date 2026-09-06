import type { RepositoryFile, RepositorySnapshot } from "./repository-content.js";

export type RepositorySnapshotChunk = {
  repositoryId: number;
  commitSha: string;
  chunkIndex: number;
  chunkCount: number;
  files: RepositoryFile[];
  omitted: RepositorySnapshot["omitted"];
  coverage: RepositorySnapshot["coverage"];
};

function bytes(value: unknown) { return Buffer.byteLength(JSON.stringify(value), "utf8"); }

// firstChunkBytes exists because the head revision shares its first artifact with the pull request
// context, so chunk zero has less room than the others. Applying that smaller budget to every chunk
// meant the whole revision was sized for the one artifact that carries a passenger, and a file that
// would fit anywhere else - an ordinary root lockfile, once those stopped being dropped as
// oversized - failed the whole review with snapshot_file_too_large. A file too big for chunk zero
// starts the next chunk instead.
export function chunkRepositorySnapshot(snapshot: RepositorySnapshot, maxChunkBytes = 3_800_000, maxChunks = 64, firstChunkBytes = maxChunkBytes) {
  if (!Number.isInteger(maxChunkBytes) || maxChunkBytes < 1_024 || !Number.isInteger(maxChunks) || maxChunks < 1) throw new Error("invalid_snapshot_chunk_limits");
  if (!Number.isInteger(firstChunkBytes) || firstChunkBytes < 1_024 || firstChunkBytes > maxChunkBytes) throw new Error("invalid_snapshot_chunk_limits");
  const budget = (chunkIndex: number) => (chunkIndex === 0 ? firstChunkBytes : maxChunkBytes) - 1_024;
  const groups: RepositoryFile[][] = [[]];
  for (const file of snapshot.files) {
    if (bytes(file) > maxChunkBytes - 1_024) throw new Error(`snapshot_file_too_large:${file.path}`);
    const current = groups.at(-1)!;
    if (bytes([...current, file]) > budget(groups.length - 1)) {
      if (groups.length >= maxChunks) throw new Error("snapshot_chunk_limit_exceeded");
      groups.push([file]);
    } else current.push(file);
  }
  const chunkCount = groups.length;
  return groups.map((files, chunkIndex): RepositorySnapshotChunk => {
    const chunk = { repositoryId: snapshot.repositoryId, commitSha: snapshot.commitSha, chunkIndex, chunkCount,
      files, omitted: chunkIndex === 0 ? snapshot.omitted : [], coverage: snapshot.coverage };
    if (bytes(chunk) > (chunkIndex === 0 ? firstChunkBytes : maxChunkBytes)) throw new Error("snapshot_chunk_size_exceeded");
    return chunk;
  });
}
