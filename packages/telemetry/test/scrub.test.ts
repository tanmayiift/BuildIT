import { describe, expect, it } from "vitest";
import { scrubSpanAttributes, scrubUrl, scrubUrlSpanProcessor } from "../src/scrub.js";

// safeAttributes governs the attributes BuildIT sets. It has nothing to say about the ones
// @vercel/otel's fetch instrumentation adds behind it, which is where http.url and url.full come
// from - so the product's source-free telemetry claim did not cover them.
describe("span URL scrubbing", () => {
  it("keeps the origin and drops everything that identifies the tenant", () => {
    expect(scrubUrl("https://api.github.com/repositories/12345/git/blobs/abcdef")).toBe("https://api.github.com");
    expect(scrubUrl("https://bucket.s3.eu-west-1.amazonaws.com/artifacts/org-a/repo-b/review-c/context.json")).toBe("https://bucket.s3.eu-west-1.amazonaws.com");
    expect(scrubUrl("https://api.github.com/repos/acme/secret-project/pulls/7")).toBe("https://api.github.com");
  });

  it("drops a query string, where a token would be", () => {
    expect(scrubUrl("https://example.com/x?token=abcdef&sig=zzz")).toBe("https://example.com");
  });

  it("redacts rather than passing through something it cannot parse", () => {
    expect(scrubUrl("not a url")).toBe("[redacted]");
    expect(scrubUrl(undefined)).toBe("[redacted]");
  });

  it("scrubs every attribute that can carry a path", () => {
    const attributes = {
      "http.url": "https://api.github.com/repos/acme/api/pulls/7",
      "url.full": "https://api.github.com/repos/acme/api/pulls/7",
      "http.target": "/repos/acme/api/pulls/7",
      "url.path": "/repos/acme/api",
      "url.query": "token=abc",
      "db.statement": "select * from reviews",
      "http.status_code": 200,
    };
    scrubSpanAttributes(attributes);
    expect(JSON.stringify(attributes)).not.toContain("acme");
    expect(JSON.stringify(attributes)).not.toContain("token=abc");
    // Timing and status are what the operator dashboards are built on, so they stay.
    expect(attributes["http.status_code"]).toBe(200);
  });

  it("leaves a span with no URL attributes untouched", () => {
    const attributes = { "buildit.operation": "review.decision", "http.status_code": 200 };
    expect(scrubSpanAttributes({ ...attributes })).toEqual(attributes);
  });

  it("runs as a span processor on end", async () => {
    const processor = scrubUrlSpanProcessor();
    const span = { attributes: { "http.url": "https://api.github.com/repos/acme/api" } };
    processor.onEnd(span);
    expect(span.attributes["http.url"]).toBe("https://api.github.com");
    await expect(processor.forceFlush()).resolves.toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });
});
