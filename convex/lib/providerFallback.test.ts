import { describe, expect, it } from "vitest";
import { fallbackWorthTrying, orderCredentialsByHealth, providerQuotaCooldownMs, providerQuotaSuppressed } from "./providerFallback";

describe("provider fallback", () => {
  it("moves to another connected provider when the provider was the problem", () => {
    expect(fallbackWorthTrying({ reason: "provider_rate_limited", alternatives: ["openai"] })).toBe("openai");
    expect(fallbackWorthTrying({ reason: "model_unavailable", alternatives: ["google", "openai"] })).toBe("google");
  });

  // Regression: splitting the provider 429 into `rate_limited` (transient) and `quota_exhausted`
  // (the account is out of credit) made the message honest and silently switched the fallback off.
  // `provider_rate_limited` was in this set; `provider_quota_exhausted` was not, so the accurate
  // classification was the one reason that could never reach another key. It is the reason that
  // most needs one: a spent account answers the same way until someone pays it, and waiting is the
  // single thing that cannot help.
  it("moves to another provider when the account is out of credit, not just rate limited", () => {
    expect(fallbackWorthTrying({ reason: "provider_quota_exhausted", alternatives: ["gemini"] })).toBe("gemini");
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

describe("ordering credentials for a new review", () => {
  const now = 1_700_000_000_000;
  const openai = { provider: "openai", quotaExhaustedAt: now - 60_000, lastValidatedAt: now - 1_000, createdAt: 0 };
  const gemini = { provider: "gemini", lastValidatedAt: now - 500_000, createdAt: 0 };

  // The production shape this exists for: OpenAI was validated most recently and its account has no
  // credit; Gemini was validated earlier and works. Sorting on recency alone picked the dead one for
  // every webhook-triggered review, which then spent a whole review failing before the fallback
  // could start a second one on the key that was going to answer.
  it("puts a key whose account just reported no credit behind one that did not", () => {
    expect(orderCredentialsByHealth([openai, gemini], now).map(item => item.provider)).toEqual(["gemini", "openai"]);
  });

  it("still offers an exhausted key when it is the only one", () => {
    expect(orderCredentialsByHealth([openai], now)).toHaveLength(1);
  });

  it("goes back to recency once the cooldown has passed", () => {
    const later = now + providerQuotaCooldownMs + 1;
    expect(orderCredentialsByHealth([openai, gemini], later).map(item => item.provider)).toEqual(["openai", "gemini"]);
  });

  it("treats a credential that never reported exhaustion as healthy", () => {
    expect(providerQuotaSuppressed(undefined, now)).toBe(false);
  });
});
