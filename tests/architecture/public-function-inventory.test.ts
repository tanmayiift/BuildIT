import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publicFunctionPolicies } from "../../convex/publicFunctionPolicy";

const convexDir = fileURLToPath(new URL("../../convex", import.meta.url));
const declaration = /export const\s+([A-Za-z0-9_]+)\s*=\s*(?:query|mutation|action)\s*\(/g;

function publicFunctions() {
  return readdirSync(convexDir).filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts")).flatMap(file => {
    const source = readFileSync(join(convexDir, file), "utf8");
    const module = basename(file, ".ts");
    return [...source.matchAll(declaration)].map(match => `${module}:${match[1]}`);
  }).sort();
}

describe("public Convex function inventory", () => {
  it("requires an authorization and response-data declaration for every public function", () => {
    expect(Object.keys(publicFunctionPolicies).sort()).toEqual(publicFunctions());
  });

  it("never labels an organization or repository endpoint as unauthenticated", () => {
    const unsafe = Object.entries(publicFunctionPolicies).filter(([name, policy]) =>
      /^(artifacts|integrations|memberships|metrics|organizations|repositoryConnections|reviews):/.test(name)
      && policy.authorization === "public_webhook");
    expect(unsafe).toEqual([]);
  });
});
