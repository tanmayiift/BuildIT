import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// @buildit/contracts exported "./src/index.ts" - a bare TypeScript path. That resolves in the
// workspace and not at all inside a deployed function, where only dist ships. Nothing noticed until
// the runner began importing it for the segment constants: its compiled dist/src/index.js then asked
// for a .ts file that was not in the bundle, and every POST /api/execute in production returned 500
// with ERR_MODULE_NOT_FOUND while every local gate stayed green.
//
// Local tests cannot catch this by construction - they resolve the same source the broken export
// points at. So the invariant is checked on the manifests instead.
describe("shared packages resolve the same way in a deployed function as they do here", () => {
  const root = join(import.meta.dirname, "../../packages");
  const shared = readdirSync(root).filter(name => existsSync(join(root, name, "package.json")));

  // The precise rule, not "no package may export source". Convex bundles TypeScript, so a package
  // only Convex imports is free to export src. The breakage is narrower and exact: a package that
  // ships dist has its imports resolved by Node at runtime, inside a bundle that contains no .ts -
  // so everything such a package imports must itself resolve to built output.
  const manifest = (name: string) => JSON.parse(readFileSync(join(root, name, "package.json"), "utf8")) as {
    name?: string; exports?: unknown; main?: string;
  };
  const runtimeTargets = (entry: unknown): string[] => {
    if (typeof entry === "string") return [entry];
    if (!entry || typeof entry !== "object") return [];
    return Object.entries(entry as Record<string, unknown>).flatMap(([condition, value]) =>
      ["types", "development"].includes(condition) ? [] : runtimeTargets(value));
  };
  const shipsDist = (name: string) => runtimeTargets(manifest(name).exports).some(path => path.includes("dist"));
  const resolvesToSource = (name: string) => {
    const targets = runtimeTargets(manifest(name).exports);
    return targets.length > 0 && targets.every(path => path.endsWith(".ts"));
  };
  const byPackageName = new Map(shared.map(dir => [manifest(dir).name ?? dir, dir]));

  it("never lets a package that ships dist import one that resolves to source", () => {
    const offenders: string[] = [];
    for (const dir of shared) {
      if (!shipsDist(dir)) continue;
      const srcDir = join(root, dir, "src");
      if (!existsSync(srcDir)) continue;
      const sources = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
        .filter(file => typeof file === "string" && file.endsWith(".ts"));
      for (const file of sources) {
        const text = readFileSync(join(srcDir, file), "utf8");
        for (const match of text.matchAll(/from "(@buildit\/[a-z-]+)"/g)) {
          const target = byPackageName.get(match[1]!);
          if (target && resolvesToSource(target)) offenders.push(`${dir}/${file} imports ${match[1]}`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("builds every package the broker's bundle loads at runtime", () => {
    const vercel = JSON.parse(readFileSync(join(root, "broker/vercel.json"), "utf8")) as { buildCommand: string };
    // @buildit/contracts is the one this test was written for: the runner imports it, so the
    // broker's bundle loads it, so the broker's build has to produce its dist.
    for (const name of ["@buildit/contracts", "@buildit/runner", "@buildit/security"]) {
      expect(vercel.buildCommand).toContain(name);
    }
  });
});
