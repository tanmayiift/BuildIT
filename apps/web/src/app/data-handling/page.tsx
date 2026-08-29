const facts = [
  ["Current preview", "Static sample screens only. No GitHub account, repository, source code, pull request, model key, or payment detail is collected by the BuildIT application."],
  ["Hosting", "The web preview runs on Vercel. Standard infrastructure request logs may include technical details such as time, browser type, and IP address under Vercel's terms."],
  ["Database", "A development Convex deployment exists in Ireland, but this public preview is not connected to it and does not write visitor data to BuildIT tables."],
  ["GitHub access", "The BuildIT GitHub App exists but is not installed on your repositories through this preview. Public and private repository access will require you to select repositories during installation."],
  ["AI providers", "No AI review runs from this preview. Future BYOK requests will use the key you provide and will be sent to the provider you select, after the product shows its data terms and asks for consent."],
  ["Before launch", "Account export, deletion, repository revocation, retention status, active sessions, audit history, and subprocessor details are release blockers—not optional follow-up work."],
];

export default function DataHandling() {
  return <div className="content trust-page">
    <p className="eyebrow">Trust boundary</p>
    <h1 className="title">What happens to your data</h1>
    <p className="lede">This page describes the deployment you are viewing now. It will change only when the corresponding product capability is built and verified.</p>
    <dl className="trust-list">{facts.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>
    <div className="next"><strong>Plain answer:</strong> the current preview cannot read your GitHub account or repositories. The visible queue and account-like details are examples.</div>
  </div>;
}
