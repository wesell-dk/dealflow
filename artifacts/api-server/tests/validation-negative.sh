#!/usr/bin/env bash
# Lightweight negative validation tests — one per domain.
# Runs against the API under $API_BASE (default: https://$REPLIT_DEV_DOMAIN).
# Asserts each bad request returns HTTP 422 with {error:"validation", issues:[...]}.
set -euo pipefail

BASE="${API_BASE:-https://$REPLIT_DEV_DOMAIN}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

LOGIN_EMAIL="${LOGIN_EMAIL:-priya@helix.com}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-dealflow}"

log() { printf '%s\n' "$*" >&2; }
pass=0; fail=0

assert_422() {
  local name="$1" method="$2" path="$3" body="$4"
  local out code
  out=$(curl -s -o /tmp/resp.json -w "%{http_code}" -b "$JAR" \
    -X "$method" -H 'content-type: application/json' \
    -d "$body" "$BASE$path") || true
  code="$out"
  if [[ "$code" == "422" ]] && grep -q '"error":"validation"' /tmp/resp.json && grep -q '"issues"' /tmp/resp.json; then
    log "PASS  $name  ($method $path -> $code)"
    pass=$((pass+1))
  else
    log "FAIL  $name  ($method $path -> $code)"
    cat /tmp/resp.json >&2; echo >&2
    fail=$((fail+1))
  fi
}

# Login once
curl -s -c "$JAR" -X POST -H 'content-type: application/json' \
  -d "{\"email\":\"$LOGIN_EMAIL\",\"password\":\"$LOGIN_PASSWORD\"}" \
  "$BASE/api/auth/login" >/dev/null

# Accounts
assert_422 "accounts.create.missing-name" POST "/api/accounts" '{}'
# Deals
assert_422 "deals.create.wrong-types"     POST "/api/deals"    '{"name":"x","value":"nan"}'
# Quotes
assert_422 "quotes.create.missing-fields" POST "/api/quotes"   '{}'
# Approvals
assert_422 "approvals.decide.bad-body"    POST "/api/approvals/a_1/decide" '{}'
# Contracts
assert_422 "contracts.create.missing"     POST "/api/contracts" '{}'
# Amendments
assert_422 "amendments.create.missing"    POST "/api/contracts/c_1/amendments" '{}'
# Negotiations (counterproposal requires fields)
assert_422 "negotiations.counter.missing" POST "/api/negotiations/n_1/counterproposal" '{}'
# Signatures (send-reminder requires body fields)
assert_422 "signatures.escalate.missing"  POST "/api/signatures/s_1/escalate" '{}'
# Orders (handover requires body)
assert_422 "orders.handover.missing"      POST "/api/order-confirmations/oc_1/handover" '{}'
# Copilot
assert_422 "copilot.message.missing"      POST "/api/copilot/threads/t_1/messages" '{}'
# GDPR
assert_422 "gdpr.forget.missing"          POST "/api/gdpr/forget"   '{}'
# Admin roles
assert_422 "admin.roles.missing-name"     POST "/api/admin/roles"   '{"description":"x"}'
# Audit manual
assert_422 "audit.manual.missing-fields"  POST "/api/audit/manual"  '{}'

log ""
log "Result: $pass passed, $fail failed."
[[ "$fail" == "0" ]]
