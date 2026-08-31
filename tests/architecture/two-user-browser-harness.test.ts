import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("two-user production browser harness", () => {
  const config = readFileSync("playwright.tenant.config.ts", "utf8"), test = readFileSync("tests/e2e-production/two-user-isolation.spec.ts", "utf8"), ignore = readFileSync(".gitignore", "utf8");
  it("requires two distinct ignored storage states and an HTTPS target", () => {
    expect(config).toContain("two_user_production_evidence_required");
    expect(config).toContain("two_independent_storage_states_required");
    expect(config).toContain(".local");
    expect(ignore).toContain(".local/");
  });
  it("covers every tenant-bearing customer surface and foreign direct review", () => {
    for (const route of ["/account", "/repositories", "/reviews", "/metrics", "/usage", "/setup/model", "/audit"]) expect(test).toContain(`"${route}"`);
    expect(test).toContain("foreignReview");
    expect(test).toContain("not.toContainText(values.foreignMarker");
  });
  it("does not print, copy, or commit browser state", () => {
    for (const forbidden of ["console.log", "readFileSync(values", "writeFile", "cookies()", "context.cookies"]) expect(test).not.toContain(forbidden);
  });
});
