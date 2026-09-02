import { githubRequester } from "./request.js";
type Http = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type GitHubIssueContext = { status: "available" | "missing" | "inaccessible" | "image_only" | "oversized"; version: string; content?: string };
const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT" };

export class GitHubIssueContextClient {
  private readonly http: Http;
  constructor(http: Http = fetch) { this.http = githubRequester(http); }
  async fetch(input: { installationToken: string; repositoryId: number; issueNumber: number; maxBytes?: number }): Promise<GitHubIssueContext> {
    const maxBytes = input.maxBytes ?? 250_000;
    if (!Number.isSafeInteger(input.repositoryId) || input.repositoryId < 1 || !Number.isSafeInteger(input.issueNumber) || input.issueNumber < 1 || maxBytes < 1 || maxBytes > 1_000_000) throw new Error("invalid_issue_context");
    const response = await this.http(`https://api.github.com/repositories/${input.repositoryId}/issues/${input.issueNumber}`, { headers: { ...headers, Authorization: `Bearer ${input.installationToken}` } });
    if (response.status === 404) return { status: "missing", version: "missing" };
    if (response.status === 401) throw new Error("installation_token_expired");
    if (response.status === 403) return { status: "inaccessible", version: "inaccessible" };
    if (!response.ok) throw new Error(`github_issue_${response.status}`);
    const value = await response.json() as { title?: unknown; body?: unknown; updated_at?: unknown; pull_request?: unknown };
    if (value.pull_request) return { status: "inaccessible", version: "linked_pull_request_not_issue" };
    const title = typeof value.title === "string" ? value.title.slice(0, 1_000) : "", body = typeof value.body === "string" ? value.body : "", version = response.headers.get("etag") ?? (typeof value.updated_at === "string" ? value.updated_at : "");
    if (!version) throw new Error("github_issue_version_missing");
    const content = `# ${title}\n${body}`, bytes = Buffer.byteLength(content);
    if (bytes > maxBytes) return { status: "oversized", version };
    const withoutImages = body.replace(/!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/gi, "").trim();
    if (!withoutImages && /!\[[^\]]*\]\([^)]*\)|<img\b/i.test(body)) return { status: "image_only", version };
    return { status: "available", version, content };
  }
}
