import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { issueModelInvocationGrant, verifyModelInvocationGrant } from "@buildit/security";

// A model grant is single-use on purpose: the broker consumes its grantId, so a token that arrives
// twice is a replay and is refused. The analysis worker minted one grant and then re-sent it on
// every provider retry, which meant the retry path could never succeed - the second attempt was
// always rejected as `model_grant_replayed`, and the review died as a platform failure instead of
// retrying through a rate limit or a transient 5xx.
//
// That is where "random platform errors" came from. They were not random: they were every review
// that needed a retry. It was found by a real review of sindresorhus/got failing the same way three
// times running while a smaller repository succeeded.

const secret = new Uint8Array(32).fill(7);
const claims = {
  organizationId: "org-1", repositoryId: "repo-1", reviewId: "review-1", credentialScopeId: "cred-1",
  provider: "openai" as const, model: "gpt-5.6", stage: "findings" as const,
  requestHash: "a".repeat(64),
};

// The broker's consume(): a grantId may be spent exactly once.
function broker() {
  const spent = new Set<string>();
  return async (grantId: string) => (spent.has(grantId) ? false : (spent.add(grantId), true));
}

describe("a grant is single-use, so every attempt needs its own", () => {
  it("refuses the same token twice, which is why re-sending one breaks the retry", async () => {
    const consume = broker();
    const token = issueModelInvocationGrant({ ...claims, ttlMs: 60_000 }, secret);

    await expect(verifyModelInvocationGrant(token, secret, { consume })).resolves.toBeDefined();
    await expect(verifyModelInvocationGrant(token, secret, { consume })).rejects.toThrow("model_grant_replayed");
  });

  it("accepts a freshly minted grant for the identical request", async () => {
    const consume = broker();
    // Same claims, same requestHash - a retry of the same call, not a different one.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = issueModelInvocationGrant({ ...claims, ttlMs: 60_000 }, secret);
      await expect(verifyModelInvocationGrant(token, secret, { consume })).resolves.toMatchObject({
        reviewId: "review-1", stage: "findings", requestHash: claims.requestHash,
      });
    }
  });

  it("still binds the request, so a fresh grant cannot be pointed at different content", async () => {
    const token = issueModelInvocationGrant({ ...claims, ttlMs: 60_000 }, secret);
    const grant = await verifyModelInvocationGrant(token, secret, { consume: broker() });
    expect(grant.requestHash).toBe(claims.requestHash);
  });
});

// The regression itself lives in the caller, so this pins the caller.
describe("what the analysis worker sends", () => {
  const worker = readFileSync(join(import.meta.dirname, "../../convex/reviewAnalysisWorker.ts"), "utf8");
  const retryLoop = worker.slice(worker.indexOf("for (let attempt = 1; attempt <= maxProviderAttempts"));

  it("mints a grant inside the retry loop, not once outside it", () => {
    const authorization = retryLoop.slice(0, retryLoop.indexOf("\n        }"));
    expect(authorization, "the retry must not re-send a token a previous attempt already spent")
      .toMatch(/authorization: `Bearer \$\{mintGrant\(\)\}`/);
  });

  it("does not keep a single reusable grant in scope for the loop", () => {
    const code = worker.replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/const grant = issueModelInvocationGrant/);
  });
});
