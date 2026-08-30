type GitHubHttp = (input: string | URL, init?: RequestInit) => Promise<Response>;
const apiHeaders = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "BuildIT", "Content-Type": "application/json" };
function safePath(path: string) { return path.length > 0 && !path.startsWith("/") && !path.includes("\0") && !path.split("/").includes("..") && !path.startsWith(".git/"); }

export class GitHubRepositoryWriter {
  constructor(private readonly input: { repositoryId: number; installationToken: string; http?: GitHubHttp }) {}
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
  async createCandidateCommit(input: { pinnedHead: string; currentHead: string; message: string; patches: Array<{ path: string; content: string }> }) {
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
    const commit = await this.request("/git/commits", { method: "POST", body: JSON.stringify({ message: input.message, tree: createdTree.sha, parents: [input.pinnedHead] }) });
    if (typeof commit.sha !== "string" || !/^[0-9a-f]{40}$/i.test(commit.sha)) throw new Error("github_commit_malformed");
    return commit.sha.toLowerCase();
  }
  async createBranch(input: { name: string; sha: string }) {
    await this.request("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${input.name}`, sha: input.sha }) });
  }
  async createPullRequest(input: { head: string; base: string; title: string; body: string }) {
    const value = await this.request("/pulls", { method: "POST", body: JSON.stringify(input) });
    if (typeof value.number !== "number" || typeof value.html_url !== "string") throw new Error("github_pull_request_malformed");
    return { number: value.number, url: value.html_url };
  }
}
