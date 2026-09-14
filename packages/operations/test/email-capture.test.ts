import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localEmailCaptureConfig } from "../src/emailCaptureConfig";
import { captureEmail } from "../src/emailCapture";
import { decisionDigestEmail, decisionEmail, type DecisionEmail } from "../src/email";
// @ts-expect-error The standalone Node collector intentionally has no build-time TS dependency.
import { storeEmailCapture } from "../../../scripts/lib/email-capture.mjs";
const env = { BUILDIT_EMAIL_DELIVERY_MODE: "local_capture", CONVEX_CLOUD_URL: "http://127.0.0.1:3210", BUILDIT_EMAIL_CAPTURE_URL: "http://127.0.0.1:3219/capture", BUILDIT_WEB_ORIGIN: "http://127.0.0.1:3000" };
const input: DecisionEmail = { localCapture: true, recipient: { organizationId: "workspace_123", userId: "member_123", email: "member@example.com", verifiedAt: 1000, consentedAt: 2000 }, status: "platform_failed", repository: "BuildIT/fixture", prNumber: 2, commit: "a".repeat(40), url: "http://127.0.0.1:3000/reviews/review_123", githubUrl: "https://github.com/BuildIT/fixture/pull/2", dedupeKey: "email-capture:batch_123" };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe("local email capture boundary", () => {
  it("needs a local backend and literal loopback capture endpoint", () => {
    expect(localEmailCaptureConfig(env)).not.toBeNull();
    for (const changed of [{ CONVEX_CLOUD_URL: "https://test.convex.cloud" }, { BUILDIT_EMAIL_CAPTURE_URL: "https://example.com/capture" }, { BUILDIT_EMAIL_CAPTURE_URL: "http://127.0.0.1.example.com/capture" }, { BUILDIT_EMAIL_CAPTURE_URL: "http://localhost:3219/capture" }, { BUILDIT_EMAIL_CAPTURE_URL: "http://127.0.0.1:3219/capture?redirect=remote" }, { VERCEL: "1" }, { VERCEL_ENV: "preview" }, { BUILDIT_EMAIL_DELIVERY_MODE: "live" }]) expect(localEmailCaptureConfig({ ...env, ...changed })).toBeNull();
  });
  it("accepts only a matching captured receipt, never a sent result", async () => {
    const message = decisionEmail(input), http = vi.fn(async () => new Response(JSON.stringify({ kind: "sent", captureId: "b".repeat(64), idempotencyKey: message.idempotencyKey })));
    await expect(captureEmail(localEmailCaptureConfig(env)!, message, http)).rejects.toThrow("email_capture_invalid_receipt");
    expect(http.mock.calls).toHaveLength(1);
  });
  it("atomically records one local file across retry and rejects changed payloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "buildit-email-capture-")); directories.push(directory);
    const message = decisionEmail(input);
    const receipts = await Promise.all([storeEmailCapture(directory, message), storeEmailCapture(directory, message)]);
    expect(receipts[0]).toEqual(receipts[1]);
    const files = await readdir(directory); expect(files).toHaveLength(1);
    const path = join(directory, files[0]!); expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ to: "member@example.com", subject: expect.stringContaining("local capture") });
    await expect(storeEmailCapture(directory, { ...message, to: "different@example.com" })).rejects.toThrow("capture_idempotency_conflict");
    expect(await readdir(directory)).toHaveLength(1);
  });
  it("says captured on both message formats and prevents mixed-recipient digests", () => {
    const immediate = decisionEmail(input), digest = decisionDigestEmail([input, { ...input, prNumber: 3, githubUrl: "https://github.com/BuildIT/fixture/pull/3" }], input.dedupeKey);
    expect(immediate.html).toContain("No email was sent"); expect(immediate.text).toContain("No email was sent"); expect(digest.html).toContain("No email was sent");
    expect(() => decisionDigestEmail([input, { ...input, recipient: { ...input.recipient, organizationId: "foreign_123" } }], input.dedupeKey)).toThrow("email_digest_recipient_mismatch");
    expect(() => decisionDigestEmail(Array.from({ length: 26 }, () => input), input.dedupeKey)).toThrow("email_digest_size_invalid");
  });
});
