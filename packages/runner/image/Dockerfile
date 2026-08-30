FROM zricethezav/gitleaks@sha256:bf00b5e039f0fad4b32935dc5ec1e358f227ccd097bcb64b971f0331072fe2ae AS gitleaks
FROM ghcr.io/google/osv-scanner@sha256:8e1f1e18937ad309d7e29dd69be7098e59055286947bf42f85fc659f24f04ccc AS osv
FROM node@sha256:6642ef280aebc09c4541bee0b15c9f89f0f3f3c247ddee79ae1d37eddfdcbbaa

COPY --from=gitleaks /usr/bin/gitleaks /usr/local/bin/gitleaks
COPY --from=osv /osv-scanner /usr/local/bin/osv-scanner

RUN corepack enable \
  && test "$(gitleaks version)" = "v8.28.0" \
  && osv-scanner --version 2>&1 | grep -F "2.2.3"

LABEL dev.buildit.runner="node24-scanners-v1" \
  dev.buildit.gitleaks="8.28.0" \
  dev.buildit.osv-scanner="2.2.3"
