import { OverviewReadiness } from "./live-connections";
import { ScanPanel } from "./scan-panel";
import { publicDemoEnabled } from "./public-demo-gate";

const layers = [
  { mark: "01", title: "Choose one pull request", body: "You choose the repositories. Unselected ones stay invisible." },
  { mark: "02", title: "Compare intent with code", body: "It pins the exact commits and says what it could not read." },
  { mark: "03", title: "Run checks and challenge findings", body: "Tests and scanners supply the facts. A finding must cite them to block." },
  { mark: "04", title: "Hand back an inspectable fix", body: "Findings land on the lines they cite, and with your consent a stacked PR you merge yourself." },
] as const;

export default function Overview() {
  return <div className="content landing">
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="landing-promise">
        <p className="eyebrow">For lean B2B software teams</p>
        <h1 id="landing-title">Autonomous code review that cites its evidence.</h1>
        <p className="landing-promise-line">It fixes what it finds and opens a stacked PR. It never merges. A human owns the merge decision.</p>
      </div>
      {/* The scan was one navigation away behind a link, so the first thing the page asked a
          stranger to do was still to go somewhere else. The working control is in the hero now and
          the promise beside it is one sentence, because a reader who can try the thing in four
          seconds does not need a paragraph arguing that it works.

          It is also its own grid child rather than part of the promise block, so that when the hero
          stacks on a phone the order becomes claim, then the thing itself, then the two actions
          that cost something - instead of burying the scanner under both buttons and the fine
          print. */}
      <aside className="landing-try" aria-labelledby="landing-try-title">
        <p className="eyebrow">{publicDemoEnabled() ? "No account, no key" : "Deterministic rules"}</p>
        <h2 id="landing-try-title">{publicDemoEnabled() ? "Scan code now" : "The same rules, on your pull requests"}</h2>
        {/* The panel posts to /api/scan. When that is closed the panel can only ever render an
            error, so it is replaced rather than left to fail - the hero is the first thing a
            stranger sees and a broken control there says more than the copy does. */}
        {publicDemoEnabled()
          ? <><ScanPanel variant="card" /><a className="text-link" href="/scan">Open the full scan and its limits →</a></>
          : <p className="landing-try-closed">BuildIT&rsquo;s deterministic rules and secret patterns run on every connected pull request, citing the exact line each finding came from. Connect a repository to see them on your own code.</p>}
      </aside>
      <div className="landing-commit">
        <div className="button-row landing-actions"><a className="button" href="/setup/install">Connect a GitHub repository</a><a className="button secondary" href="/reviews?tour=1">Inspect a sample review</a></div>
        <small className="landing-boundary">Scanning pasted code needs nothing. Sign-in identifies you. Repository access is a separate step. A model key is requested only when AI analysis starts.</small>
      </div>
    </section>
    <OverviewReadiness />

    <section className="landing-flow" aria-labelledby="flow-title"><div className="section-heading"><div><p className="eyebrow">One review, four working layers</p><h2 id="flow-title">From pull request to a decision you can inspect</h2></div></div><ol>{layers.map(layer => <li key={layer.mark}><code>{layer.mark}</code><h3>{layer.title}</h3><p>{layer.body}</p></li>)}</ol></section>

    <section className="landing-trust" aria-labelledby="trust-title"><div><p className="eyebrow">The accuracy boundary</p><h2 id="trust-title">AI proposes. Evidence decides.</h2></div><p>A model does not mark a branch safe. The verdict comes from required checks, cited findings and staleness. Missing or conflicting proof ends as <strong>inconclusive</strong>, not a confident guess.</p><a className="text-link" href="/data-handling">Read the data and access boundary →</a></section>

    <section className="landing-pricing" aria-labelledby="pricing-title"><div><p className="eyebrow">Pricing and limits</p><h2 id="pricing-title">Free while BuildIT earns your trust</h2></div><p>Every review is free today. You bring your own model key and pay your provider at cost; BuildIT adds nothing on top.</p><a className="text-link" href="/pricing">See pricing and limits →</a></section>
  </div>;
}
