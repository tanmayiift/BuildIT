import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const convexRoot = join(process.cwd(), "convex");

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "_generated") return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("Convex runtime boundary", () => {
  it("keeps Node-only dependencies out of default-runtime functions", () => {
    const violations = typescriptFiles(convexRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      if (/^\s*["']use node["'];/m.test(source)) return [];
      const forbidden = [...source.matchAll(/from\s+["'](node:[^"']+|@buildit\/(?:orchestrator|runner|broker|security))["']/g)].map((match) => match[1]);
      return forbidden.map((dependency) => `${path.slice(process.cwd().length + 1)} -> ${dependency}`);
    });
    expect(violations).toEqual([]);
  });
});
