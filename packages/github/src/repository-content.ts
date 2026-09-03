import { githubRequester, type GitHubHttp } from "./request.js";

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "BuildIT",
};

export type RepositoryFile = { path: string; sha: string; size: number; content: string };
export type RepositoryOmission = { path: string; reason: "excluded" | "oversized" | "budget" | "binary" | "not_selected" };

// Coverage records what BuildIT was asked to read and could not, not what it deliberately
// never reads. "excluded" (images, lockdirs, minified bundles) and "binary" (no reviewable
// text) are permanent properties of the file, so they are not evidence gaps: counting them as
// gaps makes every repository containing an image permanently inconclusive. "oversized" and
// "budget" are real gaps — that content was wanted and did not fit.
const forcedOmissionReasons = new Set<RepositoryOmission["reason"]>(["oversized", "budget"]);
export function isForcedOmission(omission: RepositoryOmission) { return forcedOmissionReasons.has(omission.reason); }
// Coverage conflated two questions: did I read the code this pull request changed, and did I read
// every byte of the repository. Only the first can make a verdict unsafe, and answering the second
// made every real repository inconclusive - one oversized lockfile or image was enough, so a user
// could watch all seven checks pass and still be told BuildIT could not decide.
//
// With no changed set it stays strict, because then there is no way to tell a relevant gap from an
// irrelevant one, and it must not guess in the direction that produces a confident verdict.
export function omissionCoverage(omitted: RepositoryOmission[], changedPaths?: ReadonlySet<string>) {
  const gaps = omitted.filter(isForcedOmission);
  if (!gaps.length) return "full" as const;
  if (!changedPaths) return "partial" as const;
  return gaps.some(gap => changedPaths.has(gap.path)) ? "partial" as const : "full" as const;
}
export type RepositorySnapshot = {
  repositoryId: number;
  commitSha: string;
  files: RepositoryFile[];
  omitted: RepositoryOmission[];
  fetchedBytes: number;
  coverage: "full" | "partial";
};

// Which paths this review actually reads, and the tree size past which that starts to matter.
// Below the threshold everything is fetched, because a small repository's extra files are cheap and
// do reach the model. Above it they are neither: boundedAnalysisContext stops at 80KB with changed
// files sorted first, so on a large repository the rest is fetched, stored, re-downloaded and
// dropped - while costing two blob requests each against GitHub's secondary rate limit.
export type RepositorySelection = { keep: (path: string) => boolean; relevantOnlyAbove: number };

export type RepositoryFetchLimits = {
  maxFiles: number;
  maxFetchFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

const defaults: RepositoryFetchLimits = { maxFiles: 10_000, maxFetchFiles: 2_500, maxFileBytes: 1_000_000, maxTotalBytes: 50_000_000 };
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
  constructor(http: GitHubHttp = fetch) { this.http = githubRequester(http); }
  private readonly http: GitHubHttp;

  async fetchExactCommit(input: { installationToken: string; repositoryId: number; commitSha: string; limits?: Partial<RepositoryFetchLimits>; select?: RepositorySelection }): Promise<RepositorySnapshot> {
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

    // Past the threshold, read what this review reads. A 1,440-blob repository was fetching 1,373
    // files per revision - 2,746 blob requests - to answer a question about one changed file.
    let fetchList = selected;
    if (input.select && selected.length > input.select.relevantOnlyAbove) {
      const keep = input.select.keep;
      fetchList = selected.filter(entry => keep(entry.path));
      for (const entry of selected) if (!keep(entry.path)) omitted.push({ path: entry.path, reason: "not_selected" });
    }

    // Blobs are fetched one at a time, eight in flight, so a repository with thousands of files
    // means hundreds of sequential rounds and GitHub eventually refuses with a 403. Refusing here
    // costs nothing and tells the author a number; discovering it four minutes in tells them
    // "a required platform step failed". The count is of what will actually be fetched, so a large
    // repository with a small change is no longer refused for files nobody was going to read.
    if (fetchList.length > limits.maxFetchFiles) {
      throw new Error(`repository_too_large:files=${fetchList.length};limit=${limits.maxFetchFiles}`);
    }

    const files: RepositoryFile[] = [];
    for (let offset = 0; offset < fetchList.length; offset += 8) {
      const batch = fetchList.slice(offset, offset + 8);
      const values = await Promise.all(batch.map(async entry => {
        const response = await this.http(`https://api.github.com/repositories/${input.repositoryId}/git/blobs/${entry.sha}`, { headers: authHeaders });
        if (response.status === 403 || response.status === 429) {
          throw new Error(`repository_access_refused:files=${fetchList.length};status=${response.status}`);
        }
        if (!response.ok) throw new Error(`github_blob_${response.status}`);
        const content = decodeBlob(await response.json() as { encoding?: string; content?: string }, entry.path);
        if (content === null) { omitted.push({ path: entry.path, reason: "binary" }); return null; }
        return { ...entry, content };
      }));
      files.push(...values.filter((value): value is RepositoryFile => value !== null));
    }
    const fetchedBytes = files.reduce((sum, file) => sum + file.size, 0);
    return { repositoryId: input.repositoryId, commitSha: input.commitSha.toLowerCase(), files, omitted, fetchedBytes, coverage: omissionCoverage(omitted) };
  }
}

// Every repository has a directory its own engineers would never review - a vendored dependency, a
// generated client - and a finding there is one nobody acts on. A reviewer who scrolls past those
// stops reading the ones that matter, so the team that owns the code gets to say which paths those
// are, on top of the defaults BuildIT already skips.
//
// Deliberately a small glob dialect rather than regex. A pattern in configuration is written once
// and read for years: a regex there is a footgun that silently drops half a repository, and the
// person writing it gets no feedback until a review misses something.
const maxFilters = 100, maxFilterLength = 200;

function globToRegExp(glob: string) {
  // Metacharacters are literal, or a stray dot in "a.b.ts" quietly matches "axbxts".
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]!;
    if (character === "*") {
      if (glob[index + 1] === "*") {
        // ** spans separators; a trailing /** also matches the directory itself.
        source += glob[index + 2] === "/" ? "(?:.*/)?" : ".*";
        index += glob[index + 2] === "/" ? 2 : 1;
      } else { source += "[^/]*"; }
      continue;
    }
    if (character === "?") { source += "[^/]"; continue; }
    source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function compilePathFilters(patterns: ReadonlyArray<string>) {
  if (patterns.length > maxFilters) throw new Error("path_filter_invalid");
  const rules = patterns.map(pattern => {
    const negated = pattern.startsWith("!"), glob = negated ? pattern.slice(1) : pattern;
    // A traversal or an absolute path cannot describe a repository path, and a very long pattern is
    // a mistake rather than an intent.
    if (!glob || glob.length > maxFilterLength || glob.startsWith("/") || glob.split("/").includes("..")) throw new Error("path_filter_invalid");
    return { negated, test: globToRegExp(glob) };
  });
  // A list of bare includes is an allowlist; once anything is included, everything else is out.
  const hasInclude = rules.some(rule => !rule.negated);
  return (path: string) => {
    let kept = !hasInclude;
    // Order matters the way .gitignore's does, so a later include can rescue an earlier exclude.
    for (const rule of rules) if (rule.test.test(path)) kept = !rule.negated;
    return kept;
  };
}
