"use client";
import { useConnection } from "./live-connections";

// /policies was six paragraphs describing settings, and a comment recording that a disabled button
// had been deleted from it rather than made real. Both halves were right: inventing a control that
// does nothing is worse than none, and a page of prose about your own workspace that never reads
// your workspace is not much better - it said "Source retention: 24 hours" to every reader whether
// or not that was their retention window.
//
// So the half that is workspace state is read from the workspace, with the count of repositories it
// currently applies to, and each row points at the page where that choice is actually made. The
// half that is a product invariant stays a flat statement on the page, because there is nothing to
// set and pretending otherwise is the mistake that was already made here once.

export function WorkspacePolicyState() {
  const connection = useConnection();
  if (!connection) return <section className="live-state" aria-live="polite"><span className="state-pulse" /><div><strong>Reading this workspace&rsquo;s settings…</strong><p>These values are scoped to one workspace.</p></div></section>;
  if (connection.state !== "connected" || !connection.organization) {
    return <section className="empty-state compact-empty">
      <span className="empty-mark">—</span>
      <h2>No workspace settings to read yet</h2>
      <p>Retention, autofix delivery and configuration approval are properties of a connected workspace, so BuildIT shows none of them until one exists.</p>
      <div className="button-row"><a className="button secondary" href="/repositories">Connect a repository</a></div>
    </section>;
  }
  const { organization, repositories } = connection;
  const total = repositories.length;
  const of = (count: number) => `${count} of ${total}`;
  const stacked = repositories.filter(item => item.autofixMode !== "disabled").length;
  const automatic = repositories.filter(item => item.reviewTrigger === "automatic").length;
  const approved = repositories.filter(item => item.approvedConfigHash).length;
  const awaiting = repositories.filter(item => item.pendingConfigHash && item.pendingConfigHash !== item.approvedConfigHash).length;
  return <section className="settings-list">
    <PolicyRow title="Source retention" value={`${organization.retentionHours} hours`}
      detail="Encrypted source and command output are deleted after this window, and each deletion is confirmed by reading the key back from storage."
      href="/audit" action="See the deletions" />
    <PolicyRow title="Autofix delivery" value={`${of(stacked)} stacked`}
      detail="A fix always arrives as a separate pull request; the branch under review is never written to, whichever way this is set."
      href="/repositories" action="Set per repository" />
    <PolicyRow title="When reviews start" value={`${of(automatic)} automatic`}
      detail="An automatic repository reviews on open and on every push, spending your model key. The rest run only when someone asks."
      href="/repositories" action="Set per repository" />
    <PolicyRow title="Repository configuration" value={awaiting ? `${of(approved)} approved · ${awaiting} awaiting` : `${of(approved)} approved`}
      detail="A .buildit.yml is read from your default branch and never from a pull request head. An admin approves each version before a review uses it."
      href="/repositories" action={awaiting ? "Approve a version" : "Review approvals"} />
  </section>;
}

function PolicyRow({ title, value, detail, href, action }: { title: string; value: string; detail: string; href: string; action: string }) {
  return <article className="setting-row">
    <div><strong>{title}</strong><p>{detail}</p></div>
    <div className="setting-state"><code>{value}</code><a className="text-link" href={href}>{action} →</a></div>
  </article>;
}
