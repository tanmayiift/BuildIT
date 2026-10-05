import {describe,expect,it} from "vitest";
import {buildContextIndex,buildRepositoryGraph,dependencyNeighborhood,diffRepositoryGraphs,hunkWindows,relatedPaths,retrieveGraphContext,scoreGraphRetrieval} from "../src/contextIndex.js";
describe("deterministic context index",()=>{it("sorts files and extracts changed symbols and imports",()=>{const index=buildContextIndex([{path:"src/z.ts",status:"modified",size:40,patch:'import { tax } from "./tax";\nexport function charge() {}'},{path:"src/tax.ts",status:"modified",size:30,patch:"export function tax() {}"}]);expect(index.files.map(file=>file.path)).toEqual(["src/tax.ts","src/z.ts"]);expect(index.files[0]!.symbols).toEqual(["tax"]);expect(index.files[1]!.imports).toEqual(["./tax"]);expect(dependencyNeighborhood(index,"src/tax.ts")).toEqual(["src/tax.ts","src/z.ts"])});it("reports every safety and coverage exclusion",()=>{const index=buildContextIndex([{path:"../secret",status:"modified",size:1,patch:"x"},{path:"asset.png",status:"modified",size:1,binary:true},{path:"vendor/a.js",status:"modified",size:1,patch:"x"},{path:"module",status:"modified",size:1,submodule:true},{path:"big.ts",status:"modified",size:99,patch:"x"},{path:"missing.ts",status:"modified",size:1}],{maxFiles:10,maxBytes:100,maxFileBytes:10});expect(index.coverage).toBe("partial");expect(index.excluded.map(item=>item.reason)).toEqual(["path_invalid","binary","file_too_large","patch_missing","submodule","generated"])});it("enforces a total byte budget deterministically",()=>{const index=buildContextIndex([{path:"a.ts",status:"modified",size:6,patch:"const a=1"},{path:"b.ts",status:"modified",size:6,patch:"const b=1"}],{maxFiles:2,maxBytes:6,maxFileBytes:10});expect(index.files.map(file=>file.path)).toEqual(["a.ts"]);expect(index.excluded).toEqual([{path:"b.ts",reason:"budget_exhausted"}])})});
describe("pinned repository graph",()=>{it("builds exact-version symbol, import, call, test, package, and ownership edges",()=>{const sha="a".repeat(40),files=[{path:"package.json",content:'{"name":"service"}',size:18},{path:".github/CODEOWNERS",content:"/src/ @platform",size:15},{path:"src/tax.ts",content:"export function tax(amount:number){ return amount }",size:50},{path:"src/charge.ts",content:'import { tax } from "./tax";\nexport function charge(){ return tax(10) }',size:70},{path:"tests/charge.test.ts",content:'import { charge } from "../src/charge";\ntest("charge",()=>charge())',size:70}],graph=buildRepositoryGraph({sha,files});expect(graph.sha).toBe(sha);expect(graph.nodes.every(node=>node.version===sha&&/^[0-9a-f]{64}$/.test(node.fingerprint))).toBe(true);expect(new Set(graph.edges.map(edge=>edge.type))).toEqual(new Set(["defines","imports","calls","tests","belongs_to","owns"]));expect(graph.edges).toEqual([...graph.edges].sort((a,b)=>a.id.localeCompare(b.id)));expect(graph.nodes.find(node=>node.id==="owner:@platform")).toBeDefined()});it("marks unsupported, malformed, and over-budget inputs partial instead of hiding gaps",()=>{const graph=buildRepositoryGraph({sha:"b".repeat(40),maxFileBytes:5,files:[{path:"image.svg",content:"<svg/>",size:6},{path:"package.json",content:"bad",size:3}]});expect(graph.coverage).toBe("partial");expect(graph.excluded).toEqual(expect.arrayContaining([expect.objectContaining({path:"image.svg",reason:"file_too_large"}),expect.objectContaining({path:"package.json",reason:"patch_missing"})]))});it("rejects a graph without an exact commit SHA",()=>{expect(()=>buildRepositoryGraph({sha:"main",files:[]})).toThrow("invalid_graph_sha")})});
describe("repository graph differences",()=>{it("reports only added, removed, and content-changed graph facts",()=>{const base=buildRepositoryGraph({sha:"a".repeat(40),files:[{path:"src/a.ts",content:"export const a=1",size:16},{path:"src/old.ts",content:"export const old=1",size:18}]}),head=buildRepositoryGraph({sha:"b".repeat(40),files:[{path:"src/a.ts",content:"export const a=2",size:16},{path:"src/new.ts",content:"export const fresh=1",size:20}]}),diff=diffRepositoryGraphs(base,head);expect(diff.nodes.changed.map(item=>item.after.id)).toEqual(["file:src/a.ts"]);expect(diff.nodes.added.map(item=>item.id)).toEqual(["file:src/new.ts","symbol:src/new.ts:fresh:1"]);expect(diff.nodes.removed.map(item=>item.id)).toEqual(["file:src/old.ts","symbol:src/old.ts:old:1"]);expect(diff.baseSha).toBe("a".repeat(40));expect(diff.headSha).toBe("b".repeat(40))});it("does not mutate either pinned graph and returns stable ordering",()=>{const files=[{path:"z.ts",content:"const z=1",size:9},{path:"a.ts",content:"const a=1",size:9}],base=buildRepositoryGraph({sha:"c".repeat(40),files}),head=buildRepositoryGraph({sha:"d".repeat(40),files}),before=JSON.stringify([base,head]),diff=diffRepositoryGraphs(base,head);expect(diff.nodes.changed).toEqual([]);expect(diff.edges).toEqual({added:[],removed:[]});expect(JSON.stringify([base,head])).toBe(before)})});
describe("graph retrieval accuracy gate",()=>{const files=[{path:"package.json",content:'{"name":"billing"}',size:18},{path:".github/CODEOWNERS",content:"/src/ @payments",size:15},{path:"src/tax.ts",content:"export function tax(amount:number){ return amount }",size:50},{path:"src/charge.ts",content:'import { tax } from "./tax";\nexport function charge(){ return tax(10) }',size:70},{path:"tests/charge.test.ts",content:'import { charge } from "../src/charge";\ntest("charge",()=>charge())',size:70}],graph=buildRepositoryGraph({sha:"e".repeat(40),files});it("retrieves the changed symbol, callers, tests, package, and owner from a frozen fixture",()=>{const expected=["symbol:src/tax.ts:tax:1","file:src/charge.ts","file:tests/charge.test.ts","package:package.json","owner:@payments"],actual=retrieveGraphContext(graph,{seedIds:["symbol:src/tax.ts:tax:1"]}).map(node=>node.id);expect(actual).toEqual(expect.arrayContaining(expected));expect(actual).not.toContain("symbol:src/charge.ts:tax:2")});it("allows blocking use only when frozen recall and graph coverage pass",()=>{const cases=[{id:"changed-tax",seedIds:["symbol:src/tax.ts:tax:1"],expectedIds:["file:src/charge.ts","file:tests/charge.test.ts","package:package.json","owner:@payments"]}],score=scoreGraphRetrieval(graph,cases,.9);expect(score.recall).toBe(1);expect(score.blockingEligible).toBe(true);const incomplete={...graph,coverage:"partial" as const};expect(scoreGraphRetrieval(incomplete,cases,.9).blockingEligible).toBe(false);expect(scoreGraphRetrieval(graph,[{...cases[0]!,expectedIds:[...cases[0]!.expectedIds,"file:missing.ts"]}],.9).blockingEligible).toBe(false)});it("rejects an empty or invalid accuracy gate",()=>{expect(()=>scoreGraphRetrieval(graph,[])).toThrow("invalid_graph_retrieval_gate");expect(()=>scoreGraphRetrieval(graph,[{id:"x",seedIds:[],expectedIds:[]}],1.1)).toThrow("invalid_graph_retrieval_gate")})});

describe("the files a change reaches", () => {
  const files = [
    { path: "src/core.ts", content: "export const core = 1;" },
    { path: "src/util/index.ts", content: "export const helper = 2;" },
    { path: "src/types.ts", content: 'import "./side-effect";\nimport { core } from "./core.js";\nimport { helper } from "./util";\nimport { z } from "zod";' },
    { path: "src/side-effect.ts", content: "globalThis.flag = true;" },
    { path: "test/types.test.ts", content: 'import { thing } from "../src/types.js";' },
    { path: "docs/guide.md", content: 'import { thing } from "../src/types.js";' },
    { path: "src/elsewhere.ts", content: "export const nothing = 0;" },
  ];

  it("names what the changed file imports, then what imports it, and nothing else", () => {
    // ./core.js is core.ts on disk; ./util is a directory index; a bare package name is not a file here.
    expect(relatedPaths(["src/types.ts"], files)).toEqual(["src/core.ts", "src/side-effect.ts", "src/util/index.ts", "test/types.test.ts"]);
  });

  it("never names a changed file as its own neighbour", () => {
    expect(relatedPaths(["src/types.ts", "src/core.ts"], files)).not.toContain("src/core.ts");
  });
});

describe("windows around a diff's hunks", () => {
  const content = Array.from({ length: 100 }, (_, index) => `${index + 1}`).join("\n");

  it("widens each hunk, merges windows that meet, and stays inside the file", () => {
    expect(hunkWindows(content, "@@ -1,2 +1,3 @@\n@@ -10 +11 @@\n@@ -90,2 +95,2 @@", 5)?.map(window => [window.startLine, window.endLine])).toEqual([[1, 16], [90, 100]]);
  });

  it("returns the window's own lines", () => {
    expect(hunkWindows(content, "@@ -50 +50 @@", 1)?.[0]?.text).toBe("49\n50\n51");
  });

  it("refuses to guess when there is no hunk header to read", () => {
    expect(hunkWindows(content, undefined, 5)).toBeUndefined();
    expect(hunkWindows(content, "Binary files differ", 5)).toBeUndefined();
  });
});
