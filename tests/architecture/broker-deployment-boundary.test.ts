import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("broker deployment boundary", () => {

  it("does not make unrelated routes eagerly load the execution worker", () => {
    expect(readFileSync("packages/broker/src/index.ts", "utf8")).not.toContain('export * from "./execution-http.js"');
    for (const route of ["artifacts", "credentials", "model"]) {
      expect(readFileSync(`packages/broker/api/${route}.ts`, "utf8")).not.toContain('from "../src/execution-http.js"');
    }
  });
});
