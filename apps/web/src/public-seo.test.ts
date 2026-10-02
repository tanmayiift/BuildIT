import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publicRoutes } from "./app/public-routes";
import { workspaceSections } from "./app/workspace-sections";

// The sitemap advertised /sandbox for weeks after the route was renamed to /scan, and omitted /scan
// entirely - so the one file whose whole job is telling crawlers what exists named a page that does
// not and hid one that does. robots.txt had the matching gap: /quality is a real gated workspace
// section and was the only one not disallowed. Nothing read either file, which is why both drifted.
const read = (name: string) => readFileSync(fileURLToPath(new URL(`../public/${name}`, import.meta.url)), "utf8");
const sitemap = read("sitemap.xml");
const robots = read("robots.txt");
const listed = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(match => new URL(match[1]!).pathname);

describe("what the sitemap and robots.txt claim exists", () => {
  it("advertises only routes the app actually serves", () => {
    const unknown = listed.filter(path => !(publicRoutes as readonly string[]).includes(path));
    expect(unknown, "a sitemap entry for a route that does not exist is a 404 served to every crawler").toEqual([]);
  });

  it("advertises every public page, so the two lists cannot drift apart", () => {
    // Sitemap equals publicRoutes exactly. Whether a sign-in page is worth indexing is a judgement
    // call; whether the two lists agree is not, and the drift is what actually caused the bug.
    expect([...listed].sort()).toEqual([...publicRoutes].sort());
  });

  it("disallows every workspace section, because each renders tenant-scoped data", () => {
    const disallowed = new Set([...robots.matchAll(/^Disallow:\s*(\S+)$/gm)].map(match => match[1]!));
    const missing = workspaceSections.filter(section => !disallowed.has(`/${section}`));
    expect(missing, "an indexed workspace URL is a dead link for a crawler and exposes the account surface").toEqual([]);
    for (const path of ["/account", "/reviews", "/setup"]) {
      expect(disallowed, `${path} must be disallowed`).toContain(path);
    }
  });

  it("does not disallow a page it also advertises", () => {
    const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)$/gm)].map(match => match[1]!);
    const contradictory = listed.filter(path => disallowed.includes(path));
    expect(contradictory, "telling a crawler to index and not index the same path is a drift signal").toEqual([]);
  });
});
