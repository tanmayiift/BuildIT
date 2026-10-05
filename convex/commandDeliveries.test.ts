import { generateKeyPairSync } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { noReviewToAnswerFrom } from "./reviewAskWorker";

const modules = import.meta.glob("./**/*.ts");

// GitHub, stubbed at the HTTP boundary: an installation token, the sender's permission, and the
// comment endpoints. The App key is generated per run, never written into the tree.
function stubGitHub(calls: Array<{ url: string; method: string; body?: string }>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET";
    calls.push({ url, method, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (url.endsWith("/access_tokens")) return Response.json({ token: "installation-token", expires_at: new Date(Date.now() + 3_600_000).toISOString() }, { status: 201 });
    if (url.includes("/collaborators/")) return Response.json({ permission: "write" });
    if (url.endsWith("/installation/token")) return new Response(null, { status: 204 });
    if (url.includes("/comments?")) return Response.json([]);
    if (url.includes("/comments") && method === "POST") return Response.json({ id: 7, html_url: "https://github.com/ledgerline/api/pull/7#issuecomment-7" }, { status: 201 });
    return new Response("not stubbed", { status: 500 });
  });
}

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async ctx => {
    const organizationId = await ctx.db.insert("organizations", { name: "Ledgerline", slug: "ledgerline", timezone: "UTC",
      region: "eu-west-1", retentionHours: 24, monthlyBudget: 50, concurrencyLimit: 3, createdAt: 1 });
    const installationId = await ctx.db.insert("githubInstallations", { organizationId, installationId: 123, accountLogin: "ledgerline", accountType: "user",
      permissionSnapshot: { metadata: "read", contents: "read", pullRequests: "write", issues: "read", checks: "write" }, status: "active", createdAt: 1, updatedAt: 1 });
    const repositoryId = await ctx.db.insert("repositories", { organizationId, installationId, githubRepositoryId: 42, owner: "ledgerline", name: "api",
      defaultBranch: "main", enabled: true, autofixMode: "stacked", forkPolicy: "manual_review_only", indexState: "ready", concurrencyLimit: 1, createdAt: 1, updatedAt: 1 });
    return { organizationId, repositoryId };
  });
}

const delivery = (t: ReturnType<typeof convexTest>, deliveryId: string) =>
  t.run(async ctx => (await ctx.db.query("webhookDeliveries").collect()).find(row => row.deliveryId === deliveryId));

describe("PR commands that hand their work elsewhere", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  // They returned without marking the delivery done, so every one stayed "received" for good.
  for (const command of ["@buildit help", "@buildit ask why inconclusive?", "@buildit pause", "@buildit dismiss 1"]) {
    it(`completes its delivery: ${command}`, async () => {
      vi.stubEnv("GITHUB_APP_ID", "1");
      vi.stubEnv("GITHUB_APP_PRIVATE_KEY", generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString());
      vi.stubGlobal("fetch", stubGitHub([]));
      const t = convexTest(schema, modules); await seed(t);
      const deliveryId = `delivery-${command.split(" ")[1]}`;
      await t.run(ctx => ctx.db.insert("webhookDeliveries", { deliveryId, event: "issue_comment", action: "created", installationId: 123,
        signatureValid: true, disposition: "processed", status: "received", receivedAt: 1 }));
      await t.action(internal.githubWebhookProcessor.processWebhook, { deliveryId, installationId: 123, githubRepositoryId: 42, prNumber: 7,
        senderLogin: "maintainer", senderType: "User", commentAction: "created", command });
      expect(await delivery(t, deliveryId)).toMatchObject({ disposition: "processed", status: "completed" });
    });
  }
});

describe("a question with no finished review to answer from", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  // It used to get no reply at all. Refusing to answer across a newer failure is deliberate; saying so is not optional.
  it("gets a reply saying why, instead of silence", async () => {
    vi.stubEnv("GITHUB_APP_ID", "1");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", stubGitHub(calls));
    const t = convexTest(schema, modules), seeded = await seed(t);
    const result = await t.action(internal.reviewAskWorker.answer, { organizationId: seeded.organizationId, repositoryId: seeded.repositoryId,
      prNumber: 7, question: "why inconclusive?", askedBy: "a".repeat(64) });
    expect(result).toEqual({ answered: false, reason: "no_review" });
    const posted = calls.find(call => call.method === "POST" && call.url.endsWith("/issues/7/comments"));
    expect(posted?.body).toContain(JSON.stringify(noReviewToAnswerFrom).slice(1, 40));
  });
});
