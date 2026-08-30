type Http = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type PullRequestChangedFile = { path: string; previousPath?: string; status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged"; additions: number; deletions: number; changes: number; patch?: string };
export type PullRequestContext = { title: string; body: string; htmlUrl: string; headSha: string; baseSha: string; files: PullRequestChangedFile[]; omitted: Array<{ path: string; reason: "patch_unavailable" | "patch_too_large" | "budget" }>; coverage: "full" | "partial" };

const statuses = new Set<PullRequestChangedFile["status"]>(["added", "modified", "removed", "renamed", "copied", "changed", "unchanged"]);
const baseHeaders = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT" };
function safePath(value: string) { return value.length > 0 && value.length <= 1_024 && !value.startsWith("/") && !value.includes("\0") && !value.split("/").includes(".."); }
function number(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0; }

export class PullRequestContextClient {
  constructor(private readonly http: Http = fetch) {}
  async fetch(input: { installationToken: string; repositoryId: number; prNumber: number; expectedHeadSha: string; expectedBaseSha: string; maxFiles?: number; maxPatchBytes?: number; maxPatchBytesPerFile?: number }): Promise<PullRequestContext> {
    const maxFiles = input.maxFiles ?? 3_000, maxPatchBytes = input.maxPatchBytes ?? 1_000_000, maxPatchBytesPerFile = input.maxPatchBytesPerFile ?? 100_000;
    if (!Number.isInteger(input.prNumber) || input.prNumber < 1 || !/^[0-9a-f]{40}$/i.test(input.expectedHeadSha) || !/^[0-9a-f]{40}$/i.test(input.expectedBaseSha)
      || maxFiles < 1 || maxFiles > 3_000 || maxPatchBytes < 1 || maxPatchBytesPerFile < 1) throw new Error("invalid_pull_request_context_limits");
    const headers = { ...baseHeaders, Authorization: `Bearer ${input.installationToken}` }, root = `https://api.github.com/repositories/${input.repositoryId}/pulls/${input.prNumber}`;
    const metadataResponse = await this.http(root, { headers });
    if (metadataResponse.status === 401) throw new Error("installation_token_expired");
    if (metadataResponse.status === 403 || metadataResponse.status === 404) throw new Error("pull_request_unavailable");
    if (!metadataResponse.ok) throw new Error(`github_pull_request_${metadataResponse.status}`);
    const metadata = await metadataResponse.json() as { title?: unknown; body?: unknown; html_url?: unknown; head?: { sha?: unknown }; base?: { sha?: unknown } };
    if (metadata.head?.sha !== input.expectedHeadSha || metadata.base?.sha !== input.expectedBaseSha) throw new Error("pull_request_commit_mismatch");
    const files: PullRequestChangedFile[] = [], omitted: PullRequestContext["omitted"] = [];
    let patchBytes = 0;
    for (let page = 1; page <= 30 && files.length < maxFiles; page++) {
      const response = await this.http(`${root}/files?per_page=100&page=${page}`, { headers });
      if (!response.ok) throw new Error(`github_pull_files_${response.status}`);
      const values = await response.json() as Array<{ filename?: unknown; previous_filename?: unknown; status?: unknown; additions?: unknown; deletions?: unknown; changes?: unknown; patch?: unknown }>;
      if (!Array.isArray(values)) throw new Error("github_pull_files_malformed");
      for (const value of values) {
        if (files.length >= maxFiles) { omitted.push({ path: "remaining_files", reason: "budget" }); break; }
        if (typeof value.filename !== "string" || !safePath(value.filename) || typeof value.status !== "string" || !statuses.has(value.status as PullRequestChangedFile["status"])) throw new Error("github_pull_file_unsafe");
        const file: PullRequestChangedFile = { path: value.filename, status: value.status as PullRequestChangedFile["status"], additions: number(value.additions), deletions: number(value.deletions), changes: number(value.changes) };
        if (typeof value.previous_filename === "string" && safePath(value.previous_filename)) file.previousPath = value.previous_filename;
        if (typeof value.patch !== "string") omitted.push({ path: file.path, reason: "patch_unavailable" });
        else {
          const bytes = Buffer.byteLength(value.patch);
          if (bytes > maxPatchBytesPerFile) omitted.push({ path: file.path, reason: "patch_too_large" });
          else if (patchBytes + bytes > maxPatchBytes) omitted.push({ path: file.path, reason: "budget" });
          else { file.patch = value.patch; patchBytes += bytes; }
        }
        files.push(file);
      }
      if (values.length < 100) break;
      if (page === 30 && values.length === 100) omitted.push({ path: "remaining_files", reason: "budget" });
    }
    return { title: typeof metadata.title === "string" ? metadata.title.slice(0, 500) : "", body: typeof metadata.body === "string" ? metadata.body.slice(0, 250_000) : "", htmlUrl: typeof metadata.html_url === "string" ? metadata.html_url : "", headSha: input.expectedHeadSha, baseSha: input.expectedBaseSha, files, omitted, coverage: omitted.length ? "partial" : "full" };
  }
}
