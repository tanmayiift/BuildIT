# Release blockers, re-checked 2026-09-03

The trust page listed five release blockers. Four now have dated evidence; one does not, and is
still listed as a blocker rather than quietly dropped.

## Cleared

**A complete real-model review.** `tanmayiift/buildit-review-ms#1` — a replay of upstream
`vercel/ms#296`, code neither the author nor the agent wrote. All seven checks executed and
passed: install, test, lint, typecheck, buildit-rules, gitleaks, osv-scanner. Model cost $0.2768.
BuildIT also completed a review of its own 502-file monorepo on `tanmayiift/BuildIT#31`.

**Native scanner timing.** The same review ran gitleaks, osv-scanner and buildit-rules as real
processes inside the Vercel Sandbox, each returning a pass with its own recorded duration, rather
than as mocked results.

**One human-inspected stacked pull request.** `tanmayiift/buildit-public-fixture#19` — Autofix
proposed a one-line TLS fix (`rejectUnauthorized: false` → `true`) against a Critical finding
BuildIT raised on `#18`. A person reviewed it and merged it into the parent branch, and the
corrected code then reached `main`. BuildIT merged nothing.

**Cross-tenant browser proof.** Recorded 2026-09-02 in `two-user-isolation-2026-09-02.md`: a
second GitHub account signed in independently, received its own workspace, and was refused on every
public function and direct object reference belonging to the first tenant.

**Key rotation.** Closed 2026-09-03, recorded in `key-rotation-2026-09-03.md`. Revoking a provider
credential now destroys the envelope rather than flagging the row, so the old ciphertext is
unusable structurally and not only by query filtering. The KMS rewrap helper `rotateEnvelope` still
has no production caller, and that document says so rather than counting it as evidence.

**Retention deletion.** Executed in production 2026-09-03, recorded in
`retention-executed-2026-09-03.md`. Five artifacts on a real review, including two repository
snapshots, were claimed and deleted, each confirmed by the broker reading the key back from S3 and
accepting only a NotFound. The expiry was brought forward deliberately; the clock is the only thing
that was simulated, and nothing about the deletion path was stubbed.

## Still open

**A track record.** Nine reviews across two repositories is evidence that the specific failures
found on 2026-09-03 are fixed. It is not evidence of general reliability, and it is not presented
as any. Both repositories are small Node and Kotlin projects. The honest expectation is that an
unfamiliar repository shape finds something new.

**A staged sandbox outage.** `execution_failed` and `sandbox_unavailable` are measured in the sense
that every failure BuildIT can reach now becomes one specific, honest, non-leaking code, pinned by
tests over the real runner and the real broker classifier. A genuine Vercel Sandbox outage still
cannot be caused on demand, and no document here implies one was staged.
