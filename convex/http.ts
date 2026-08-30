import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);
http.route({ path: "/api/github/webhooks", method: "POST", handler: httpAction(async (ctx, request) => {
  const rawBody = await request.arrayBuffer(), body = new Uint8Array(rawBody), signature = request.headers.get("x-hub-signature-256"), secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature || !await validSignature(rawBody, signature, secret)) return new Response("invalid signature", { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>; } catch { return new Response("invalid json", { status: 400 }); }
  const deliveryId = request.headers.get("x-github-delivery"), event = request.headers.get("x-github-event") ?? "unknown";
  if (!deliveryId) return new Response("missing delivery", { status: 400 });
  const action = typeof payload.action === "string" ? payload.action : "unknown", sender = payload.sender as { login?: unknown; type?: unknown } | undefined, installation = payload.installation as { id?: unknown } | undefined, repository = payload.repository as { id?: unknown } | undefined, comment = payload.comment as { body?: unknown } | undefined, issue = payload.issue as { number?: unknown; pull_request?: unknown } | undefined;
  const pullRequest = payload.pull_request as { number?: unknown; head?: { sha?: unknown } } | undefined;
  const pushRef = payload.ref, pushAfter = payload.after;
  const disposition = sender?.type === "Bot" ? "ignored_bot" : action === "edited" ? "ignored_edit" : "processed";
  const reserved = await ctx.runMutation(internal.githubWebhookData.reserve, { deliveryId, event, action, installationId: typeof installation?.id === "number" ? installation.id : undefined, disposition, now: Date.now() });
  if (reserved.duplicate) return new Response("duplicate", { status: 202 });
  if (disposition !== "processed") return new Response("ignored", { status: 202 });
  if (event === "issue_comment" && issue?.pull_request && typeof issue.number === "number" && Number.isInteger(issue.number) && issue.number > 0 && typeof installation?.id === "number" && typeof repository?.id === "number" && typeof sender?.login === "string" && typeof sender.type === "string" && typeof comment?.body === "string") {
    await ctx.scheduler.runAfter(0, internal.githubWebhookProcessor.processWebhook, { deliveryId, installationId: installation.id, githubRepositoryId: repository.id, prNumber: issue.number, senderLogin: sender.login, senderType: sender.type, commentAction: action, command: comment.body.slice(0, 200) });
  } else if (event === "pull_request" && typeof installation?.id === "number" && typeof repository?.id === "number" && typeof pullRequest?.number === "number" && typeof pullRequest.head?.sha === "string") {
    await ctx.scheduler.runAfter(0, internal.githubWebhookProcessor.processPullRequestWebhook, { deliveryId, installationId: installation.id, githubRepositoryId: repository.id, prNumber: pullRequest.number, headSha: pullRequest.head.sha });
  } else if (event === "push" && typeof installation?.id === "number" && typeof repository?.id === "number" && typeof pushRef === "string" && typeof pushAfter === "string") {
    await ctx.scheduler.runAfter(0, internal.githubWebhookProcessor.processPushWebhook, { deliveryId, installationId: installation.id, githubRepositoryId: repository.id, ref: pushRef, afterSha: pushAfter });
  } else await ctx.runMutation(internal.githubWebhookData.complete, { deliveryId, disposition: "rejected", status: "completed", now: Date.now() });
  return new Response("accepted", { status: 202 });
}) });

async function validSignature(body: ArrayBuffer, header: string, secret: string) {
  if (!/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, body)), actual = Uint8Array.from(header.slice(7).match(/../g) ?? [], value => Number.parseInt(value, 16));
  if (actual.length !== digest.length) return false;
  let mismatch = 0; for (let index = 0; index < actual.length; index++) mismatch |= actual[index]! ^ digest[index]!;
  return mismatch === 0;
}
export default http;
