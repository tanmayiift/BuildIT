import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// Every GitHub event reaches Convex through this one hop, and Convex verifies the HMAC over the exact
// bytes GitHub signed. So the proxy must forward the body byte for byte, carry the three GitHub
// headers the receiver reads, and nothing else - a cookie or an authorization header has no business
// leaving this function.
const body = new TextEncoder().encode('{"action":"created","zero":"\u0000","emoji":"🚀"}  \n');

function githubRequest(extra: Record<string, string> = {}) {
  return new Request("https://buildit.example/api/github/webhooks", { method: "POST", body, headers: {
    "content-type": "application/json", "x-github-delivery": "delivery-1", "x-github-event": "issue_comment",
    "x-hub-signature-256": "sha256=" + "a".repeat(64), cookie: "session=private", authorization: "Bearer private", ...extra } });
}

describe("the GitHub webhook proxy", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("forwards the signed bytes and only the GitHub headers, and returns Convex's answer", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://example-123.convex.site");
    const upstream = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("accepted", { status: 202, headers: { "content-type": "text/plain" } }));
    vi.stubGlobal("fetch", upstream);
    const response = await POST(githubRequest());
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("accepted");
    const [url, init] = upstream.mock.calls[0]!;
    expect(String(url)).toBe("https://example-123.convex.site/api/github/webhooks");
    expect(new Uint8Array(init!.body as ArrayBuffer)).toEqual(body);
    const sent = new Headers(init!.headers);
    expect([...sent.keys()].sort()).toEqual(["content-type", "x-github-delivery", "x-github-event", "x-hub-signature-256"]);
    expect(sent.get("x-hub-signature-256")).toBe("sha256=" + "a".repeat(64));
  });

  it("passes a refused signature straight back", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://example-123.convex.site");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid signature", { status: 401 })));
    const response = await POST(githubRequest());
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("invalid signature");
  });

  it("derives the .convex.site receiver from the client URL when no site URL is set", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example-123.convex.cloud");
    const upstream = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("accepted", { status: 202 }));
    vi.stubGlobal("fetch", upstream);
    await POST(githubRequest());
    expect(String(upstream.mock.calls[0]![0])).toBe("https://example-123.convex.site/api/github/webhooks");
  });

  it("answers 503 rather than guessing when no receiver is configured", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await POST(githubRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "webhook_unavailable" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers 503 when Convex cannot be reached, so GitHub retries the delivery", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://example-123.convex.site");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const response = await POST(githubRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "webhook_forward_failed" });
  });
});
