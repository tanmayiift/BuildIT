import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("broker deployment boundary", () => {
  it("builds every workspace package imported by production functions", () => {
    const config = JSON.parse(readFileSync("packages/broker/vercel.json", "utf8")) as { buildCommand?: string };
    for (const workspace of ["providers", "security", "runner", "scanners"]) expect(config.buildCommand).toContain(`@buildit/${workspace} build`);
  });

  it("uses compiled runtime exports outside development", () => {
    for (const workspace of ["runner", "scanners"]) {
      const value = JSON.parse(readFileSync(`packages/${workspace}/package.json`, "utf8")) as { exports: { ".": { development: string; import: string } } };
      expect(value.exports["."].development).toMatch(/^\.\/src\//);
      expect(value.exports["."].import).toMatch(/^\.\/dist\//);
    }
  });

  it("does not make unrelated routes eagerly load the execution worker", () => {
    expect(readFileSync("packages/broker/src/index.ts", "utf8")).not.toContain('export * from "./execution-http.js"');
    for (const route of ["artifacts", "credentials", "model"]) {
      expect(readFileSync(`packages/broker/api/${route}.ts`, "utf8")).not.toContain('from "../src/execution-http.js"');
    }
  });
});
