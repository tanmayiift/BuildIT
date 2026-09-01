import { describe, expect, it, vi } from "vitest";
import { decisionEmail, sendDecisionEmail, type DecisionEmail } from "../src/email.js";

const message: DecisionEmail = { recipient: { email: "rohan@example.com", organizationId: "org_12345678", userId: "user_12345678", verifiedAt: 1, consentedAt: 2 }, status: "changes_requested", repository: "acme/api", prNumber: 42, commit: "a".repeat(40), url: "https://buildit.example/reviews/42", githubUrl: "https://github.com/acme/api/pull/42", dedupeKey: "review:42:decision" };

describe("source-free decision email", () => {
  it("leads with the outcome, next human action, and exact source-free receipt", () => {
    const result = decisionEmail(message);
    expect(result).toEqual(expect.objectContaining({ subject: "[BuildIT] Changes need review · acme/api #42", idempotencyKey: "review:42:decision" }));
    expect(result.text).toContain("BuildIT review: Changes need review");
    expect(result.text).toContain("Next action\nInspect the evidence and decide whether the pull request should change.");
    expect(result.text).toContain(`Exact commit: ${"a".repeat(40)}`);
    expect(result.text).toContain("Open evidence: https://buildit.example/reviews/42");
    expect(result.text).toContain("Open on GitHub: https://github.com/acme/api/pull/42");
    expect(result.text).not.toContain("changes_requested");
  });
  it("renders semantic, tracking-free HTML from the same validated values", () => {
    const result = decisionEmail(message);
    expect(result.html).toMatch(/<h1[^>]*>Changes need review<\/h1>/);
    expect(result.html).toContain("Inspect the evidence and decide whether the pull request should change.");
    expect(result.html).toContain(`aria-label="Open BuildIT review for acme/api pull request 42"`);
    expect(result.html).toContain("BuildIT cannot merge this pull request");
    expect(result.html).toContain("verified person who enabled review email for this workspace");
    expect(result.html).not.toMatch(/<img|tracking|pixel|script/i);
  });
  it("rejects source-like, unknown-status, or unsafe action fields", () => {
    expect(() => decisionEmail({ ...message, status: "```diff" } as unknown as DecisionEmail)).toThrow("email_status_invalid");
    expect(() => decisionEmail({ ...message, status: "unknown_state" } as unknown as DecisionEmail)).toThrow("email_status_invalid");
    expect(() => decisionEmail({ ...message, repository: "acme/api\ndiff --git" })).toThrow("email_repository_invalid");
    expect(() => decisionEmail({ ...message, url: "http://buildit.example/reviews/42" })).toThrow("email_url_invalid");
    expect(() => decisionEmail({ ...message, githubUrl: "https://example.com/acme/api/pull/42" })).toThrow("email_github_url_invalid");
  });
  it("requires an exact verified and consented tenant recipient", () => {
    expect(() => decisionEmail({ ...message, recipient: { ...message.recipient, verifiedAt: 0 } })).toThrow("email_recipient_unverified");
    expect(() => decisionEmail({ ...message, recipient: { ...message.recipient, consentedAt: 0 } })).toThrow("email_recipient_unconsented");
    expect(() => decisionEmail({ ...message, recipient: { ...message.recipient, organizationId: "" } })).toThrow("email_recipient_scope_invalid");
  });
  it("passes one idempotent message to an injected provider", async () => { const transport = vi.fn(async () => undefined); await sendDecisionEmail(message, transport); expect(transport).toHaveBeenCalledOnce(); expect(JSON.stringify(transport.mock.calls)).not.toContain("diff --git"); });
});
