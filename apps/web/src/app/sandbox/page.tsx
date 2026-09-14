import { ScanPanel } from "../scan-panel";

// The only surface a visitor could reach without GitHub sign-in was a tour over invented data, so
// nobody could try BuildIT on code they actually cared about. This is a third state - not the
// sample tour, not a live workspace - and it says so, because a clean result here must never read
// as a clean review.
//
// The form and the annotated result moved into ScanPanel so the landing hero runs the identical
// control. What is left here is the part a hero has no room for: what this is not.

export default function Sandbox() {
  return <div className="content trust-page">
    <p className="eyebrow">Open sandbox · no account, no key</p>
    <h1 className="title">Run BuildIT&rsquo;s deterministic rules on your own code</h1>
    <p className="lede">
      Paste code and the server runs BuildIT&rsquo;s own rules and secret patterns on it, pinning each
      finding to the line it cites. Nothing is stored, no model is called, no repository is read.
    </p>

    <ScanPanel />

    <div className="next"><strong>What this is not:</strong> a verdict. Two deterministic passes over text you pasted, with no commit, no tests and no evidence behind them. A real review pins an exact commit, runs your tests and the pinned scanners in an isolated sandbox, and makes a model justify every finding against that evidence.</div>
    <div className="button-row"><a className="button" href="/setup/install">Connect a GitHub repository</a><a className="button secondary" href="/pricing">See pricing and limits</a></div>
  </div>;
}
