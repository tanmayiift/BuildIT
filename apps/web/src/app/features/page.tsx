// BuildIT had a price page and a data boundary and no page saying what it does, so the only way to
// find out was to connect a repository. Every comparable tool leads with one.
//
// Everything below is shipped and can be checked on a real pull request today. Nothing here is a
// roadmap item, because a features page that mixes the two is how a product stops being trusted.
const capabilities = [
  ["Findings on the line they cite",
    "Each finding is posted as a review comment on the exact file and line it is about, anchored to the commit BuildIT reviewed. The summary comment carries the verdict; the detail sits on the diff where you are already reading."],
  ["Evidence decides, not the model",
    "A finding must cite a file, a line and a content hash BuildIT verified at that commit. One that cannot is dropped before you ever see it, so a confident-sounding guess cannot reach your pull request."],
  ["Real checks, base against head",
    "Install, test, lint, typecheck, gitleaks, osv-scanner and BuildIT's own rules run as real processes in an isolated sandbox with no network, on both commits, so a failure that was already there is not blamed on your change."],
  ["A tested fix, in a separate pull request",
    "With your consent BuildIT opens a stacked pull request with the fix and the check output that proves it. You review and merge it. BuildIT never merges anything."],
  ["Ask it about its own review",
    "Comment `@buildit ask` with a question and it answers from the review it published — no second look at your code, and it says so plainly when the evidence has expired rather than guessing."],
  ["It refuses rather than guesses",
    "When required checks are missing, evidence cannot be gathered, or the critic cannot settle a finding, the verdict is inconclusive and names what stopped it. A confident wrong answer costs more than no answer."],
  ["Your key, your bill",
    "Bring a key for Anthropic, OpenAI or Google. You pay your provider at cost and BuildIT adds nothing on top. Every rupee is itemised on the Usage page, per review."],
  ["As loud as you want it",
    "Choose per repository whether inline comments cover only what blocks a merge, the serious findings too, or everything that survived the evidence gate. The review comment always carries every finding either way."],
  ["Review on every push, if you want it",
    "Off until a repository asks, because a review spends your model key. Once on, opening a pull request or pushing to one starts a review, several commits in one push cost one review, and `@buildit pause` quietens a single pull request without touching the rest."],
  ["Configure it in the repository",
    "A `.buildit.yml` on your default branch sets the review profile, path filters and per-path instructions. It is read from the trusted branch and never from a pull request head, and an admin approves each version, so nobody can change the rules of the review in the pull request being reviewed."],
  ["It learns what your team dismisses",
    "Findings your team repeatedly dismisses stop appearing on the diff and stay in the summary. It never stops finding them, never relaxes the evidence gate, and never quietens a blocking finding or anything a scanner produced."],
  ["A history of what it found and cost",
    "Every review with its verdict, findings, model cost, duration and what your team did with each finding — plus your open pull requests ordered by what BuildIT actually found rather than a risk score it would have to invent."],
  ["Skip what your team would never review",
    "Exclude vendored directories, generated clients or anything else with glob patterns, on top of the lockfiles, build output and binaries BuildIT already skips. Dependency manifests are always read, so quietening a folder never turns off the vulnerability scan."],
];

const boundaries = [
  ["It never merges", "Every verdict ends with a person deciding. BuildIT has no path to the merge button, by design."],
  ["Access is granted in steps", "Signing in identifies you. Repository access is a separate choice you make in GitHub. A model key is requested only when AI analysis starts."],
  ["Source evidence is deleted", "Checked-out code and command output are encrypted, kept for the retention window you set, and then deleted — with the deletion confirmed against storage, not assumed."],
  ["A large repository is read selectively, not wholly", "BuildIT fetches the files your pull request changed, your dependency manifests and the documents it cites \u2014 not your entire repository \u2014 so what it asks GitHub for grows with the size of the change, not the size of your codebase. The hard stop left is a repository whose file listing GitHub itself truncates, and BuildIT says so rather than reviewing part of your code and calling it done."],
];

import record from "../track-record.json";

export default function Features() {
  return <div className="content trust-page">
    <p className="eyebrow">What BuildIT does</p>
    <h1 className="title">Every claim it makes, it can show you</h1>
    <p className="lede">BuildIT reviews one pull request against pinned commits, runs your real checks in a sandbox, and cites the file, line and commit behind every finding. A person still owns the merge.</p>

    <h2 className="section-title">What it does</h2>
    <dl className="trust-list">{capabilities.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>

    <h2 className="section-title">Where it stops</h2>
    <dl className="trust-list">{boundaries.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>

    <div className="next"><strong>The honest limit:</strong> BuildIT has reviewed {record.reviews} pull requests across {record.repositories} repositories, {record.decisive} of which reached a blocking or passing verdict, and {record.sinceLastPlatformFailure} consecutive reviews since the last platform failure on {record.lastPlatformFailureAt}. That is a real record and a small one — the next unfamiliar codebase may still find something it handles badly, and the largest repository BuildIT has been measured on is far smaller than the point where GitHub truncates a file listing. It refuses rather than guesses, so you will sometimes get no answer instead of a wrong one.</div>
    <div className="button-row"><a className="button" href="/setup/install">Connect a GitHub repository</a><a className="button secondary" href="/reviews?tour=1">Inspect a sample review</a></div>
  </div>;
}
