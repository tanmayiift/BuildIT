# syntax=docker/dockerfile:1.7
FROM zricethezav/gitleaks@sha256:bf00b5e039f0fad4b32935dc5ec1e358f227ccd097bcb64b971f0331072fe2ae AS gitleaks
FROM ghcr.io/google/osv-scanner@sha256:8e1f1e18937ad309d7e29dd69be7098e59055286947bf42f85fc659f24f04ccc AS osv
FROM node@sha256:6642ef280aebc09c4541bee0b15c9f89f0f3f3c247ddee79ae1d37eddfdcbbaa

COPY --from=gitleaks /usr/bin/gitleaks /usr/local/bin/gitleaks
COPY --from=osv /osv-scanner /usr/local/bin/osv-scanner
ADD --checksum=sha256:fab7e52aef841fd2b671d2d960ce3c9771cb83e4cdebb288a515877528ff8aa6 \
  "https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip?generation=1788068061863880" \
  /opt/buildit/osv-db/osv-scanner/npm/all.zip

ENV OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=/opt/buildit/osv-db

RUN corepack enable \
  && test "$(gitleaks version)" = "v8.28.0" \
  && osv-scanner --version 2>&1 | grep -F "2.2.3"

LABEL dev.buildit.runner="node24-scanners-v2" \
  dev.buildit.gitleaks="8.28.0" \
  dev.buildit.osv-scanner="2.2.3" \
  dev.buildit.osv-npm-database-sha256="fab7e52aef841fd2b671d2d960ce3c9771cb83e4cdebb288a515877528ff8aa6" \
  dev.buildit.osv-npm-database-generation="1788068061863880" \
  dev.buildit.osv-npm-database-retrieved="2026-08-30T05:34:21Z"
