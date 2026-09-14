import record from "../track-record.json";
import { TrustBoundary } from "../trust-boundary";

// This page carried 387 words and no control, on the one subject that is a shape rather than an
// argument. The stages, their regions, their retention and their refusals are all still here; they
// are in a diagram you can step through instead of ten paragraphs you have to hold in your head.
//
// What stays on the page unconditionally is everything a reader must not have to click to find:
// where source physically goes, the accuracy boundary, and how thin the track record still is.

export const metadata = { title: "Data & privacy · BuildIT" };

export default function DataHandling() {
  return <div className="content trust-page">
    <p className="eyebrow">Trust boundary</p>
    <h1 className="title">What happens to your data</h1>
    <p className="lede">Pick a stage to see what it holds and what it refuses.</p>

    <TrustBoundary />

    <p className="boundary-caption">Source is transported as short-lived encrypted artifacts in AWS Ireland. Isolated checks run in a Vercel Sandbox in Paris, France. Convex Ireland stores references and source-free review metadata rather than plaintext source.</p>

    <h2>What is not promised</h2>
    <p className="boundary-caption">BuildIT does not promise that AI makes code bug-free. Required test, scanner, commit, citation and staleness evidence decides the result, and missing or conflicting proof ends as inconclusive — never as ready to merge.</p>
    <p className="boundary-caption">What is still thin is the track record: {record.reviews} pull requests over {record.repositories} repositories, {record.sinceLastPlatformFailure} consecutive since the last platform failure on {record.lastPlatformFailureAt}. Enough to show the known failures are fixed; not enough to claim reliability on a codebase unlike those.</p>

    {/* This replaced a four-row list of the same four steps. The list said them at four times the
        length and the diagram above already draws them, so what is left is the one-line answer. */}
    <div className="next"><strong>Plain answer:</strong> sign-in grants identity only and does not grant source-code access. Repository access needs a separate GitHub App installation. AI needs a separate model-provider key. Autofix needs separate consent. Merge always stays with a human.</div>
  </div>;
}
