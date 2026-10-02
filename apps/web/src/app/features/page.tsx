import record from "../track-record.json";
import { FeatureStages } from "../feature-stages";

// BuildIT had a price page and a data boundary and no page saying what it does, so the only way to
// find out was to connect a repository. Every comparable tool leads with one.
//
// It then went too far the other way: six hundred words of claims with nothing to operate. A
// features page for a code reviewer that cannot show you a review is asking to be believed. So the
// page now opens with the one part of a review that runs for a stranger with no account, and the
// claims sit behind it grouped by the stage of a review they belong to.
//
// Everything here is shipped and can be checked on a real pull request today. Nothing is a roadmap
// item, because a features page that mixes the two is how a product stops being trusted.

const boundaries = [
  ["It never merges", "Every verdict ends with a person deciding. BuildIT has no path to the merge button, by design."],
  ["Access is granted in steps", "Sign-in identifies you. Repository access is a separate choice in GitHub. A model key is requested only when AI analysis starts."],
  ["Source evidence is deleted", "Checked-out code and command output are encrypted, kept for the retention window you set, then deleted — with the deletion confirmed against storage, not assumed."],
  ["A large repository is read selectively", "It fetches the files your pull request changed, your dependency manifests and the documents it cites. If GitHub truncates the file listing, BuildIT says so rather than reviewing part of your code and calling it done."],
  // The landing page's open-source answer links here, so this entry carries the anchor.
  ["A fork cannot spend your key", "A pull request from a fork is reviewed only when a maintainer with write access comments @buildit review — never automatically, and never with a fix pushed back to it. The configuration it runs with is never read from the pull request itself, and text in it that tries to instruct the reviewer marks the affected finding uncertain for a person to judge.", "forks"],
];

export const metadata = { title: "Features · BuildIT" };

export default function Features() {
  return <div className="content trust-page">
    <p className="eyebrow">What BuildIT does</p>
    <h1 className="title">Every claim it makes, it can show you</h1>
    {/* The lede promised "this page starts by doing it", which stops being true the moment the
        panel below is gated. Copy that describes a control has to change with the control. */}
    <p className="lede">Every claim below names the file, the line and the commit it came from, and a review that cannot prove its result says so instead of guessing. <a className="text-link" href="/scan">Read one it ran</a>.</p>

    <h2>What it does, stage by stage</h2>
    <FeatureStages />

    <h2>Where it stops</h2>
    <dl className="trust-list">{boundaries.map(([term, detail, anchor]) => <div key={term} id={anchor}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>

    <div className="next"><strong>The honest limit:</strong> BuildIT has reviewed {record.reviews} pull requests over {record.repositories} repositories, {record.decisive} of them reaching a blocking or passing verdict and {record.platformFailed} failing on BuildIT&rsquo;s own side rather than on your code. That is a real record and a small one — the next unfamiliar codebase may still find something it handles badly. It refuses rather than guesses, so you will sometimes get no answer instead of a wrong one.</div>
    <div className="button-row"><a className="button" href="/setup/install">Connect a GitHub repository</a><a className="button secondary" href="/reviews?tour=1">Inspect a sample review</a></div>
  </div>;
}
