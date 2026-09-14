# Local email capture implementation evidence

Scope: BuildIT only. Local code/tests; no production mutations, customer mail, provider account, sender domain, or paid model request.

The original local-capture UI regression failed because notification settings always returned “Not connected” and hid controls (`email-capture-red.txt`). The implementation now has tenant-scoped opt-in, address-bound consent, optional explicit verification expiry, bounded event fanout, durable immediate/daily batches, lease recovery, three-attempt retry, safe local capture, accurate captured/suppressed/failed states, and metadata erasure after an organization tombstone.

The production default remains disconnected. The collector is file-only, listens on 127.0.0.1, rejects browser-origin requests, uses private files, refuses changed payloads for a used idempotency key, and never forwards mail. Backend configuration rejects hosted backends, Vercel, hostname aliases, non-loopback endpoints, and redirects. Messages remain fixed-copy and source-free.

Tests exercise an actual reviewState transition through scheduled fanout, claim, real worker, transport, and durable file capture. They also cover duplicate events, lost receipts, ten access/consent/verification changes after queueing, wrong-tenant parents, UTC daily batching, immediate critical failures, 57 eligible members across fanout pages, 27 reviews across two digest batches, transport failure, disconnected cloud mode, active-org purge refusal and deleted-org cleanup. UI tests click opt-in/out, timing and repository muting, reject unverified opt-in, allow consent withdrawal after verification expires, show save errors, and hide actions in hosted disconnected mode.

Evidence files:
- `email-capture-red.txt`: original failing regression, before implementation.
- `email-capture-fourth.txt`: 31 transport, outbox and security inventory assertions passing before larger-queue/UI additions.
- `email-capture-large-ui.txt`: 21 outbox and 4 settings component assertions passing.
- `email-lint.txt`: owned email implementation lint passes.
- `email-operations-typecheck.txt`: operations package typecheck passes.
- Final focused combined suite: 18 files / 232 tests passing in `email-capture-final.txt` (includes the final consent-withdrawal regression).

Limits: Component tests are not a live browser proof. No live mailbox or real delivery proof exists, by design. Local exported captures remain until the local operator removes them. The product has no general organization deletion UI or writer. The bounded hourly `trackerOAuthData:sweepDeletedOrganizations` job now schedules notification and tracker cleanup for committed tombstones; the internal purges are covered independently. Whole-Convex checking initially awaited generated API entries for new parallel-agent modules, while the frontend had stale Next route type artifacts; final parent verification must regenerate and check these artifacts.
