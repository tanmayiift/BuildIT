import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxy from "./proxy";
import { known } from "./route-map";
import { publicRoutes } from "./app/public-routes";
import { workspaceSections } from "./app/workspace-sections";
import { publicAssets } from "./public-assets";

const unknownPaths = ["/settings", "/setup/github", "/setup/run", "/audit-nonexistent-route", "/_not-found", "/audit-nonexistent-route/child", "/reviews/123/extra", "/setup"];
describe("unknown route responses finish at the proxy", () => {
  it.each(unknownPaths)("returns a complete 404 without rewriting %s into the internal not-found route", async pathname => {
    const response = proxy(new NextRequest(`http://127.0.0.1:3107${pathname}`));
    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("That page does not exist");
    expect(body).toContain('href="/"'); expect(body).toContain('href="/reviews"');
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });
  it("answers HEAD without a body or a rewrite", async () => {
    const response = proxy(new NextRequest("http://127.0.0.1:3107/settings", { method: "HEAD" }));
    expect(response.status).toBe(404); expect(response.headers.get("x-middleware-rewrite")).toBeNull(); expect(await response.text()).toBe("");
  });
  it("does not echo an untrusted URL into the error page", async () => {
    const response = proxy(new NextRequest("http://127.0.0.1:3107/unknown?message=%3Cscript%3Esecret%3C/script%3E"));
    expect(await response.text()).not.toContain("secret");
  });
});

describe("route inventory and existing security forwarding", () => {
  const existing = [...publicRoutes, ...workspaceSections.map(section => `/${section}`), ...publicAssets,
    "/reviews", "/reviews/review_123", "/account", "/setup/install", "/setup/repository", "/setup/model", "/setup/health", "/setup/tracker", "/setup/review"];
  it.each(existing)("continues to allow the existing route %s", pathname => {
    expect(known(pathname)).toBe(true);
    const response = proxy(new NextRequest(`http://127.0.0.1:3107${pathname}`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    const nonce = response.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(response.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(response.headers.get("content-security-policy"));
  });
  it.each(unknownPaths)("does not claim a nonexistent route exists: %s", pathname => expect(known(pathname)).toBe(false));
  it("replaces a forged nonce and creates a new nonce for each request", () => {
    const request = new NextRequest("http://127.0.0.1:3107/account", { headers: { "x-nonce": "forged", cookie: "fixture_session=preserved" } });
    const first = proxy(request), second = proxy(request);
    expect(first.headers.get("x-middleware-request-x-nonce")).not.toBe("forged");
    expect(first.headers.get("x-middleware-request-x-nonce")).not.toBe(second.headers.get("x-middleware-request-x-nonce"));
    expect(first.headers.get("x-middleware-request-cookie")).toBe("fixture_session=preserved");
  });
});
