import type { ReactNode } from "react";

// Every "nothing here yet" and "this did not load" panel, one way. Written out by hand fourteen times,
// the copies drifted: most let a screen reader announce their decorative mark ("GH", "ER", "—") as
// the first thing on the panel, one put its action outside the button row, and the error pages used a
// heading level the stylesheet never spaced. The layout lives in .empty-state (globals.css); this
// decides only what appears.
export function EmptyState({ mark, title, detail, actions, size = "compact", level = 2, alert = false, as: Tag = "section" }: {
  // Two or three characters that stand for the subject; decoration, never read aloud.
  mark: string;
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  // compact: a panel inside a page. live: the page's own state. full: a whole-page result.
  size?: "compact" | "live" | "full";
  // 1 only where the panel is the page (an error boundary); everywhere else it sits under the page's h1.
  level?: 1 | 2;
  alert?: boolean;
  as?: "section" | "article";
}) {
  const Heading = level === 1 ? "h1" : "h2";
  const className = size === "compact" ? "empty-state compact-empty" : size === "live" ? "empty-state live-empty" : "empty-state";
  return (
    <Tag className={className} role={alert ? "alert" : undefined}>
      <span className="empty-mark" aria-hidden="true">{mark}</span>
      <Heading>{title}</Heading>
      {detail ? <p>{detail}</p> : null}
      {actions ? <div className="button-row">{actions}</div> : null}
    </Tag>
  );
}
