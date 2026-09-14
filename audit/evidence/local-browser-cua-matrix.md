# Actual local Chrome case matrix

**45 passed, 0 failed.** Run: 2026-09-14 05:30:55–05:49:47 UTC. Per-case UTC timestamps and outcomes are in `local-browser-cua-proof.json`. Count is named cases, some of which contain multiple conditions. All data is simulated and loopback-only; paid calls: **0**.

| Cases | Scope | Result |
|---|---|---|
| 1–4 | Owner correct cost/unknown labels, zero limit removes bar, reload persistence, restore limit | 4 passed |
| 5–9 | Repository pause, reload, resume, persisted comment policy, explanations; original state restored | 5 passed |
| 10 | History attempts/verdicts/unknown duration labels | Passed |
| 11, 20 | Metric figures and missing accuracy labels; event7→8 updates open page | 2 passed |
| 12–13 | Missing key blocks review; Enter opens exact review row | 2 passed |
| 14–17 | Unconnected PR rejected; valid installed PR prefilled; advanced disclosure; link resumes | 4 passed |
| 18–19, 28–30 | Missing broker blocks key save; provider/repo selection; stale recent auth gate; mobile form; password input | 5 passed |
| 21–22, 24 | Actual400px metric fit; keyboard mobile menu and navigation | 3 passed |
| 23, 25–26 | Reserved/settled cost updates open page; basic language/heading/landmark/input labels | 3 passed |
| 27 | Linear/Jira missing configuration shown accurately | Passed |
| 31–35 | Viewer3.75 isolated; policy read-only; cross-tenant review denied; no start-review or key controls | 5 passed |
| 36–37 | Missing-page mobile rendering and keyboard recovery | 2 passed |
| 38–40 | Sign-out clears private data; fixture relogin works; final owner cost preserved | 3 passed |
| 41–45 | Policies, members, notifications, audit, health headings render with no application error/other workspace text | 5 passed; render checks only |

Inline screenshot surfaces: mobile metrics (05:39 UTC); usage reserved/settled (05:40); model stale-auth and full fresh-session form (05:42); viewer usage (05:43); missing page (05:46). These are actual screenshots emitted by the supported CUA tool. No downloadable files were returned. The model form was visually checked at400px with no overlap and measured no horizontal overflow. Its historical B49 pixel-baseline failure remains unverified against the original lost artifact.

| Area | Status and limit |
|---|---|
| Full axe, contrast ratios, screen-reader speech | Untested; supported CUA allows read-only DOM inspection, not scanner injection. Keyboard and basic semantics checked separately. |
| Historical screenshot comparison | Untested; original failure artifact unavailable. Current visual check does not close the historical pixel comparison. |
| 390px/360px and other browser engines | Untested; requested viewport change did not initially apply. Only measured400px counted. |
| Large-data cap/partial browser fixture | Untested here; prior server/component regressions cover bounds. Legacy unknown cost and pending reservation visible states passed. |
| Live GitHub install, key validation, paid review/sandbox, Linear/Jira consent | Untested; isolated environment intentionally has no external credentials. Missing configuration is correctly visible. |
| Membership/notification sends and additional settings writes | Untested; render checks only. No messages sent. |

All product source files match the final root snapshot except documented local test additions/CSP change. See `local-browser-cua-snapshot.json`. Earlier API26/HTTP36 receipts retain their timestamps and were not relabeled as a new browser run.
