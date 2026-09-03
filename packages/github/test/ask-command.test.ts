import { describe, expect, it } from "vitest";
import { authorizeTrigger } from "../src/index.js";

// Comment commands already arrive and are already hardened: bots rejected, edited comments
// rejected, and every kind gated on the sender's repository permission. Asking a question about a
// review is the same shape of request, so it extends that path rather than opening a new one.
//
// It is gated at triage, like review, not at write. Asking what a finding means is a read - a
// person who can see the pull request can already see the finding.

const base = { deliveryId: "d1", senderType: "User", action: "created", permission: "triage" as const };

describe("asking BuildIT about a review", () => {
  it("accepts a question and keeps it", () => {
    const result = authorizeTrigger({ ...base, body: "@buildit ask why is line 4 unsafe?" });
    expect(result).toMatchObject({ accepted: true, kind: "ask", question: "why is line 4 unsafe?" });
  });

  it("reads at triage, the same level that may ask for a review", () => {
    expect(authorizeTrigger({ ...base, permission: "read", body: "@buildit ask what changed?" }))
      .toMatchObject({ accepted: false, reason: "permission" });
    expect(authorizeTrigger({ ...base, permission: "admin", body: "@buildit ask what changed?" }))
      .toMatchObject({ accepted: true });
  });

  it("refuses an empty question rather than asking the model to guess", () => {
    expect(authorizeTrigger({ ...base, body: "@buildit ask" })).toMatchObject({ accepted: false });
    expect(authorizeTrigger({ ...base, body: "@buildit ask    " })).toMatchObject({ accepted: false });
  });

  // BuildIT answering its own comment is an infinite loop with a bill attached.
  it("never answers a bot", () => {
    expect(authorizeTrigger({ ...base, senderType: "Bot", body: "@buildit ask anything" }))
      .toMatchObject({ accepted: false, reason: "bot" });
  });

  it("ignores an edited comment, like every other command", () => {
    expect(authorizeTrigger({ ...base, action: "edited", body: "@buildit ask anything" }))
      .toMatchObject({ accepted: false, reason: "edited" });
  });

  it("caps the question, because the body is attacker-controlled text", () => {
    const result = authorizeTrigger({ ...base, body: `@buildit ask ${"x".repeat(1_000)}` });
    expect(result).toMatchObject({ accepted: true });
    expect((result as { question: string }).question.length).toBeLessThanOrEqual(500);
  });

  it("leaves the existing commands exactly as they were", () => {
    expect(authorizeTrigger({ ...base, body: "@buildit review" })).toMatchObject({ accepted: true, kind: "review" });
    expect(authorizeTrigger({ ...base, permission: "write", body: "@buildit autofix stacked" })).toMatchObject({ accepted: true, kind: "autofix", mode: "stacked" });
    expect(authorizeTrigger({ ...base, permission: "write", body: "@buildit cancel" })).toMatchObject({ accepted: true, kind: "cancel" });
  });
});
