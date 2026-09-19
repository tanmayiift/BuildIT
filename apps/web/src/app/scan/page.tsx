import { ScanPanel } from "../scan-panel";
import { demoClosedDetail, demoClosedHeading, publicDemoEnabled } from "../public-demo-gate";

// The only surface a visitor could reach without GitHub sign-in was a tour over invented data, so
// nobody could try BuildIT on code they actually cared about. This is a third state - not the
// sample tour, not a live workspace - and it says so, because a clean result here must never read
// as a clean review.
//
// The form and the annotated result moved into ScanPanel so the landing hero runs the identical
// control. What is left here is the part a hero has no room for: what this is not.

// The route answers 200 in both states on purpose. Dropping it from publicRoutes would turn it
// into a proxy 404 and break three suites that check the route table agrees with itself, to save a
// page that costs nothing to render. The two buttons are also unconditional: the onboarding journey
// reaches "Connect a GitHub repository" through this page, so a closed demo must not be a dead end.
export default function Sandbox() {
  const open = publicDemoEnabled();
  return <div className="content trust-page">
    <p className="eyebrow">{open ? "Open scan · no account, no key" : "Deterministic rules"}</p>
    <h1 className="title">{open ? <>Run BuildIT&rsquo;s deterministic rules on your own code</> : demoClosedHeading}</h1>
    <p className="lede">
      {open
        ? <>Paste code and the server runs BuildIT&rsquo;s own rules and secret patterns on it, pinning each
          finding to the line it cites. Nothing is stored, no model is called, no repository is read.</>
        : demoClosedDetail}
    </p>

    {open ? <ScanPanel /> : null}

    {open ? <div className="next"><strong>What this is not:</strong> a verdict. Two deterministic passes over text you pasted, with no commit, no tests and no evidence behind them. A real review pins an exact commit, runs your tests and the pinned scanners in an isolated environment, and makes a model justify every finding against that evidence.</div> : null}
    <div className="button-row"><a className="button" href="/setup/install">Connect a GitHub repository</a><a className="button secondary" href="/pricing">See pricing and limits</a></div>
  </div>;
}
