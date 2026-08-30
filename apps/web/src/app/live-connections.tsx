"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ActionLink } from "./action";
import { useSampleTour } from "./workspace-route-boundary";
import { useEffect, useState } from "react";

type Connection = {
  state: "signed_out" | "no_workspace" | "installation_required" | "installation_unavailable" | "no_repositories_selected" | "connected";
  organization: null | { id: string; name: string; slug: string; role: string; region: "eu-west-1"; retentionHours: number };
  installations: Array<{ id: string; installationId: number; accountLogin: string; accountType: "user" | "organization"; status: "active" | "suspended" | "removed"; updatedAt: number }>;
  repositories: Array<{ id: string; installationId: string; githubRepositoryId: number; owner: string; name: string; defaultBranch: string; visibility: "public" | "private" | "internal" | "unknown"; autofixMode: "disabled" | "stacked" | "direct_push"; indexState: string; updatedAt: number }>;
};
const connectionQuery = makeFunctionReference<"query", Record<string, never>, Connection>("repositoryConnections:current");
const credentialQuery = makeFunctionReference<"query", { organizationId: string }, Array<{ status: string }>>("integrations:listProviderCredentials");
const receiptQuery = makeFunctionReference<"query", Record<string, never>, null | {identity:{login:string;lastAuthenticatedAt?:number};organization:{name:string;role:string;region:"eu-west-1";retentionHours:number};installations:Array<{installationId:number;accountLogin:string;accountType:"user"|"organization";status:string;permissions:{metadata:"read";contents:"read"|"write";pullRequests:"write";issues:"read";checks:"read"|"write"};lastSynchronizedAt:number}>;repositories:Array<{id:string;owner:string;name:string;visibility:string;autofixMode:string}>;credentials:Array<{id:string;provider:string;repositoryId?:string;maskedSuffix:string;lastValidatedAt?:number;lastUsedAt?:number}>;boundaries:{sourceRegion:"eu-west-1";maximumSourceRetentionHours:number;mergeAuthority:false;workflowWrite:false;repositoryAdministration:false}}>("permissionReceipts:current");

const signedOutConnection: Connection = { state: "signed_out", organization: null, installations: [], repositories: [] };
function useConnection() {
  const [hydrated, setHydrated] = useState(false);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const sampleTour = useSampleTour();
  const connection = useQuery(connectionQuery, hydrated && isAuthenticated && !sampleTour ? {} : "skip");
  useEffect(() => setHydrated(true), []);
  if (sampleTour) return signedOutConnection;
  if (!hydrated) return undefined;
  if (!isLoading && !isAuthenticated) return signedOutConnection;
  return connection;
}

function useCredentialReadiness(connection: Connection | undefined) {
  const role = connection?.organization?.role;
  const canManage = role === "owner" || role === "admin";
  const credentials = useQuery(credentialQuery, canManage && connection?.organization ? { organizationId: connection.organization.id } : "skip");
  return { canManage, ready: credentials?.some(item => item.status === "valid") ?? false };
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
    return <ActionLink priority="secondary" href={href} external>Manage access</ActionLink>;
  }
  return <ActionLink href="https://github.com/apps/buildit-agentic-review/installations/new" external>Choose repositories</ActionLink>;
}

export function RepositoryConnectionView() {
  const connection = useConnection();
  if (!connection) return <section className="live-state" aria-live="polite"><span className="state-pulse" /><div><strong>Loading repository access…</strong><p>Checking your active workspace on the server.</p></div></section>;
  const copy = stateCopy[connection.state];
  if (connection.state !== "connected") return <section className="split-layout"><article className="empty-state live-empty"><span className="empty-mark">GH</span><h2>{copy.title}</h2><p>{copy.body}</p><div className="button-row"><ConnectionAction connection={connection} /><ActionLink priority="tertiary" href="/data-handling">How isolation works</ActionLink></div></article><aside className="explain-panel"><p className="eyebrow">Current state</p><strong className="connection-state-name">{connection.state.replaceAll("_", " ")}</strong><p>Repository content is never inferred from public visibility. BuildIT requires the selected GitHub installation for both public and private repositories.</p></aside></section>;
  const installation = connection.installations.find(item => item.status === "active")!;
  return <>
    <section className="connection-hero" aria-live="polite"><div><span className="status success">Connected</span><h2>{copy.title}</h2><p>{connection.organization?.name} · GitHub account {installation.accountLogin}</p></div><ConnectionAction connection={connection} /></section>
    <section className="context-strip"><span><small>Workspace</small><strong>{connection.organization?.name}</strong></span><span><small>Installation</small><strong>#{installation.installationId}</strong></span><span><small>Repository access</small><strong>{connection.repositories.length} selected</strong></span><span><small>Data region</small><strong>Ireland</strong></span></section>
    <section className="repository-list" aria-label="Connected repositories">{connection.repositories.map(repository => <article className="repository-row" key={repository.id}><span className="repository-mark">{repository.visibility === "private" ? "PR" : repository.visibility === "public" ? "PU" : "RE"}</span><div><h2>{repository.owner}/{repository.name}</h2><p>{repository.visibility} repository · default branch <code>{repository.defaultBranch}</code></p></div><div className="repository-policy"><span>Autofix</span><strong>{repository.autofixMode === "stacked" ? "Stacked PR" : repository.autofixMode.replaceAll("_", " ")}</strong></div><div className="repository-policy"><span>Index</span><strong>{repository.indexState.replaceAll("_", " ")}</strong></div><ActionLink priority="secondary" size="compact" external href={`https://github.com/${repository.owner}/${repository.name}`} label={`View ${repository.owner}/${repository.name} on GitHub`}>View on GitHub</ActionLink></article>)}</section>
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
  const connected = connection?.state === "connected";
  return <div className="preview-banner" role="status"><span className="preview-label">{connected ? "Connected" : "Preview"}</span><span>{connected ? `${connection.repositories.length} GitHub repositories connected. Repository execution and AI review remain disabled until their safety gates pass.` : "Sample evidence is clearly marked. Connect GitHub to replace setup examples with your isolated workspace."}</span><a href={connected ? "/repositories" : "/data-handling"}>{connected ? "View access" : "Trust boundary"}</a></div>;
}

export function SetupProgress() {
  const connection = useConnection();
  const connected = connection?.state === "connected";
  return <a className="setup-state" href={connected ? "/setup/repository" : "/setup/install"}><span className={`setup-dot${connected ? " ready" : ""}`} />{connected ? "GitHub connected" : "Setup 1 of 4"}</a>;
}

export function OverviewReadiness() {
  const connection = useConnection();
  const signedIn = Boolean(connection && connection.state !== "signed_out");
  const connected = connection?.state === "connected";
  return <section className="readiness" aria-labelledby="readiness-title"><div><p className="eyebrow">Your path to a live review</p><h2 id="readiness-title">{connected ? "Repository access is ready. Execution remains gated." : "Explore freely. Connect only when an action needs it."}</h2><p>{connected ? `${connection.repositories.length} selected repositories are visible only inside ${connection.organization?.name}. BuildIT will not execute code until sandbox and provider safety checks pass.` : "Browsing this tour needs no key. GitHub is requested when you connect a repository; a model key is requested only when you start AI analysis."}</p></div><ol><li data-state={signedIn ? "ready" : undefined}><span>1</span><div><strong>Sign in</strong><small>{signedIn ? "GitHub identity verified" : "Save your workspaces and preferences"}</small></div></li><li data-state={connected ? "ready" : undefined}><span>2</span><div><strong>Select repositories</strong><small>{connected ? `${connection.repositories.length} connected` : "Choose public or private access in GitHub"}</small></div></li><li><span>3</span><div><strong>Run a review</strong><small>{connected ? "Blocked until execution safety is ready" : "Add BYOK only when analysis starts"}</small></div></li></ol></section>;
}

export function SetupAccessSummary({ stepIndex }: { stepIndex: number }) {
  const connection = useConnection();
  const credential = useCredentialReadiness(connection);
  const signedIn = Boolean(connection && connection.state !== "signed_out");
  const connected = connection?.state === "connected";
  const providerDetail = credential.ready ? "Encrypted and valid" : signedIn && !credential.canManage ? "Managed by Admin" : stepIndex > 1 ? "Optional" : "Not requested";
  return <><p className="eyebrow">Access at this step</p><AccessRow label="GitHub identity" active={signedIn} detail={signedIn ? "Verified" : "Required"} /><AccessRow label="Selected repositories" active={connected} detail={connected ? `${connection.repositories.length} connected` : "Not connected"} /><AccessRow label="Provider API key" active={credential.ready} detail={providerDetail} /><AccessRow label="Repository execution" active={false} detail="Safety blocked" /><p className="aside-note">These states come from your active workspace. A check mark means the connection is verified now.</p></>;
}

export function PermissionReceipt() {
  const connection = useConnection(), receipt = useQuery(receiptQuery, connection && connection.state !== "signed_out" ? {} : "skip");
  if (!connection || connection.state === "signed_out") return <section className="setup-card"><p className="eyebrow">Permission receipt</p><h2>Nothing is connected</h2><p>GitHub sign-in identifies you. It does not grant repository or model access.</p></section>;
  if (!receipt) return <section className="setup-card" aria-live="polite"><p>Loading verified permission receipt…</p></section>;
  const installation=receipt.installations[0],repositoryNames=receipt.repositories.map(item=>`${item.owner}/${item.name}`),repositoryById=new Map(receipt.repositories.map(item=>[item.id,`${item.owner}/${item.name}`]));
  const manageHref=installation?(installation.accountType==="organization"?`https://github.com/organizations/${encodeURIComponent(installation.accountLogin)}/settings/installations/${installation.installationId}`:`https://github.com/settings/installations/${installation.installationId}`):"https://github.com/apps/buildit-agentic-review/installations/new";
  return <section className="setup-card permission-receipt"><div className="optional-heading"><div><p className="eyebrow">Verified permission receipt</p><h2>{receipt.identity.login} → {receipt.organization.name}</h2></div><span className="status success">Server checked</span></div><div className="trust-terms"><div><strong>Repositories visible</strong><span>{repositoryNames.length?repositoryNames.join(", "):"None selected"}</span></div><div><strong>GitHub can write</strong><span>{installation?"One BuildIT Check, one PR summary, and a consented stacked PR":"Nothing—no active installation"}</span></div><div><strong>GitHub cannot write</strong><span>Merge actions, workflows, repository settings, or unselected repositories</span></div><div><strong>Source handling</strong><span>Ireland ({receipt.boundaries.sourceRegion}); encrypted; expires within {receipt.boundaries.maximumSourceRetentionHours} hours</span></div></div>{installation?<div className="permission-list"><div><code>Contents · {installation.permissions.contents}</code><span>Read during review; write capability is used only for consented stacked-PR delivery.</span></div><div><code>Pull requests · {installation.permissions.pullRequests}</code><span>Read context and maintain one BuildIT report comment.</span></div><div><code>Checks · {installation.permissions.checks}</code><span>Publish the result on the exact commit.</span></div><div><code>Issues · {installation.permissions.issues}</code><span>Read linked intent. No issue write access.</span></div></div>:null}<div className="saved-credentials"><h3>Model-provider access</h3>{receipt.credentials.length?receipt.credentials.map(item=><div key={item.id}><span className="provider-mark">{item.provider.slice(0,2).toUpperCase()}</span><span><strong>{item.provider} · •••• {item.maskedSuffix}</strong><small>{item.repositoryId?repositoryById.get(item.repositoryId)??"Removed repository":"All selected repositories"} · last used {item.lastUsedAt?new Date(item.lastUsedAt).toLocaleDateString():"never"}</small></span></div>):<p>No model key is visible to your role, or none is connected.</p>}</div><div className="button-row"><ActionLink priority="secondary" href={manageHref} external>{installation?"Change or revoke GitHub access":"Choose repositories"}</ActionLink><ActionLink priority="tertiary" href="/setup/model">Rotate or revoke model key</ActionLink></div></section>;
}

function AccessRow({ label, active, detail }: { label: string; active: boolean; detail: string }) { return <div className="access-row" data-active={active || undefined}><span>{active ? "✓" : "—"}</span><strong>{label}</strong><small>{detail}</small></div>; }

export function SetupHealthState() {
  const connection = useConnection();
  const credential = useCredentialReadiness(connection);
  const connected = connection?.state === "connected";
  return <section className="setup-card"><h2>Readiness checks</h2><div className="health-list"><Health ready title="GitHub App registration" detail="Verified App identity and least-privilege permissions" result="ready" /><Health ready={connected} title="Repository installation" detail={connected ? `${connection.repositories.length} selected repositories in ${connection.organization?.name}` : connection ? stateCopy[connection.state].body : "Checking active workspace"} result={connected ? "ready" : "required"} /><Health ready={false} title="Sandbox boundary" detail="Execution remains disabled until adversarial tests pass" result="blocked" /><Health ready={credential.ready} title="Model provider" detail={credential.ready ? "A valid encrypted organization credential is available" : credential.canManage ? "Optional until AI analysis" : "Managed by an organization Admin or Owner"} result={credential.ready ? "ready" : "optional"} /></div></section>;
}
function Health({ ready, title, detail, result }: { ready: boolean; title: string; detail: string; result: string }) { return <div><span className={`health-dot${ready ? " ready" : ""}`} /><span><strong>{title}</strong><small>{detail}</small></span><code>{result}</code></div>; }

export function MembersWorkspaceState() {
  const connection = useConnection();
  if (!connection) return <section className="live-state"><span className="state-pulse" /><div><strong>Loading workspace access…</strong></div></section>;
  if (!connection.organization) return <section className="empty-state compact-empty"><span className="empty-mark">ID</span><h2>{connection.state === "signed_out" ? "Sign in to manage members" : "No workspace selected"}</h2><p>Membership and roles are scoped to one workspace at a time.</p><ConnectionAction connection={connection} returnTo="/members" /></section>;
  return <section className="connection-hero"><div><span className="status success">Current workspace</span><h2>{connection.organization.name}</h2><p>Your role: {connection.organization.role}. Invitation and role-management controls remain disabled until their audit and last-owner safeguards pass.</p></div><a className="button secondary" href="/account">Manage account</a></section>;
}
