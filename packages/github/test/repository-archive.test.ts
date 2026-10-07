import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { gitBlobSha, readTarball } from "../src/archive";
import { RepositoryContentClient } from "../src/repository-content";

// GitHub serves a commit's tarball as `git archive` output, so git makes the fixture. A reader
// tested against a hand-built tar proves only that it reads what its author expected to be sent.
function repository() {
  const dir = mkdtempSync(join(tmpdir(), "buildit-archive-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=BuildIT", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd: dir });
  const write = (path: string, content: string | Buffer) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), content); };
  git("init", "-q");
  for (let index = 0; index < 30; index += 1) write(`src/mod${index}.ts`, `export const value${index} = ${index};\n`);
  // Past ustar's 100-byte name field, so git writes a pax header for it.
  write(`src/${"nested/".repeat(16)}deep.ts`, "export const deep = true;\n");
  write("assets/raw.dat", Buffer.from([1, 0, 2]));
  // Attributes that make the archive differ from the tree: left out, and rewritten.
  write(".gitattributes", "ignored.ts export-ignore\nsubst.ts export-subst\n");
  write("ignored.ts", "export const ignored = 1;\n");
  write("subst.ts", "export const commit = \"$Format:%H$\";\n");
  symlinkSync("src/mod1.ts", join(dir, "link.ts"));
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  const head = git("rev-parse", "HEAD").toString().trim();
  const tree = (rev: string) => git("ls-tree", "-r", "-l", "-z", rev).toString().split("\0").filter(Boolean).map(line => {
    const [meta, path] = line.split("\t") as [string, string];
    const [mode, type, sha, size] = meta.split(/\s+/) as [string, string, string, string];
    return { path, mode, type, sha, size: Number(size) };
  });
  const archive = (rev: string) => git("archive", "--format=tar.gz", `--prefix=owner-repo-${head.slice(0, 7)}/`, rev);
  return { dir, git, write, head, treeSha: git("rev-parse", "HEAD^{tree}").toString().trim(), tree, archive, blob: (sha: string) => git("cat-file", "blob", sha) };
}

type Fixture = ReturnType<typeof repository>;
function github(fixture: Fixture, tarball: () => Response) {
  const calls: string[] = [];
  const http = vi.fn(async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/git/commits/")) return Response.json({ sha: fixture.head, tree: { sha: fixture.treeSha } });
    if (url.includes("/git/trees/")) return Response.json({ sha: fixture.treeSha, tree: fixture.tree("HEAD") });
    if (url.includes("/tarball/")) return tarball();
    const sha = url.split("/git/blobs/")[1]!;
    return Response.json({ encoding: "base64", content: fixture.blob(sha).toString("base64") });
  });
  return { http, calls, blobs: () => calls.filter(url => url.includes("/git/blobs/")).map(url => url.split("/git/blobs/")[1]) };
}
const fetchHead = (fixture: Fixture, http: ReturnType<typeof github>["http"], limits = {}) =>
  new RepositoryContentClient(http).fetchExactCommit({ installationToken: "token", repositoryId: 7, commitSha: fixture.head, limits });

describe("reading a commit from its archive", () => {
  it("returns exactly what per-file reads return, with a blob request only where the archive differs", async () => {
    const fixture = repository();
    const fromArchive = github(fixture, () => new Response(fixture.archive("HEAD")));
    const fromBlobs = github(fixture, () => new Response("unavailable", { status: 502 }));
    const archived = await fetchHead(fixture, fromArchive.http);
    const blobbed = await fetchHead(fixture, fromBlobs.http);

    expect(archived.files).toEqual(blobbed.files);
    expect(archived.omitted).toEqual(blobbed.omitted);
    expect(archived.files.find(file => file.path.endsWith("/deep.ts"))?.content).toBe("export const deep = true;\n");
    expect(archived.omitted).toContainEqual({ path: "assets/raw.dat", reason: "binary" });

    // Left out by export-ignore, rewritten by export-subst, and a symlink: the three files the
    // archive cannot vouch for, and the only ones that cost a request.
    const shaOf = (path: string) => fixture.tree("HEAD").find(entry => entry.path === path)!.sha;
    expect(fromArchive.blobs().sort()).toEqual(["ignored.ts", "subst.ts", "link.ts"].map(shaOf).sort());
    expect(archived.fetch).toEqual({ archive: "used", blobRequests: 3 });
    expect(blobbed.fetch).toEqual({ archive: "failed", blobRequests: fixture.tree("HEAD").length });
  });

  it("refuses an archive of a different commit, and any file whose bytes differ from the tree", async () => {
    const fixture = repository();
    const original = fixture.archive("HEAD"), firstTree = fixture.tree("HEAD");
    fixture.write("src/mod3.ts", "export const value3 = 'changed';\n");
    fixture.git("commit", "-q", "-am", "change");
    // The tree listing stays the first commit's: the archive is the only thing that moved.
    const pinned = { ...fixture, tree: () => firstTree };

    const otherCommit = github(pinned, () => new Response(fixture.archive("HEAD")));
    const wholesale = await fetchHead(pinned, otherCommit.http);
    expect(wholesale.fetch?.archive).toBe("failed");

    // A tree-ish archive carries no commit id, so only the per-file check stands between it and
    // the review. The changed file is read as a blob, at the commit the review is pinned to.
    const otherTree = github(pinned, () => new Response(fixture.archive("HEAD^{tree}")));
    const perFile = await fetchHead(pinned, otherTree.http);
    expect(perFile.fetch?.archive).toBe("used");
    expect(perFile.files.find(file => file.path === "src/mod3.ts")?.content).toBe("export const value3 = 3;\n");
    expect(otherTree.blobs()).toContain(firstTree.find(entry => entry.path === "src/mod3.ts")!.sha);
    expect(original.length).toBeGreaterThan(0);
  });

  it("is refused the way blob reads are when GitHub refuses it", async () => {
    const fixture = repository();
    const refused = github(fixture, () => new Response("{}", { status: 403 }));
    await expect(fetchHead(fixture, refused.http)).rejects.toThrow(/^repository_access_refused:files=\d+;status=403$/);
    expect(refused.blobs()).toEqual([]);
  });

  it("is not downloaded for a handful of files", async () => {
    const fixture = repository();
    const small = github(fixture, () => new Response(fixture.archive("HEAD")));
    const result = await new RepositoryContentClient(small.http).fetchExactCommit({ installationToken: "token", repositoryId: 7, commitSha: fixture.head,
      select: { keep: path => path === "src/mod1.ts", relevantOnlyAbove: 0 } });
    expect(result.files.map(file => file.path)).toEqual(["src/mod1.ts"]);
    expect(small.calls.some(url => url.includes("/tarball/"))).toBe(false);
    expect(result.fetch).toEqual({ archive: "skipped", blobRequests: 1 });
  });

  it("no longer refuses a repository for blob requests the archive made unnecessary", async () => {
    const fixture = repository();
    const limits = { maxFetchFiles: 5 };
    await expect(fetchHead(fixture, github(fixture, () => new Response(fixture.archive("HEAD"))).http, limits)).resolves.toMatchObject({ fetch: { archive: "used", blobRequests: 3 } });
    await expect(fetchHead(fixture, github(fixture, () => new Response("", { status: 502 })).http, limits)).rejects.toThrow(/^repository_too_large:files=\d+;limit=5$/);
  });
});

describe("the archive reader", () => {
  it("reads git's own blob ids and long paths", () => {
    const fixture = repository();
    const read = readTarball(fixture.archive("HEAD"), { maxBytes: 10_000_000, wanted: () => true });
    expect(read.commit).toBe(fixture.head);
    for (const entry of fixture.tree("HEAD").filter(item => read.files.has(item.path) && item.path !== "subst.ts")) {
      expect(gitBlobSha(read.files.get(entry.path)!)).toBe(entry.sha);
    }
    expect(read.files.has(`src/${"nested/".repeat(16)}deep.ts`)).toBe(true);
    expect(read.files.has("link.ts")).toBe(false);
    expect(read.files.has("ignored.ts")).toBe(false);
  });

  it("stops at its size bound instead of inflating without limit", () => {
    const fixture = repository();
    expect(() => readTarball(fixture.archive("HEAD"), { maxBytes: 1_024, wanted: () => true })).toThrow();
  });
});
