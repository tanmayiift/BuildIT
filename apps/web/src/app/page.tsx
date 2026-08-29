import { efficacy, sampleReviews } from "./sample-data";
import { OverviewReadiness } from "./live-connections";

export default function Overview() {
  return <div className="content">
    <div className="page-heading"><div><p className="eyebrow">Sample workspace · product tour</p><h1 className="title">Engineering review, with proof</h1><p className="page-description">See what needs a decision, what BuildIT verified, and what is safe to hand back to a human.</p></div><a className="button" href="/setup/install">Connect your first repository</a></div>
    <OverviewReadiness />
    <section aria-labelledby="outcomes-title"><div className="section-heading"><div><p className="eyebrow">Illustrative outcomes</p><h2 id="outcomes-title">What efficacy looks like</h2></div><a href="/metrics">How these are measured →</a></div><div className="metric-line"><article className="metric hero-metric"><span>PRs reviewed</span><strong>{efficacy.reviewed}</strong><small>Since Sunday</small></article><article className="metric"><span>Regressions caught</span><strong>{efficacy.regressions}</strong><small>Before human merge</small></article><article className="metric"><span>Suggested → implemented</span><strong>{efficacy.suggestions} → {efficacy.implemented}</strong><small>Verified fixes only</small></article><article className="metric"><span>Effective LOC</span><strong>{efficacy.effectiveLoc}</strong><small>No comments or formatting</small></article></div></section>
    <section aria-labelledby="decisions-title"><div className="section-heading"><div><p className="eyebrow">Needs a human</p><h2 id="decisions-title">Decisions waiting</h2></div><a href="/reviews">Open review queue →</a></div><div className="decision-list">{sampleReviews.slice(0, 3).map(review => <a href={`/reviews/${review.pr}`} className="decision-row" key={review.pr}><span className={`status ${review.tone}`}>{review.status}</span><span><strong>{review.repo} #{review.pr}</strong><small>{review.title}</small></span><code>{review.commit}</code><span>{review.coverage} criteria</span><span className="row-arrow">→</span></a>)}</div></section>
  </div>;
}
