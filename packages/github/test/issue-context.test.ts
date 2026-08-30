import { describe, expect, it, vi } from "vitest";
import { GitHubIssueContextClient } from "../src/issue-context";

describe("pinned GitHub issue context", () => {
  it("uses only the installation-scoped repository endpoint and pins the response version", async () => {
    const http = vi.fn(async () => Response.json({ title: "Reject empty names", body: "## Acceptance criteria\n- [ ] Reject whitespace", updated_at: "2026-08-30T00:00:00Z" }, { headers: { etag: '"issue-v2"' } }));
    await expect(new GitHubIssueContextClient(http).fetch({ installationToken: "secret", repositoryId: 42, issueNumber: 7 })).resolves.toEqual({ status: "available", version: '"issue-v2"', content: "# Reject empty names\n## Acceptance criteria\n- [ ] Reject whitespace" });
    expect(http).toHaveBeenCalledWith("https://api.github.com/repositories/42/issues/7", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret" }) }));
  });
  it("fails closed for missing, inaccessible, pull-request, image-only, and oversized sources", async () => {
    const client = (response: Response) => new GitHubIssueContextClient(async () => response);
    await expect(client(new Response(null, { status: 404 })).fetch({ installationToken: "x", repositoryId: 1, issueNumber: 1 })).resolves.toMatchObject({ status: "missing" });
    await expect(client(new Response(null, { status: 403 })).fetch({ installationToken: "x", repositoryId: 1, issueNumber: 1 })).resolves.toMatchObject({ status: "inaccessible" });
    await expect(client(Response.json({ title: "PR", body: "text", updated_at: "v", pull_request: {} })).fetch({ installationToken: "x", repositoryId: 1, issueNumber: 1 })).resolves.toMatchObject({ status: "inaccessible" });
    await expect(client(Response.json({ title: "Design", body: "![criteria](x.png)", updated_at: "v" })).fetch({ installationToken: "x", repositoryId: 1, issueNumber: 1 })).resolves.toMatchObject({ status: "image_only" });
    await expect(client(Response.json({ title: "Large", body: "x".repeat(100), updated_at: "v" })).fetch({ installationToken: "x", repositoryId: 1, issueNumber: 1, maxBytes: 20 })).resolves.toMatchObject({ status: "oversized" });
  });
});
