import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("two-user production browser harness", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const config = read("playwright.tenant.config.ts"), session = read("playwright.session.config.ts"), test = read("tests/e2e-production/two-user-isolation.spec.ts"),
    fixture = read("tests/live-browser.ts"), script = read("scripts/browser-evidence.mjs"), ignore = read(".gitignore");
  it("requires two distinct loopback browsers and an HTTPS target", () => {
    expect(config).toContain("two_user_production_evidence_required");
    expect(config).toContain("two_independent_browsers_required");
    expect(config).toContain("live_browser_must_be_loopback");
    expect(config).toMatch(/startsWith\("https:\/\/"\)/);
    expect(session).toContain("live_browser_must_be_loopback");
    expect(ignore).toContain(".local/");
  });
  it("runs the specs in the owner's own signed-in window, never from a saved login", () => {
    for (const source of [config, session, fixture]) expect(source).not.toMatch(/storageState\s*:/);
    expect(test).toContain('from "../live-browser"');
    expect(read("tests/e2e-session/signed-in-journey.spec.ts")).toContain('from "../live-browser"');
    expect(fixture).toContain("connectOverCDP");
  });
  it("covers every tenant-bearing customer surface and foreign direct review", () => {
    for (const route of ["/account", "/repositories", "/reviews", "/metrics", "/usage", "/setup/model", "/audit"]) expect(test).toContain(`"${route}"`);
    expect(test).toContain("foreignReview");
    expect(test).toContain("not.toContainText(values.foreignMarker");
  });
  it("does not print, copy, or commit browser state", () => {
    for (const forbidden of ["console.log", "readFileSync(values", "writeFile", "cookies()", "context.cookies"]) expect(test).not.toContain(forbidden);
    // The command checks that a session exists by its key, and signs it out at the end; it never
    // reads a token's value, a cookie, or a storage state.
    for (const forbidden of ["localStorage.getItem", "cookies(", "storageState", "trace: \"on"]) expect(script + fixture + config + session).not.toContain(forbidden);
    expect(script).toContain("Sign out this browser");
    expect(script).toMatch(/rmSync\(window\.profile/);
  });
});
