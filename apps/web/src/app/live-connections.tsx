"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ActionLink } from "./action";
import { useSampleTour } from "./workspace-route-boundary";
import { useEffect, useState } from "react";

type Connection = {
  state: "signed_out" | "no_workspace" | "installation_required" | "installation_unavailable" | "no_repositories_selected" | "connected";
  organization: null | { id: string; name: string; slug: string; role: string; region: "eu-west-1"; retentionHours: number };
  installations: Array<{ id: string; installationId: number; accountLogin: string; accountType: "user" | "organization"; status: "active" | "suspended" | "removed"; updatedAt: number }>;
  repositories: Array<{ id: string; installationId: string; githubRepositoryId: number; owner: string; name: string; defaultBranch: string; visibility: "public" | "private" | "internal" | "unknown"; autofixMode: "disabled" | "stacked" | "direct_push"; paused: boolean; indexState: string; updatedAt: number }>;
};
const connectionQuery = makeFunctionReference<"query", Record<string, never>, Connection>("repositoryConnections:current");
const credentialQuery = makeFunctionReference<"query", { organizationId: string }, Array<{ status: string }>>("integrations:listProviderCredentials");
const receiptQuery = makeFunctionReference<"query", Record<string, never>, null | {identity:{login:string;lastAuthenticatedAt?:number};organization:{name:string;role:string;region:"eu-west-1";retentionHours:number};installations:Array<{installationId:number;accountLogin:string;accountType:"user"|"organization";status:string;permissions:{metadata:"read";contents:"read"|"write";pullRequests:"write";issues:"read";checks:"read"|"write"};lastSynchronizedAt:number}>;repositories:Array<{id:string;owner:string;name:string;visibility:string;autofixMode:string}>;credentials:Array<{id:string;provider:string;repositoryId?:string;maskedSuffix:string;lastValidatedAt?:number;lastUsedAt?:number}>;boundaries:{sourceRegion:"eu-west-1";maximumSourceRetentionHours:number;mergeAuthority:false;workflowWrite:false;repositoryAdministration:false}}>("permissionReceipts:current");
const readinessQuery = makeFunctionReference<"query", Record<string, never>, { executionEnabled: boolean }>("runtimeReadiness:current");
type Member = { id: string; userId: string; name: string | null; githubLogin: string | null; role: "viewer" | "developer" | "admin" | "owner"; status: "active" | "invited"; createdAt: number; updatedAt: number };
const membersQuery = makeFunctionReference<"query", { organizationId: string }, Member[]>("memberships:list");
const inviteMember = makeFunctionReference<"mutation", { organizationId: string; githubLogin: string; role: "viewer" | "developer" | "admin"; requestId: string }, string>("memberships:inviteByGitHubLogin");
const changeMemberRole = makeFunctionReference<"mutation", { organizationId: string; membershipId: string; role: "viewer" | "developer" | "admin" | "owner"; requestId: string }, null>("memberships:changeRole");
const removeMember = makeFunctionReference<"mutation", { organizationId: string; membershipId: string; requestId: string }, null>("memberships:remove");
const setReviewPolicy = makeFunctionReference<"mutation", { organizationId: string; repositoryId: string; paused: boolean; autofixMode: "disabled" | "stacked"; requestId: string }, null>("repositoryConnections:setReviewPolicy");

const signedOutConnection: Connection = { state: "signed_out", organization: null, installations: [], repositories: [] };
const connectedDesignFixture: Connection = {
  state: "connected",
  organization: { id: "fixture-organization", name: "Northstar workspace", slug: "northstar", role: "owner", region: "eu-west-1", retentionHours: 24 },
  installations: [{ id: "fixture-installation", installationId: 42, accountLogin: "northstar", accountType: "organization", status: "active", updatedAt: 1 }],
  repositories: [
    { id: "fixture-api", installationId: "fixture-installation", githubRepositoryId: 1, owner: "northstar", name: "api", defaultBranch: "main", visibility: "private", autofixMode: "stacked", paused: false, indexState: "ready", updatedAt: 1 },
    { id: "fixture-web", installationId: "fixture-installation", githubRepositoryId: 2, owner: "northstar", name: "web", defaultBranch: "main", visibility: "public", autofixMode: "disabled", paused: false, indexState: "ready", updatedAt: 1 },
    { id: "fixture-worker", installationId: "fixture-installation", githubRepositoryId: 3, owner: "northstar", name: "worker", defaultBranch: "main", visibility: "private", autofixMode: "stacked", paused: true, indexState: "ready", updatedAt: 1 },
  ],
};
export function useConnection() {
  const [hydrated, setHydrated] = useState(false);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const sampleTour = useSampleTour();
  const connection = useQuery(connectionQuery, hydrated && isAuthenticated && !sampleTour ? {} : "skip");
  useEffect(() => setHydrated(true), []);
  const designFixtureRequested = process.env.NEXT_PUBLIC_BUILDIT_E2E === "1"
    && sampleTour
    && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("fixture") === "connected";
  if (sampleTour) return hydrated && designFixtureRequested ? connectedDesignFixture : signedOutConnection;
  if (!hydrated) return undefined;
  if (!isLoading && !isAuthenticated) return signedOutConnection;
  return connection;
}

export function useCredentialReadiness(connection: Connection | undefined) {
  const role = connection?.organization?.role;
  const canManage = role === "owner" || role === "admin";
  const credentials = useQuery(credentialQuery, canManage && connection?.organization ? { organizationId: connection.organization.id } : "skip");
  return { canManage, checking: Boolean(canManage && connection?.organization && credentials === undefined), ready: credentials?.some(item => item.status === "valid") ?? false };
}

const stateCopy: Record<Connection["state"], { title: string; body: string }> = {
  signed_out: { title: "Sign in to see repository access", body: "Your repository list is private to your BuildIT account and active workspace." },
  no_workspace: { title: "Connect your GitHub installation", body: "Sign-in is complete. Verify the GitHub App installation to create your isolated workspace." },
  installation_required: { title: "Choose repositories in GitHub", body: "BuildIT has no installation for this workspace yet." },
  installation_unavailable: { title: "GitHub access needs attention", body: "The installation was suspended or removed. BuildIT will not use stale access." },
  no_repositories_selected: { title: "No repositories are selected", body: "Update the GitHub App installation and choose at least one repository." },
  connected: { title: "GitHub is connected", body: "Selected repositories are isolated to this workspace and installation." },
};

function ConnectionAction({ connection, returnTo = "/repositories" }: { connection: Connection; returnTo?: string }) {
  if (connection.state === "signed_out") return <ActionLink href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Sign in with GitHub</ActionLink>;
  const installation = connection.installations[0];
  if (installation) {
    const href = installation.accountType === "organization"
      ? `https://github.com/organizations/${encodeURIComponent(installation.accountLogin)}/settings/installations/${installation.installationId}`
      : `https://github.com/settings/installations/${installation.installationId}`;
    return <ActionLink priority="secondary" href={href} external>Manage GitHub access</ActionLink>;
  }
  return <ActionLink href="https://github.com/apps/buildit-agentic-review/installations/new" external>Choose repositories</ActionLink>;
}

type ConnectedRepository = Connection["repositories"][number];

function visibilityLabel(visibility: ConnectedRepository["visibility"]) {
  if (visibility === "public") return "Public repository";
  if (visibility === "private") return "Private repository";
  if (visibility === "internal") return "Internal repository";
  return "Repository";
}

function RepositoryPolicyRow({ repository, canManage, saving, onSave }: {
  repository: ConnectedRepository;
  canManage: boolean;
  saving: boolean;
  onSave: (next: { paused?: boolean; autofixMode?: "disabled" | "stacked" }) => Promise<void>;
}) {
  const fullName = `${repository.owner}/${repository.name}`;
  const stacked = repository.autofixMode !== "disabled";
  return <article className="repository-row" aria-label={`Repository policy for ${fullName}`}>
    <div className="repository-identity">
      <span className="repository-mark" aria-hidden="true">{repository.visibility === "private" ? "PR" : repository.visibility === "public" ? "PU" : "RE"}</span>
      <div>
        <h2>{fullName}</h2>
        <p>{visibilityLabel(repository.visibility)} <span aria-hidden="true">·</span> Default branch <code>{repository.defaultBranch}</code></p>
      </div>
    </div>
    <div className="repository-control-group">
      <label className="repository-policy">
        <span>Autofix delivery</span>
        {canManage ? <select className="repository-policy-select" aria-label={`Autofix delivery for ${fullName}`} value={stacked ? "stacked" : "disabled"} disabled={saving} onChange={event => void onSave({ autofixMode: event.target.value as "disabled" | "stacked" })}>
          <option value="disabled">Suggestions only</option>
          <option value="stacked">Separate fix PR</option>
        </select> : <strong>{stacked ? "Separate fix PR" : "Suggestions only"}</strong>}
        <small>{stacked ? "Fixes open as a separate pull request" : "BuildIT reports changes without writing code"}</small>
      </label>
      <div className="repository-review-state">
        <span className={`status ${repository.paused ? "warning" : "success"}`}>{repository.paused ? "Reviews paused" : "Reviews active"}</span>
        {canManage ? <button className="button secondary" type="button" disabled={saving} aria-label={`${repository.paused ? "Resume" : "Pause"} reviews for ${fullName}`} onClick={() => void onSave({ paused: !repository.paused })}>{saving ? "Saving…" : repository.paused ? "Resume" : "Pause"}</button> : null}
      </div>
      <div className="repository-actions">
        <ActionLink priority="tertiary" size="compact" external href={`https://github.com/${fullName}`} label={`Open ${fullName} on GitHub`}>Open in GitHub</ActionLink>
      </div>
    </div>
  </article>;
}

export function RepositoryConnectionView() {
  const connection = useConnection();
  const updatePolicy = useMutation(setReviewPolicy), [policyMessage, setPolicyMessage] = useState(""), [savingRepositoryId, setSavingRepositoryId] = useState<string | null>(null);
  if (!connection) return <section className="live-state" aria-live="polite"><span className="state-pulse" /><div><strong>Loading repository access…</strong><p>Checking your active workspace on the server.</p></div></section>;
  const copy = stateCopy[connection.state];
  if (connection.state !== "connected") return <section className="split-layout"><article className="empty-state live-empty"><span className="empty-mark">GH</span><h2>{copy.title}</h2><p>{copy.body}</p><div className="button-row"><ConnectionAction connection={connection} /><ActionLink priority="tertiary" href="/data-handling">How isolation works</ActionLink></div></article><aside className="explain-panel"><p className="eyebrow">Current state</p><strong className="connection-state-name">{connection.state.replaceAll("_", " ")}</strong><p>Repository content is never inferred from public visibility. BuildIT requires the selected GitHub installation for both public and private repositories.</p></aside></section>;
  const installation = connection.installations.find(item => item.status === "active")!;
  const organization = connection.organization!;
  const canManage = organization.role === "owner" || organization.role === "admin";
  const save = async (repository: ConnectedRepository, next: { paused?: boolean; autofixMode?: "disabled" | "stacked" }) => {
    setPolicyMessage("");
    setSavingRepositoryId(repository.id);
    try {
      await updatePolicy({ organizationId: organization.id, repositoryId: repository.id, paused: next.paused ?? repository.paused, autofixMode: next.autofixMode ?? (repository.autofixMode === "disabled" ? "disabled" : "stacked"), requestId: crypto.randomUUID() });
      setPolicyMessage(`Policy saved for ${repository.owner}/${repository.name}. New reviews will use it.`);
    } catch {
      setPolicyMessage("The policy change was refused. Refresh your GitHub identity and active workspace, then try again.");
    } finally {
      setSavingRepositoryId(null);
    }
  };
  return <>
    <section className="connection-overview" aria-label="GitHub connection" aria-live="polite">
      <div className="connection-summary"><span className="status success">Connected</span><h2>{connection.repositories.length} {connection.repositories.length === 1 ? "repository" : "repositories"} connected</h2><p>GitHub account <strong>{installation.accountLogin}</strong></p></div>
      <div className="connection-facts"><span><small>Workspace</small><strong>{organization.name}</strong></span><span><small>Installation</small><strong>#{installation.installationId}</strong></span><span><small>Encrypted source</small><strong>Ireland</strong></span><span><small>Isolated tests</small><strong>Paris</strong></span></div>
      <ConnectionAction connection={connection} />
    </section>
    {policyMessage ? <p className="form-result" role="status">{policyMessage}</p> : null}
    <section className="repository-list" aria-label="Connected repositories">{connection.repositories.map(repository => <RepositoryPolicyRow key={repository.id} repository={repository} canManage={canManage} saving={savingRepositoryId === repository.id} onSave={next => save(repository, next)} />)}</section>
  </>;
}

export function GitHubIntegrationState() {
  const connection = useConnection();
  const loading = !connection;
  const connected = connection?.state === "connected";
  return <article className="integration-card" data-connected={connected || undefined}><div><span className="integration-glyph">GH</span><span className={`status ${connected ? "success" : "neutral"}`}>{loading ? "Checking…" : connected ? `${connection.repositories.length} connected` : "Setup needed"}</span></div><h2>GitHub</h2><p>{loading ? "Checking your active workspace." : connected ? `${connection.organization?.name} can access only the selected repositories shown in BuildIT.` : stateCopy[connection.state].body}</p>{connection ? <ConnectionAction connection={connection} returnTo="/integrations" /> : null}</article>;
}

export function ConnectionBanner() {
  const connection = useConnection();
  const readiness = useQuery(readinessQuery, connection && connection.state !== "signed_out" ? {} : "skip");
  if (!connection) return <div className="preview-banner" role="status"><span className="preview-label">Checking</span><span>Confirming your private workspace before showing repository data.</span></div>;
  const connected = connection?.state === "connected";
  const execution = readiness?.executionEnabled;
  const message = !connected
    ? "Sample evidence is clearly marked. Connect GitHub to replace setup examples with your isolated workspace."
    : execution === undefined
      ? `${connection.repositories.length} GitHub repositories connected. Checking whether this workspace can start reviews.`
      : execution
        ? `${connection.repositories.length} GitHub repositories connected. Reviews can start only after exact-scope consent.`
        : `${connection.repositories.length} GitHub repositories connected. Repository execution and AI review remain disabled until their safety gates pass.`;
  return <div className="preview-banner" role="status"><span className="preview-label">{connected ? execution === undefined ? "Checking" : "Connected" : "Preview"}</span><span>{message}</span><a href={connected ? "/repositories" : "/data-handling"}>{connected ? "View access" : "Trust boundary"}</a></div>;
}

export function SetupProgress() {
  const connection = useConnection();
  if (!connection) return <span className="setup-state" aria-live="polite"><span className="setup-dot" />Checking access</span>;
  const connected = connection?.state === "connected";
  return <a className="setup-state" href={connected ? "/setup/repository" : "/setup/install"}><span className={`setup-dot${connected ? " ready" : ""}`} />{connected ? "GitHub connected" : "Setup 1 of 4"}</a>;
}

export function OverviewReadiness() {
  const connection = useConnection();
  const readiness = useQuery(readinessQuery, connection && connection.state !== "signed_out" ? {} : "skip");
  const signedIn = Boolean(connection && connection.state !== "signed_out");
  const connected = connection?.state === "connected";
  const execution = readiness?.executionEnabled;
  const title = !connected
    ? "Explore freely. Connect only when an action needs it."
    : execution === undefined
      ? "Repository access is ready. Checking review readiness."
      : execution
        ? "Repository access is ready. Review one exact pull request."
        : "Repository access is ready. Review execution is safety-blocked.";
  const detail = !connected
    ? "Browsing this tour needs no key. GitHub is requested when you connect a repository; a model key is requested only when you start AI analysis."
    : execution === undefined
      ? `${connection.repositories.length} selected repositories are visible only inside ${connection.organization?.name}. BuildIT is checking its execution boundary.`
      : execution
        ? `${connection.repositories.length} selected repositories are visible only inside ${connection.organization?.name}. Preview an exact pull request before BuildIT reads code or runs checks.`
        : `${connection.repositories.length} selected repositories are visible only inside ${connection.organization?.name}. BuildIT will not execute code until sandbox and provider safety checks pass.`;
  const reviewStep = !connected ? "Add BYOK only when analysis starts" : execution === undefined ? "Checking execution readiness" : execution ? "Preview one exact pull request" : "Blocked until execution safety is ready";
  return <section className="readiness" aria-labelledby="readiness-title"><div><p className="eyebrow">Your path to a live review</p><h2 id="readiness-title">{title}</h2><p>{detail}</p></div><ol><li data-state={signedIn ? "ready" : undefined}><span>1</span><div><strong>Sign in</strong><small>{signedIn ? "GitHub identity verified" : "Save your workspaces and preferences"}</small></div></li><li data-state={connected ? "ready" : undefined}><span>2</span><div><strong>Select repositories</strong><small>{connected ? `${connection.repositories.length} connected` : "Choose public or private access in GitHub"}</small></div></li><li data-state={execution ? "ready" : undefined}><span>3</span><div><strong>Run a review</strong><small>{reviewStep}</small></div></li></ol></section>;
}

export function SetupAccessSummary({ stepIndex }: { stepIndex: number }) {
  const connection = useConnection();
  const readiness = useQuery(readinessQuery, connection && connection.state !== "signed_out" ? {} : "skip");
  const credential = useCredentialReadiness(connection);
  const signedIn = Boolean(connection && connection.state !== "signed_out");
  const connected = connection?.state === "connected";
  const providerDetail = credential.ready ? "Encrypted and valid" : signedIn && !credential.canManage ? "Managed by Admin" : stepIndex > 1 ? "Optional" : "Not requested";
  return <><p className="eyebrow">Access at this step</p><AccessRow label="GitHub identity" active={signedIn} detail={signedIn ? "Verified" : "Required"} /><AccessRow label="Selected repositories" active={connected} detail={connected ? `${connection.repositories.length} connected` : "Not connected"} /><AccessRow label="Provider API key" active={credential.ready} detail={providerDetail} /><AccessRow label="Repository execution" active={readiness?.executionEnabled ?? false} detail={readiness?.executionEnabled ? "Release gate passed" : "Safety blocked"} /><p className="aside-note">These states come from your active workspace. A check mark means the connection is verified now.</p></>;
}

export function PermissionReceipt() {
  const connection = useConnection(), receipt = useQuery(receiptQuery, connection && connection.state !== "signed_out" ? {} : "skip");
  if (!connection || connection.state === "signed_out") return <section className="setup-card"><p className="eyebrow">Permission receipt</p><h2>Nothing is connected</h2><p>GitHub sign-in identifies you. It does not grant repository or model access.</p></section>;
  if (!receipt) return <section className="setup-card" aria-live="polite"><p>Loading verified permission receipt…</p></section>;
  const installation=receipt.installations[0],repositoryNames=receipt.repositories.map(item=>`${item.owner}/${item.name}`),repositoryById=new Map(receipt.repositories.map(item=>[item.id,`${item.owner}/${item.name}`]));
  const manageHref=installation?(installation.accountType==="organization"?`https://github.com/organizations/${encodeURIComponent(installation.accountLogin)}/settings/installations/${installation.installationId}`:`https://github.com/settings/installations/${installation.installationId}`):"https://github.com/apps/buildit-agentic-review/installations/new";
  return <section className="setup-card permission-receipt"><div className="optional-heading"><div><p className="eyebrow">Verified permission receipt</p><h2>{receipt.identity.login} → {receipt.organization.name}</h2></div><span className="status success">Server checked</span></div><div className="trust-terms"><div><strong>Repositories visible</strong><span>{repositoryNames.length?repositoryNames.join(", "):"None selected"}</span></div><div><strong>GitHub can write</strong><span>{installation?"One BuildIT Check, one PR summary, and a consented stacked PR":"Nothing—no active installation"}</span></div><div><strong>GitHub cannot write</strong><span>Merge actions, workflows, repository settings, or unselected repositories</span></div><div><strong>Source handling</strong><span>Encrypted artifacts stay in Ireland ({receipt.boundaries.sourceRegion}); isolated checks run in Paris; source expires within {receipt.boundaries.maximumSourceRetentionHours} hours</span></div></div>{installation?<div className="permission-list"><div><code>Contents · {installation.permissions.contents}</code><span>Read during review; write capability is used only for consented stacked-PR delivery.</span></div><div><code>Pull requests · {installation.permissions.pullRequests}</code><span>Read context and maintain one BuildIT report comment.</span></div><div><code>Checks · {installation.permissions.checks}</code><span>Publish the result on the exact commit.</span></div><div><code>Issues · {installation.permissions.issues}</code><span>Read linked intent. No issue write access.</span></div></div>:null}<section className="permission-provider-access" aria-labelledby="permission-provider-access-title"><div className="permission-provider-heading"><div><p className="eyebrow">Encrypted credentials</p><h3 id="permission-provider-access-title">Model-provider access</h3></div>{receipt.credentials.length?<span className="status success">{receipt.credentials.length} active</span>:null}</div>{receipt.credentials.length?<ul className="permission-provider-list" aria-label="Active model-provider access">{receipt.credentials.map(item=><li key={item.id}><span className="provider-mark" aria-hidden="true">{item.provider.slice(0,2).toUpperCase()}</span><span className="permission-provider-identity"><strong>{modelProviderName(item.provider)}</strong><code aria-label={`Key ending in ${item.maskedSuffix}`}>•••• {item.maskedSuffix}</code></span><dl className="permission-provider-metadata"><div><dt>Scope</dt><dd>{item.repositoryId?repositoryById.get(item.repositoryId)??"Removed repository":"All selected repositories"}</dd></div><div><dt>Activity</dt><dd>{item.lastUsedAt?`Used ${new Date(item.lastUsedAt).toLocaleDateString()}`:"Not used yet"}</dd></div></dl></li>)}</ul>:<p className="muted-copy">No model key is visible to your role, or none is connected.</p>}</section><div className="button-row"><ActionLink priority="secondary" href={manageHref} external>{installation?"Change or revoke GitHub access":"Choose repositories"}</ActionLink><ActionLink priority="tertiary" href="/setup/model">Rotate or revoke model key</ActionLink></div></section>;
}

function modelProviderName(provider: string) {
  if (provider === "gemini") return "Google Gemini";
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  return provider;
}

function AccessRow({ label, active, detail }: { label: string; active: boolean; detail: string }) { return <div className="access-row" data-active={active || undefined}><span>{active ? "✓" : "—"}</span><strong>{label}</strong><small>{detail}</small></div>; }

export function SetupHealthState() {
  const connection = useConnection();
  const credential = useCredentialReadiness(connection);
  const readiness = useQuery(readinessQuery, connection && connection.state !== "signed_out" ? {} : "skip");
  const connected = connection?.state === "connected";
  const executionReady = readiness?.executionEnabled ?? false;
  return <section className="setup-card"><h2>Readiness checks</h2><div className="health-list"><Health ready title="GitHub App registration" detail="Verified App identity and least-privilege permissions" result="ready" /><Health ready={connected} title="Repository installation" detail={connected ? `${connection.repositories.length} selected repositories in ${connection.organization?.name}` : connection ? stateCopy[connection.state].body : "Checking active workspace"} result={connected ? "ready" : "required"} /><Health ready={executionReady} title="Sandbox boundary" detail={executionReady ? "Broker, runner, and release probes are enabled" : "Execution remains disabled until adversarial tests pass"} result={executionReady ? "ready" : "blocked"} /><Health ready={credential.ready} title="Model provider" detail={credential.ready ? "A valid encrypted organization credential is available" : credential.canManage ? "Optional until AI analysis" : "Managed by an organization Admin or Owner"} result={credential.ready ? "ready" : "optional"} /></div></section>;
}
function Health({ ready, title, detail, result }: { ready: boolean; title: string; detail: string; result: string }) { return <div><span className={`health-dot${ready ? " ready" : ""}`} /><span><strong>{title}</strong><small>{detail}</small></span><code>{result}</code></div>; }

export function MembersWorkspaceState() {
  const connection = useConnection();
  const organizationId = connection?.organization?.id;
  const members = useQuery(membersQuery, organizationId ? { organizationId } : "skip");
  const invite = useMutation(inviteMember), changeRole = useMutation(changeMemberRole), remove = useMutation(removeMember);
  const [githubLogin, setGithubLogin] = useState(""), [inviteRole, setInviteRole] = useState<"viewer" | "developer" | "admin">("developer"), [message, setMessage] = useState(""), [working, setWorking] = useState(false);
  if (!connection) return <section className="live-state"><span className="state-pulse" /><div><strong>Loading workspace access…</strong></div></section>;
  if (!connection.organization) return <section className="empty-state compact-empty"><span className="empty-mark">ID</span><h2>{connection.state === "signed_out" ? "Sign in to manage members" : "No workspace selected"}</h2><p>Membership and roles are scoped to one workspace at a time.</p><ConnectionAction connection={connection} returnTo="/members" /></section>;
  const canManage = connection.organization.role === "owner" || connection.organization.role === "admin", requestId = () => crypto.randomUUID();
  async function submitInvite(event: React.FormEvent) { event.preventDefault(); if (!organizationId || !canManage) return; setWorking(true); setMessage(""); try { await invite({ organizationId, githubLogin, role: inviteRole, requestId: requestId() }); setGithubLogin(""); setMessage("Invitation created. The person can accept it after signing in with that GitHub account."); } catch (error) { const code = error instanceof Error ? error.message : ""; setMessage(code.includes("member_must_sign_in_first") ? "That GitHub user must sign in to BuildIT once before you can invite them." : "The invitation was not created. Your access may have changed; refresh and try again."); } finally { setWorking(false); } }
  async function update(member: Member, action: "remove" | Member["role"]) { if (!organizationId || !canManage) return; setWorking(true); setMessage(""); try { if (action === "remove") await remove({ organizationId, membershipId: member.id, requestId: requestId() }); else await changeRole({ organizationId, membershipId: member.id, role: action, requestId: requestId() }); setMessage(action === "remove" ? "Member access removed." : "Member role updated."); } catch { setMessage("The member change was refused. BuildIT preserves the last owner and rechecks your role before every change."); } finally { setWorking(false); } }
  return <><section className="connection-hero"><div><span className="status success">Current workspace</span><h2>{connection.organization.name}</h2><p>Your role: {connection.organization.role}. Roles and invitations apply only to this workspace.</p></div><a className="button secondary" href="/account">Manage account</a></section>{canManage?<form className="review-start-form" onSubmit={submitInvite}><label className="field"><span>GitHub username</span><input value={githubLogin} onChange={event=>setGithubLogin(event.target.value)} placeholder="octocat" autoComplete="off" required /></label><label className="field"><span>Starting role</span><select value={inviteRole} onChange={event=>setInviteRole(event.target.value as typeof inviteRole)}><option value="viewer">Viewer</option><option value="developer">Developer</option><option value="admin">Admin</option></select></label><button className="button" disabled={working||!githubLogin.trim()}>{working?"Saving…":"Invite member"}</button></form>:null}{message?<p className="form-result" role="status">{message}</p>:null}<section className="settings-list" aria-label="Workspace members">{members?.map(member=><article className="setting-row" key={member.id}><div><strong>{member.name||member.githubLogin||"GitHub user"}</strong><p>{member.githubLogin?`@${member.githubLogin} · `:""}{member.status}</p></div><code>{member.role}</code>{canManage&&member.role!=="owner"?<div className="button-row"><select aria-label={`Role for ${member.githubLogin||member.userId}`} value={member.role} disabled={working||member.status!=="active"} onChange={event=>void update(member,event.target.value as Member["role"])}><option value="viewer">Viewer</option><option value="developer">Developer</option><option value="admin">Admin</option></select><button className="button danger" type="button" disabled={working} onClick={()=>void update(member,"remove")}>Remove</button></div>:<span className="muted-copy">Protected owner</span>}</article>)??<article className="setting-row"><div><strong>Loading members…</strong></div></article>}</section></>;
}
