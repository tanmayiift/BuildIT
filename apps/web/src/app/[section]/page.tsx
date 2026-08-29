import { efficacy } from "../sample-data";
import { GitHubIntegrationState, RepositoryConnectionView } from "../live-connections";

const validSections = new Set(["repositories", "metrics", "usage", "integrations", "policies", "members", "audit"]);

export default async function Section({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!validSections.has(section)) return <div className="content"><h1 className="title">Page not found</h1><a href="/">Return to overview</a></div>;
  if (section === "repositories") return <Repositories />;
  if (section === "metrics") return <Metrics />;
  if (section === "usage") return <Usage />;
  if (section === "integrations") return <Integrations />;
  if (section === "policies") return <Policies />;
  if (section === "members") return <Members />;
  return <Audit />;
}

function Header({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1 className="title">{title}</h1><p className="page-description">{description}</p></div>{action}</div>;
}

function Repositories() {
  return <div className="content"><Header eyebrow="Repository scope" title="Repositories" description="Every repository is isolated by account, workspace, installation, and immutable GitHub repository ID." /><RepositoryConnectionView /></div>;
}

function Metrics() {
  return <div className="content"><Header eyebrow="Sample workspace · illustrative" title="Efficacy & accuracy" description="Outcome measures are separated from activity. Effective LOC shows delivered work, never model accuracy." /><div className="metric-line"><article className="metric hero-metric"><span>PRs reviewed</span><strong>{efficacy.reviewed}</strong><small>Exact Sunday window</small></article><article className="metric"><span>Regressions caught</span><strong>{efficacy.regressions}</strong><small>Introduced vs base</small></article><article className="metric"><span>Verified fixes</span><strong>{efficacy.implemented}</strong><small>Of {efficacy.suggestions} suggested</small></article><article className="metric"><span>Effective LOC</span><strong>{efficacy.effectiveLoc}</strong><small>Delivered code only</small></article></div><section className="metric-explainer"><div><p className="eyebrow">Accuracy</p><h2>Insufficient adjudicated evidence</h2><p>Precision and recall appear only after human labels exist. Acceptance rate is not renamed as accuracy.</p></div><div className="formula"><span>Supported findings</span><strong>—</strong><small>Awaiting human labels</small></div><div className="formula"><span>False-covered rate</span><strong>—</strong><small>Awaiting later outcomes</small></div></section><section className="definition-table"><h2>Metric source of truth</h2><dl><div><dt>Suggested → implemented</dt><dd>Accepted finding linked to a delivered and validated stacked-PR commit.</dd></div><div><dt>Effective LOC</dt><dd>Executable/source lines only; blank, comment, indentation, formatting, generated, vendor, lockfile, and reverted changes excluded.</dd></div><div><dt>Regression caught</dt><dd>A required check passes at base and fails at the pinned PR head under the same environment.</dd></div></dl></section></div>;
}

function Usage() {
  return <div className="content"><Header eyebrow="No key required" title="Usage & budgets" description="See cost controls before connecting a provider. Spending begins only after explicit analysis consent." /><section className="budget-board"><div><p className="eyebrow">Illustrative monthly ceiling</p><strong>₹4,120 <small>of ₹15,000</small></strong><div className="budget-track"><span style={{ width: "27%" }} /></div><p>Model ₹2,980 · Sandbox ₹940 · Storage ₹200</p></div><aside><strong>Pre-flight rule</strong><p>A review does not start when its estimate exceeds the remaining ceiling. No partial result is called a pass.</p></aside></section><section className="empty-band"><div><strong>Connect later without losing your place</strong><p>Provider setup opens only when you start AI analysis. Repository connection and deterministic configuration do not require a model key.</p></div><a href="/integrations">Compare providers →</a></section></div>;
}

function Integrations() {
  return <div className="content"><Header eyebrow="Dependency-specific setup" title="Integrations" description="Connect only the service needed for the next action. No all-or-nothing setup wall." /><div className="integration-grid"><GitHubIntegrationState /><Integration name="Anthropic / OpenAI / Gemini" status="Connect when analyzing" description="Your key is used only for the provider request you authorize." action="Compare model setup" href="/setup/model" /><Integration name="Linear" status="Optional" description="Read linked issue intent from approved workspaces." action="See supported context" href="#linear" /><Integration name="Jira" status="Optional" description="Read linked tickets with the connecting user's permissions." action="See supported context" href="#jira" /></div></div>;
}
function Integration({ name, status, description, action, href }: { name: string; status: string; description: string; action: string; href: string }) { return <article className="integration-card"><div><span className="integration-glyph">{name.slice(0, 2).toUpperCase()}</span><span className="status neutral">{status}</span></div><h2>{name}</h2><p>{description}</p><a href={href}>{action} →</a></article>; }

function Policies() { return <div className="content"><Header eyebrow="Trusted configuration" title="Policies" description="These controls come from an approved ref, never from an untrusted pull request." /><section className="settings-list"><Setting title="Human merge boundary" value="Always enforced" detail="BuildIT has no merge authority." /><Setting title="Autofix delivery" value="Stacked PR only" detail="The source PR branch is never modified." /><Setting title="Convergence bounds" value="3 rounds · 6 proposals" detail="First reached limit stops the loop." /><Setting title="Required-check policy" value="Advisory" detail="Platform failures cannot claim evaluation occurred." /><Setting title="Source retention" value="24 hours" detail="Maximum 7 days; deletion remains auditable." /></section></div>; }
function Setting({ title, value, detail }: { title: string; value: string; detail: string }) { return <article className="setting-row"><div><strong>{title}</strong><p>{detail}</p></div><code>{value}</code><button type="button" disabled>Configure after organization setup</button></article>; }

function Members() { return <div className="content"><Header eyebrow="Organization access" title="Members & roles" description="One person can belong to multiple organizations with a separate role in each." /><section className="empty-state compact-empty"><span className="empty-mark">ID</span><h2>No organization selected</h2><p>Sign in, create or join an organization, then manage owners, admins, developers, and viewers. Switching organizations re-checks membership on the server.</p><a className="button" href="/sign-in">Sign in to continue</a></section></div>; }

function Audit() { return <div className="content"><Header eyebrow="Source-free evidence" title="Audit log" description="Security-relevant actions are append-only and contain identifiers, decisions, and hashes—not repository source." /><section className="audit-preview"><div className="audit-row"><time>10:42:18</time><code>review.created</code><span>Sample review pinned to <code>d9f2e1a</code></span><span className="status neutral">Recorded</span></div><div className="audit-row"><time>10:43:02</time><code>evidence.rejected</code><span>Unknown evidence ID removed before publish</span><span className="status warning">Guardrail</span></div><div className="audit-row"><time>10:47:11</time><code>autofix.stopped</code><span>Round ceiling reached; no branch delivered</span><span className="status danger">Bound</span></div></section><p className="sample-note">Sample events illustrate the format. Live events appear only inside their authorized organization and repository scope.</p></div>; }
