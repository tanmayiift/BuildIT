import { sampleReviews } from "../sample-data";

export default function ReviewQueue() {
  const needsDecision = sampleReviews.filter(review => review.status !== "Running");
  const running = sampleReviews.filter(review => review.status === "Running");
  return <div className="content">
    <div className="page-heading"><div><p className="eyebrow">Sample evidence · no repository connected</p><h1 className="title">Review queue</h1><p className="page-description">Prioritized by the next human action—not by when a webhook arrived.</p></div><div className="heading-actions"><label className="search-field"><span className="sr-only">Search reviews</span><input type="search" placeholder="Search repo, PR, commit" /></label><a className="button" href="/setup/install">Connect repository</a></div></div>
    <ReviewGroup title="Needs decision" reviews={needsDecision} />
    <ReviewGroup title="Running" reviews={running} />
    <section className="empty-band"><div><strong>Finished reviews appear here</strong><p>Delivered, passed, cancelled, and failed runs remain searchable with their exact commit and evidence expiry.</p></div><a href="/data-handling">Read retention policy →</a></section>
  </div>;
}

function ReviewGroup({ title, reviews }: { title: string; reviews: typeof sampleReviews }) {
  return <section className="review-group"><div className="section-heading compact"><h2>{title}</h2><span className="count">{reviews.length}</span></div><div className="review-table" role="table" aria-label={title}>{reviews.map(review => <a role="row" className="review-row" href={`/reviews/${review.pr}`} key={review.pr}><span role="cell" className={`status ${review.tone}`}>{review.status}</span><span role="cell" className="review-name"><strong>{review.repo} #{review.pr}</strong><small>{review.title}</small></span><code role="cell">{review.commit}</code><span role="cell">{review.coverage}</span><span role="cell" className="signal">{review.signal}</span><span role="cell">{review.owner}</span><time role="cell">{review.age}</time></a>)}</div></section>;
}
