import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// "New users should only be able to use this in BYOK mode" turned out to describe something the
// product already does - there is no platform model key anywhere, and an organization with no
// credential of its own cannot start a review. Building a flag to enforce it would have been a
// second lock on an already-locked door.
//
// What was missing is this: nothing stopped the property being lost. A platform key would arrive as
// an ordinary-looking convenience - one env var read in one worker, to unblock one demo - and every
// read path would keep compiling. So the property is asserted rather than assumed.

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" || entry.name === "_generated" ? [] : sourceFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("BYOK is the only mode", () => {
  // If organizationId ever becomes optional, a credential belonging to nobody becomes
  // representable - and every by_org_status read would simply stop returning it, which is a silent
  // change in who can review rather than a loud one.
  it("cannot represent a provider credential that belongs to no organization", () => {
    const schema = read("convex/schema.ts");
    const table = schema.slice(schema.indexOf("providerCredentials: defineTable("));
    const declaration = table.slice(0, table.indexOf("}).index("));
    expect(declaration).toContain('organizationId: v.id("organizations")');
    expect(declaration, "organizationId must not become optional").not.toMatch(/organizationId:\s*v\.optional/);
  });

  // The failure mode this is really guarding: a provider key read from the environment instead of
  // from a tenant's own encrypted row. Allowed in the offline evaluation CLI, which runs against
  // nobody's workspace, and nowhere that serves a review.
  it("reads no provider API key from the environment on any serving path", () => {
    const offenders: string[] = [];
    for (const directory of ["convex", "apps/web/src", "packages/broker/src", "packages/orchestrator/src", "packages/providers/src"]) {
      for (const path of sourceFiles(directory)) {
        const source = read(path);
        for (const match of source.matchAll(/process\.env(?:\.|\[["'])(\w*(?:ANTHROPIC|OPENAI|GEMINI|GOOGLE)\w*API\w*KEY\w*)/gi)) {
          offenders.push(`${path}: ${match[1]}`);
        }
      }
    }
    expect(offenders, "a provider key from the environment is a platform key by another name").toEqual([]);
  });

  // The broker is the only thing that ever holds a plaintext key, and it gets there one way.
  it("decrypts only a stored credential the caller named", () => {
    const broker = read("packages/broker/src/index.ts");
    expect(broker).toContain('if (credential.status !== "valid") throw new Error("credential_unavailable")');
    expect(broker).toContain("async withCredential");
  });
});
