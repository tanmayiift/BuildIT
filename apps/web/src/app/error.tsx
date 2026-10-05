"use client";

import { useEffect } from "react";
import { EmptyState } from "./empty-state";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("BuildIT route failed", { digest: error.digest }); }, [error.digest]);
  return <div className="content"><EmptyState alert level={1} mark="ER" title="We could not load this workspace" detail="No fallback or sample data has been substituted. Retry the authorized request, or return to setup if access changed." actions={<><button className="button" type="button" onClick={reset}>Retry</button><a className="button secondary" href="/setup/install">Check setup</a></>} /></div>;
}
