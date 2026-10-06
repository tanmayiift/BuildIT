import { CheckOutput } from "../evidence/check-output";
import { CodeExcerpt } from "../evidence/code-excerpt";
import { DiffView } from "../evidence/diff-view";
import { sampleReviews } from "../sample-data";

// The homepage's first visual is one review BuildIT actually ran, drawn with the components the
// review page uses. Every value comes from the transcribed review in sample-data.ts, so the hero
// cannot claim a finding the product never produced; hero-evidence-boundary.test.ts holds it to that.
const review = sampleReviews.find(item => item.finding)!;
const finding = review.finding!;
const excerpt = finding.excerpt.split("\n").map((text, index) => ({ number: index + 1, text, cited: String(index + 1) === finding.lines }));

export function HeroReviewCard() {
  return (
    <div className="hero-card">
      <div className="hero-card-bar">
        <span>{finding.source.label}</span>
        <code>{finding.commit.slice(0, 7)}</code>
        <span className={`status ${review.tone}`}>{review.status}</span>
      </div>
      <div className="hero-card-body">
        <p className="hero-card-verdict"><span className={`status ${review.tone}`}>{finding.severity}</span> {finding.verdict}</p>
        <h3>{finding.title}</h3>
        <CodeExcerpt path={finding.path} lines={excerpt} clipped={false} />
        <CheckOutput name={finding.checkName} lines={finding.checkOutput.split("\n")} truncated />
        <div className="hero-card-fix">
          <p>The fix, opened as a stacked pull request</p>
          <DiffView label={`The fix to ${finding.path}`} lines={finding.fix.split("\n")} />
          <a className="text-link" href={finding.stackedPr.href}>{finding.stackedPr.label}</a>
        </div>
      </div>
    </div>
  );
}
