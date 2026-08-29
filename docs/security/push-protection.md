# GitHub secret protection

Repository administrators should enable **Secret Protection** and **Push Protection** in GitHub under **Settings → Code security**. Push Protection blocks a push when GitHub recognizes a supported credential before it enters repository history.

BuildIT also runs Gitleaks on every pull request and push to `main`, and `pnpm security:tracked-files` rejects private plans, environment files, key bundles, operating-system metadata, and raw customer-source directories.

If a real credential is ever committed, revoke and replace it first. Removing the text from a later commit does not make the exposed credential safe again.
