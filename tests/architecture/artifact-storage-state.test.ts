import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// redactionStatus: "redacted" was set when an upload completed and its checksum matched. No code
// inspects artifact bytes, so the name asserted a guarantee the product does not provide, in a
// product whose argument is that it claims nothing it cannot back. It was replaced by storageState
// in two steps (widen and migrate, then narrow). This keeps it from coming back under any spelling.
const convexSources = readdirSync("convex").filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"));
const code = convexSources.map(name => readFileSync(`convex/${name}`, "utf8")).join("\n");
const schema = readFileSync("convex/schema.ts", "utf8") + readFileSync("convex/validators.ts", "utf8");

describe("artifact storage state", () => {
  it("has no schema field or state that claims bytes were redacted", () => {
    expect(schema.replace(/\/\/.*$/gm, "")).not.toMatch(/edact/i);
  });

  it("is read through one helper", () => {
    const direct = convexSources.filter(name => /\.storageState\s*[=!]==/.test(readFileSync(`convex/${name}`, "utf8")));
    expect(direct).toEqual([]);
    expect(readFileSync("convex/lib/artifactState.ts", "utf8")).toMatch(/export const isStored/);
  });

  it("has a producer for each state it declares", () => {
    for (const state of ["pending", "stored"]) expect(code, state).toMatch(new RegExp(`storageState: "${state}"`));
  });
});
