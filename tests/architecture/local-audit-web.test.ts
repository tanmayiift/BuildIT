import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain Node script used before any build.
import { localAuditWebPolicy } from "../../scripts/lib/local-audit-web.mjs";

const productionSource = readFileSync("apps/web/src/security-policy.ts", "utf8");
describe("the isolated browser fixture connection policy", () => {
  it("allows the fixture HTTP and WebSocket connections without widening any other policy directive", () => {
    const copy = localAuditWebPolicy(productionSource);
    expect(copy).toContain("http://127.0.0.1:3218 ws://127.0.0.1:3218");
    expect(copy.replace(" http://127.0.0.1:3218 ws://127.0.0.1:3218", "")).toBe(productionSource);
    expect(productionSource).not.toContain("127.0.0.1");
  });
  it("refuses to silently patch an unexpected production policy", () => {
    expect(() => localAuditWebPolicy("export const policy = 'new format';")).toThrow("local_audit_csp_shape_changed");
  });
});
