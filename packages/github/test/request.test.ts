import { describe, expect, it, vi } from "vitest";
import { githubRequester, rateLimitDelayMs } from "../src/request.js";

// packages/github had no handling of 429, Retry-After, x-ratelimit-* or GitHub's secondary rate
// limits: a 429 fell into the generic !response.ok branch and became an immediate hard failure.
// repository-content issues up to 10,000 blob GETs in batches of 8 per review, which is exactly
// the pattern that triggers a secondary limit - so this was a predictable failure on large repos,
// not an edge case. Only GitHubAppClient set a timeout, so every other client could hang.

const limited = (headers: Record<string, string>, status = 429) => new Response("", { status, headers });

describe("GitHub rate limits", () => {
  it("reads a Retry-After delay", () => {
    expect(rateLimitDelayMs(limited({ "retry-after": "12" }), 0)).toBe(12_000);
  });

  // GitHub answers a secondary limit with 403 plus Retry-After, not 429.
  it("reads a secondary limit answered as 403", () => {
    expect(rateLimitDelayMs(limited({ "retry-after": "5" }, 403), 0)).toBe(5_000);
  });

  it("reads a primary limit from the reset epoch", () => {
    const now = 1_000_000;
    expect(rateLimitDelayMs(limited({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String((now + 8_000) / 1_000) }, 403), now)).toBe(8_000);
  });

  it("does not treat an ordinary 403 as a rate limit", () => {
    expect(rateLimitDelayMs(limited({ "x-ratelimit-remaining": "42" }, 403), 0)).toBeUndefined();
    expect(rateLimitDelayMs(new Response("", { status: 404 }), 0)).toBeUndefined();
  });

  it("caps the wait rather than holding a review's lease indefinitely", () => {
    expect(rateLimitDelayMs(limited({ "retry-after": "86400" }), 0)).toBe(30_000);
  });

  it("waits and retries instead of failing the review", async () => {
    const waits: number[] = [];
    const http = vi.fn()
      .mockResolvedValueOnce(limited({ "retry-after": "2" }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const request = githubRequester(http, { wait: async ms => { waits.push(ms); } });
    await expect(request("https://api.github.com/x").then(response => response.status)).resolves.toBe(200);
    expect(waits).toEqual([2_000]);
  });

  it("gives up after a bounded number of retries and returns the response", async () => {
    const http = vi.fn().mockResolvedValue(limited({ "retry-after": "1" }));
    const request = githubRequester(http, { wait: async () => {} });
    await expect(request("https://api.github.com/x").then(response => response.status)).resolves.toBe(429);
    expect(http).toHaveBeenCalledTimes(4);
  });

  it("turns a hung socket into a timeout instead of hanging the review", async () => {
    const http = vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); });
    await expect(githubRequester(http)("https://api.github.com/x")).rejects.toThrow("github_timeout");
  });
});
