import { type SampleReview } from "./sample-data";

// Shared because two pages now render the same transcribed evidence: the sample review detail, and
// /scan, which replaced a live code-paste demo with a read-only proof of a real review. Keeping one
// component means the two cannot drift into describing the same finding differently - and the whole
// claim of the page is that every value is quotable from the pull request it links to.
export function CompleteFinding({ finding }: { finding: NonNullable<SampleReview["finding"]> }) {
  return <section className="complete-finding" aria-labelledby="complete-finding-title">
    <div className="section-heading compact"><div><p className="eyebrow">Cited evidence</p><h2 id="complete-finding-title">{finding.title}</h2></div><span className="status danger">{finding.severity}</span></div>
    <p className="finding-where"><code>{finding.path}:{finding.lines}</code> at commit <code>{finding.commit.slice(0, 12)}</code> · {finding.verdict}</p>
    <p className="finding-source">Transcribed from a review BuildIT ran on {finding.reviewedAt}: <a className="text-link" href={finding.source.href} rel="noreferrer noopener" target="_blank">{finding.source.label}</a>. Every value below is quotable from it.</p>
    <p className="finding-why">{finding.why}</p>
    <p className="finding-why">{finding.inspect}</p>
    <div className="finding-block"><h3>The code it read</h3><pre tabIndex={0} role="region" aria-label="The code it read"><code>{finding.excerpt}</code></pre></div>
    <div className="finding-block"><h3>What <code>{finding.checkName}</code> reported</h3><pre tabIndex={0} role="region" aria-label={`What ${finding.checkName} reported`}><code>{finding.checkOutput}</code></pre></div>
    <div className="finding-block"><h3>The change it proposes</h3><pre className="finding-diff" tabIndex={0} role="region" aria-label="The change it proposes"><code>{finding.fix}</code></pre></div>
    <p className="finding-delivery">Delivered as a stacked pull request a person reviews and merges — BuildIT never merges: <a className="text-link" href={finding.stackedPr.href} rel="noreferrer noopener" target="_blank">{finding.stackedPr.label}</a></p>
  </section>;
}
