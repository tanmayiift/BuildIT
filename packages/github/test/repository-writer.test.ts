import { describe, expect, it, vi } from "vitest";
import { GitHubRepositoryWriter } from "../src/repository-writer";

const head = "a".repeat(40), treeSha = "b".repeat(40), blobSha = "c".repeat(40), candidate = "d".repeat(40);
describe("GitHub candidate writer", () => {
  it("creates a bounded candidate commit on the pinned parent", async () => {
    const bodies: unknown[] = [], http = vi.fn(async (url: string | URL, init?: RequestInit) => {
      bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      const path = String(url); const value = path.endsWith(`/git/commits/${head}`) ? { tree: { sha: treeSha } } : path.endsWith("/git/blobs") ? { sha: blobSha } : path.endsWith("/git/trees") ? { sha: treeSha } : { sha: candidate };
      return new Response(JSON.stringify(value), { status: path.endsWith(`/git/commits/${head}`) ? 200 : 201 });
    });
    const writer = new GitHubRepositoryWriter({ repositoryId: 7, installationToken: "token", http });
    await expect(writer.createCandidateCommit({ pinnedHead: head, currentHead: head, message: "Fix regression", patches: [{ path: "src/tax.js", content: "fixed" }] })).resolves.toBe(candidate);
    expect(bodies.at(-1)).toEqual({ message: "Fix regression", tree: treeSha, parents: [head] });
  });
  it("refuses stale heads and unsafe or oversized patches before GitHub writes", async () => {
    const http = vi.fn(), writer = new GitHubRepositoryWriter({ repositoryId: 7, installationToken: "token", http });
    await expect(writer.createCandidateCommit({ pinnedHead: head, currentHead: candidate, message: "Fix", patches: [{ path: "a", content: "x" }] })).rejects.toThrow("stale_head");
    await expect(writer.createCandidateCommit({ pinnedHead: head, currentHead: head, message: "Fix", patches: [{ path: "../escape", content: "x" }] })).rejects.toThrow("candidate_path_invalid");
    expect(http).not.toHaveBeenCalled();
  });
  it("creates only a branch and pull request delivery", async () => {
    const http = vi.fn(async (url: string | URL) => new Response(JSON.stringify(String(url).endsWith("/pulls") ? { number: 4, html_url: "https://github.test/pr/4" } : {}), { status: 201 }));
    const writer = new GitHubRepositoryWriter({ repositoryId: 7, installationToken: "token", http });
    await writer.createBranch({ name: "buildit/pr-2/proof", sha: candidate });
    await expect(writer.createPullRequest({ head: "buildit/pr-2/proof", base: "feature", title: "Fix", body: "Human merge required" })).resolves.toEqual({ number: 4, url: "https://github.test/pr/4" });
    expect(http).toHaveBeenCalledTimes(2);
  });
  it("publishes an exact-commit completed check without merge authority", async () => {
    const http = vi.fn(async (_url: string | URL, init?: RequestInit) => new Response(JSON.stringify({ id: 9, html_url: "https://github.test/check/9", body: init?.body }), { status: 201 }));
    const writer = new GitHubRepositoryWriter({ repositoryId: 7, installationToken: "token", http });
    await expect(writer.createCheckRun({ name: "BuildIT / candidate", headSha: candidate, conclusion: "success", title: "Candidate validated", summary: "Install, test, and lint passed." })).resolves.toEqual({ id: 9, url: "https://github.test/check/9" });
    const body = JSON.parse(String((http.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ head_sha: candidate, status: "completed", conclusion: "success" });
  });
  it("updates the app's exact-commit check run on retry",async()=>{const http=vi.fn(async(url:string|URL,init?:RequestInit)=>{const path=String(url);if(path.includes("/commits/")&&path.includes("/check-runs?"))return new Response(JSON.stringify({check_runs:[{id:9,name:"BuildIT / review",app:{slug:"buildit-agentic-review"}}]}));if(path.endsWith("/check-runs/9")&&init?.method==="PATCH")return new Response(JSON.stringify({id:9,html_url:"https://github.test/check/9"}));return new Response("",{status:500})});const writer=new GitHubRepositoryWriter({repositoryId:7,installationToken:"token",http});await expect(writer.upsertCheckRun({name:"BuildIT / review",headSha:candidate,conclusion:"success",title:"Checks passed",summary:"Evidence complete"})).resolves.toMatchObject({id:9,operation:"updated"});expect(http).toHaveBeenCalledTimes(2)});
  it("updates only the bot comment with the stable review marker",async()=>{const marker=`buildit-review:review_123:${candidate}`,http=vi.fn(async(url:string|URL,init?:RequestInit)=>{const path=String(url);if(path.includes("/issues/4/comments?"))return new Response(JSON.stringify([{id:11,body:`<!-- ${marker} -->\nold`,user:{type:"Bot"}},{id:12,body:`<!-- ${marker} -->\nhuman`,user:{type:"User"}}]));if(path.endsWith("/issues/comments/11")&&init?.method==="PATCH")return new Response(JSON.stringify({id:11,html_url:"https://github.test/comment/11"}));return new Response("",{status:500})});const writer=new GitHubRepositoryWriter({repositoryId:7,installationToken:"token",http});await expect(writer.upsertIssueComment({prNumber:4,marker,body:"new report"})).resolves.toMatchObject({id:11,operation:"updated"});expect(http).toHaveBeenCalledTimes(2)});
});
