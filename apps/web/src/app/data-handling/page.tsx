const facts = [
  ["Public tour versus your workspace", "The public tour is labelled sample data and needs no account. After sign-in, workspace pages request tenant-scoped data from the server; they do not silently replace missing or forbidden data with samples."],
  ["GitHub identity", "GitHub sign-in proves who you are and creates a BuildIT session. It does not grant source-code access. BuildIT stores only the identity fields GitHub returns and rechecks organization membership for protected operations."],
  ["Repository access", "Source and pull-request access starts only after you install the BuildIT GitHub App and select repositories. Public and private repositories use the same installation boundary. Unselected repositories remain unavailable, and removing an installation stops new access."],
  ["GitHub writes", "A review may maintain one BuildIT Check and one summary comment on the reviewed commit. BuildIT may open a separate stacked pull request only after Autofix consent. It has no merge authority and does not edit workflows or repository settings."],
  ["Model-provider key", "This is an Anthropic, OpenAI, or Gemini key—not a GitHub key. The browser sends it to BuildIT's separate credential broker for provider validation and AWS KMS encryption. BuildIT returns masked metadata, not the raw key, and does not store plaintext in Convex. An Owner or Admin can rotate or revoke it."],
  ["What reaches the model provider", "When you start AI analysis, BuildIT sends the selected review prompt and bounded evidence to the provider you chose, along with your provider key for authentication. Deterministic checks can run without a model key. BuildIT does not send unrelated repositories."],
  ["Source artifacts and test region", "Review source is transported as short-lived encrypted artifacts in AWS Ireland and bound to one organization, repository, review, and stage. Isolated checks run in a Vercel Sandbox in Paris, France, with network access denied after the fixed install step; the sandbox is destroyed after the run. Convex stores references and source-free review metadata rather than plaintext source. The configured maximum source retention is seven days; repository policy may be shorter."],
  ["Hosting and operational logs", "The web app and isolated broker run on Vercel; durable application state runs in Convex Ireland; encrypted artifacts and keys use AWS in Ireland. Infrastructure providers may retain request metadata such as time, IP address, and browser details under their own terms. Product logs must not contain source or raw provider keys."],
  ["Accuracy boundary", "BuildIT does not promise that AI makes code bug-free. Required test, scanner, commit, citation, and staleness evidence decides the result. Missing or conflicting proof must end as inconclusive or action required—not ready to merge."],
  ["Current release status", "Four of the five previous release blockers now have dated evidence (2026-09-03): a complete real-model review on third-party code with all seven checks passing, native scanner timing from real sandbox processes, one human-inspected stacked pull request merged by a person, and cross-tenant browser isolation proved with a second account. Key rotation proof is still outstanding and remains a release blocker."],
];

export default function DataHandling() {
  return <div className="content trust-page">
    <p className="eyebrow">Trust boundary</p>
    <h1 className="title">What happens to your data</h1>
    <p className="lede">What BuildIT can read, where it goes, what it may write, and what remains unproven in this deployment.</p>
    <dl className="trust-list">{facts.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>
    <div className="next"><strong>Plain answer:</strong> sign-in grants identity only. Repository access needs a separate GitHub App installation. AI needs a separate model-provider key. Autofix needs separate consent. Merge always stays with a human.</div>
  </div>;
}
