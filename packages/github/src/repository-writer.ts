import { githubRequester } from "./request.js";
type GitHubHttp = (input: string | URL, init?: RequestInit) => Promise<Response>;
const apiHeaders = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT", "Content-Type": "application/json" };
function safePath(path: string) { return path.length > 0 && !path.startsWith("/") && !path.includes("\0") && !path.split("/").includes("..") && !path.startsWith(".git/"); }
function safeDetailsUrl(value: string | undefined) {
  if (value === undefined) return undefined;
  if (value.length > 2_048) throw new Error("check_run_details_url_invalid");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("check_run_details_url_invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("check_run_details_url_invalid");
  return url.toString();
}

export class GitHubRepositoryWriter {
  private readonly input: { repositoryId: number; installationToken: string; http?: GitHubHttp };
  constructor(input: { repositoryId: number; installationToken: string; http?: GitHubHttp }) {
    this.input = { ...input, http: githubRequester(input.http ?? fetch) };
  }
  get http() { return this.input.http ?? fetch; }
  get headers() { return { ...apiHeaders, Authorization: `Bearer ${this.input.installationToken}` }; }
  async request(path: string, init: RequestInit = {}) {
    const response = await this.http(`https://api.github.com/repositories/${this.input.repositoryId}${path}`, { ...init, headers: this.headers });
    if (response.status === 401) throw new Error("installation_token_expired");
    if (response.status === 403 || response.status === 404) throw new Error("repository_write_unavailable");
    if (!response.ok) throw new Error(`github_write_${response.status}`);
    return response.json() as Promise<Record<string, unknown>>;
  }
  async branchHead(branch: string) {
    const value = await this.request(`/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`);
    const sha = (value.object as { sha?: unknown } | undefined)?.sha;
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) throw new Error("github_ref_malformed");
    return sha.toLowerCase();
  }
  async createCandidateCommit(input: { pinnedHead: string; currentHead: string; message: string; patches: Array<{ path: string; content: string }>; identity?: { name: string; email: string; date: string } }) {
    if (input.pinnedHead !== input.currentHead) throw new Error("stale_head");
    if (!/^[0-9a-f]{40}$/i.test(input.pinnedHead) || !input.message.trim() || input.patches.length < 1 || input.patches.length > 100) throw new Error("candidate_input_invalid");
    let bytes = 0;
    for (const patch of input.patches) { if (!safePath(patch.path)) throw new Error("candidate_path_invalid"); bytes += Buffer.byteLength(patch.content); }
    if (bytes > 5_000_000) throw new Error("candidate_too_large");
    const parent = await this.request(`/git/commits/${input.pinnedHead}`), baseTree = (parent.tree as { sha?: unknown } | undefined)?.sha;
    if (typeof baseTree !== "string") throw new Error("github_commit_malformed");
    const tree = await Promise.all(input.patches.map(async patch => {
      const blob = await this.request("/git/blobs", { method: "POST", body: JSON.stringify({ content: patch.content, encoding: "utf-8" }) });
      if (typeof blob.sha !== "string") throw new Error("github_blob_malformed");
      return { path: patch.path, mode: "100644", type: "blob", sha: blob.sha };
    }));
    const createdTree = await this.request("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree }) });
    if (typeof createdTree.sha !== "string") throw new Error("github_tree_malformed");
    if (input.identity && (!input.identity.name.trim() || !/^\S+@\S+$/.test(input.identity.email) || !Number.isFinite(Date.parse(input.identity.date)))) throw new Error("candidate_identity_invalid");
    const commit = await this.request("/git/commits", { method: "POST", body: JSON.stringify({ message: input.message, tree: createdTree.sha, parents: [input.pinnedHead], ...(input.identity ? { author: input.identity, committer: input.identity } : {}) }) });
    if (typeof commit.sha !== "string" || !/^[0-9a-f]{40}$/i.test(commit.sha)) throw new Error("github_commit_malformed");
    return commit.sha.toLowerCase();
  }
  async createBranch(input: { name: string; sha: string }) {
    await this.request("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${input.name}`, sha: input.sha }) });
  }
  async upsertBranch(input: { name: string; sha: string }) {
    if (!/^[A-Za-z0-9._/-]+$/.test(input.name) || input.name.startsWith("/") || input.name.includes("..") || !/^[0-9a-f]{40}$/i.test(input.sha)) throw new Error("branch_input_invalid");
    try { const existing = await this.branchHead(input.name); if (existing !== input.sha.toLowerCase()) throw new Error("branch_conflict"); return { operation: "reused" as const }; }
    catch (error) { if (error instanceof Error && error.message !== "repository_write_unavailable") throw error; }
    await this.createBranch(input); return { operation: "created" as const };
  }
  async deleteBranchIfExact(input: { name: string; sha: string }) {
    if (!/^[A-Za-z0-9._/-]+$/.test(input.name) || input.name.startsWith("/") || input.name.includes("..") || !/^[0-9a-f]{40}$/i.test(input.sha)) throw new Error("branch_input_invalid");
    const encoded = input.name.split("/").map(encodeURIComponent).join("/"), getPath = `/git/ref/heads/${encoded}`, deletePath = `/git/refs/heads/${encoded}`;
    const current = await this.http(`https://api.github.com/repositories/${this.input.repositoryId}${getPath}`, { headers: this.headers });
    if (current.status === 404) return { operation: "missing" as const };
    if (current.status === 401) throw new Error("installation_token_expired");
    if (current.status === 403) throw new Error("repository_write_unavailable");
    if (!current.ok) throw new Error(`github_write_${current.status}`);
    const value = await current.json() as { object?: { sha?: unknown } };
    if (typeof value.object?.sha !== "string" || value.object.sha.toLowerCase() !== input.sha.toLowerCase()) throw new Error("branch_cleanup_sha_mismatch");
    const removed = await this.http(`https://api.github.com/repositories/${this.input.repositoryId}${deletePath}`, { method: "DELETE", headers: this.headers });
    if (removed.status === 404) return { operation: "missing" as const };
    if (removed.status === 401) throw new Error("installation_token_expired");
    if (removed.status === 403) throw new Error("repository_write_unavailable");
    if (!removed.ok) throw new Error(`github_write_${removed.status}`);
    return { operation: "deleted" as const };
  }
  async createPullRequest(input: { head: string; base: string; title: string; body: string }) {
    const value = await this.request("/pulls", { method: "POST", body: JSON.stringify(input) });
    if (typeof value.number !== "number" || typeof value.html_url !== "string") throw new Error("github_pull_request_malformed");
    return { number: value.number, url: value.html_url };
  }
  async upsertStackedPullRequest(input: { head: string; base: string; title: string; body: string }) {
    if (!input.head.trim() || !input.base.trim() || !input.title.trim() || !input.body.trim()) throw new Error("pull_request_input_invalid");
    const listed = await this.request(`/pulls?state=open&base=${encodeURIComponent(input.base)}&per_page=100`), items = Array.isArray(listed) ? listed : [];
    const existing = (items as Array<{ number?: unknown; html_url?: unknown; head?: { ref?: unknown }; base?: { ref?: unknown } }>).find(item => item.head?.ref === input.head && item.base?.ref === input.base);
    if (existing && typeof existing.number === "number" && typeof existing.html_url === "string") return { number: existing.number, url: existing.html_url, operation: "reused" as const };
    return { ...await this.createPullRequest(input), operation: "created" as const };
  }
  async createCheckRun(input: { name: string; headSha: string; conclusion: "success" | "failure" | "neutral" | "action_required"; title: string; summary: string; detailsUrl?: string }) {
    if (!/^[0-9a-f]{40}$/i.test(input.headSha) || !input.name.trim() || !input.title.trim() || !input.summary.trim() || Buffer.byteLength(input.summary) > 60_000) throw new Error("check_run_input_invalid");
    const detailsUrl = safeDetailsUrl(input.detailsUrl);
    const value = await this.request("/check-runs", { method: "POST", body: JSON.stringify({ name: input.name, head_sha: input.headSha, status: "completed", conclusion: input.conclusion, ...(detailsUrl ? { details_url: detailsUrl } : {}), output: { title: input.title, summary: input.summary } }) });
    if (typeof value.id !== "number" || typeof value.html_url !== "string") throw new Error("github_check_run_malformed");
    return { id: value.id, url: value.html_url };
  }
  async upsertCheckRun(input: { name: string; headSha: string; conclusion: "success" | "failure" | "neutral" | "action_required"; title: string; summary: string; detailsUrl?: string }) {
    if (!/^[0-9a-f]{40}$/i.test(input.headSha) || !input.name.trim() || !input.title.trim() || !input.summary.trim() || Buffer.byteLength(input.summary) > 60_000) throw new Error("check_run_input_invalid");
    const detailsUrl = safeDetailsUrl(input.detailsUrl);
    const existing = await this.request(`/commits/${input.headSha}/check-runs?check_name=${encodeURIComponent(input.name)}&filter=latest&per_page=100`);
    const run = Array.isArray(existing.check_runs) ? (existing.check_runs as Array<{ id?: unknown; name?: unknown; app?: { slug?: unknown } }>).find(item => item.name === input.name && item.app?.slug === "buildit-agentic-review") : undefined;
    const body = JSON.stringify({ name: input.name, head_sha: input.headSha, status: "completed", conclusion: input.conclusion, ...(detailsUrl ? { details_url: detailsUrl } : {}), output: { title: input.title, summary: input.summary } });
    const value = run && typeof run.id === "number" ? await this.request(`/check-runs/${run.id}`, { method: "PATCH", body }) : await this.request("/check-runs", { method: "POST", body });
    if (typeof value.id !== "number" || typeof value.html_url !== "string") throw new Error("github_check_run_malformed");
    return { id: value.id, url: value.html_url, operation: run ? "updated" as const : "created" as const };
  }
  async upsertIssueComment(input: { prNumber: number; marker: string; body: string }) {
    if (!Number.isInteger(input.prNumber) || input.prNumber < 1 || !/^buildit-(?:review|autofix):[A-Za-z0-9_|-]+:[0-9a-f]{40}$/.test(input.marker) || !input.body.trim()) throw new Error("comment_input_invalid");
    const marker = `<!-- ${input.marker} -->`, body = `${marker}\n${input.body}`;
    if (Buffer.byteLength(body) > 65_000) throw new Error("comment_too_large");
    const comments = await this.request(`/issues/${input.prNumber}/comments?per_page=100&sort=created&direction=desc`), items = Array.isArray(comments) ? comments : [];
    const existing = (items as Array<{ id?: unknown; body?: unknown; user?: { type?: unknown } }>).find(item => item.user?.type === "Bot" && typeof item.body === "string" && item.body.includes(marker));
    const value = existing && typeof existing.id === "number" ? await this.request(`/issues/comments/${existing.id}`, { method: "PATCH", body: JSON.stringify({ body }) }) : await this.request(`/issues/${input.prNumber}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    if (typeof value.id !== "number" || typeof value.html_url !== "string") throw new Error("github_comment_malformed");
    return { id: value.id, url: value.html_url, operation: existing ? "updated" as const : "created" as const };
  }
}
