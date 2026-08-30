# CLI parity read-only proof — 2026-08-30

The built CLI was exercised without passing or printing any provider or GitHub token.

- `buildit --help`: exit 0; documents configure, local/remote review, stacked-only Autofix, status/watch, cancel, doctor, and the no-merge boundary.
- `buildit doctor --json`: Node and Git ready; GitHub authenticated with the current repository available; all three local provider keys reported only as `missing`.
- `pnpm smoke:cli`: product-reviewer help/doctor and developer scoped-plan/consent journeys passed; worktree unchanged; provider cost 0.
- Public fixture PR #2: exact head `682805eaf9a3e813d400ba1fac7e3a0799f63f42`; status `not_started`; exit 3.
- Public fixture stacked PR #3: exact head `405628ff616465f3782f8d15d79067ea45493115`; exact-candidate BuildIT Check `SUCCESS`; status `passed`; exit 0.

This proves stable read-only terminal behavior and exact-head Check interpretation. It does not prove hosted model parity or live Autofix; those remain blocked until the broker and matching worker are deployed and probed.
