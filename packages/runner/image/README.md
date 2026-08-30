# BuildIT sandbox image

This image contains the fixed Node 24 runtime and deterministic scanner binaries used by hosted reviews.

Every `FROM` line uses a Linux/AMD64 manifest digest. Do not replace a digest with a mutable tag. Build and test with:

```sh
docker build --platform linux/amd64 -t buildit-runner:node24-scanners-v1 packages/runner/image
docker run --rm --platform linux/amd64 buildit-runner:node24-scanners-v1 node --version
docker run --rm --platform linux/amd64 buildit-runner:node24-scanners-v1 gitleaks version
docker run --rm --platform linux/amd64 buildit-runner:node24-scanners-v1 osv-scanner --version
```

Production must use an immutable Vercel Container Registry digest owned by the separately deployed BuildIT broker project. A tag or an image from the web project is not an acceptable review runtime.
