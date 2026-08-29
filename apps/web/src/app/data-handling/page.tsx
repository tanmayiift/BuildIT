const facts = [
  ["Current preview", "GitHub sign-in is active. If you approve it, BuildIT stores the identity fields GitHub returns so it can maintain your session. Review screens remain sample data; no repository, source code, pull request, model key, or payment detail is collected through them."],
  ["Hosting", "The web preview runs on Vercel. Standard infrastructure request logs may include technical details such as time, browser type, and IP address under Vercel's terms."],
  ["Database", "GitHub identity and session records are stored in the BuildIT development Convex deployment in Ireland after sign-in. Tenant tables require server-side organization membership; repository data is not active yet."],
  ["GitHub access", "BuildIT shows live repository metadata only after you sign in, install the GitHub App, and select repositories. Public and private repositories use the same explicit installation boundary; unselected repositories are not imported."],
  ["AI providers", "No AI review runs from this preview. Future BYOK requests will use the key you provide and will be sent to the provider you select, after the product shows its data terms and asks for consent."],
  ["Before launch", "Account export, deletion, repository revocation, retention status, active sessions, audit history, and subprocessor details are release blockers—not optional follow-up work."],
];

export default function DataHandling() {
  return <div className="content trust-page">
    <p className="eyebrow">Trust boundary</p>
    <h1 className="title">What happens to your data</h1>
    <p className="lede">This page describes the deployment you are viewing now. It will change only when the corresponding product capability is built and verified.</p>
    <dl className="trust-list">{facts.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>
    <div className="next"><strong>Plain answer:</strong> signing in shares your approved GitHub identity with BuildIT, but does not grant repository access. The visible review queue is sample data.</div>
  </div>;
}
