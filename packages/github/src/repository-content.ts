type GitHubHttp = (input: string | URL, init?: RequestInit) => Promise<Response>;

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "BuildIT",
};

export type RepositoryFile = { path: string; sha: string; size: number; content: string };
export type RepositoryOmission = { path: string; reason: "excluded" | "oversized" | "budget" | "binary" };
export type RepositorySnapshot = {
  repositoryId: number;
  commitSha: string;
  files: RepositoryFile[];
  omitted: RepositoryOmission[];
  fetchedBytes: number;
  coverage: "full" | "partial";
};

export type RepositoryFetchLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

const defaults: RepositoryFetchLimits = { maxFiles: 10_000, maxFileBytes: 1_000_000, maxTotalBytes: 50_000_000 };
const excludedSegment = /(^|\/)(?:\.git|node_modules|vendor|dist|build|coverage|\.next|target|__pycache__)(\/|$)/;
const excludedFile = /(?:\.min\.(?:js|css)|\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|jar|class|wasm|woff2?|ttf|eot))$/i;

function safePath(path: string) {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\0") && !path.split("/").includes("..");
}

function decodeBlob(value: { encoding?: string; content?: string }, path: string) {
  if (value.encoding !== "base64" || typeof value.content !== "string") throw new Error(`github_blob_encoding_unsupported:${path}`);
  const bytes = Buffer.from(value.content.replace(/\s/g, ""), "base64");
  if (bytes.includes(0)) return null;
  return bytes.toString("utf8");
}

export class RepositoryContentClient {
  constructor(private readonly http: GitHubHttp = fetch) {}

  async fetchExactCommit(input: { installationToken: string; repositoryId: number; commitSha: string; limits?: Partial<RepositoryFetchLimits> }): Promise<RepositorySnapshot> {
    if (!/^[0-9a-f]{40}$/i.test(input.commitSha)) throw new Error("invalid_commit_sha");
    const limits = { ...defaults, ...input.limits };
    if (limits.maxFiles < 1 || limits.maxFileBytes < 1 || limits.maxTotalBytes < 1) throw new Error("invalid_repository_fetch_limits");
    const authHeaders = { ...headers, Authorization: `Bearer ${input.installationToken}` };
    const commitResponse = await this.http(`https://api.github.com/repositories/${input.repositoryId}/git/commits/${input.commitSha}`, { headers: authHeaders });
    if (commitResponse.status === 401) throw new Error("installation_token_expired");
    if (commitResponse.status === 403 || commitResponse.status === 404) throw new Error("commit_or_repository_unavailable");
    if (!commitResponse.ok) throw new Error(`github_commit_${commitResponse.status}`);
    const commitBody = await commitResponse.json() as { sha?: string; tree?: { sha?: string } };
    if (commitBody.sha?.toLowerCase() !== input.commitSha.toLowerCase() || !commitBody.tree?.sha || !/^[0-9a-f]{40}$/i.test(commitBody.tree.sha)) throw new Error("github_commit_sha_mismatch");
    const treeSha = commitBody.tree.sha.toLowerCase();
    const treeResponse = await this.http(`https://api.github.com/repositories/${input.repositoryId}/git/trees/${treeSha}?recursive=1`, { headers: authHeaders });
    if (treeResponse.status === 401) throw new Error("installation_token_expired");
    if (treeResponse.status === 403 || treeResponse.status === 404) throw new Error("commit_or_repository_unavailable");
    if (!treeResponse.ok) throw new Error(`github_tree_${treeResponse.status}`);
    const treeBody = await treeResponse.json() as { truncated?: boolean; sha?: string; tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string; size?: number }> };
    if (treeBody.truncated) throw new Error("github_tree_truncated");
    if (treeBody.sha?.toLowerCase() !== treeSha) throw new Error("github_tree_sha_mismatch");
    if (!Array.isArray(treeBody.tree)) throw new Error("github_tree_malformed");

    const omitted: RepositoryOmission[] = [];
    const selected: Array<{ path: string; sha: string; size: number }> = [];
    let plannedBytes = 0;
    for (const entry of treeBody.tree) {
      if (entry.type !== "blob" || typeof entry.path !== "string" || typeof entry.sha !== "string" || typeof entry.size !== "number") continue;
      if (!safePath(entry.path)) throw new Error("github_tree_unsafe_path");
      if (excludedSegment.test(entry.path) || excludedFile.test(entry.path)) { omitted.push({ path: entry.path, reason: "excluded" }); continue; }
      if (entry.size > limits.maxFileBytes) { omitted.push({ path: entry.path, reason: "oversized" }); continue; }
      if (selected.length >= limits.maxFiles || plannedBytes + entry.size > limits.maxTotalBytes) { omitted.push({ path: entry.path, reason: "budget" }); continue; }
      selected.push({ path: entry.path, sha: entry.sha, size: entry.size });
      plannedBytes += entry.size;
    }

    const files: RepositoryFile[] = [];
    for (let offset = 0; offset < selected.length; offset += 8) {
      const batch = selected.slice(offset, offset + 8);
      const values = await Promise.all(batch.map(async entry => {
        const response = await this.http(`https://api.github.com/repositories/${input.repositoryId}/git/blobs/${entry.sha}`, { headers: authHeaders });
        if (!response.ok) throw new Error(`github_blob_${response.status}`);
        const content = decodeBlob(await response.json() as { encoding?: string; content?: string }, entry.path);
        if (content === null) { omitted.push({ path: entry.path, reason: "binary" }); return null; }
        return { ...entry, content };
      }));
      files.push(...values.filter((value): value is RepositoryFile => value !== null));
    }
    const fetchedBytes = files.reduce((sum, file) => sum + file.size, 0);
    return { repositoryId: input.repositoryId, commitSha: input.commitSha.toLowerCase(), files, omitted, fetchedBytes, coverage: omitted.length ? "partial" : "full" };
  }
}
