import type { ReactNode } from "react";

// Every loading, empty and refusal panel on the site, one way. It was written out by hand thirteen
// times, so each copy drifted on its own: a refusal wore the amber "still loading" pulse, a short
// loading line was pushed to the far edge of the card, and a button sat flush against the paragraph
// above it. The layout lives in .live-state (flows.css); this decides only what appears.
export function StatePanel({ title, detail, action, loading = false }: {
  title: ReactNode;
  detail?: ReactNode;
  action?: { href: string; label: string };
  // The pulse means "still working". A final state - signed out, refused, unavailable - has none.
  loading?: boolean;
}) {
  return (
    <section className="live-state" aria-live={loading ? "polite" : undefined}>
      {loading ? <span className="state-pulse" aria-hidden="true" /> : null}
      <div>
        <strong>{title}</strong>
        {detail ? <p>{detail}</p> : null}
        {action ? <a className="button" href={action.href}>{action.label}</a> : null}
      </div>
    </section>
  );
}
