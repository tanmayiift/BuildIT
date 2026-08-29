"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useState } from "react";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const callbackError = new URLSearchParams(window.location.search).get("error");
    if (callbackError) setError("GitHub sign-in returned without a verified BuildIT session. No repository access was granted. Try again, or use a different GitHub account if this one is already linked.");
  }, []);

  async function continueWithGitHub() {
    setPending(true);
    setError("");
    try {
      const requested=new URLSearchParams(window.location.search).get("returnTo"),redirectTo=requested?.startsWith("/")&&!requested.startsWith("//")?requested:"/";
      await signIn("github", { redirectTo });
    } catch {
      setError("GitHub sign-in could not start. No repository access was granted. Please try again.");
      setPending(false);
    }
  }

  return <div className="content auth-card">
    <p className="eyebrow">Secure account access</p>
    <h1 className="title">Sign in with GitHub</h1>
    <p>Sign-in identifies you. It does not give BuildIT access to a repository. You choose repositories separately when installing the GitHub App.</p>
    <button className="button" type="button" disabled={pending} onClick={continueWithGitHub}>{pending ? "Opening GitHub…" : "Continue with GitHub"}</button>
    {error ? <p className="auth-error" role="alert">{error}</p> : null}
    <p className="muted">GitHub shows the identity permission before you approve it. BuildIT repository access remains off until a separate App installation.</p>
    <a className="text-link" href="/data-handling">See what BuildIT stores and where</a>
  </div>;
}
