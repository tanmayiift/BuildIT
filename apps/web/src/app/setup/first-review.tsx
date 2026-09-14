"use client";
import { useEffect, useState } from "react";
import { useConnection } from "../live-connections";
import { DashboardReviewStart } from "../reviews/dashboard-review-start";
type Repository = { id: string; owner: string; name: string };
function selectedPullRequest(value: string, repositories: Repository[]) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password) return null;
    const path = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)(?:\/files|\/commits)?\/?$/.exec(url.pathname);
    if (!path) return null;
    const repository = repositories.find(row => row.owner.toLowerCase() === path[1]!.toLowerCase() && row.name.toLowerCase() === path[2]!.toLowerCase());
    const prNumber = Number(path[3]); return repository && Number.isSafeInteger(prNumber) ? { repository, prNumber } : null;
  } catch { return null; }
}
export function FirstReviewSetup() {
  const workspace = useConnection();
  return <div className="content setup-page"><a className="back-link" href="/setup/model">← Model key</a><p className="eyebrow">Step 3 of 3 · Your pull request</p><h1 className="title">See BuildIT review your own change</h1><p>Paste an open pull request from a repository you connected. First inspect the scope and cost limit, then approve one review.</p>
    {workspace === undefined ? <p role="status">Loading your workspace…</p> : !workspace?.organization ? <><p>Sign in and choose which repositories BuildIT may access.</p><a className="button" href="/setup/install">Connect GitHub</a></> : !workspace.repositories.length ? <><p>Connect the repository that contains your pull request before continuing.</p><a className="button" href="/setup/install">Choose a repository in GitHub</a></> : <OwnPullRequest key={workspace.organization.id} organizationId={workspace.organization.id} repositories={workspace.repositories} canStart={workspace.organization.role !== "viewer"} />}
    <details className="setup-card"><summary>Optional settings and connections</summary><p>Your first review uses the repository&apos;s trusted policy. Open these settings when you need them.</p><p><a href="/repositories">Repository policies</a> · <a href="/setup/health">Connection checks</a> · <a href="/integrations">Linear and Jira</a></p></details>
  </div>;
}
function OwnPullRequest({ organizationId, repositories, canStart }: { organizationId: string; repositories: Repository[]; canStart: boolean }) {
  const storageKey = `buildit:first-pr:${organizationId}`, [url, setUrl] = useState(""), [loaded, setLoaded] = useState(false);
  useEffect(() => { try { const value = window.sessionStorage.getItem(storageKey); if (value && value.length <= 2048) setUrl(value); } catch { /* Storage may be disabled. The form still works. */ } setLoaded(true); }, [storageKey]);
  useEffect(() => { if (loaded) try { window.sessionStorage.setItem(storageKey, url); } catch { /* A draft is optional. */ } }, [loaded, storageKey, url]);
  const selected = selectedPullRequest(url, repositories);
  if (!canStart) return <p>Starting a review needs the developer role or higher. You can still <a href="/reviews">read your workspace&apos;s reviews</a>.</p>;
  return <><label className="field"><span>Your GitHub pull request URL</span><input type="url" value={url} maxLength={2048} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/your-team/your-repo/pull/42" /></label><p>Your link is saved in this browser tab. Reloading always requires a fresh preview and approval.</p>
    {url && !selected ? <p role="status">Use a GitHub pull request URL from a repository connected to this workspace. <a href="/setup/install">Update GitHub repository access</a> if it is missing.</p> : null}
    {selected ? <DashboardReviewStart key={`${selected.repository.id}:${selected.prNumber}`} repositories={repositories} initialRepositoryId={selected.repository.id} initialPrNumber={selected.prNumber} canStartReview={canStart} /> : null}
  </>;
}
