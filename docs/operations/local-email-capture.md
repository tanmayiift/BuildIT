# Local customer email capture

Customer email delivery remains **Not connected**. This implementation writes test messages to this computer and never contacts a mail provider. A capture is not a sent email, delivery receipt, or proof that a mailbox accepted a message.

From the BuildIT repository, run the capture collector with `node scripts/capture-buildit-email.mjs`. It listens only on `http://127.0.0.1:3219/capture` and writes private JSON files beneath `.local/email-captures` (ignored by Git). Each file contains the test recipient and the rendered HTML/text message. Open a file locally to inspect the result. Delete local capture files when the test is finished; database erasure does not delete exported local files.

Use a separate local Convex backend. Set these values **on that local backend**, using its local admin console or a CLI explicitly targeted at its loopback URL:

```text
BUILDIT_EMAIL_DELIVERY_MODE=local_capture
BUILDIT_EMAIL_CAPTURE_URL=http://127.0.0.1:3219/capture
BUILDIT_WEB_ORIGIN=http://127.0.0.1:3000
```

The backend's built-in `CONVEX_CLOUD_URL` must itself be a literal loopback HTTP URL (for example `http://127.0.0.1:3210`). A cloud URL, Vercel deployment, hostname alias, external endpoint, or redirect cannot enable capture. Do not copy these settings into a hosted project. `BUILDIT_EMAIL_CAPTURE_PORT` may change the collector's local port; update the capture URL to match.

Sign in to the local frontend as a separately verified BuildIT member. In notification settings, choose **Enable local capture**. Opt-in is scoped to this workspace, this member, and the verified email address. A changed address requires fresh opt-in. Expired verification, removed membership, disabled repository, removed installation, muted repository, or revoked consent suppresses pending captures. The GitHub App owner is never a fallback recipient.

Immediate mode captures each decision. Daily mode groups routine decisions at midnight UTC, in batches of at most 25; budget stops and platform/Autofix failures remain immediate. Only current review generations are included. Final review decisions, cancellations, budget stops, and Autofix outcomes enqueue metadata through their authoritative lifecycle writes. Messages include repository/PR/commit identifiers, fixed outcome text, and links; they contain no source, findings, logs, prompts, or credentials.

The outbox fans out to at most 50 memberships per transaction and resumes using a cursor. The worker claims a 60-second lease, retries at most three times, and rechecks access before each capture. A stable batch key makes collector writes idempotent across a lost receipt. Capture HTTP requests time out after eight seconds and cannot follow redirects. Durable rows record `captured`, `suppressed`, or `failed`; they do not record `sent` for this transport.

`notificationOutbox:purgeDeletedOrganization` is an internal, resumable metadata cleanup operation. It refuses active organizations and removes at most 100 rows from each of notifications, preferences, fanouts, and batches per transaction. The hourly `trackerOAuthData:sweepDeletedOrganizations` job finds indexed organization tombstones in pages of 50 and schedules this cleanup alongside tracker-secret erasure. The existing product has no general organization deletion UI or writer; this job handles tombstones that have already been committed.

Real delivery remains blocked on the chosen provider, sender domain, verified sender configuration, delivery/bounce proof, and explicit authorization to send customer messages. None of those steps is performed by this local implementation.
