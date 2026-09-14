# GitHub PR #28 secret-scan review — 2026-09-14

PR #28 (`012dc1f`, Dependabot `actions/checkout` update) is closed and unmerged. Its Security
workflow had a failed `secret-scan` job in addition to the browser screenshot failure.

The failed scan identified one **test fixture false positive**, not a live credential:

| File | Rule | Finding |
| --- | --- | --- |
| `convex/credentialRevocation.test.ts:26` at `012dc1f` | `generic-api-key` | A base64-shaped `wrappedDataKey` fixture literal |

The fixture was subsequently changed in commit `8fdf015` to assemble deterministic values from
the words `fixture`, the field label, and `not-a-secret`. A whole-tree scan of the current tracked
BuildIT source with the repository allowlist removed reports **zero findings**. The scanner remains
in `.github/workflows/security.yml`; no allowlist was added for this value.

This classifies the historical PR failure as fixed in the current source. The PR itself remains
closed, so GitHub's historical check conclusion is unchanged until a future branch event runs the
workflow again.
