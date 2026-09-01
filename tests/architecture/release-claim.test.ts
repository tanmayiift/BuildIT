import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("release claim guard", () => {
  it("cannot call the product ready while a canonical blocker is open", () => {
    const register = JSON.parse(read("docs/validation/release-blockers.json")) as { verdictWhileOpen: string; blockers: Array<{ id: string; state: string; dependency: string }> };
    const report = read("docs/evidence/release-validation-2026-09-01.md").toLowerCase();
    const open = register.blockers.filter(item => item.state === "open");
    expect(open.length).toBeGreaterThan(0);
    expect(register.verdictWhileOpen).toBe("not_ready");
    expect(report).toContain("not ready");
    expect(report).not.toMatch(/verdict:\s*production ready/);
    expect(new Set(register.blockers.map(item => item.id)).size).toBe(register.blockers.length);
  });

  it("distinguishes deferred commercial work from active initial-release evidence", () => {
    const register = JSON.parse(read("docs/validation/release-blockers.json")) as { blockers: Array<{ id: string; state: string; dependency: string }> };
    const deferred = register.blockers.filter(item => item.state === "deferred");
    expect(deferred.map(item => item.id).sort()).toEqual(["external-security-audit", "tracker-and-email-integrations"]);
    expect(deferred.every(item => item.dependency.includes("initial") || item.dependency.includes("core GitHub review"))).toBe(true);
  });
});
