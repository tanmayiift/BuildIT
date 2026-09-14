import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const yaml = createRequire(new URL("../../packages/orchestrator/package.json", import.meta.url))("js-yaml") as { load(source: string): unknown };
type Group = { "applies-to"?: string; patterns?: string[]; "update-types"?: string[]; "exclude-patterns"?: string[]; "dependency-type"?: string };
type Updates = { "package-ecosystem": string; directory: string; schedule: { interval: string; day?: string; time?: string; timezone?: string }; "open-pull-requests-limit": number; groups?: Record<string, Group>; ignore?: unknown; "target-branch"?: string };
const config = yaml.load(readFileSync(".github/dependabot.yml", "utf8")) as { version: number; updates: Updates[] };
function ecosystem(name: string) {
  const matches = config.updates.filter(update => update["package-ecosystem"] === name);
  expect(matches, `one unambiguous ${name} update policy`).toHaveLength(1);
  return matches[0]!;
}
function wildcardGroup(update: Updates, kind: string, bump: string) {
  return Object.entries(update.groups ?? {}).find(([, group]) =>
    (group["applies-to"] ?? "version-updates") === kind && group.patterns?.includes("*") &&
    !group["exclude-patterns"]?.length && (!group["update-types"] || group["update-types"].includes(bump)))?.[0];
}

describe("bounded dependency maintenance without hiding security fixes", () => {
  it("batches routine action minor and patch updates weekly while leaving major changes separately reviewable", () => {
    const actions = ecosystem("github-actions");
    expect(actions.schedule).toMatchObject({ interval: "weekly", day: "monday", timezone: "Asia/Kolkata" });
    expect(actions["open-pull-requests-limit"]).toBe(2);
    const patch = wildcardGroup(actions, "version-updates", "patch");
    expect(patch).toBeTruthy();
    expect(wildcardGroup(actions, "version-updates", "minor")).toBe(patch);
    expect(wildcardGroup(actions, "version-updates", "major")).toBeUndefined();
    expect(actions.ignore).toBeUndefined();
  });

  it("keeps action security fixes in a separate group, including fixes that need a major upgrade", () => {
    const actions = ecosystem("github-actions");
    const security = wildcardGroup(actions, "security-updates", "major");
    expect(security).toBeTruthy();
    expect(security).not.toBe(wildcardGroup(actions, "version-updates", "patch"));
    expect(wildcardGroup(actions, "security-updates", "patch")).toBe(security);
    expect(actions["target-branch"]).toBeUndefined();
  });

  it("covers the root pnpm workspace with security fixes while opening no routine npm upgrade backlog", () => {
    const npm = ecosystem("npm");
    expect(npm.directory).toBe("/");
    expect(npm["open-pull-requests-limit"]).toBe(0);
    const security = wildcardGroup(npm, "security-updates", "major");
    expect(security).toBeTruthy();
    expect(npm.groups![security!]["dependency-type"]).toBeUndefined();
    expect(npm.ignore).toBeUndefined();
    expect(npm["target-branch"]).toBeUndefined();
    const lock = yaml.load(readFileSync("pnpm-lock.yaml", "utf8")) as { importers: Record<string, unknown> };
    expect(lock.importers).toHaveProperty("apps/web");
    expect(lock.importers).toHaveProperty("packages/broker");
  });
});
