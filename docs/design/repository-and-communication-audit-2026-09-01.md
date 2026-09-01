# Repository and communication audit — 2026-09-01

## Purpose

This audit covers the authenticated Repositories screen and three supplied email exports: one BuildIT GitHub review thread, one Vercel deployment comment, and one Grafana alert. It records which presentation BuildIT owns so a provider-owned shell is never presented as a BuildIT template.

## Ownership boundary

| Surface | BuildIT controls | Provider controls | Product action |
| --- | --- | --- | --- |
| Repositories screen | All content, layout, controls, states, and responsive behaviour | Browser rendering | Rebuild and regression-test the page. |
| BuildIT GitHub review email | The Check/comment Markdown and when BuildIT publishes it | GitHub's sender, subject thread, mail frame, subscription footer, and Gmail's printed export | Make the published report concise, evidence-led, and actionable. Do not claim the outer email can be branded. |
| Vercel deployment email | Whether BuildIT enables Vercel's GitHub integration and the underlying deployment status | Vercel bot comment, “Review with Vercel Agent”, GitHub email, and Gmail frame | Treat as a vendor deployment notification, not a BuildIT customer email. Do not add a duplicate BuildIT template. |
| Grafana operator alert | BuildIT alert names, fixed labels, annotations, runbook links, and BuildIT-only contact-point template | Grafana's outer email frame and mail delivery | Add clear service, severity, symptom, action, time, and runbook content without tenant data. |
| Future customer email | Validated source-free payload, tenant-safe recipient resolution, subject, plain text, semantic HTML, and BuildIT footer | Future transactional provider's transport headers | Keep disconnected until provider and address verification are production-proven. |

## Repositories screen findings

1. The connection card is taller than its information needs and separates its four facts into a second heavy box. This delays the primary job: checking each repository and its policy.
2. Repository identity, policy controls, review state, and the GitHub link sit in unrelated columns. The eye has no single action group.
3. The native Autofix select does not share the button height, border, focus treatment, or typography. It looks unfinished and its purpose is not explained.
4. The label `Reviews` above a `Pause` button describes a noun while the control describes an action. The current state is implicit.
5. Public/private marks use unexplained abbreviations. Visibility should be readable text, with the mark only supporting recognition.
6. Three wide rows leave large dead areas on a desktop while squeezing controls into narrow columns. At smaller widths those columns will become brittle.
7. Success green appears only in a small badge while the most important state—whether reviews are active—is absent from the repository row.

## BuildIT GitHub report findings

1. The outcome is clear, but commit/configuration IDs appear before the reason and next human action.
2. Raw evidence identifiers make the message look like a debug dump. They are useful only in a collapsed technical receipt, not in each finding headline.
3. Check names and model findings are listed without a short summary such as “2 required checks failed”.
4. Repeated retries create a long email thread with near-identical reports. Exact-head idempotency remains required so one current decision is the obvious result.
5. The human merge boundary is present and must remain prominent.

## Grafana alert findings

1. `TestAlert` and `Notification test` do not name the BuildIT service, affected boundary, operator action, or urgency.
2. Generic `instance=Grafana` and a raw machine timestamp add noise without helping recovery.
3. There is no dashboard or runbook link and no plain explanation of what a page-level versus ticket-level alert means.
4. The alert must remain global and source-free. Repository, pull request, review, customer, member, email, code, finding, prompt, and credential labels are forbidden.

## Acceptance bar

- A technical lead can identify repository access, review state, Autofix delivery, and the next action without interpreting an abbreviation.
- Desktop and mobile layouts have no overlap, clipped text, or horizontal overflow; interactive targets are at least 44 by 44 pixels.
- BuildIT-owned customer messages lead with outcome, impact, next action, and a bounded exact-commit receipt.
- Operator alerts lead with service, severity, symptom, action, and runbook while remaining source-free.
- GitHub, Gmail, Vercel, and Grafana outer frames are described honestly as provider-owned.
