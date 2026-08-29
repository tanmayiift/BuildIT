export default function SignIn() {
  return <div className="content auth-card">
    <p className="eyebrow">Product preview</p>
    <h1 className="title">GitHub sign-in is not active yet</h1>
    <p>BuildIT is currently showing sample screens while authentication and repository isolation are being completed and tested.</p>
    <button className="button" type="button" disabled>Continue with GitHub</button>
    <p className="muted">This button will be enabled only after a real OAuth round trip, account isolation, sign-out, and access-revocation tests pass.</p>
    <a className="text-link" href="/data-handling">See what this preview collects</a>
  </div>;
}
