#!/usr/bin/env bash
# OWASP ZAP against a running stack; HTML and JSON reports in security/reports/ (git-ignored).
#   Baseline (passive): the dashboard and the Gateway.
#   API scan (active attacks on every endpoint in the OpenAPI docs): the Risk and Control services, called on the
#   Docker network so the Gateway's per-user rate limit doesn't turn most attempts into 429s.
#
#   bash security/zap.sh
#       The normal stack, as the viewer Dave: attacks reach every endpoint without creating junk data.
#   NETWORK=rcp-isolated_default USERS="alice bob carol" bash security/zap.sh
#       The throwaway copy (security/compose.isolated.yaml), once per user who can write, so the attacks also reach
#       the input handling of every create and update endpoint. Creates lots of junk data in that copy.
set -u
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/security/reports"
mkdir -p "$OUT"
NETWORK="${NETWORK:-risk-control-platform_default}"
USERS="${USERS:-dave}"
ZAP=ghcr.io/zaproxy/zaproxy:2.16.1
NODE=node:22.23.4-alpine3.24
SUFFIX=$([ "$NETWORK" = "risk-control-platform_default" ] && echo "" || echo "-isolated")

zap() { docker run --rm --network "$NETWORK" -v "$OUT:/zap/wrk:rw" -u root "$ZAP" "$@"; }
token() {
  docker run --rm --network "$NETWORK" "$NODE" node -e "
    fetch('http://gateway:8080/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '$1', password: 'demo123' }) }).then((r) => r.json()).then((j) => console.log(j.accessToken))"
}
auth() {
  echo "-config replacer.full_list(0).description=auth -config replacer.full_list(0).enabled=true \
-config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Authorization \
-config replacer.full_list(0).regex=false -config replacer.full_list(0).replacement=Bearer\ $1"
}

echo "== ZAP baseline: dashboard"
zap zap-baseline.py -t http://dashboard:8080 -r "zap-dashboard$SUFFIX.html" -J "zap-dashboard$SUFFIX.json" -I
echo "== ZAP baseline: gateway"
zap zap-baseline.py -t http://gateway:8080/api/risks -r "zap-gateway$SUFFIX.html" -J "zap-gateway$SUFFIX.json" -I
for user in $USERS; do
  AUTH=$(auth "$(token "$user")")
  echo "== ZAP API scan: risk-service as $user"
  zap zap-api-scan.py -t http://risk-service:8081/v3/api-docs -f openapi -I -z "$AUTH" \
    -r "zap-risk-api-$user$SUFFIX.html" -J "zap-risk-api-$user$SUFFIX.json"
  echo "== ZAP API scan: control-service as $user"
  zap zap-api-scan.py -t http://control-service:8082/v3/api-docs -f openapi -I -z "$AUTH" \
    -r "zap-control-api-$user$SUFFIX.html" -J "zap-control-api-$user$SUFFIX.json"
done
