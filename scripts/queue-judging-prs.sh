#!/usr/bin/env bash
# Opens N fresh pull requests on the fixture repository and asks BuildIT to review each one.
#
# Why fresh rather than re-running the existing ones: real-output overflow counts tasks completed
# during judging, and a review is keyed to a pull request at an exact commit. Re-triggering a
# review that already ran at the same head SHA is deduplicated by design, so judging needs new
# commits. This opens them in about fifteen seconds.
#
# Before running, confirm the organization's concurrency limit is at least N, or the reviews after
# the first will be materialised as blocked rather than run:
#   pnpm exec convex run --prod organizations:setCapacityLimits \
#     '{"organizationId":"<org>","concurrencyLimit":6,"actorId":"operator","requestId":"capacity-<date>-0001","now":<epoch-ms>}'
set -euo pipefail

REPO="${BUILDIT_FIXTURE_REPO:-tanmayiift/buildit-public-fixture}"
BUDGET="${BUILDIT_REVIEW_BUDGET:-2}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

gh repo clone "$REPO" "$WORK/repo" -- --depth 1 --quiet
cd "$WORK/repo"

# Each case is a change a developer would plausibly write, carrying one real defect: a
# floating-point boundary, an unbounded loop, an unvalidated environment value, an off-by-one
# against a stated policy, and a log line that prints credentials.
open_pr() {
  local slug="$1" path="$2" title="$3" body="$4"
  git checkout -q main
  git checkout -q -b "judging-${STAMP}-${slug}"
  mkdir -p "$(dirname "$path")"
  cat > "$path"
  git add -A
  git commit -q -m "$title"
  git push -q -u origin "judging-${STAMP}-${slug}"
  local url
  url="$(gh pr create --repo "$REPO" --base main --head "judging-${STAMP}-${slug}" --title "$title" --body "$body")"
  echo "$url"
  gh pr comment "$url" --body "@buildit review budget=${BUDGET}" > /dev/null
}

open_pr rounding src/currency.js "Round money to paise before display" \
  "Tax figures were rendering with long floating tails. Rounds at the display boundary." <<'JS'
export function toPaise(amount) {
  return Math.round(amount * 100) / 100;
}
export function formatINR(amount) {
  return `₹${toPaise(amount).toFixed(2)}`;
}
JS

open_pr retry src/retry.js "Retry the rates fetch on a transient failure" \
  "The rates service occasionally returns a 503, which fails the whole calculation." <<'JS'
export async function retry(operation, delayMs = 200) {
  while (true) {
    try {
      return await operation();
    } catch {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
JS

open_pr config src/config.js "Read the rates endpoint from the environment" \
  "Hardcoding the rates host made staging impossible to test against." <<'JS'
export function ratesUrl(path) {
  const host = process.env.RATES_HOST;
  return `https://${host}/${path}`;
}
JS

open_pr rebate src/discount.js "Apply the senior rebate at the qualifying age" \
  "Policy is a rebate from age 60. This applies it in the tax path." <<'JS'
// Policy: the qualifying age is 60 and over.
export function seniorRebate(age, tax) {
  if (age > 60) return tax * 0.9;
  return tax;
}
JS

open_pr audit src/audit.js "Log rates requests for support triage" \
  "Support could not reconstruct which rates call a customer hit." <<'JS'
export function logRatesRequest(request) {
  console.log("rates request", JSON.stringify({
    url: request.url,
    method: request.method,
    headers: request.headers,
  }));
}
JS

echo
echo "Five reviews queued. Watch them land:"
echo "  gh pr list --repo ${REPO} --state open --limit 5"
