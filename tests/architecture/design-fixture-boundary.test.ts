import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// connectedDesignFixture is a hardcoded "Northstar workspace" shipped into the client bundle. It
// is a reasonable design harness, but it renders the same screens a real customer sees, so the
// gate that keeps it out of production is load-bearing: if it ever opened, a visitor could be
// shown a workspace that does not exist.

const source = readFileSync("apps/web/src/app/live-connections.tsx", "utf8");

describe("design fixture boundary", () => {
  it("needs the build flag, the tour, and an explicit query parameter, all three", () => {
    const gate = source.slice(source.indexOf("const designFixtureRequested"), source.indexOf("if (sampleTour) return"));
    expect(gate).toContain('process.env.NEXT_PUBLIC_BUILDIT_E2E === "1"');
    expect(gate).toContain("sampleTour");
    expect(gate).toContain('get("fixture") === "connected"');
  });

  // A signed-in customer must never be served the fixture, whatever is in the URL.
  it("is unreachable on any path that is not the sample tour", () => {
    expect(source).toContain("if (sampleTour) return hydrated && designFixtureRequested ? connectedDesignFixture : signedOutConnection;");
    // The only two places the fixture is named: its definition and that one guarded return.
    expect(source.match(/connectedDesignFixture/g) ?? []).toHaveLength(2);
  });

  // The production build does not set the flag, so the branch is dead in a deployed bundle.
  it("is not enabled by the production build", () => {
    const workflows = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflows).not.toMatch(/NEXT_PUBLIC_BUILDIT_E2E:\s*"?1"?\s*$/m);
  });

  // The screenshots rendered from it must not be cited as connected-state evidence.
  it("says what its screenshots actually prove", () => {
    const readme = readFileSync("tests/e2e/__screenshots__README.md", "utf8");
    expect(readme).toContain("layout and accessibility evidence");
    expect(readme).toContain("connectedJourney.test.ts");
    const accessibility = readFileSync("tests/e2e/accessibility.spec.ts", "utf8");
    expect(accessibility).toContain("design fixture, not live data");
  });
});
