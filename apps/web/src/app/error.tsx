"use client";

import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("BuildIT route failed", { digest: error.digest }); }, [error.digest]);
  return <div className="content"><section className="empty-state compact-empty" role="alert"><span className="empty-mark">ER</span><h1>We could not load this workspace</h1><p>No fallback or sample data has been substituted. Retry the authorized request, or return to setup if access changed.</p><div className="button-row"><button className="button" type="button" onClick={reset}>Retry</button><a className="button secondary" href="/setup/install">Check setup</a></div></section></div>;
}
