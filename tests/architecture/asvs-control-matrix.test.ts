import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Matrix = { standard: string; source: string; scope: string; controls: Array<{ id: string; area: string; status: "automated" | "manual_required" | "external_required"; evidence: string[] }> };
const matrix = JSON.parse(readFileSync("docs/security/asvs-control-matrix.json", "utf8")) as Matrix;

describe("security release control matrix", () => {
  it("pins the stable ASVS version and disclaims certification", () => {
    expect(matrix.standard).toBe("OWASP ASVS 5.0.0");
    expect(matrix.source).toContain("/v5.0.0");
    expect(matrix.scope).toContain("not an OWASP certification");
  });
  it("maps every automated control to existing executable evidence", () => {
    const automated = matrix.controls.filter(item => item.status === "automated");
    expect(automated.length).toBeGreaterThanOrEqual(10);
    for (const control of automated) {
      expect(control.id).toMatch(/^v5\.0\.0-\d+\.\d+\.\d+$/);
      expect(control.area).not.toBe("");
      expect(control.evidence.length).toBeGreaterThan(0);
      for (const path of control.evidence) expect(existsSync(path), `${control.id}: ${path}`).toBe(true);
    }
  });
  it("never represents independent penetration testing as automated", () => {
    expect(matrix.controls.find(item => item.id === "external-penetration-test")).toEqual({ id: "external-penetration-test", area: "independent adversarial assessment", status: "external_required", evidence: [] });
  });
});
