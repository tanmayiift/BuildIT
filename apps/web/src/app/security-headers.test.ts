import { describe, expect, it } from "vitest";
import config from "../../next.config";

describe("web security headers", () => {
  it("applies a fail-closed browser policy to every route", async () => {
    const rules = await config.headers?.();
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.source).toBe("/(.*)");
    const headers = new Map(rules?.[0]?.headers.map((item) => [item.key, item.value]));
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(headers.get("Content-Security-Policy")).not.toContain("unsafe-eval");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });
});
