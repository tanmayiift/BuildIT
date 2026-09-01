# Design-partner evidence runbook

Use this only for observed sessions with people outside the BuildIT team. Product code and synthetic browser tests cannot create this evidence.

1. Pick one narrow niche before recruiting. Keep the same `niche` value for the study.
2. Observe 3–10 people across at least two teams. Hash participant, team, and observer identifiers outside BuildIT with a study-specific salt. Do not put names, emails, GitHub handles, organization names, repository names, pull-request numbers, source, findings, credentials, or links in the evidence file.
3. Record each activation stage as it happens: landing page, permission receipt, repository selection, exact-scope preview, and first evidence result. Record time to first evidence. If the founder intervenes, mark it; that result cannot count as self-service.
4. Ask whether the evidence created an aha moment, whether the human-only merge boundary was understood, whether they would use it again, and which exact review job it would replace. Record repeat use only after another real review.
5. Mark copy, contrast, font size, primary action, and guidance as `clear` or `unclear`. Put only a short, source-free trust explanation in `trustNote`.
6. Use the four public lines exactly once in the file: `whatBuilt`, `whoFor`, `whyCare`, and the fixed BuildIT production link.
7. Keep the completed JSON outside Git. Run `pnpm eval:partners -- <path>` for the 3-person evidence gate. Run `pnpm eval:partners -- --broad-launch <path>` only for the 10-user stability gate.

The checker reports collected evidence; it does not manufacture sessions. Three valid observations permit a measured design-partner claim. Broad-launch stability additionally requires ten unique people, at least 80% self-service first evidence, at least 50% repeat use, at least 80% trust-boundary understanding, and zero recorded security incidents.
