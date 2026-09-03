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

## Still open

**Key rotation proof.** No dated evidence exists that a stored provider key can be rotated and the
old ciphertext rendered unusable end to end. The code path exists; the proof does not. This remains
a release blocker and is stated as one on the trust page.
