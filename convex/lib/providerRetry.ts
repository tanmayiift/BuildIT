// A single 429 or one 5xx ended the whole review: `providerRetryCount` has existed on every review
// row since the schema was written and was never incremented. Eight of thirty production failures
// were `rate_limited` or `malformed_response` from one attempt.
//
// What is worth retrying is narrow. A rate limit and a provider outage pass on their own. A key
// that cannot reach the model (401, 403, 404) will answer the same way forever, and retrying it
// only spends the review's time before telling the user the one thing they could have acted on.
export const maxProviderAttempts = 3;

const retryable = /(?:^|[^a-z])(?:rate_limited|provider_unavailable|timeout|aborted)(?:$|[^a-z])|http_(?:408|425|429|5\d\d)/i;
const permanent = /invalid_key|model_unavailable|http_(?:400|401|403|404|422)/i;

export function isRetryableProviderReason(reason: string) {
  if (permanent.test(reason)) return false;
  return retryable.test(reason);
}

// A 404 from a provider means the key cannot reach that model. It arrived as `malformed_response`,
// which reads as a garbled body and invites a retry that cannot succeed.
export function providerReasonIsModelUnavailable(reason: string) {
  return /http_(?:401|403|404)|invalid_key/i.test(reason);
}

// Exponential with a floor, and the provider's own Retry-After wins when it sends one — it knows
// when its window resets and guessing shorter just burns an attempt.
export function retryDelayMs(attempt: number, retryAfterSeconds?: number) {
  const backoff = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  const advised = retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? Math.min(60_000, retryAfterSeconds * 1_000)
    : 0;
  return Math.max(backoff, advised);
}
