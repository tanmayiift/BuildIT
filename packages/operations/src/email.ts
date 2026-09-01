export type ResolvedEmailRecipient = { email: string; organizationId: string; userId: string; verifiedAt: number; consentedAt: number };
export type DecisionEmail = { recipient: ResolvedEmailRecipient; status: string; repository: string; prNumber: number; commit: string; url: string; dedupeKey: string };
export type EmailTransport = (message: { to: string; subject: string; text: string; idempotencyKey: string }) => Promise<void>;

const safe = (value: string, pattern: RegExp, code: string) => { if (!pattern.test(value)) throw new Error(code); return value; };

export function decisionEmail(input: DecisionEmail) {
  if (!Number.isFinite(input.recipient.verifiedAt) || input.recipient.verifiedAt <= 0) throw new Error("email_recipient_unverified");
  if (!Number.isFinite(input.recipient.consentedAt) || input.recipient.consentedAt <= 0) throw new Error("email_recipient_unconsented");
  safe(input.recipient.organizationId, /^[A-Za-z\d_-]{8,200}$/, "email_recipient_scope_invalid");
  safe(input.recipient.userId, /^[A-Za-z\d_|-]{8,200}$/, "email_recipient_scope_invalid");
  const repository = safe(input.repository, /^[A-Za-z\d_.-]+\/[A-Za-z\d_.-]+$/, "email_repository_invalid"),
    commit = safe(input.commit, /^[0-9a-f]{40}$/i, "email_commit_invalid"),
    status = safe(input.status, /^[a-z][a-z_]{1,48}$/, "email_status_invalid"),
    url = new URL(input.url);
  if (url.protocol !== "https:") throw new Error("email_url_invalid");
  return { to: safe(input.recipient.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, "email_recipient_invalid"), subject: `BuildIT decision needed · ${repository} #${input.prNumber}`, text: `Status: ${status}\nRepository: ${repository}\nPull request: #${input.prNumber}\nCommit: ${commit}\nOpen BuildIT: ${url.toString()}`, idempotencyKey: safe(input.dedupeKey, /^[A-Za-z\d:_-]{8,200}$/, "email_dedupe_key_invalid") };
}

export async function sendDecisionEmail(input: DecisionEmail, transport: EmailTransport) { await transport(decisionEmail(input)); }
