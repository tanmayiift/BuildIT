import { OverviewReadiness } from "./live-connections";

const layers = [
  { mark: "01", title: "Choose one pull request", body: "You choose the repositories. Unselected ones stay invisible." },
  { mark: "02", title: "Compare intent with code", body: "It pins the exact commits and says what it could not read." },
  { mark: "03", title: "Run checks and challenge findings", body: "Tests and scanners supply the facts. A finding must cite them to block." },
  { mark: "04", title: "Hand back an inspectable fix", body: "With your consent, a stacked PR you review and merge yourself." },
] as const;

export default function Overview() {
  return <div className="content landing">
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="landing-promise">
        <p className="eyebrow">For lean B2B software teams</p>
        <h1 id="landing-title">Autonomous code review that cites its evidence.</h1>
        <p className="landing-promise-line">It fixes what it finds and opens a stacked PR. It never merges. A human owns the merge decision.</p>
        <p>Every finding names the file, the line, and the commit it was checked against.</p>
        <div className="button-row landing-actions"><a className="button" href="/setup/install">Connect a GitHub repository</a><a className="button secondary" href="/reviews?tour=1">Inspect a sample review</a></div>
        <small className="landing-boundary">Sign-in identifies you. Repository access is a separate step. A model key is requested only when AI analysis starts.</small>
      </div>
      <aside className="review-proof" aria-label="What a BuildIT decision contains">
        <div className="proof-context"><span><small>Repository</small><strong>your-org/api</strong></span><span><small>Commit</small><code>exact head SHA</code></span></div>
        <div className="proof-verdict"><span className="status warning">Needs evidence</span><h2>One requirement is not covered</h2><p>The finding cannot block until its cited lines and required test output pass verification.</p></div>
        <dl><div><dt>Requirements</dt><dd>Linked to source</dd></div><div><dt>Checks</dt><dd>Base vs head</dd></div><div><dt>AI claims</dt><dd>Evidence-gated</dd></div><div><dt>Merge</dt><dd>Human only</dd></div></dl>
      </aside>
    </section>
    <OverviewReadiness />

    <section className="landing-flow" aria-labelledby="flow-title"><div className="section-heading"><div><p className="eyebrow">One review, four working layers</p><h2 id="flow-title">From pull request to a decision you can inspect</h2></div></div><ol>{layers.map(layer => <li key={layer.mark}><code>{layer.mark}</code><h3>{layer.title}</h3><p>{layer.body}</p></li>)}</ol></section>

    <section className="landing-trust" aria-labelledby="trust-title"><div><p className="eyebrow">The accuracy boundary</p><h2 id="trust-title">AI proposes. Evidence decides.</h2></div><p>A model does not mark a branch safe. The verdict comes from required checks, cited findings and staleness. Missing or conflicting proof ends as <strong>inconclusive</strong>, not a confident guess.</p><a className="text-link" href="/data-handling">Read the data and access boundary →</a></section>

    <section className="landing-pricing" aria-labelledby="pricing-title"><div><p className="eyebrow">Pricing and limits</p><h2 id="pricing-title">Free while BuildIT earns your trust</h2></div><p>Every review is free today. You bring your own model key and pay your provider at cost; BuildIT adds nothing on top.</p><a className="text-link" href="/pricing">See pricing and limits →</a></section>
  </div>;
}
