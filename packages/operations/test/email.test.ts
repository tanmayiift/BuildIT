import { describe, expect, it, vi } from "vitest";
import { decisionEmail, sendDecisionEmail } from "../src/email.js";

const message = { recipient: { email: "rohan@example.com", organizationId: "org_12345678", userId: "user_12345678", verifiedAt: 1, consentedAt: 2 }, status: "changes_requested", repository: "acme/api", prNumber: 42, commit: "a".repeat(40), url: "https://buildit.example/reviews/42", dedupeKey: "review:42:decision" };

describe("source-free decision email", () => {
  it("contains only status and immutable identifiers", () => expect(decisionEmail(message)).toEqual(expect.objectContaining({ subject: "BuildIT decision needed · acme/api #42", text: expect.stringContaining(`Commit: ${"a".repeat(40)}`), idempotencyKey: "review:42:decision" })));
  it("rejects source-like or unsafe fields", () => { expect(() => decisionEmail({ ...message, status: "```diff" })).toThrow("email_status_invalid"); expect(() => decisionEmail({ ...message, repository: "acme/api\ndiff --git" })).toThrow("email_repository_invalid"); expect(() => decisionEmail({ ...message, url: "http://buildit.example/reviews/42" })).toThrow("email_url_invalid"); });
  it("requires an exact verified and consented tenant recipient", () => {
    expect(() => decisionEmail({ ...message, recipient: { ...message.recipient, verifiedAt: 0 } })).toThrow("email_recipient_unverified");
    expect(() => decisionEmail({ ...message, recipient: { ...message.recipient, consentedAt: 0 } })).toThrow("email_recipient_unconsented");
    expect(() => decisionEmail({ ...message, recipient: { ...message.recipient, organizationId: "" } })).toThrow("email_recipient_scope_invalid");
  });
  it("passes one idempotent message to an injected provider", async () => { const transport = vi.fn(async () => undefined); await sendDecisionEmail(message, transport); expect(transport).toHaveBeenCalledOnce(); expect(JSON.stringify(transport.mock.calls)).not.toContain("diff --git"); });
});
