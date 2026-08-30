import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publicFunctionPolicies } from "../../convex/publicFunctionPolicy";
import { tablePolicies } from "../../convex/tablePolicy";

const convexDir = fileURLToPath(new URL("../../convex", import.meta.url));
const declaration = /export const\s+([A-Za-z0-9_]+)\s*=\s*(?:query|mutation|action)\s*\(/g;
const schema = readFileSync(join(convexDir, "schema.ts"), "utf8");

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

describe("product table security inventory", () => {
  it("requires scope, parent, and stored-data declarations for every product table", () => {
    const tables = [...schema.matchAll(/^  ([A-Za-z_]+): defineTable/gm)].map(match => match[1]).sort();
    expect(Object.keys(tablePolicies).sort()).toEqual(tables);
  });

  it("requires repository and review tables to declare their complete parent chain", () => {
    const incomplete = Object.entries(tablePolicies).filter(([name, policy]) =>
      policy.scope === "repository" && name !== "repositories" && !policy.parents.includes("repositoryId" as never)
      || policy.scope === "review" && name !== "reviews" && !policy.parents.includes("reviewId" as never));
    expect(incomplete).toEqual([]);
  });
});
