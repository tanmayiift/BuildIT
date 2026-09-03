import { describe, expect, it } from "vitest";
import { usageKind } from "./validators";

// The first version counted every model_tokens row for the review, so a review's own seven prompt
// stages used the entire allowance before anybody could ask a question about it - the limiter
// silently refused the very first `@buildit ask` on every fresh review. Questions are billed under
// their own kind now, which fixes the count and also makes asks separately visible in usage rather
// than hidden inside review spend.
describe("what a question is billed as", () => {
  it("has a kind of its own, distinct from review stages", () => {
    const members = (usageKind as unknown as { members: Array<{ value: string }> }).members.map(item => item.value);
    expect(members).toContain("ask_tokens");
    expect(members).toContain("model_tokens");
  });

  it("keeps the ask worker writing that kind, not the review one", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./reviewAskData.ts", import.meta.url), "utf8");
    expect(source).toContain('kind: "ask_tokens"');
    // The limiter must count questions, never the review's own stages.
    expect(source).toContain('item.kind === "ask_tokens" && item.reviewId === review._id');
    expect(source).not.toContain('item.kind === "model_tokens" && item.reviewId');
  });
});

// missing_model_invocation_secret: the ask worker invented an env var name that does not exist,
// and the failure only surfaced in production logs because the scheduler swallows it. Every secret
// a worker reads has to be one the deployment actually sets.
describe("the secrets the ask worker reads", () => {
  it("uses the same names as the worker it borrowed the grant flow from", async () => {
    const { readFileSync } = await import("node:fs");
    const ask = readFileSync(new URL("./reviewAskWorker.ts", import.meta.url), "utf8");
    const analysis = readFileSync(new URL("./reviewAnalysisWorker.ts", import.meta.url), "utf8");
    const names = (source: string) => new Set([...source.matchAll(/required\("([A-Z_]+)"\)/g)].map(match => match[1]!));
    const known = names(analysis);
    for (const name of names(ask)) {
      if (name.startsWith("GITHUB_")) continue;
      expect(known).toContain(name);
    }
  });
});
