import { describe, expect, it } from "vitest";
import { fallbackWorthTrying } from "./providerFallback";

describe("provider fallback", () => {
  it("moves to another connected provider when the provider was the problem", () => {
    expect(fallbackWorthTrying({ reason: "provider_rate_limited", alternatives: ["openai"] })).toBe("openai");
    expect(fallbackWorthTrying({ reason: "model_unavailable", alternatives: ["google", "openai"] })).toBe("google");
  });

  it("does not move for a failure another model would repeat", () => {
    for (const reason of ["repository_too_large", "change_too_large", "platform_misconfigured", "platform_error", "repository_access_refused"] as const) {
      expect(fallbackWorthTrying({ reason, alternatives: ["openai"] }), reason).toBeUndefined();
    }
  });

  it("does not chain: a fallback that fails does not start another", () => {
    expect(fallbackWorthTrying({ reason: "provider_rate_limited", alternatives: ["openai"], parentReviewId: "abc" })).toBeUndefined();
  });

  it("does nothing when there is no other key connected", () => {
    expect(fallbackWorthTrying({ reason: "provider_rate_limited", alternatives: [] })).toBeUndefined();
  });
});
