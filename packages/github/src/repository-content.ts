import { gitBlobSha, readTarball } from "./archive.js";
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
  // How the files arrived, for the log: whether the commit's archive was used, and how many files
  // still took a blob request each.
  fetch?: { archive: "used" | "skipped" | "failed"; blobRequests: number };
};

// Which paths this review actually reads, and the tree size past which that starts to matter.
// Below the threshold everything is fetched, because a small repository's extra files are cheap and
// do reach the model. Above it they are neither: boundedAnalysisContext stops at 80KB with changed
// files sorted first, so on a large repository the rest is fetched, stored, re-downloaded and
// dropped - while costing two blob requests each against GitHub's secondary rate limit.
//
// `mustFetch` marks the paths the review cannot proceed without, and it exists because the size
// gate below runs before selection does. maxFileBytes is a limit on what the model is shown, and a
// root lockfile is parsed and installed from, never shown - but a 1 MB package-lock.json, which is
// an ordinary size, was dropped as oversized before executionPlanInput could force it back in. Both
// revisions then detected no package manager, so install, test, lint and typecheck never ran.
export type RepositorySelection = { keep: (path: string) => boolean; relevantOnlyAbove: number; mustFetch?: (path: string) => boolean };

export type RepositoryFetchLimits = {
  maxFiles: number;
  maxFetchFiles: number;
  maxFileBytes: number;
  // The ceiling for a mustFetch path. Separate from maxFileBytes because it is bounded by what the
  // snapshot chunker can carry, not by what is worth putting in front of the model.
  maxMustFetchBytes: number;
  maxTotalBytes: number;
};

const defaults: RepositoryFetchLimits = { maxFiles: 10_000, maxFetchFiles: 2_500, maxFileBytes: 1_000_000, maxMustFetchBytes: 2_000_000, maxTotalBytes: 50_000_000 };
const excludedSegment = /(^|\/)(?:\.git|node_modules|vendor|dist|build|coverage|\.next|target|__pycache__)(\/|$)/;
const excludedFile = /(?:\.min\.(?:js|css)|\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|jar|class|wasm|woff2?|ttf|eot))$/i;

// One archive instead of a request per file. GitHub allows an installation 5,000 API requests an
// hour, and a review read every file it needed as a separate blob request, for head and for base:
// about 800 requests for a 400-file repository, so roughly 30 reviews an hour per installation. The
// R0 benchmark ran into exactly that on 6 Oct 2026 (repository_access_refused, status 403, after
// about 30 reviews). A commit's tarball is one API request; the download itself comes from
// codeload and is not counted.
//
// The archive is never trusted for content. A file is taken from it only when its git blob id
// equals the tree's, which makes it the same bytes the blob API returns. Anything the archive
// leaves out or alters - export-ignore, export-subst, LFS, a symlink - is fetched as a blob, as is
// everything when the archive cannot be read.
//
// Below archiveAbove files (three rounds of eight), the blob requests cost less than a download.
// Above archiveMaxBytes of source the archive is not attempted: it is held in memory, twice over
// while head and base are read side by side.
const archiveAbove = 24;
export const archiveMaxBytes = 64_000_000;
const archiveTimeoutMs = 120_000;

async function boundedBody(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => undefined); return undefined; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

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
    const merged = { ...defaults, ...input.limits };
    // A path the review cannot proceed without is never held to a tighter ceiling than one it can.
    const limits = { ...merged, maxMustFetchBytes: Math.max(merged.maxMustFetchBytes, merged.maxFileBytes) };
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
    let plannedBytes = 0, treeBytes = 0;
    for (const entry of treeBody.tree) {
      if (entry.type !== "blob" || typeof entry.path !== "string" || typeof entry.sha !== "string" || typeof entry.size !== "number") continue;
      if (!safePath(entry.path)) throw new Error("github_tree_unsafe_path");
      treeBytes += entry.size;
      if (excludedSegment.test(entry.path) || excludedFile.test(entry.path)) { omitted.push({ path: entry.path, reason: "excluded" }); continue; }
      if (entry.size > (input.select?.mustFetch?.(entry.path) ? limits.maxMustFetchBytes : limits.maxFileBytes)) { omitted.push({ path: entry.path, reason: "oversized" }); continue; }
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

    const contents = new Map<string, string | null>();
    let archive: "used" | "skipped" | "failed" = "skipped";
    if (fetchList.length > archiveAbove && treeBytes <= archiveMaxBytes) {
      const wanted = new Map(fetchList.map(entry => [entry.path, entry.sha.toLowerCase()]));
      const read = await this.readArchive(input, authHeaders, wanted, fetchList.length);
      archive = read ? "used" : "failed";
      for (const [path, bytes] of read ?? []) contents.set(path, bytes.includes(0) ? null : bytes.toString("utf8"));
    }
    const remaining = fetchList.filter(entry => !contents.has(entry.path));

    // Blobs are fetched one at a time, eight in flight, so a repository with thousands of files
    // means hundreds of sequential rounds and GitHub eventually refuses with a 403. Refusing here
    // costs nothing and tells the author a number; discovering it four minutes in tells them
    // "a required platform step failed". The count is of what will actually be fetched as blobs, so
    // neither a large repository with a small change nor one read from its archive is refused for
    // requests nobody is going to make.
    if (remaining.length > limits.maxFetchFiles) {
      throw new Error(`repository_too_large:files=${remaining.length};limit=${limits.maxFetchFiles}`);
    }

    for (let offset = 0; offset < remaining.length; offset += 8) {
      const batch = remaining.slice(offset, offset + 8);
      await Promise.all(batch.map(async entry => {
        const response = await this.http(`https://api.github.com/repositories/${input.repositoryId}/git/blobs/${entry.sha}`, { headers: authHeaders });
        if (response.status === 403 || response.status === 429) {
          throw new Error(`repository_access_refused:files=${remaining.length};status=${response.status}`);
        }
        if (!response.ok) throw new Error(`github_blob_${response.status}`);
        contents.set(entry.path, decodeBlob(await response.json() as { encoding?: string; content?: string }, entry.path));
      }));
    }

    const files: RepositoryFile[] = [];
    for (const entry of fetchList) {
      const content = contents.get(entry.path);
      if (content === undefined) throw new Error("repository_content_missing");
      if (content === null) omitted.push({ path: entry.path, reason: "binary" });
      else files.push({ ...entry, content });
    }
    const fetchedBytes = files.reduce((sum, file) => sum + file.size, 0);
    return { repositoryId: input.repositoryId, commitSha: input.commitSha.toLowerCase(), files, omitted, fetchedBytes, coverage: omissionCoverage(omitted),
      fetch: { archive, blobRequests: remaining.length } };
  }

  // The files of fetchList that the commit's archive holds byte for byte, or undefined when the
  // archive could not be read. A refusal is GitHub's rate limit, and the blob requests that would
  // follow are refused the same way, so it fails here with the same code they would.
  private async readArchive(input: { repositoryId: number; commitSha: string }, authHeaders: Record<string, string>, wanted: Map<string, string>, files: number) {
    let response: Response;
    try {
      response = await this.http(`https://api.github.com/repositories/${input.repositoryId}/tarball/${input.commitSha}`, { headers: authHeaders, signal: AbortSignal.timeout(archiveTimeoutMs) });
    } catch { return undefined; }
    if (response.status === 403 || response.status === 429) throw new Error(`repository_access_refused:files=${files};status=${response.status}`);
    if (!response.ok) return undefined;
    try {
      const gzipped = await boundedBody(response, archiveMaxBytes);
      if (!gzipped) return undefined;
      // A tar adds at most 1,536 bytes a file: its header, padding, and a pax header for a long path.
      const read = readTarball(gzipped, { maxBytes: archiveMaxBytes + wanted.size * 1_536 + 1_048_576, wanted: path => wanted.has(path) });
      if (read.commit && read.commit.toLowerCase() !== input.commitSha.toLowerCase()) return undefined;
      return [...read.files].filter(([path, bytes]) => gitBlobSha(bytes) === wanted.get(path));
    } catch { return undefined; }
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

// One file at one commit. The repository's own configuration is read from the trusted ref, never
// from the pull request head, so it cannot be fetched alongside the head snapshot - and pulling a
// whole second snapshot to read one small file would cost far more than it saves.
export async function fetchFileAtCommit(input: { installationToken: string; repositoryId: number; commitSha: string; path: string; maxBytes?: number; http?: GitHubHttp }) {
  if (!/^[0-9a-f]{40}$/i.test(input.commitSha)) throw new Error("invalid_commit_sha");
  if (!safePath(input.path)) throw new Error("invalid_repository_path");
  const request = githubRequester(input.http ?? fetch);
  const authHeaders = { ...headers, Authorization: `Bearer ${input.installationToken}` };
  const response = await request(`https://api.github.com/repositories/${input.repositoryId}/contents/${encodeURI(input.path)}?ref=${input.commitSha}`, { headers: authHeaders });
  // A repository with no configuration is the common case, not an error.
  if (response.status === 404) return { present: false as const };
  if (!response.ok) return { present: false as const };
  const body = await response.json() as { content?: unknown; encoding?: unknown; size?: unknown };
  if (typeof body.content !== "string" || body.encoding !== "base64") return { present: false as const };
  if (typeof body.size === "number" && body.size > (input.maxBytes ?? 64_000)) return { present: false as const, tooLarge: true as const };
  const bytes = Buffer.from(body.content.replace(/\s/g, ""), "base64");
  if (bytes.length > (input.maxBytes ?? 64_000) || bytes.includes(0)) return { present: false as const };
  return { present: true as const, content: bytes.toString("utf8") };
}
