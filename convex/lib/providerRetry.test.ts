import { describe, expect, it } from "vitest";
import { isRetryableProviderReason, providerReasonIsModelUnavailable, retryDelayMs } from "./providerRetry";

describe("provider retry", () => {
  // The reason strings the analysis worker actually builds, taken from production failures.
  it("retries what passes on its own", () => {
    for (const reason of ["rate_limited", "provider_unavailable", "provider_error:http_429", "provider_error:http_503", "http_500", "timeout"]) {
      expect(isRetryableProviderReason(reason), reason).toBe(true);
    }
  });

  it("never retries a key that cannot reach the model", () => {
    for (const reason of ["invalid_key", "malformed_response:http_404", "provider_error:http_401", "requirements:provider_error:malformed_response:http_404"]) {
      expect(isRetryableProviderReason(reason), reason).toBe(false);
    }
  });

  it("names a model the key cannot reach, instead of calling the body malformed", () => {
    expect(providerReasonIsModelUnavailable("requirements:provider_error:malformed_response:http_404")).toBe(true);
    expect(providerReasonIsModelUnavailable("rate_limited")).toBe(false);
  });

  it("backs off, and defers to Retry-After when the provider sends one", () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(2)).toBe(2_000);
    expect(retryDelayMs(1, 45)).toBe(45_000);
    expect(retryDelayMs(1, 0)).toBe(1_000);
    expect(retryDelayMs(9)).toBe(30_000);
    expect(retryDelayMs(1, 3_600)).toBe(60_000);
  });
});

// An exhausted balance arrives as http_429, which the retryable pattern matches on sight. It is not
// retryable: the account has no credit and the next attempt gets the same answer. `permanent` is
// tested first, which is what makes naming it there sufficient.
describe("a 429 that means the account is empty", () => {
  it("is never retried, however many times the status says 429", () => {
    expect(isRetryableProviderReason("quota_exhausted:http_429")).toBe(false);
  });

  it("leaves a real rate limit retryable", () => {
    expect(isRetryableProviderReason("rate_limited:http_429")).toBe(true);
  });
});
