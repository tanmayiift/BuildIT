import { TrackerOAuthCards } from "../tracker-oauth";
import { GitHubIntegrationState, MembersWorkspaceState, ModelIntegrationState, RepositoryConnectionView, TrackerConnections } from "../live-connections";
import { WorkspaceMetrics, WorkspaceUsage } from "../live-metrics-usage";
import { WorkspaceAudit } from "../live-audit";
import { NotificationPreferences } from "../notification-preferences";
import { WorkspacePolicyState } from "../live-policies";
import { notFound } from "next/navigation";
import { isWorkspaceSection } from "../workspace-sections";



export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  // Runs before the streamed shell is flushed, which is the only place a 404 status can still be
  // set: the layout's <Suspense> means the page component itself renders after the headers.
  if (!isWorkspaceSection(section)) notFound();
  return { title: `${section.charAt(0).toUpperCase()}${section.slice(1)} · BuildIT` };
}

export default async function Section({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!isWorkspaceSection(section)) notFound();
  if (section === "repositories") return <Repositories />;
  if (section === "metrics") return <Metrics />;
  if (section === "usage") return <Usage />;
  if (section === "integrations") return <Integrations />;
  if (section === "policies") return <Policies />;
  if (section === "members") return <Members />;
  if (section === "notifications") return <Notifications />;
  if (section === "audit") return <Audit />;
  // "history" is the ninth section and has no branch here - the static /history route shadows this
  // dynamic segment, so it renders correctly and the gap is invisible. It was `return <Audit />`,
  // which meant any section without a branch silently served the audit log under that section's
  // own title. The next section added to workspaceSections would have shipped mislabelled rather
  // than obviously missing, which is the harder bug to notice.
  notFound();
}

function Header({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1 className="title">{title}</h1><p className="page-description">{description}</p></div>{action}</div>;
}

function Repositories() {
  return <div className="content"><Header eyebrow="Repository scope" title="Repositories" description="Every repository is isolated by account, workspace, installation, and immutable GitHub repository ID." /><RepositoryConnectionView /></div>;
}

function Metrics() {
  return <div className="content"><Header eyebrow="Live organization outcomes" title="Efficacy & accuracy" description="Operational outcomes come from append-only events. Human-labelled accuracy is reported separately." /><WorkspaceMetrics/><section className="definition-table"><h2>Metric source of truth</h2><dl><div><dt>Verified Autofix</dt><dd>A delivered stacked-PR candidate whose full required checks passed.</dd></div><div><dt>Effective LOC</dt><dd>Reserved for delivered executable lines; never used as model accuracy.</dd></div><div><dt>Regression caught</dt><dd>A required check passes at base and fails at the pinned PR head under the same environment.</dd></div></dl></section></div>;
}

function Usage() {
  return <div className="content"><Header eyebrow="Append-only usage ledger" title="Usage & budgets" description="See tenant-scoped model, sandbox, storage, and recorded cost without exposing source or keys." /><WorkspaceUsage/></div>;
}

function Integrations() {
  return <div className="content"><Header eyebrow="Dependency-specific setup" title="Integrations" description="Connect only the service needed for the next action. No all-or-nothing setup wall." /><div className="integration-grid"><GitHubIntegrationState /><ModelIntegrationState /><TrackerOAuthCards /></div><TrackerConnections /></div>;
}

// This page used to show six prose rows, one of which had carried a disabled button reading
// "Configure after organization setup" - a control that was never going to appear. Deleting it was
// right; leaving six sentences that describe a workspace without ever reading it was not. "Source
// retention: 24 hours" was printed to every reader whether or not that was their retention window.
//
// The rows that are workspace state now come from the workspace and say how many repositories they
// currently apply to, each pointing at the page where the choice is made. The rows below them are
// product invariants with nothing to set, and are stated flatly for exactly that reason.
function Policies() {
  return <div className="content">
    <Header eyebrow="Trusted configuration" title="Policies"
      description="What this workspace is set to, and what no setting can relax." />
    <h2 className="settings-heading">This workspace</h2>
    <WorkspacePolicyState />
    <h2 className="settings-heading">Never relaxed, by any setting</h2>
    <section className="settings-list">
      <Setting title="Human merge boundary" value="Always enforced" detail="BuildIT has no merge authority, including over its own autofix and changelog pull requests." />
      <Setting title="Convergence bounds" value="3 rounds · 6 proposals" detail="The first limit reached stops the loop, so a review cannot run indefinitely against your key." />
      <Setting title="Required-check policy" value="Advisory" detail="A platform failure is reported as a platform failure. It can never be presented as a check that evaluated your code." />
    </section>
  </div>;
}
function Setting({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <article className="setting-row"><div><strong>{title}</strong><p>{detail}</p></div><div className="setting-state"><code>{value}</code></div></article>;
}

function Members() { return <div className="content"><Header eyebrow="Organization access" title="Members & roles" description="One person can belong to multiple organizations with a separate role in each." /><MembersWorkspaceState /></div>; }
function Notifications() { return <div className="content"><Header eyebrow="Source-free communication" title="Notifications" description="See where review results appear today and who may receive future email. Customer messages never contain source, diffs, logs, findings, or secrets."/><NotificationPreferences/></div>; }

function Audit() { return <div className="content"><Header eyebrow="Source-free evidence" title="Audit log" description="Security-relevant actions are append-only and contain identifiers, decisions, and hashes—not repository source." /><WorkspaceAudit/></div>; }
