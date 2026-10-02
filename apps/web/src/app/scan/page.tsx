import { sampleReviewFor } from "../sample-data";
import { CompleteFinding } from "../complete-finding";

// This page used to execute code a stranger pasted. That was the only surface in the product running
// attacker-supplied input with no account behind it, and once BuildIT had tenants other than its
// author the trade stopped being worth it: the demo was gated off behind a build-time flag and the
// page became a closed door, so the product's only zero-commitment proof of output was a sample tour
// reached from a secondary button.
//
// A read-only proof is strictly better evidence anyway. A scan of pasted text ran two deterministic
// passes with no commit, no tests and no verdict - it could never show the thing BuildIT is actually
// for. This shows one complete review that really ran: the verdict, the checks behind it, the finding
// with its file, line and commit, the output of the check that proved it, the fix it proposed, and
// links to the public pull requests where every value can be checked. No form, no execution, no
// sandbox seconds, no abuse surface.
const review = sampleReviewFor("22");

export const metadata = { title: "A review BuildIT ran · BuildIT" };

export default function Scan() {
  // sampleReviewFor(22) is the transcribed buildit-public-fixture review and is the only sample row
  // carrying a complete finding. If it ever stops doing so, say so rather than rendering a page whose
  // headline promises evidence it does not have.
  if (!review?.finding) {
    return <div className="content trust-page">
      <p className="eyebrow">Evidence</p>
      <h1 className="title">This page is temporarily without a transcribed review</h1>
      <p className="lede">The live numbers on the proof page are unaffected and are read straight from
        production.</p>
      <div className="button-row"><a className="button" href="/proof">See the live numbers</a></div>
    </div>;
  }

  return <div className="content trust-page">
    <p className="eyebrow">One real review · no account, no key</p>
    <h1 className="title">What a BuildIT review actually hands you</h1>
    <p className="lede">
      Every value below is transcribed from one review BuildIT ran on a public repository, and every
      one of them is checkable: the file at that commit, the output of the check that failed, and the
      pull request the fix was opened as. Nothing here is composed for the page.
    </p>

    {/* Only fields sample-data.ts documents as real are cited here. The row's own `repo`, `commit`
        and `title` are illustrative placeholders for the queue mock - quoting those as evidence on a
        page whose whole claim is checkability would be the exact defect this page exists to avoid.
        finding.* is transcribed from the real review, and `checks` is its real check table. */}
    <dl className="trust-list">
      <div><dt>The pull request</dt><dd>
        <a className="text-link" href={review.finding.source.href} rel="noreferrer noopener" target="_blank">{review.finding.source.label}</a>
        {" "}at commit <code>{review.finding.commit.slice(0, 12)}</code>, reviewed on {review.finding.reviewedAt}.
      </dd></div>
      <div><dt>The verdict</dt><dd>{review.finding.verdict}. A finding BuildIT can prove blocks the merge; one it cannot prove does not.</dd></div>
      <div><dt>What it ran</dt><dd>
        {review.checks?.map(check => `${check.name} (${check.policy.toLowerCase()}): ${check.result.toLowerCase()}`).join(" · ")}.
        Each is a check the repository already defines, run against that exact commit on both the base and the head.
      </dd></div>
    </dl>

    <CompleteFinding finding={review.finding} />

    <div className="next"><strong>What this is not:</strong> a claim about your code. It is one review
      of one repository, and the proof page carries the whole record — including the reviews that
      failed on BuildIT&rsquo;s own side rather than on anybody&rsquo;s code.</div>

    <div className="button-row">
      <a className="button" href="/setup/install">Connect a GitHub repository</a>
      <a className="button secondary" href="/proof">See every review, including the failures</a>
    </div>
  </div>;
}
