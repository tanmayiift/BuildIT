import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { commandFailureCode } from "./githubWebhookProcessor";
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
