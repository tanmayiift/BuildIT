import { OverviewReadiness } from "./live-connections";

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
      {/* The hero used to carry a working scanner that executed pasted code. It was the only surface
          in the product running attacker-supplied input with no account behind it, and once BuildIT
          had tenants other than its author that trade stopped being worth it - so it was gated off
          and the hero became a paragraph arguing that the rules work.

          A real review is better evidence than a scan of pasted text ever was. A scan ran two
          deterministic passes with no commit, no tests and no verdict; this points at one complete
          review with the file, the line, the commit, the failing check and the fix, every value
          checkable against a public pull request.

          It stays its own grid child so that when the hero stacks on a phone the order is claim,
          then the evidence, then the two actions that cost something. */}
      <aside className="landing-try" aria-labelledby="landing-try-title">
        <p className="eyebrow">One real review</p>
        <h2 id="landing-try-title">See what it hands you</h2>
        <p className="landing-try-closed">One review BuildIT actually ran: the file and line it cites, the commit it read, the output of the check that proved the finding, and the pull request the fix was opened as. No account, and nothing to paste.</p>
        <a className="text-link" href="/scan">Read a real review &rarr;</a>
      </aside>
      <div className="landing-commit">
        <div className="button-row landing-actions"><a className="button" href="/setup/install">Connect a GitHub repository</a><a className="button secondary" href="/reviews?tour=1">Inspect a sample review</a></div>
        <small className="landing-boundary">Reading a real review needs nothing. Sign-in identifies you. Repository access is a separate step. A model key is requested only when AI analysis starts.</small>
      </div>
    </section>
    <OverviewReadiness />

    <section className="landing-flow" aria-labelledby="flow-title"><div className="section-heading"><div><p className="eyebrow">One review, four working layers</p><h2 id="flow-title">From pull request to a decision you can inspect</h2></div></div><ol>{layers.map(layer => <li key={layer.mark}><code>{layer.mark}</code><h3>{layer.title}</h3><p>{layer.body}</p></li>)}</ol></section>

    <section className="landing-trust" aria-labelledby="trust-title"><div><p className="eyebrow">The accuracy boundary</p><h2 id="trust-title">AI proposes. Evidence decides.</h2></div><p>A model does not mark a branch safe. The verdict comes from required checks, cited findings and staleness. Missing or conflicting proof ends as <strong>inconclusive</strong>, not a confident guess.</p><a className="text-link" href="/data-handling">Read the data and access boundary →</a></section>

    <section className="landing-pricing" aria-labelledby="pricing-title"><div><p className="eyebrow">Pricing and limits</p><h2 id="pricing-title">Free while BuildIT earns your trust</h2></div><p>Every review is free today. You bring your own model key and pay your provider at cost; BuildIT adds nothing on top.</p><a className="text-link" href="/pricing">See pricing and limits →</a></section>
  </div>;
}
