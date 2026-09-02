#!/usr/bin/env bash
# Applies the IST notification template and points the operator contact point at it.
#
# Grafana Cloud does not read observability/grafana/provisioning/*.yml — that file is the source of
# truth in this repository, not a thing Grafana polls. Until this runs, alert emails keep arriving
# in the stock UTC layout, so an operator reads the wrong time during an incident.
#
# Run it yourself. It reads the token from the environment and never takes it as an argument, so
# the value stays out of your shell history and out of the process list:
#
#   read -rs GRAFANA_TOKEN && export GRAFANA_TOKEN
#   bash scripts/apply-grafana-ist-template.sh
#
# The token needs a service account with the "Alerting Notifications Writer" role. Create one at
#   https://peacefulbumblebee2324.grafana.net/org/serviceaccounts
set -euo pipefail

STACK="${GRAFANA_STACK:-peacefulbumblebee2324.grafana.net}"
: "${GRAFANA_TOKEN:?Set GRAFANA_TOKEN first: read -rs GRAFANA_TOKEN && export GRAFANA_TOKEN}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_FILE="$ROOT/observability/grafana/notification-templates/buildit-operator-v1.tmpl"
[ -f "$TEMPLATE_FILE" ] || { echo "template not found: $TEMPLATE_FILE" >&2; exit 1; }

api() {
  local method="$1" path="$2"
  shift 2
  curl -sS -X "$method" "https://${STACK}${path}" \
    -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "X-Disable-Provenance: true" \
    "$@"
}

echo "Applying notification template to ${STACK}…"
# jq builds the JSON so the template's newlines and braces survive intact.
jq -Rs --arg name "buildit-operator-v1" '{name: $name, template: .}' < "$TEMPLATE_FILE" \
  | api PUT "/api/v1/provisioning/templates/buildit-operator-v1" --data-binary @- \
  | jq -r 'if .name then "  template \(.name) applied" else "  unexpected response: \(.)" end'

echo
echo "Contact points currently defined:"
api GET "/api/v1/provisioning/contact-points" \
  | jq -r '.[] | "  \(.uid)\t\(.name)\t\(.type)"'

cat <<'NEXT'

Template applied. One manual step remains, because it depends on which contact point you use:
set that contact point's subject and message to the template, then send a test notification.

  Alerting → Contact points → (your operator email) → Optional Email settings
    Subject:  {{ template "buildit.operator.subject.v1" . }}
    Message:  {{ template "buildit.operator.body.v1" . }}

The template renders 06:38:44 UTC as "01 Sep 2026, 12:08:44 IST". If a test alert still shows UTC,
the contact point is not using the template yet.
NEXT
