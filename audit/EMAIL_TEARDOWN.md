# BuildIT Inbox Teardown

**Outbound email review · 2026-09-02**

Three real messages, pulled from the printed Gmail threads and read against the templates
that produced them. The palette and the safety copy are already good. What breaks is
hierarchy: the decision competes with 120 characters of hex, and the one alert template
written specifically for operators is wired to nothing.

| | |
|---|---|
| **Sources** | 3 PDF threads, 6 messages |
| **Templates read** | `packages/orchestrator/src/report.ts` · `packages/operations/src/email.ts` · `observability/grafana/notification-templates/buildit-operator-v1.tmpl` · `observability/alerts.yml` |
| **Findings** | 17 |
| **Commit** | `ec23ec4` |

> The PDFs had no extractable text layer (CID-encoded fonts, no `pdftotext` available), so
> the message bodies below were recovered by decoding the embedded ToUnicode CMaps.

---

## 1. What arrives today

Only one of these three is a message BuildIT designed. That distinction drives most of the
recommendations below — you control the *body* of the review email, not its envelope, and
you control the alert template but aren't using it.

| Message | Sender | Who controls the design | Volume seen |
|---|---|---|---|
| **PR review result**<br>"BuildIT: changes requested" | `buildit-agentic-review[bot]` via `notifications@github.com` | BuildIT controls the Markdown body. GitHub controls the subject, chrome, and footer. | 4 messages on one PR in 7 hours |
| **Service alert**<br>"[FIRING:1] TestAlert" | `grafana@…grafana.net` | BuildIT controls the template — but is shipping Grafana's stock one. | 1 |
| **Deployment notice**<br>"Ready · Preview" | `vercel[bot]` via `notifications@github.com` | Third party. Not yours to design. | 1 |

### Worth saying first

The customer decision email in `packages/operations/src/email.ts` is the best-designed asset
here — table-based layout, a hidden preheader, ARIA labels, and a tone palette where **every
foreground/background pair clears WCAG AA**. I measured all twelve; the lowest is 5.56:1, the
highest 12.97:1:

| Pair | Ratio |
|---|---|
| danger `#9f1d16` on `#fff0ee` | 7.12 |
| success `#146332` on `#eaf7ef` | 6.66 |
| warning `#704300` on `#fff4dc` | 7.72 |
| neutral `#3f4856` on `#f6f7f9` | 8.62 |
| body `#3f4856` on white | 9.24 |
| muted `#5f6978` on white | 5.56 |
| next-action `#26384c` on `#eef5fc` | 10.90 |
| brand/button `#0b315f` ↔ white | 12.97 |

It is also not being sent yet. Everything below is about the messages that *are* going out.

---

## 2. The review email

This is the product's voice. Below is the body as it rendered on PR #2 — condensed but not
cleaned up. The line breaks and hex strings are real.

```
Subject: Re: [tanmayiift/buildit-public-fixture] Refactor higher tax tier (PR #2)   [1]

BuildIT: changes requested
Repository: tanmayiift/buildit-public-fixture · PR #2
Head: 682805eaf9a3e813d400ba1fac7e3a
0799f63f42 · Base: 16bac25e61f0092bcfe72aa4eba2dc
461c570956 ·                                                                        [2]
Configuration: kn7fs3p837n3f33e1bc9bffbks8dgn
mf                                                                                  [3]
Coverage: complete
Next action: inspect findings

Deterministic checks                                                                [4]
install: passed
test: failed
lint: passed
typecheck: failed
buildit-rules: passed
gitleaks: passed
osv-scanner: passed

Findings
critical · uncertain:  Incorrect higher-tier tax formula applies                     [5]
20% to full amount instead of excess [source-
38dafbd4c8db7b5492b4144c, source-
b56de1ed7781aaada990e370, source-
5fd2cd5d500b81e65d5c5472]                                                            [6]

Cost: $1.0371 · Source-derived evidence expires: 2026-09-08T03:07:05.953Z            [7]
BuildIT did not merge this pull request. A human owns the merge decision.
```

### Defects

| # | What's wrong | Fix | Weight |
|---|---|---|---|
| **1** | **The subject line says nothing.** All four messages in this thread share one GitHub-generated subject. The one carrying three critical findings looks identical to the two that carried no findings at all. | You can't change GitHub's subject — so make the **first line of the body** the subject. Gmail shows it in the list preview. Lead with `Changes requested — 3 critical findings, 2 required checks failed`. | High |
| **2** | **Full 40-character SHAs.** Head and base wrap across two lines each. Six lines of hex before the reader reaches a single finding. | Show 7–12 characters inline, full SHA in the collapsed receipt. *Already fixed* in current `report.ts` — it emits `headSha.slice(0,12)`. Ship it. | Fixed |
| **3** | **Config revision at full weight.** `kn7fs3p837n3f33e1bc9bffbks8dgnmf` means nothing to a reviewer, yet sits three lines above the findings. | Move to the technical receipt. Nobody reads a config hash while deciding whether to merge. | Medium |
| **4** | **Seven checks, flat list, no weight.** Two failures are buried among five passes in identical typography. The eye has to read all seven to find them. | Sort failures first, group the rest as `5 other checks passed`. Mark required vs optional. Current `report.ts` emits a table with a Policy column — good, but it still doesn't sort or emphasise failures. | High |
| **5** | **"critical · uncertain" undercuts itself.** Every finding in both detailed emails carried `uncertain`. A reader learns to discount the label — and it reads as "we're not sure" attached to a genuine, reproducible bug. | Separate *severity* from *confidence* visually rather than joining them with a middot. And distinguish the reasons: "the critic disagreed" and "an injection signal downgraded this" are not the same message. See the note below — this one isn't only a copy problem. | High |
| **6** | **Evidence IDs inline, mid-sentence.** Three 24-character hex tokens — about 120 characters — interrupt the finding title before the reader reaches the explanation. | Drop them from the body entirely. They belong in the receipt, or behind a link. No human cross-references `source-38dafbd4c8db7b5492b4144c` from an email. | High |
| **7** | **Cost without context.** $1.0371, then $0.9788, then $0.0492, then $0.0475 — $2.11 across four messages for one pull request, with no running total and no explanation of why two runs cost twenty times the others. | Show the per-review cost once, in the receipt, with the budget ceiling beside it: `$1.04 of $2.00 ceiling`. A bare number invites the wrong question. | Medium |

### Not a copy problem

Every model finding in both detailed emails came back `uncertain`, and the pull request was
only blocked because `test` and `typecheck` failed deterministically. That matches the
fail-open behaviour recorded as **DEF-043** in `DEFECT_REGISTER.md`: a single injection
signal downgrades every AI finding to non-blocking, and if the deterministic checks had
passed, this PR would have received a **green check with three critical findings attached**.

Rewording the label would hide that. Fix the downgrade first, then write the copy for the two
states that remain.

### What it could read like

**Now**

```
Re: […] Refactor higher tax tier (PR #2)

BuildIT: changes requested
Head: 682805eaf9a3e813d4…
Configuration: kn7fs3p837n3f33e…
Coverage: complete

Deterministic checks
install: passed
test: failed
lint: passed
typecheck: failed
buildit-rules: passed
gitleaks: passed
osv-scanner: passed

Findings
critical · uncertain: Incorrect higher-tier
tax formula… [source-38dafbd4…]
```

**Proposed**

```
Changes requested — 2 required checks failed, 3 critical findings

The higher-tier tax formula applies 20% to the full amount
instead of the excess above 100.

CHECKS
  test        Failed · required
  typecheck   Failed · required
  5 other checks passed

  [ Inspect the evidence ]   [ Open PR #2 ]

tanmayiift/buildit-public-fixture · PR #2 · commit 682805eaf9a3
BuildIT did not merge this pull request. A human owns the merge decision.
```

Same information, same safety guarantees, same evidence boundary. The difference is that the
decision, the count, and the one-sentence reason arrive before anything a machine wrote for
another machine.

---

## 3. Three defects still in the shipping template

Commits #17 and #18 already moved this template decision-first — the heading, the 12-character
commit, the check table, the collapsed receipt, and the "Why it matters / What to inspect"
pattern are all real improvements over what these PDFs show. These three survived.

| Where | Defect | Fix |
|---|---|---|
| `report.ts:6` | **Paragraph breaks are destroyed.** `safe()` ends with `.replace(/\s+/g," ")`, which collapses every newline in `impact` and `explanation` into a single space. The "What to inspect" text — the most valuable prose in the message, often 4–6 sentences — renders as one unbroken run-on line. | Strip control characters and collapse runs of spaces and tabs, but preserve paragraph breaks: use `/[^\S\n]+/g` for horizontal whitespace and cap consecutive newlines at two. One-line change, largest legibility return in the file. |
| `report.ts:60` | **A failed required check looks like a passing optional one.** Every row of the Markdown table renders in identical weight; there is no ordering and no visual marker. | Sort failed-and-required first. Prefix the result cell with a marker GitHub renders distinctly, and collapse the passing rows into a single summary row when there are more than four. |
| `report.ts:33` | **"Needs human confirmation" for everything.** Every non-accepted finding gets the same string, whether the critic disagreed, arbitration mismatched, or an injection signal fired. The reader can't tell a weak finding from a suppressed one. | Carry the resolution reason through to the report and write three distinct sentences for it. Pair with the DEF-043 fix. |

---

## 4. The operator alert

This one has a simpler story: you wrote a good template and it is connected to nothing.

```
Subject: [FIRING:1] TestAlert Grafana                                               [8]

Grouped by  alertname=TestAlert  instance=Grafana
1 firing instances
Firing · TestAlert
Summary   Notification test
Labels    alertname TestAlert / instance Grafana
Silence

Observed 0s before this notification was delivered, at                              [10]
2026-09-01 06:38:44.137892489 +0000 UTC m=+189755.431694414                          [9]

© 2026 Grafana Labs. Sent by Mimir vmain-ed3d476                                    [11]
```

### The finding that matters

`observability/grafana/notification-templates/buildit-operator-v1.tmpl` is referenced
**nowhere in the repository** — there is no alerting or contact-point provisioning file, only
`provisioning/dashboards/` and `provisioning/datasources/`. Grafana is therefore using its
stock template.

Your five real alert rules in `alerts.yml` each carry an `action` annotation *and* a
`runbook_url` pointing at a specific anchor in the operations runbook:

```yaml
annotations:
  summary: "More than 5% of BuildIT operations are failing"
  action: "Check the BuildIT failure and latency panels, then pause the failing boundary…"
  runbook_url: "https://github.com/…/alert-runbooks.md#buildithighfailurerate"
```

**Neither `action` nor `runbook_url` ever reaches the operator's inbox.** The stock template
renders only `summary` and labels. An on-call engineer gets "More than 5% of BuildIT
operations are failing" and no link to the page telling them what to do about it.

### Defects

| # | What's wrong | Fix | Weight |
|---|---|---|---|
| **8** | **Subject carries no service, severity, or environment.** `[FIRING:1] TestAlert Grafana` could be any system in any environment. | Your own template already does this correctly — `[ACTION REQUIRED] BuildIT · <summary>`. Just wire it up. | High |
| **9** | **A raw Go timestamp with a monotonic clock reading.** `…44.137892489 +0000 UTC m=+189755.431694414` — nanosecond precision plus process uptime, in the body of an email meant to be read at 3 a.m. | Render `StartsAt` as `2026-09-01 06:38 UTC (4 min ago)`. Drop the monotonic segment entirely. | Medium |
| **10** | **"Observed 0s before this notification was delivered."** Grammatically inverted and, at zero, meaningless. | Omit when the value is zero. Otherwise: `Firing for 4m before this alert was sent.` | Low |
| **11** | **It's signed by Grafana Labs and Mimir.** An operational alert about your product arrives branded as someone else's infrastructure. | The custom template ends with "This alert contains only global BuildIT service health" — a better and more honest sign-off. Another reason to wire it. | Low |

### Also worth adding to the template

It is currently plain text, with `Environment` hardcoded to `production` and no alert-instance
detail beyond `StartsAt`. Add the firing value and threshold (*"queue depth 41, threshold 25"*)
so the operator can judge severity before opening a dashboard, and make `runbook_url` the
primary link rather than the last line.

---

## 5. Before you turn on customer email

This template isn't sending yet — `convex/notifications.ts:6` documents that honestly and the
UI reports "Not connected". The design is sound; these are the things that break once it hits
real clients.

| # | Issue | Fix | Weight |
|---|---|---|---|
| **12** | **Semantic HTML5 layout in an email.** `<main>`, `<section>`, and `<h1>` with margin-based spacing are unreliable in Outlook's Word rendering engine — the card, the padding, and the border radius will all drop. | Keep the semantics for screen readers but nest them inside a `role="presentation"` table scaffold. You already use tables for the receipt and header rows; extend the pattern to the outer container. | High |
| **13** | **No dark-mode declaration.** Gmail and Apple Mail will forcibly invert a light-only email, and they invert backgrounds and text independently. Your tone panels — dark red on pale pink — are exactly the pattern that inverts into something unreadable. | Add `<meta name="color-scheme" content="light dark">` and `<meta name="supported-color-schemes" content="light dark">`, then set explicit dark values in a `prefers-color-scheme` block. Test the three tone panels specifically. | High |
| **14** | **Arial-only font stack.** `font-family:Arial,Helvetica,sans-serif` renders acceptably everywhere and beautifully nowhere. | Lead with the system stack — `-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif` — so the message matches the reader's platform. | Low |
| **15** | **The subject is good; the preheader repeats it.** `[BuildIT] Changes need review · repo #2` is strong. The hidden preheader then repeats the summary and repository, so the inbox shows the same words twice. | Use the preheader for what the subject can't hold: `2 required checks failed · commit 682805eaf9a3 · no action taken`. | Medium |
| **16** | **The security paragraph is 11px and last.** "No code, diff, logs, findings, prompts, or credentials are in this email" is one of the strongest things you can say to a security-conscious buyer, and it is set smaller than everything else, below the fold. | Promote it to a bordered strip directly under the action buttons at 12–13px. It's a feature, not a disclaimer. | Medium |
| **17** | **No unsubscribe or preference link.** There's a notification preferences screen in the product, but the email doesn't link to it — and bulk senders need `List-Unsubscribe` headers to stay out of spam. | Add a "Manage review emails" link to the footer and send `List-Unsubscribe` and `List-Unsubscribe-Post` headers from the transport. | High |

---

## 6. The volume problem

Four BuildIT emails landed on one pull request between 8:40 a.m. and 3:25 p.m. The head
commit never changed — it was `682805eaf9a3` in all four. The last two contained no findings
at all: the same header block, the same seven checks, and nothing new. This is how a review
tool trains people to filter it.

**Don't re-notify on an unchanged decision.** If the head SHA, the check conclusions, and the
finding set are all identical to the previous published report, update the existing PR comment
silently and skip the notification. GitHub sends mail on comment *creation*, not on edit — so
editing in place instead of posting again solves this for free.

**Say why a re-run happened.** When a re-review genuinely produces a different result, open
with the delta: `Re-reviewed after model key change — same decision, 0 findings changed.`

---

## 7. Where to start

| # | Fix | Where |
|---|---|---|
| **01** | **Wire the Grafana template.** One provisioning file. It turns an anonymous "TestAlert" into a message that names the service, states the action, and links the runbook — using annotations you have already written. | `observability/grafana/provisioning/alerting/` |
| **02** | **Stop collapsing paragraphs in the review body.** A one-line regex change that restores structure to the most useful prose BuildIT writes. | `packages/orchestrator/src/report.ts:6` |
| **03** | **Lead with the decision and the counts.** First line of the body becomes the de-facto subject in Gmail's preview. Make it carry the verdict, the failed-check count, and the critical-finding count. | `packages/orchestrator/src/report.ts:64` |
| **04** | **Get evidence IDs and the config hash out of the body.** Roughly 200 characters of hex per finding move into the collapsed receipt. Nothing is lost; the finding becomes readable. | `packages/orchestrator/src/report.ts:33,58` |
| **05** | **Sort and weight the checks.** Failed and required first, passing checks collapsed to a count. | `packages/orchestrator/src/report.ts:60` |
| **06** | **Edit the existing comment instead of posting a new one.** Removes the duplicate notifications entirely, because GitHub only mails on creation. | `packages/github/src/repository-writer.ts` |
| **07** | **Fix the confidence label — after DEF-043.** Separate severity from confidence, and give the three downgrade reasons three different sentences. Do this after the fail-open fix, not instead of it. | `packages/orchestrator/src/report.ts:33` |
| **08** | **Harden the customer email before enabling it.** Table scaffold, dark-mode declaration, and `List-Unsubscribe`. The visual design is already there. | `packages/operations/src/email.ts` |

---

Read from three printed Gmail threads dated 2026-09-01 and from `report.ts`, `email.ts`,
`buildit-operator-v1.tmpl`, and `alerts.yml` at commit `ec23ec4`. Contrast ratios measured,
not estimated. No code was changed.
