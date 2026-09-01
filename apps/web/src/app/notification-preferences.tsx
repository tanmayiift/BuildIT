"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useState } from "react";
import { notificationEmailState } from "./notification-email-state";

type Connection = { organization: null | { id: string; name: string }; repositories: Array<{ id: string; owner: string; name: string }> };
type Preferences = { emailEnabled: boolean; deliveryAvailable: boolean; digestMode: "immediate" | "daily"; mutedRepositoryIds: string[]; updatedAt: number | null; recipient: { state: "verified"; maskedEmail: string } | { state: "verification_required" } };
const connectionQuery = makeFunctionReference<"query", Record<string, never>, Connection>("repositoryConnections:current"),
  preferencesQuery = makeFunctionReference<"query", { organizationId: string }, Preferences>("notifications:preferences"),
  updatePreferences = makeFunctionReference<"mutation", { organizationId: string; emailEnabled: boolean; digestMode: "immediate" | "daily"; mutedRepositoryIds: string[]; requestId: string }, null>("notifications:updatePreferences");

export function NotificationPreferences() {
  const { isAuthenticated } = useConvexAuth(), connection = useQuery(connectionQuery, isAuthenticated ? {} : "skip"), organizationId = connection?.organization?.id,
    saved = useQuery(preferencesQuery, organizationId ? { organizationId } : "skip"), update = useMutation(updatePreferences), [message, setMessage] = useState(""), [working, setWorking] = useState(false);
  if (!organizationId || !saved) return <section className="live-state" aria-live="polite"><span className="state-pulse"/><div><strong>{isAuthenticated ? "Loading notification preferences…" : "Sign in to manage notifications"}</strong></div></section>;
  async function save(next: Partial<Preferences>) { if (!organizationId || !saved) return; setWorking(true); setMessage(""); try { await update({ organizationId, emailEnabled: next.emailEnabled ?? saved.emailEnabled, digestMode: next.digestMode ?? saved.digestMode, mutedRepositoryIds: next.mutedRepositoryIds ?? saved.mutedRepositoryIds, requestId: crypto.randomUUID() }); setMessage("Notification preferences saved for this workspace."); } catch { setMessage("Preferences were not saved. Refresh your active workspace and try again."); } finally { setWorking(false); } }
  const email = notificationEmailState(saved);
  return <>
    <section className={`settings-list notification-settings${saved.deliveryAvailable?" has-actions":""}`} aria-label="Customer email status">
      <article className="setting-row"><div><strong>Customer review email</strong><p>{email.summary}</p></div><span className="status neutral">{email.status}</span>{saved.deliveryAvailable?<button type="button" disabled={working||saved.recipient.state!=="verified"} onClick={()=>void save({emailEnabled:!saved.emailEnabled})}>{saved.emailEnabled?"Turn off":"Turn on"}</button>:null}</article>
      <article className="setting-row"><div><strong>Future recipient</strong><p>{email.recipient}</p></div><span className="recipient-scope">One member</span></article>
      <article className="setting-row"><div><strong>Where results appear now</strong><p>Review results appear in GitHub checks and your BuildIT dashboard.</p></div><span className="status success">Active</span></article>
      {saved.deliveryAvailable?<article className="setting-row"><div><strong>Delivery timing</strong><p>Immediate sends each event; daily groups non-critical events.</p></div><select aria-label="Email delivery timing" value={saved.digestMode} disabled={working||!saved.emailEnabled} onChange={event=>void save({digestMode:event.target.value as Preferences["digestMode"]})}><option value="immediate">Immediate</option><option value="daily">Daily digest</option></select></article>:null}
    </section>
    {saved.deliveryAvailable?<section className="settings-list" aria-label="Repository notification muting">{connection.repositories.map(repository=>{const muted=saved.mutedRepositoryIds.includes(repository.id);return <article className="setting-row" key={repository.id}><div><strong>{repository.owner}/{repository.name}</strong><p>{muted?"Routine notifications muted":"Notifications follow your delivery timing"}</p></div><button type="button" disabled={working} onClick={()=>void save({mutedRepositoryIds:muted?saved.mutedRepositoryIds.filter(id=>id!==repository.id):[...saved.mutedRepositoryIds,repository.id]})}>{muted?"Unmute":"Mute"}</button></article>})}</section>:null}
    {message?<p className="form-result" role="status">{message}</p>:null}
    <p className="boundary-note"><strong>Delivery boundary:</strong> {email.boundary} GitHub checks and the dashboard remain the current customer channels.</p>
  </>;
}
