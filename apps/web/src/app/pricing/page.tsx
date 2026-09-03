// The public product stated no price, no free allowance and no limit anywhere, so a reader could
// not tell whether BuildIT is a prototype, a free tool or a paid service. That is the question a
// design partner asks before the second conversation, and silence answers it badly.
const plan = [
  ["Who it is for", "Tech leads and builders shipping code with AI agents, who want proof before a merge rather than an incident after one."],
  ["What it costs today", "Every review is free. There is no per-seat, per-repository or per-pull-request charge, and no trial clock counting down."],
  ["What you pay for", "Your own model key. You pay Anthropic, OpenAI or Google directly at their rate, and BuildIT adds nothing on top of it. The Usage page shows every rupee spent on your behalf, per review and per stage."],
  ["What changes later", "Paid plans are coming. Repositories connected now keep free reviews through that change — you will be told before anything is charged, not after."],
];

export default function Pricing() {
  return <div className="content trust-page">
    <p className="eyebrow">Pricing and limits</p>
    <h1 className="title">Free while BuildIT earns your trust</h1>
    <p className="lede">BuildIT charges nothing today. You bring a model key and pay your provider at cost, so the only bill is the one you can already audit.</p>
    <dl className="trust-list">{plan.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>
    <div className="next"><strong>The honest limit:</strong> BuildIT is early. It reviews one pull request at a time against pinned evidence, it never merges, and a review that cannot prove its result ends inconclusive rather than confident. If that is the trade you want, connect a repository.</div>
    <div className="button-row"><a className="button" href="/setup/install">Connect a GitHub repository</a><a className="button secondary" href="/data-handling">Read the data boundary</a></div>
  </div>;
}
