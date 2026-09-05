"use client";

import { useEffect } from "react";

// The app's root error boundary answers "We could not load this workspace… Check setup", which is
// the right sentence for a signed-in customer and the wrong one for a stranger who has no
// workspace, no account and no setup to check. /proof is the only public route that reads live
// data, so it is the only one that can reach an error boundary at all - and telling a visitor
// their access may have changed, when they never had any, reads as a broken product.
export default function ProofError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("BuildIT proof page failed", { digest: error.digest }); }, [error.digest]);
  return <div className="content trust-page">
    <section className="empty-state compact-empty" role="alert">
      <span className="empty-mark" aria-hidden="true">ER</span>
      <h1>The live numbers did not load</h1>
      <p>
        BuildIT could not read its own aggregate query just now. No cached, sample or estimated figures have been
        substituted in their place, because a number on this page that did not come from the database would defeat
        the point of the page.
      </p>
      <div className="button-row">
        <button className="button" type="button" onClick={reset}>Try again</button>
        <a className="button secondary" href="/data-handling">What happens to your data</a>
      </div>
    </section>
  </div>;
}
