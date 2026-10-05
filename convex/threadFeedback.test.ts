/// <reference types="vite/client" />
import { createHmac, randomBytes } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findingFingerprint } from "./lib/findingFingerprint";
import { inlineFinding } from "./reviewPublicationWorker";
import { summaryFixture } from "./testing/summaryFixture";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
// Assembled, not literal: a secret-shaped string anywhere in the tree fails the scanners on every review.
const webhookSecret = ["test", "webhook", "signing", "value"].join("-");

// Resolving a BuildIT inline thread is how a person says "not this one". The comment's marker used to
// carry the model's own id ("F1"), which matched no finding, so every resolved thread on every review
// recorded nothing - and the delivery was logged "rejected" on top. Both halves are pinned here,
// through the real route, signed the way GitHub signs.
describe("a resolved BuildIT thread", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  async function setUp() {
    vi.useFakeTimers();
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", webhookSecret);
    const t = convexTest(schema, modules), now = Date.now(), base = await summaryFixture(t, "threads", now - 10_000);
    const key = randomBytes(32), modelFinding = { id: "F1", path: "src/signer.py", startLine: 40, endLine: 44 };
    const findingId = await t.run(async ctx => {
      const repository = (await ctx.db.get(base.repositoryId))!;
      const artifactId = await ctx.db.insert("artifacts", { organizationId: base.organizationId, repositoryId: base.repositoryId, reviewId: base.reviewId, type: "review_message", storageKey: "test/report", encrypted: true, checksum: "a".repeat(64), size: 1, storageState: "stored", expiresAt: now + 60_000, deletionAttempts: 0 });
      const id = await ctx.db.insert("findings", { organizationId: base.organizationId, reviewId: base.reviewId, fingerprintHmac: findingFingerprint(modelFinding, key), pathHmac: "b".repeat(64), category: "correctness", severity: "high", confidence: 0.9, blocking: true, contentArtifactId: artifactId, evidenceIds: [artifactId], startLine: 40, endLine: 44, resolution: "open", createdAt: now, updatedAt: now, expiresAt: now + 60_000 });
      return { id, githubRepositoryId: repository.githubRepositoryId };
    });
    // What reviewPublicationWorker writes at the top of the inline comment.
    const marker = `<!-- buildit-review:inline-pr-1:${findingFingerprint(modelFinding, key)} -->`;
    const deliver = (deliveryId: string, body: string, action = "resolved") => {
      const payload = JSON.stringify({ action, installation: { id: 1 }, repository: { id: findingId.githubRepositoryId }, pull_request: { number: 1 },
        sender: { login: "maintainer", type: "User" }, thread: { comments: [{ body }] } });
      return t.fetch("/api/github/webhooks", { method: "POST", body: payload, headers: { "content-type": "application/json",
        "x-hub-signature-256": `sha256=${createHmac("sha256", webhookSecret).update(payload).digest("hex")}`,
        "x-github-delivery": deliveryId, "x-github-event": "pull_request_review_thread" } });
    };
    return { t, findingId: findingId.id, marker, deliver };
  }

  it("records the dismissal against the finding the marker names, and logs the delivery as processed", async () => {
    const { t, findingId, marker, deliver } = await setUp();
    expect((await deliver("thread-resolved-0001", `${marker}\n**high** — Per-call salt is ignored`)).status).toBe(202);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const feedback = await t.run(ctx => ctx.db.query("findingFeedback").collect());
    expect(feedback).toEqual([expect.objectContaining({ findingId, verdict: "dismissed" })]);
    const delivery = await t.run(async ctx => (await ctx.db.query("webhookDeliveries").collect()).find(row => row.deliveryId === "thread-resolved-0001"));
    expect(delivery).toMatchObject({ disposition: "processed", status: "completed" });
  });

  it("attributes nothing to a marker carrying a model id, which is what the old comments hold", async () => {
    const { t, deliver } = await setUp();
    await deliver("thread-resolved-0002", "<!-- buildit-review:inline-pr-1:F1 -->\n**high** — old comment");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run(ctx => ctx.db.query("findingFeedback").collect())).toEqual([]);
  });

  it("is published under the fingerprint the analysis stored, never the model's own id", () => {
    const key = randomBytes(32), arbitrated = { id: "F1", path: "src/signer.py", startLine: 40, endLine: 44, severity: "high", title: "Salt ignored", explanation: "x" };
    const published = inlineFinding(arbitrated, key);
    expect(published.id).toBe(findingFingerprint(arbitrated, key));
    expect(published.id).toMatch(/^[0-9a-f]{64}$/);
    expect(published).toMatchObject({ path: "src/signer.py", startLine: 40, endLine: 44 });
  });
});
