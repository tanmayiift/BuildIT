"use client";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { useConnection } from "./live-connections";
type Provider = "linear" | "jira";
type Resource = { id: string; name: string; workspaceId: string };
type Draft = { id: string; provider: Provider; repositoryId?: string; resources: Resource[]; expiresAt: number };
type Project = { id: string; key: string; name: string };
type Connection = { id: string; provider: string; workspaceId: string; status: string; credentialFormat?: string; projectKeys?: string[]; repositoryId?: string };
const availabilityAction = makeFunctionReference<"action", { organizationId: string }, { linear: boolean; jira: boolean; runtimeConfigured: boolean; unavailable?: boolean }>("trackerOAuth:availability");
const beginAction = makeFunctionReference<"action", { organizationId: string; repositoryId: string; provider: Provider; replacesConnectionId?: string }, { authorizationUrl: string }>("trackerOAuth:begin");
const completeAction = makeFunctionReference<"action", { state: string; code?: string; error?: string }, { cancelled: boolean; draftId?: string }>("trackerOAuth:complete");
const projectAction = makeFunctionReference<"action", { draftId: string; resourceId: string; cursor?: string }, { projects: Project[]; nextCursor: string | null }>("trackerOAuth:projects");
const connectAction = makeFunctionReference<"action", { draftId: string; resourceId: string; projectId: string }, { status: "active" }>("trackerOAuth:connect");
const disconnectAction = makeFunctionReference<"action", { organizationId: string; connectionId: string; requestId: string }, { status: "revoked"; remoteRevoked: boolean; removalUrl?: string }>("trackerOAuth:disconnect");
const pendingQuery = makeFunctionReference<"query", { organizationId: string }, { rows: Draft[]; truncated: boolean }>("trackerOAuthData:pending");
const connectionQuery = makeFunctionReference<"query", { organizationId: string }, Connection[]>("integrations:listTrackerConnections");
export function trackerOAuthMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("recent_reauthentication_required")) return "Sign in with GitHub again, then connect the tracker. Your repository settings are saved.";
  if (message.includes("not_configured") || message.includes("configuration_missing")) return "BuildIT has not enabled this tracker sign-in yet. You can continue reviewing GitHub pull requests.";
  if (message.includes("state_") || message.includes("reconnect_required")) return "This connection attempt expired. Start it again from Integrations.";
  if (message.includes("permission_denied") || message.includes("scope_refused")) return "The tracker did not grant access to that workspace or project. Choose an accessible project or reconnect.";
  if (message.includes("not_found_or_forbidden")) return "An owner or admin of the workspace that started this connection must finish it.";
  if (message.includes("rate_limited")) return "Too many connection attempts. Wait a few minutes and try again.";
  return "The tracker connection could not finish. Your GitHub reviews remain available. Try again from Integrations.";
}
export function TrackerOAuthCards() {
  const workspace = useConnection(), organization = workspace?.organization, canManage = organization?.role === "owner" || organization?.role === "admin";
  const available = useAction(availabilityAction), begin = useAction(beginAction), disconnect = useAction(disconnectAction);
  const rows = useQuery(connectionQuery, organization && canManage ? { organizationId: organization.id } : "skip");
  const pending = useQuery(pendingQuery, organization && canManage ? { organizationId: organization.id } : "skip");
  const [configuration, setConfiguration] = useState<{ linear: boolean; jira: boolean; runtimeConfigured: boolean; unavailable?: boolean } | null>(null);
  const [working, setWorking] = useState(""), [message, setMessage] = useState(""), [removalUrl, setRemovalUrl] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  useEffect(() => { let active = true; setConfiguration(null); if (organization && canManage) void available({ organizationId: organization.id }).then(value => { if (active) setConfiguration(value); }).catch(() => { if (active) setConfiguration({ linear: false, jira: false, runtimeConfigured: false, unavailable: true }); }); return () => { active = false; }; }, [available, canManage, organization?.id]);
  useEffect(() => { if (!workspace?.repositories.some(item => item.id === repositoryId)) setRepositoryId(workspace?.repositories[0]?.id ?? ""); }, [repositoryId, workspace?.repositories]);
  async function start(provider: Provider, replacesConnectionId?: string) {
    if (!organization || !repositoryId) return;
    setWorking(provider); setMessage("");
    try { const result = await begin({ organizationId: organization.id, repositoryId, provider, ...(replacesConnectionId ? { replacesConnectionId } : {}) }); window.location.assign(result.authorizationUrl); }
    catch (error) { setMessage(trackerOAuthMessage(error)); setWorking(""); }
  }
  return <>
    {(["linear", "jira"] as const).map(provider => {
      const title = provider === "linear" ? "Linear" : "Jira", connections = (rows ?? []).filter(row => row.provider === provider && row.credentialFormat === "oauth_bundle_v1" && row.status !== "revoked");
      return <article className="integration-card" key={provider}>
        <div><span className="integration-glyph">{title.slice(0, 2).toUpperCase()}</span><span className="status neutral">{!canManage ? "Owner or admin connects" : configuration === null ? "Checking availability…" : configuration.unavailable ? "Unavailable" : configuration[provider] ? "Ready to connect" : "Not configured"}</span></div>
        <h2>{title}</h2><p>Read linked issues from one selected {provider === "linear" ? "team" : "project"}. No issue edits or comments are requested.</p>
        {canManage && configuration?.unavailable ? <p>BuildIT cannot check {title} right now. Reload this page to try again.</p> : canManage && configuration && !configuration[provider] ? <p>BuildIT has not enabled {title} sign-in yet. GitHub reviews can continue.</p> : null}
        {canManage && configuration?.[provider] ? <><label className="field"><span>Use for repository</span><select value={repositoryId} onChange={event => setRepositoryId(event.target.value)} disabled={Boolean(working)}>{workspace?.repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.owner}/{repo.name}</option>)}</select></label><button className="button secondary" disabled={!repositoryId || Boolean(working)} onClick={() => void start(provider)}>{working === provider ? "Opening sign-in…" : `Connect ${title}`}</button></> : null}
        {connections.map(row => <div key={row.id} className="setting-row"><div><strong>{row.workspaceId} · {row.projectKeys?.join(", ")}</strong><p>{row.status === "active" ? "Connected with renewable read access." : "Access expired. Connect again to restore linked issue context."}</p></div><button className="button destructive" disabled={Boolean(working)} onClick={() => {
          if (!organization) return; setWorking(row.id); setMessage(""); setRemovalUrl("");
          void disconnect({ organizationId: organization.id, connectionId: row.id, requestId: `tracker-disconnect:${crypto.randomUUID()}` }).then(result => { setMessage(result.remoteRevoked ? `${title} disconnected and provider access revoked.` : `${title} disconnected from BuildIT. Remove the app in your tracker account to revoke the provider grant too.`); setRemovalUrl(result.removalUrl ?? ""); }).catch(error => setMessage(trackerOAuthMessage(error))).finally(() => setWorking(""));
        }}>{working === row.id ? "Disconnecting…" : "Disconnect"}</button></div>)}
        {pending?.rows.filter(row => row.provider === provider).map(row => <p key={row.id}><a href={`/setup/tracker?draft=${encodeURIComponent(row.id)}`}>Continue selecting the {provider === "linear" ? "team" : "site and project"}</a></p>)}
      </article>;
    })}
    {message ? <p className="form-result" role="status">{message} {removalUrl ? <a href={removalUrl} rel="noreferrer" target="_blank">Open tracker account access settings</a> : null}</p> : null}
  </>;
}
export function TrackerOAuthSetup() {
  const workspace = useConnection(), organization = workspace?.organization, { isAuthenticated, isLoading } = useConvexAuth();
  const canManage = organization?.role === "owner" || organization?.role === "admin", complete = useAction(completeAction);
  const pending = useQuery(pendingQuery, organization && canManage ? { organizationId: organization.id } : "skip");
  const seen = useRef(false), [draftId, setDraftId] = useState(""), [connected, setConnected] = useState(false), [message, setMessage] = useState("Checking the tracker response…");
  useEffect(() => {
    if (isLoading || seen.current) return;
    const params = new URLSearchParams(window.location.search), state = params.get("state"), existing = params.get("draft");
    if (existing) { seen.current = true; setDraftId(existing); setMessage(""); return; }
    seen.current = true;
    if (!state) { setMessage("Start a tracker connection from Integrations."); return; }
    const code = params.get("code"), error = params.get("error");
    window.history.replaceState(null, "", "/setup/tracker");
    if (!isAuthenticated) { setMessage("Your session ended. Sign in with GitHub and start the tracker connection again."); return; }
    void complete({ state, ...(code ? { code } : {}), ...(error ? { error } : {}) }).then(result => {
      if (result.cancelled) { setMessage("Tracker access was declined. No connection was activated."); return; }
      setDraftId(result.draftId ?? ""); setMessage(""); window.history.replaceState(null, "", `/setup/tracker?draft=${encodeURIComponent(result.draftId ?? "")}`);
    }).catch(error => setMessage(trackerOAuthMessage(error)));
  }, [complete, isAuthenticated, isLoading]);
  const draft = pending?.rows.find(row => row.id === draftId);
  return <div className="content setup-page"><a className="back-link" href="/integrations">← Integrations</a><h1 className="title">Choose the issue context BuildIT may read</h1><p>Tracker consent grants read access. BuildIT further restricts this connection to the repository and {draft?.provider === "linear" ? "team" : "project"} you select.</p>
    {message ? <p role="status">{message}</p> : null}
    {!isLoading && !isAuthenticated ? <a className="button" href="/sign-in">Sign in with GitHub</a> : null}
    {connected ? <section className="setup-card"><h2>Issue tracker connected</h2><p>BuildIT can now read matching issue links when you review your pull request.</p><a className="button" href="/setup/review">Review your pull request</a></section> : draft ? <TrackerSelection key={draft.id} draft={draft} onConnected={() => setConnected(true)} /> : draftId && pending !== undefined ? <p role="status">This selection expired or belongs to another workspace. Return to the workspace where you started the connection, or connect again.</p> : null}
  </div>;
}
function TrackerSelection({ draft, onConnected }: { draft: Draft; onConnected: () => void }) {
  const load = useAction(projectAction), connect = useAction(connectAction), [resourceId, setResourceId] = useState(draft.resources.length === 1 ? draft.resources[0]!.id : ""), [projectId, setProjectId] = useState(""), [projects, setProjects] = useState<Project[]>([]), [cursor, setCursor] = useState<string | null>(null), [working, setWorking] = useState(false), [message, setMessage] = useState(""), epoch = useRef(0);
  useEffect(() => { const current = ++epoch.current; setProjects([]); setProjectId(""); setCursor(null); setMessage(""); if (!resourceId) return; setWorking(true); void load({ draftId: draft.id, resourceId }).then(result => { if (current === epoch.current) { setProjects(result.projects); setCursor(result.nextCursor); } }).catch(error => { if (current === epoch.current) setMessage(trackerOAuthMessage(error)); }).finally(() => { if (current === epoch.current) setWorking(false); }); }, [draft.id, load, resourceId]);
  return <section className="setup-card"><label className="field"><span>{draft.provider === "jira" ? "Jira site" : "Linear workspace"}</span><select value={resourceId} onChange={event => setResourceId(event.target.value)} disabled={working}><option value="">Choose a workspace…</option>{draft.resources.map(resource => <option key={resource.id} value={resource.id}>{resource.name} · {resource.workspaceId}</option>)}</select></label>
    <label className="field"><span>{draft.provider === "linear" ? "Linear team" : "Jira project"}</span><select value={projectId} onChange={event => setProjectId(event.target.value)} disabled={working || !resourceId}><option value="">Choose the issue scope…</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name} ({project.key})</option>)}</select></label>
    {cursor ? <button className="button tertiary" disabled={working} onClick={() => { setWorking(true); void load({ draftId: draft.id, resourceId, cursor }).then(result => { setProjects(previous => [...previous, ...result.projects.filter(item => !previous.some(held => held.id === item.id))]); setCursor(result.nextCursor); }).catch(error => setMessage(trackerOAuthMessage(error))).finally(() => setWorking(false)); }}>Load more choices</button> : null}
    {!working && resourceId && !projects.length && !message ? <p>No accessible {draft.provider === "linear" ? "teams" : "projects"} were returned. Check the account&apos;s permissions before reconnecting.</p> : null}
    <p>No model call or pull-request review starts when you connect this tracker.</p><button className="button" disabled={working || !projectId} onClick={() => { setWorking(true); setMessage(""); void connect({ draftId: draft.id, resourceId, projectId }).then(onConnected).catch(error => setMessage(trackerOAuthMessage(error))).finally(() => setWorking(false)); }}>{working ? "Checking access…" : "Connect selected issue scope"}</button>{message ? <p role="alert">{message}</p> : null}
  </section>;
}
