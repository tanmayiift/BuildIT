import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPublicRoute } from "./public-routes";
import { workspaceSections } from "./workspace-sections";

// The sidebar's Overview entry pointed at "/", which is a public route. Clicking it while signed in
// dropped the reader out of the workspace chrome into the marketing shell - no sidebar, no way back
// except the brand link - and the product had no signed-in home at all: /reviews was the de facto
// one. The readiness strip lived on the marketing page, so the nav pointed where the component was.
//
// Nothing caught it because every individual piece was correct: "/" is a real route, it rendered, and
// the strip worked. The defect was only visible in the relationship between the two lists.
const shell = readFileSync(fileURLToPath(new URL("./app-shell.tsx", import.meta.url)), "utf8");
const hrefs = [...shell.matchAll(/href:\s*"([^"]+)"/g)].map(match => match[1]!);

describe("the signed-in sidebar", () => {
  it("names some routes, so an empty sweep cannot pass as a clean one", () => {
    expect(hrefs.length).toBeGreaterThan(5);
  });

  it("never points a workspace nav entry at a public route", () => {
    const escaping = hrefs.filter(href => isPublicRoute(href));
    expect(escaping, "a sidebar entry on a public route leaves the workspace chrome").toEqual([]);
  });

  it("points every entry at a route the app actually serves", () => {
    // /reviews and /account are real static routes; everything else must be a declared section.
    const known = new Set<string>(["/reviews", "/account", ...workspaceSections.map(section => `/${section}`)]);
    const unknown = hrefs.filter(href => !known.has(href));
    expect(unknown, "a sidebar entry for an undeclared section 404s through the Edge proxy").toEqual([]);
  });

  it("gives the workspace a home of its own", () => {
    expect(workspaceSections).toContain("overview");
    expect(hrefs).toContain("/overview");
  });
});
