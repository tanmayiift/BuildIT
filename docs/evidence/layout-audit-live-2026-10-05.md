# Live signed-in layout audit, 5 October 2026

The checks in `tests/e2e/layout-audit.spec.ts` run in CI only against public and sample-tour routes,
because CI holds no BuildIT login. This applies the same checks to production with a real signed-in
session (`tanmayiift`, in the agent's own browser), on every workspace route.

- **Production:** `23e730a`, deployed by the GitHub release workflow. The broker's `/api/health`
  reported that commit.
- **Viewports:** 1440×900 and 375×812, on the mobile preset.
- **Checks per route:**
  - horizontal page overflow;
  - a button within 4px of text;
  - a paragraph wider than 100 characters a line;
  - text clipped by `overflow: hidden`.

## Result

**34 of 34 page loads clean** after one correction to the audit itself.

| Route | 1440 | 375 |
|---|---|---|
| /overview, /reviews, /repositories, /history, /metrics, /usage | clean | clean |
| /integrations, /policies, /members, /notifications, /audit, /account | clean | clean |
| /setup/model, /setup/install | clean | clean |
| /reviews/nx716ncp… (zod#1, inconclusive) | clean | clean |
| /reviews/nx73mag2… (gson#3, changes requested, finding text erased) | clean | clean |
| /reviews/nx7ebsdb… (user B's review, opened as A) | clean, refusal panel | clean, refusal panel |

## The one fault, and why it was the audit's

At 1440px, /overview and /reviews first reported `clipped "Active organization"`. The element was
the workspace switcher's `.sr-only` label: 1×1px and `clip: rect(0 0 0 0)`, hidden on purpose for
sighted readers. CI never saw it because its signed-out routes have no switcher. The audit now skips
visually hidden elements, and both routes are clean.

## User B's review, opened as user A

"Review evidence is unavailable: This review is not in your active workspace, or no longer exists".
It names no repository, pull request or finding of B's, and links back to the review queue. This is
the refusal panel the 5 October screenshot complained about; it now has a 66-character measure and
stacked spacing (#107).
