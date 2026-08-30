# Authenticated credential reload — 2026-08-30

The existing signed-in Chrome session opened the production account and model setup pages through macOS accessibility automation. Screenshots remain local-only and contain no source code or raw credential.

Observed server state:

- GitHub identity: Tanmay Kumar.
- Active workspace: `tanmayiift's workspace`.
- Repository access: exactly the public and private BuildIT fixture repositories.
- Session controls: current browser, another active browser, sign out other sessions, and sign out this browser.
- Provider credential after a fresh page load: Gemini, organization scope, all selected repositories, masked suffix `nmiQ`, encrypted and valid.

A direct source-free Convex assertion found the envelope ciphertext, nonce, authentication tag, wrapped data key, KMS key ID, authenticated-data digest, and validation timestamp. It rejected the evidence if a plaintext, key, or secret field existed.

The credential was not revoked yet because the live Gemini review must use it first. Revoke and post-revoke denial are the final credential checks.
