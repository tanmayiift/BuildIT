export type ResolvedEmailRecipient = { email: string; organizationId: string; userId: string; verifiedAt: number; consentedAt: number };
export type DecisionEmailStatus = "changes_requested" | "awaiting_human_approval" | "failed_after_three_rounds" | "budget_exhausted" | "inconclusive" | "platform_failed" | "cancelled";
export type DecisionEmail = { recipient: ResolvedEmailRecipient; status: DecisionEmailStatus; repository: string; prNumber: number; commit: string; url: string; githubUrl?: string; dedupeKey: string };
export type EmailTransport = (message: { to: string; subject: string; text: string; html: string; idempotencyKey: string }) => Promise<void>;

type DecisionCopy = { title: string; summary: string; nextAction: string; tone: "danger" | "success" | "warning" | "neutral" };

const copy: Record<DecisionEmailStatus, DecisionCopy> = {
  changes_requested: { title: "Changes need review", summary: "BuildIT found evidence that needs a human decision.", nextAction: "Inspect the evidence and decide whether the pull request should change.", tone: "danger" },
  awaiting_human_approval: { title: "Ready for human review", summary: "The required evidence is ready for a human merge decision.", nextAction: "Review the evidence and merge only if you agree with it.", tone: "success" },
  failed_after_three_rounds: { title: "Autofix stopped safely", summary: "BuildIT reached the three-round limit and did not merge anything.", nextAction: "Inspect the remaining failures and the delivered partial changes.", tone: "warning" },
  budget_exhausted: { title: "Review stopped at its budget", summary: "BuildIT stopped before the next provider call could cross the approved ceiling.", nextAction: "Inspect the partial evidence, then raise the ceiling only if another run is justified.", tone: "warning" },
  inconclusive: { title: "Review needs attention", summary: "BuildIT could not collect enough complete evidence to make a safe decision.", nextAction: "Inspect the missing checks or context before relying on this review.", tone: "warning" },
  platform_failed: { title: "Review could not complete", summary: "A BuildIT service failed before a trustworthy code decision was available.", nextAction: "Open the review receipt, resolve the service problem, and retry once.", tone: "danger" },
  cancelled: { title: "Review cancelled", summary: "The review stopped without a code decision or merge.", nextAction: "Start a new review only when you are ready.", tone: "neutral" },
};

const tones = {
  danger: { foreground: "#9f1d16", background: "#fff0ee", border: "#efb7b2" },
  success: { foreground: "#146332", background: "#eaf7ef", border: "#b5dcc2" },
  warning: { foreground: "#704300", background: "#fff4dc", border: "#e8c77f" },
  neutral: { foreground: "#3f4856", background: "#f6f7f9", border: "#d8dde5" },
} as const;

const safe = (value: string, pattern: RegExp, code: string) => { if (!pattern.test(value)) throw new Error(code); return value; };
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function secureUrl(value: string, code: string) {
  if (value.length > 2048) throw new Error(code);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(code);
  return url;
}

export function decisionEmail(input: DecisionEmail) {
  if (!Number.isFinite(input.recipient.verifiedAt) || input.recipient.verifiedAt <= 0) throw new Error("email_recipient_unverified");
  if (!Number.isFinite(input.recipient.consentedAt) || input.recipient.consentedAt <= 0) throw new Error("email_recipient_unconsented");
  safe(input.recipient.organizationId, /^[A-Za-z\d_-]{8,200}$/, "email_recipient_scope_invalid");
  safe(input.recipient.userId, /^[A-Za-z\d_|-]{8,200}$/, "email_recipient_scope_invalid");
  if (!Number.isSafeInteger(input.prNumber) || input.prNumber < 1) throw new Error("email_pr_number_invalid");
  const repository = safe(input.repository, /^[A-Za-z\d_.-]+\/[A-Za-z\d_.-]+$/, "email_repository_invalid");
  const commit = safe(input.commit, /^[0-9a-f]{40}$/i, "email_commit_invalid");
  const status = safe(input.status, /^(changes_requested|awaiting_human_approval|failed_after_three_rounds|budget_exhausted|inconclusive|platform_failed|cancelled)$/, "email_status_invalid") as DecisionEmailStatus;
  const builditUrl = secureUrl(input.url, "email_url_invalid");
  const githubUrl = input.githubUrl ? secureUrl(input.githubUrl, "email_github_url_invalid") : undefined;
  if (githubUrl && (githubUrl.hostname !== "github.com" || githubUrl.pathname !== `/${repository}/pull/${input.prNumber}`)) throw new Error("email_github_url_invalid");
  const recipient = safe(input.recipient.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, "email_recipient_invalid");
  const idempotencyKey = safe(input.dedupeKey, /^[A-Za-z\d:_-]{8,200}$/, "email_dedupe_key_invalid");
  const decision = copy[status], tone = tones[decision.tone], escapedRepository = escapeHtml(repository), escapedCommit = escapeHtml(commit), escapedBuilditUrl = escapeHtml(builditUrl.toString()), escapedGithubUrl = githubUrl ? escapeHtml(githubUrl.toString()) : null;
  const githubText = githubUrl ? `\nOpen on GitHub: ${githubUrl.toString()}` : "";
  const githubButton = escapedGithubUrl ? `<a href="${escapedGithubUrl}" style="display:inline-block;margin:8px 0 0;padding:12px 16px;color:#0b315f;background:#ffffff;border:1px solid #b8c0cc;border-radius:6px;font-size:14px;font-weight:700;text-decoration:none" aria-label="Open ${escapedRepository} pull request ${input.prNumber} on GitHub">Open on GitHub</a>` : "";
  const text = `BuildIT review: ${decision.title}\n${repository} · PR #${input.prNumber}\n\n${decision.summary}\n\nNext action\n${decision.nextAction}\n\nExact commit: ${commit}\nOpen evidence: ${builditUrl.toString()}${githubText}\n\nSecurity: This source-free message contains no code, diff, logs, findings, prompts, or credentials. It was addressed only to the verified person who enabled review email for this workspace. BuildIT cannot merge this pull request; a human owns the decision.`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(decision.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;color:#151a22;font-family:Arial,Helvetica,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(decision.summary)} · ${escapedRepository} #${input.prNumber}</span>
<main style="max-width:620px;margin:0 auto;padding:28px 14px">
  <div style="overflow:hidden;background:#ffffff;border:1px solid #d8dde5;border-radius:10px">
    <header style="padding:18px 22px;border-bottom:1px solid #e6eaf0">
      <table role="presentation" style="width:100%;border-collapse:collapse"><tr>
        <td style="color:#0b315f;font-size:18px;font-weight:800;letter-spacing:-0.02em">BuildIT</td>
        <td style="text-align:right;color:#5f6978;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Pull request evidence</td>
      </tr></table>
    </header>
    <div style="padding:22px">
      <p style="margin:0 0 8px;color:#5f6978;font-size:12px;font-weight:700">${escapedRepository} · PR #${input.prNumber}</p>
      <section aria-labelledby="review-outcome" style="margin:0 0 16px;padding:16px;background:${tone.background};border:1px solid ${tone.border};border-radius:7px">
        <div style="margin-bottom:7px;color:${tone.foreground};font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em">Review outcome</div>
        <h1 id="review-outcome" style="margin:0 0 7px;color:#151a22;font-size:25px;line-height:1.2;letter-spacing:-.025em">${escapeHtml(decision.title)}</h1>
        <p style="margin:0;color:#3f4856;font-size:14px;line-height:1.55">${escapeHtml(decision.summary)}</p>
      </section>
      <section aria-labelledby="next-action" style="margin:0 0 18px;padding:14px 16px;background:#eef5fc;border-left:3px solid #0b315f">
        <h2 id="next-action" style="margin:0 0 5px;color:#0b315f;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Next action</h2>
        <p style="margin:0;color:#26384c;font-size:14px;line-height:1.55">${escapeHtml(decision.nextAction)}</p>
      </section>
      <table role="presentation" aria-label="Review receipt" style="width:100%;margin:0 0 20px;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:9px 0;color:#5f6978;border-bottom:1px solid #e6eaf0">Repository</td><td style="padding:9px 0;text-align:right;font-weight:700;border-bottom:1px solid #e6eaf0">${escapedRepository}</td></tr>
        <tr><td style="padding:9px 0;color:#5f6978;border-bottom:1px solid #e6eaf0">Pull request</td><td style="padding:9px 0;text-align:right;font-weight:700;border-bottom:1px solid #e6eaf0">#${input.prNumber}</td></tr>
        <tr><td style="padding:9px 0;color:#5f6978">Exact commit</td><td style="padding:9px 0;text-align:right;font-family:monospace;font-size:12px">${escapedCommit.slice(0, 12)}</td></tr>
      </table>
      <div role="group" aria-label="Review actions">
        <a href="${escapedBuilditUrl}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 16px;color:#ffffff;background:#0b315f;border:1px solid #0b315f;border-radius:6px;font-size:14px;font-weight:700;text-decoration:none" aria-label="Open BuildIT review for ${escapedRepository} pull request ${input.prNumber}">Open review evidence</a>${githubButton}
      </div>
      <p style="margin:18px 0 0;padding-top:15px;color:#5f6978;border-top:1px solid #d8dde5;font-size:11px;line-height:1.55">No code, diff, logs, findings, prompts, or credentials are in this email. It was sent only to the verified person who enabled review email for this workspace. BuildIT cannot merge this pull request; a human owns the decision.</p>
    </div>
  </div>
</main></body></html>`;
  return { to: recipient, subject: `[BuildIT] ${decision.title} · ${repository} #${input.prNumber}`, text, html, idempotencyKey };
}

export async function sendDecisionEmail(input: DecisionEmail, transport: EmailTransport) { await transport(decisionEmail(input)); }
