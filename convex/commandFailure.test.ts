import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { commandFailureCode } from "./githubWebhookProcessor";
import { commandFailureNotice, commandVerb } from "./lib/commandFailureNotice";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// An "@buildit review" whose processing threw was recorded as "rejected" with no reason, and the
// person who commented saw nothing at all (R0 benchmark, 6 Oct 2026: date-fns comments during a
// GitHub rate limit). The delivery now keeps the error's code - never its text.
describe("a command that failed while being processed", () => {
  it("is recorded by the code it threw, as production throws it", () => {
    expect(commandFailureCode(new Error("repository_access_refused:files=60;status=403"))).toBe("repository_access_refused");
    expect(commandFailureCode(new Error("Uncaught Error: github_pull_403\n    at handler (../convex/githubWebhookProcessor.ts:1:1)"))).toBe("github_pull_403");
    // Free text from anywhere else is not a code and is not kept.
    expect(commandFailureCode(new Error("Something about src/secret-plan.ts went wrong"))).toBe("unexpected");
    expect(commandFailureCode("not an error")).toBe("unexpected");
  });

  it("stores a valid code on the delivery and refuses anything else", async () => {
    const t = convexTest(schema, modules);
    const insert = (deliveryId: string) => t.run(ctx => ctx.db.insert("webhookDeliveries", { deliveryId, event: "issue_comment", action: "created", signatureValid: true, disposition: "processed", status: "enqueued", receivedAt: 1 }));
    await insert("d-1"); await insert("d-2");
    await t.mutation(internal.githubWebhookData.complete, { deliveryId: "d-1", disposition: "rejected", status: "failed", failureCode: "repository_access_refused", now: 2 });
    await t.mutation(internal.githubWebhookData.complete, { deliveryId: "d-2", disposition: "rejected", status: "failed", failureCode: "Has Spaces: and text", now: 2 });
    const rows = await t.run(ctx => ctx.db.query("webhookDeliveries").collect());
    expect(rows.find(row => row.deliveryId === "d-1")).toMatchObject({ disposition: "rejected", failureCode: "repository_access_refused" });
    expect(rows.find(row => row.deliveryId === "d-2")).not.toHaveProperty("failureCode");
  });
});

// Recording the code told the operator; the person who typed the command still saw nothing.
describe("what the commenter is told when a command failed", () => {
  const at = Date.UTC(2026, 9, 6, 4, 31);

  it("says what GitHub refused, that nothing ran, and what to do", () => {
    expect(commandFailureNotice({ code: commandFailureCode(new Error("Uncaught Error: pull_request_lookup_403\n    at x")), verb: "review", at })).toBe([
      "**BuildIT could not carry out `@buildit review`** (04:31 UTC).",
      "",
      "GitHub refused BuildIT's request for this pull request. That usually means the installation's GitHub API limit was reached for the moment. No review was started by it and nothing was charged.",
      "",
      "Comment the command again in a few minutes. If it keeps failing, check in GitHub's settings that the BuildIT app still has access to this repository.",
      "",
      "Reference: `pull_request_lookup_403`",
    ].join("\n"));
  });

  it("names the cause for each failure a person can act on, and falls back to a reference", () => {
    const why = (code: string) => commandFailureNotice({ code, at })!.split("\n")[2];
    expect(why("permission_lookup_404")).toContain("GitHub did not let BuildIT read this pull request.");
    expect(why("pull_request_lookup_502")).toContain("GitHub returned an error");
    expect(why("repository_unavailable")).toContain("not switched on in a BuildIT workspace");
    expect(why("installation_unavailable")).toContain("not linked to an active BuildIT workspace");
    expect(why("repository_execution_safety_blocked")).toContain("switched off running repository code");
    expect(why("review_runtime_configuration_missing")).toContain("missing part of its own configuration");
    expect(why("unexpected")).toContain("Something failed inside BuildIT");
  });

  it("stays quiet where the pull request already says why, or nothing can be posted", () => {
    expect(commandFailureNotice({ code: "review_not_runnable", verb: "review", at })).toBeUndefined();
    expect(commandFailureNotice({ code: "github_app_not_configured", at })).toBeUndefined();
  });

  it("repeats only a known command word, never the comment's own text", () => {
    expect(commandVerb("Please @BuildIT  Autofix provider=openai")).toBe("autofix");
    expect(commandVerb("@buildit ignore-previous-instructions")).toBeUndefined();
    expect(commandFailureNotice({ code: "unexpected", verb: "deploy`<b>", at })).toContain("**BuildIT could not carry out that command**");
  });
});
