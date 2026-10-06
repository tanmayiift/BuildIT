# Visual direction, October 2026

Why the homepage and journey pages changed, and what they are measured against. The competitors' structure was measured on 6 October 2026 in a browser at 1440×900. Nothing was copied: no copy, assets or layouts.

## What the field does

| Site | Headline | First-screen visual | Visuals on the page | Words |
|---|---|---|---|---|
| CodeRabbit | 2 lines | a rendered review comment on a diff | 10 | ~1,500 |
| Greptile | 4 words | a brand illustration | 19 | ~1,200 |
| Graphite | 6 words | a product video | 26 | 609 |
| Qodo | 7 words | product images and a mascot | 10 | 1,864 |
| Cursor Bugbot | 7 words | a framed pull-request window: diff, finding title, explanation | 2 (+1 video) | 689 |
| Sourcery | 4 words | a small diagram | 4 | 602 |
| Ellipsis | 6 words | a wide diagram | 5 | 1,342 |
| **BuildIT, before** | 10 words, plus ~55 words of hero copy | none: a text card | **0** | 548 |

What the field shares:
- a headline of seven words or fewer, with one supporting line;
- one or two actions;
- **the product doing its job** (a finding on a diff, in a framed window) as the first visual;
- illustration as a brand layer behind or beside the product, never instead of it;
- proof (logos or numbers) below the fold.

## What BuildIT does with that

**The first visual is a real review, rendered.** The hero card draws the actual review of `tanmayiift/buildit-public-fixture#22`, field for field from `sample-data.ts`:
- the commit;
- the finding;
- the cited lines;
- the failing check's output;
- the one-line fix and the stacked pull request.

It uses the same components the review page uses (`apps/web/src/app/evidence`), so the homepage cannot show a finding the product could not render. `tests/architecture/hero-evidence-boundary.test.ts` holds it to transcribed fields only, with no fetch and no state.

**The headline stays.** "Code review that shows its evidence — or says it couldn't." is longer than the field's norm. It is also the one sentence only BuildIT can say, and three journey tests pin it. Instead, the copy around it is cut: one supporting line, the never-merges line, the two actions.

**The highlight never rests on colour alone.**
- Cited lines carry a `›` marker and a screen-reader phrase.
- Diff lines carry `+` / `−` glyphs and "added" / "removed".
- Every colour is a token defined for both schemes and measured at WCAG AA by `interface-accessibility.test.ts`.

**Illustration is secondary.** Generated illustrations are allowed where a page has nothing of the product to show: empty states and setup steps. They must be abstract, carry no text or logos, use the `globals.css` palette, and read in both schemes. Each one's source and prompt goes in `asset-provenance.md`.
