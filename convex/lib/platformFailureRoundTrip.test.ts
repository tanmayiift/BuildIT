import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPlatformFailure, isPlatformFailureReason } from "./platformFailureReport";

// platformFailureReport says its own output is not a valid input to it. fallbackOrReport was doing
// exactly that - re-classifying a reason reviewAutofixData.failPlatform had already classified - so
// `model_unavailable` degraded to `platform_error`, which is not in the fallback set. A workspace
// with a second provider key never failed over when the first key was revoked or rotated.
//
// The reason list is deliberately not exported; this reads it through the public predicate rather
// than widening the module's surface for a test.
const reasons = ["provider_rate_limited", "provider_quota_exhausted", "repository_too_large",
  "repository_access_refused", "model_unavailable", "change_too_large", "platform_misconfigured",
  "sandbox_unavailable", "platform_error"] as const;

describe("a stored failure reason survives being read back", () => {
  it("recognises every reason it can store, and nothing else", () => {
    for (const reason of reasons) expect(isPlatformFailureReason(reason), reason).toBe(true);
    expect(isPlatformFailureReason("not_a_reason")).toBe(false);
    expect(isPlatformFailureReason(undefined)).toBe(false);
  });

  it("names a reason that does not round-trip, so the guard is not decorative", () => {
    const lost = reasons.filter(reason => classifyPlatformFailure(reason) !== reason);
    // If nothing degraded, re-classifying would be harmless and the fix pointless. It does.
    expect(lost.length).toBeGreaterThan(0);
    expect(lost).toContain("model_unavailable");
  });

  it("is what fallbackOrReport uses, rather than classifying a stored reason again", () => {
    const source = readFileSync(join(process.cwd(), "convex/durableReview.ts"), "utf8");
    expect(source, "a stored reason must be passed through, not re-derived").toMatch(/isPlatformFailureReason\(review\.statusReasonCode\)/);
  });
});
