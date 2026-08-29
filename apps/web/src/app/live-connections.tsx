"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

type Connection = {
  state: "signed_out" | "no_workspace" | "installation_required" | "installation_unavailable" | "no_repositories_selected" | "connected";
  organization: null | { id: string; name: string; slug: string; role: string; region: "eu-west-1"; retentionHours: number };
  installations: Array<{ id: string; installationId: number; accountLogin: string; accountType: "user" | "organization"; status: "active" | "suspended" | "removed"; updatedAt: number }>;
  repositories: Array<{ id: string; installationId: string; githubRepositoryId: number; owner: string; name: string; defaultBranch: string; visibility: "public" | "private" | "internal" | "unknown"; autofixMode: "disabled" | "stacked" | "direct_push"; indexState: string; updatedAt: number }>;
};
const connectionQuery = makeFunctionReference<"query", Record<string, never>, Connection>("repositoryConnections:current");

const signedOutConnection: Connection = { state: "signed_out", organization: null, installations: [], repositories: [] };
function useConnection() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const connection = useQuery(connectionQuery, isAuthenticated ? {} : "skip");
  if (!isLoading && !isAuthenticated) return signedOutConnection;
  return connection;
}

const stateCopy: Record<Connection["state"], { title: string; body: string }> = {
  signed_out: { title: "Sign in to see repository access", body: "Your repository list is private to your BuildIT account and active workspace." },
  no_workspace: { title: "Connect your GitHub installation", body: "Sign-in is complete. Verify the GitHub App installation to create your isolated workspace." },
  installation_required: { title: "Choose repositories in GitHub", body: "BuildIT has no installation for this workspace yet." },
  installation_unavailable: { title: "GitHub access needs attention", body: "The installation was suspended or removed. BuildIT will not use stale access." },
  no_repositories_selected: { title: "No repositories are selected", body: "Update the GitHub App installation and choose at least one repository." },
  connected: { title: "GitHub is connected", body: "Selected repositories are isolated to this workspace and installation." },
};

function ConnectionAction({ connection }: { connection: Connection }) {
  if (connection.state === "signed_out") return <a className="button" href="/sign-in?returnTo=%2Frepositories">Sign in with GitHub</a>;
  const installation = connection.installations[0];
  if (installation) return <a className="button" href={`https://github.com/settings/installations/${installation.installationId}`}>Manage repository selection</a>;
  return <a className="button" href="https://github.com/apps/buildit-agentic-review/installations/new">Choose repositories in GitHub</a>;
}

export function RepositoryConnectionView() {
  const connection = useConnection();
  if (!connection) return <section className="live-state" aria-live="polite"><span className="state-pulse" /><div><strong>Loading repository access…</strong><p>Checking your active workspace on the server.</p></div></section>;
  const copy = stateCopy[connection.state];
  if (connection.state !== "connected") return <section className="split-layout"><article className="empty-state live-empty"><span className="empty-mark">GH</span><h2>{copy.title}</h2><p>{copy.body}</p><div className="button-row"><ConnectionAction connection={connection} /><a className="button secondary" href="/data-handling">How isolation works</a></div></article><aside className="explain-panel"><p className="eyebrow">Current state</p><strong className="connection-state-name">{connection.state.replaceAll("_", " ")}</strong><p>Repository content is never inferred from public visibility. BuildIT requires the selected GitHub installation for both public and private repositories.</p></aside></section>;
  const installation = connection.installations.find(item => item.status === "active")!;
  return <>
    <section className="connection-hero" aria-live="polite"><div><span className="status success">Connected</span><h2>{copy.title}</h2><p>{connection.organization?.name} · GitHub account {installation.accountLogin}</p></div><ConnectionAction connection={connection} /></section>
    <section className="context-strip"><span><small>Workspace</small><strong>{connection.organization?.name}</strong></span><span><small>Installation</small><strong>#{installation.installationId}</strong></span><span><small>Repository access</small><strong>{connection.repositories.length} selected</strong></span><span><small>Data region</small><strong>Ireland</strong></span></section>
    <section className="repository-list" aria-label="Connected repositories">{connection.repositories.map(repository => <article className="repository-row" key={repository.id}><span className="repository-mark">{repository.visibility === "private" ? "PR" : repository.visibility === "public" ? "PU" : "RE"}</span><div><h2>{repository.owner}/{repository.name}</h2><p>{repository.visibility} repository · default branch <code>{repository.defaultBranch}</code></p></div><div className="repository-policy"><span>Autofix</span><strong>{repository.autofixMode === "stacked" ? "Stacked PR" : repository.autofixMode.replaceAll("_", " ")}</strong></div><div className="repository-policy"><span>Index</span><strong>{repository.indexState.replaceAll("_", " ")}</strong></div><a href={`https://github.com/${repository.owner}/${repository.name}`} aria-label={`Open ${repository.owner}/${repository.name} on GitHub`}>Open ↗</a></article>)}</section>
  </>;
}

export function GitHubIntegrationState() {
  const connection = useConnection();
  const loading = !connection;
  const connected = connection?.state === "connected";
  return <article className="integration-card" data-connected={connected || undefined}><div><span className="integration-glyph">GH</span><span className={`status ${connected ? "success" : "neutral"}`}>{loading ? "Checking…" : connected ? `${connection.repositories.length} connected` : "Setup needed"}</span></div><h2>GitHub</h2><p>{loading ? "Checking your active workspace." : connected ? `${connection.organization?.name} can access only the selected repositories shown in BuildIT.` : stateCopy[connection.state].body}</p>{connection ? <ConnectionAction connection={connection} /> : null}</article>;
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
