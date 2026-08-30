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

export function chunkRepositorySnapshot(snapshot: RepositorySnapshot, maxChunkBytes = 3_800_000, maxChunks = 64) {
  if (!Number.isInteger(maxChunkBytes) || maxChunkBytes < 1_024 || !Number.isInteger(maxChunks) || maxChunks < 1) throw new Error("invalid_snapshot_chunk_limits");
  const groups: RepositoryFile[][] = [[]];
  for (const file of snapshot.files) {
    if (bytes(file) > maxChunkBytes - 1_024) throw new Error(`snapshot_file_too_large:${file.path}`);
    const current = groups.at(-1)!;
    if (current.length && bytes([...current, file]) > maxChunkBytes - 1_024) {
      if (groups.length >= maxChunks) throw new Error("snapshot_chunk_limit_exceeded");
      groups.push([file]);
    } else current.push(file);
  }
  const chunkCount = groups.length;
  return groups.map((files, chunkIndex): RepositorySnapshotChunk => {
    const chunk = { repositoryId: snapshot.repositoryId, commitSha: snapshot.commitSha, chunkIndex, chunkCount,
      files, omitted: chunkIndex === 0 ? snapshot.omitted : [], coverage: snapshot.coverage };
    if (bytes(chunk) > maxChunkBytes) throw new Error("snapshot_chunk_size_exceeded");
    return chunk;
  });
}
