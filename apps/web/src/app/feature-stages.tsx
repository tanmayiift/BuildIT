"use client";
import { useState } from "react";

// /features was seventeen claims in one flat definition list - six hundred words with no structure
// and nothing to do. A reader could not tell which claims describe the same moment of a review, so
// the only way through was to read all of it.
//
// The claims are unchanged in substance and none were dropped. They are grouped by the stage of a
// review they belong to, and one stage is shown at a time, so the page teaches the pipeline instead
// of reciting a list - and a reader looking for one thing reads four lines rather than seventeen.

const stages = [
  {
    mark: "01", title: "Read the change", summary: "You decide which repositories exist and what is worth reading.",
    claims: [
      ["Review on every push, if you want it", "Off until a repository asks, because a review spends your model key. `@buildit pause` quietens one pull request."],
      ["Configured in the repository", "A `.buildit.yml` on your default branch sets profile, path filters and per-path instructions. Never read from a pull request head, and an admin approves each version."],
      ["Skip what your team would never review", "Exclude vendored or generated directories with globs. Dependency manifests are always read, so quietening a folder never turns off the vulnerability scan."],
    ],
  },
  {
    mark: "02", title: "Gather evidence", summary: "Real processes produce the facts, on both commits, before anything is judged.",
    claims: [
      ["Real checks, base against head", "Install, test, lint, typecheck, gitleaks, osv-scanner and BuildIT's own rules run in an isolated sandbox with no network, on both commits, so a pre-existing failure is not blamed on your change."],
      ["Evidence decides, not the model", "A finding must cite a file, a line and a content hash BuildIT verified at that commit. One that cannot is dropped before you see it."],
    ],
  },
  {
    mark: "03", title: "Decide what blocks", summary: "Findings land where you are already reading, and only if they can prove themselves.",
    claims: [
      ["Findings on the line they cite", "Each one is a review comment on the exact file and line, anchored to the commit BuildIT reviewed. The summary comment carries the verdict."],
      ["As loud as you want it", "Per repository: only what blocks a merge, the serious findings too, or everything that survived the evidence gate."],
      ["It refuses rather than guesses", "Missing checks or unsettled findings end as inconclusive, naming what stopped it. A confident wrong answer costs more than no answer."],
      ["It learns what your team dismisses", "Repeatedly dismissed findings move to the summary instead of the diff. Never a blocking finding, and never anything a scanner produced."],
    ],
  },
  {
    mark: "04", title: "Hand it back", summary: "A fix you review, an answer you can question, and a bill you can audit.",
    claims: [
      ["A tested fix, in a separate pull request", "With your consent, a stacked pull request carrying the check output that proves it. You review and merge. BuildIT never merges."],
      ["Ask it about its own review", "Comment `@buildit ask` and it answers from the review it published — no second look at your code, and it says so when the evidence has expired."],
      ["A history of what it found and cost", "Every review with its verdict, findings, model cost, duration, and what your team did with each finding."],
      ["Your key, your bill", "Bring a key for Anthropic, OpenAI or Google. You pay your provider at cost, itemised per review on the Usage page."],
    ],
  },
] as const;

export function FeatureStages() {
  const [active, setActive] = useState(0);
  const stage = stages[active]!;
  return <section className="feature-stages" aria-label="What BuildIT does, by stage of a review">
    <div className="stage-choices">
      {stages.map((item, index) => (
        <button key={item.mark} className="button secondary" type="button" aria-pressed={index === active}
          onClick={() => setActive(index)}>
          <code>{item.mark}</code> {item.title}
        </button>
      ))}
    </div>
    <div className="stage-panel" aria-live="polite">
      <p className="stage-summary">{stage.summary}</p>
      <dl className="trust-list">
        {stage.claims.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}
      </dl>
    </div>
  </section>;
}
