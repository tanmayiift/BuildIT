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
