import {expect,it} from "vitest";
import {readdirSync,readFileSync,statSync} from "node:fs";
import {join} from "node:path";
function files(dir:string):string[]{return readdirSync(dir).filter(n=>n!=="node_modules"&&n!=="dist").flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?files(p):[p]})}
it("contains no GitHub merge call",()=>{const roots=["apps","packages","convex"].filter(p=>{try{return statSync(p).isDirectory()}catch{return false}});const source=roots.flatMap(files).filter(f=>/\.(ts|tsx)$/.test(f)&&!f.includes("merge-boundary")).map(f=>readFileSync(f,"utf8")).join("\n");expect(source).not.toMatch(/\.merge\s*\(|mergePullRequest|PUT \/repos\/.*\/merge/)});
