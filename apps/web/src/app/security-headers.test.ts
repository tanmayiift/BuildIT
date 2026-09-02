import { describe, expect, it } from "vitest";
import config from "../../next.config";
import { contentSecurityPolicy } from "../security-policy";

// The old version of this test asserted only that the policy did not contain "unsafe-eval" and
// never inspected script-src at all - so its stated claim of a "fail-closed browser policy" was
// not backed by its assertions, while script-src carried 'unsafe-inline' with no nonce.

describe("web security headers", () => {
  it("applies a fail-closed browser policy to every route", async () => {
    const rules = await config.headers?.();
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.source).toBe("/:path*");
    const headers = new Map(rules?.[0]?.headers.map(item => [item.key, item.value]));
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  // upgrade-insecure-requests is not a substitute: it does not protect the first navigation,
  // which is exactly the one an attacker on the network wants.
  it("sends HSTS, long-lived and preloadable", async () => {
    const rules = await config.headers?.();
    const headers = new Map(rules?.[0]?.headers.map(item => [item.key, item.value]));
    const hsts = headers.get("Strict-Transport-Security") ?? "";
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).toContain("preload");
    expect(Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0)).toBeGreaterThanOrEqual(31_536_000);
  });

  it("does not name the framework and version to anyone scanning", () => {
    expect(config.poweredByHeader).toBe(false);
  });
});

describe("content security policy", () => {
  const policy = contentSecurityPolicy("test-nonce");
  const directive = (name: string) => policy.split("; ").find(part => part.startsWith(`${name} `));

  it("pins the directives that decide what the page can reach", () => {
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("connect-src")).toContain("https://*.convex.cloud");
  });

  // The old test asserted only that the whole policy did not contain "unsafe-eval" and never
  // inspected script-src at all, so its claim of a "fail-closed browser policy" was not backed by
  // its assertions - while script-src carried 'unsafe-inline' with no nonce.
  it("allows inline script only by nonce, with no host or inline fallback", () => {
    expect(directive("script-src")).toBe("script-src 'nonce-test-nonce' 'strict-dynamic'");
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
    expect(directive("script-src")).not.toContain("'unsafe-eval'");
    expect(directive("script-src")).not.toContain("'self'");
  });

  // style-src keeps 'unsafe-inline' deliberately: Next injects inline styles, and inline CSS is
  // not the vector inline script is.
  it("keeps the deliberate style-src allowance and nothing more", () => {
    expect(directive("style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("gives every request its own nonce", () => {
    expect(contentSecurityPolicy("a")).not.toBe(contentSecurityPolicy("b"));
    expect(contentSecurityPolicy("a")).toContain("'nonce-a'");
  });

  it("never allows eval in a production build", () => {
    expect(policy).not.toContain("unsafe-eval");
  });
});
