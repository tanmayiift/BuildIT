import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// redactionStatus named a guarantee no code provides - nothing inspects artifact bytes - so it is
// being retired for storageState in two steps: every reader moves to lib/artifactState.ts while the
// rows migrate, then the field leaves the schema. This holds the first step: only the files that
// define, migrate or translate the legacy field may name it, so the second step deletes four
// references instead of hunting thirty.
const allowed = new Set(["validators.ts", "schema.ts", "artifactStorageMigration.ts"]);
const sources = readdirSync("convex").filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"));

describe("artifact storage state", () => {
  it("is read in one place while the legacy field still exists", () => {
    const offenders = sources.filter(name => !allowed.has(name) && readFileSync(`convex/${name}`, "utf8").includes("redactionStatus"));
    expect(offenders).toEqual([]);
    expect(readFileSync("convex/lib/artifactState.ts", "utf8")).toMatch(/export function storageStateOf/);
  });

  it("is never written under the legacy name", () => {
    const writers = sources.filter(name => /redactionStatus:\s*"(pending|redacted|rejected)"/.test(readFileSync(`convex/${name}`, "utf8")));
    expect(writers).toEqual([]);
  });

  it("has a producer for each state it declares", () => {
    const code = sources.map(name => readFileSync(`convex/${name}`, "utf8")).join("\n");
    for (const state of ["pending", "stored"]) expect(code, state).toMatch(new RegExp(`storageState: "${state}"`));
  });
});
