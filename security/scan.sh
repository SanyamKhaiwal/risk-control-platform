#!/usr/bin/env bash
# Automated security scans; results in security/reports/ (git-ignored). Needs Docker and the images built
# (docker compose build). Run from anywhere:  bash security/scan.sh
#   Trivy     known vulnerabilities in dependencies (Maven, npm) and in the four images; Dockerfile misconfigurations
#   gitleaks  secrets committed by mistake (.gitleaks.toml lists the allowed test keys)
#   npm audit the dashboard's npm packages
set -u
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: don't rewrite container paths
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/security/reports"
mkdir -p "$OUT"
TRIVY="aquasec/trivy:0.69.3"
docker volume create trivy-cache >/dev/null

echo "== Trivy: repository (dependencies, Dockerfiles)"
docker run --rm -v trivy-cache:/root/.cache -v "$ROOT:/src:ro" "$TRIVY" fs -q \
  --scanners vuln,misconfig --skip-dirs /src/dashboard/node_modules --skip-dirs /src/deploy/keys \
  --format table /src | tee "$OUT/trivy-repo.txt"

for image in gateway risk-service control-service dashboard; do
  echo "== Trivy: image $image"
  docker run --rm -v trivy-cache:/root/.cache -v /var/run/docker.sock:/var/run/docker.sock "$TRIVY" image -q \
    --scanners vuln --severity MEDIUM,HIGH,CRITICAL --format table "risk-control-platform/$image:local" \
    | tee "$OUT/trivy-$image.txt"
done

echo "== gitleaks"
docker run --rm -v "$ROOT:/src:ro" zricethezav/gitleaks:v8.28.0 dir /src --config /src/.gitleaks.toml --no-banner --redact \
  2>&1 | tee "$OUT/gitleaks.txt"

echo "== npm audit"
(cd "$ROOT/dashboard" && npm audit) | tee "$OUT/npm-audit.txt"
