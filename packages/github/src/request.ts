// packages/github had no handling of HTTP 429, Retry-After, x-ratelimit-* or GitHub's secondary
// rate limits: a 429 fell into the generic !response.ok branch and became an immediate hard
// failure. repository-content issues up to 10,000 blob GETs in batches of 8 per review, which is
// exactly the pattern that triggers a secondary limit. Only GitHubAppClient set a request
// timeout, so every other client could hang until the platform killed the function.

export type GitHubHttp = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const defaultRequestTimeoutMs = 30_000;
const maxRetries = 3;
const maxBackoffMs = 30_000;

function isTimeout(error: unknown) {
  const name = (error as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

// GitHub answers a primary limit with 403 or 429 plus x-ratelimit-remaining: 0 and a reset epoch,
// and a secondary limit with 403 plus Retry-After. Both mean wait, not fail.
export function rateLimitDelayMs(response: Response, now: number): number | undefined {
  if (response.status !== 429 && response.status !== 403) return undefined;
  const header = response.headers.get("retry-after");
  const retryAfter = header === null ? Number.NaN : Number(header);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1_000, maxBackoffMs);
  if (response.headers.get("x-ratelimit-remaining") !== "0") return undefined;
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(reset)) return undefined;
  return Math.min(Math.max(0, reset * 1_000 - now), maxBackoffMs);
}

export function githubRequester(
  http: GitHubHttp = fetch,
  options: { timeoutMs?: number; now?: () => number; wait?: (ms: number) => Promise<void> } = {},
): GitHubHttp {
  const timeoutMs = options.timeoutMs ?? defaultRequestTimeoutMs;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const signal = init?.signal ?? AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await http(input, { ...init, signal });
      } catch (error) {
        if (isTimeout(error) || signal.aborted) throw new Error("github_timeout");
        throw error;
      }
      const delay = rateLimitDelayMs(response, now());
      // Retrying past the cap would hold the review's lease longer than waiting is worth; the
      // caller sees the rate-limit response and fails with a code that says so.
      if (delay === undefined || attempt >= maxRetries) return response;
      await wait(delay);
    }
  };
}
