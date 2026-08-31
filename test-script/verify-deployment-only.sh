#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY_DIR="$ROOT_DIR/k8s/overlays/internal-example"

command -v kubectl >/dev/null 2>&1 || {
  echo "kubectl is required to render the deployment-only overlay" >&2
  exit 1
}

rendered="$(kubectl kustomize "$OVERLAY_DIR")"

deployment_count="$(grep -c '^kind: Deployment$' <<<"$rendered" || true)"
[[ "$deployment_count" == "1" ]] || {
  echo "expected exactly one Deployment, found $deployment_count" >&2
  exit 1
}

for forbidden_kind in ConfigMap Service Ingress NetworkPolicy Secret; do
  if grep -q "^kind: $forbidden_kind$" <<<"$rendered"; then
    echo "deployment-only overlay unexpectedly renders $forbidden_kind" >&2
    exit 1
  fi
done

for required_value in \
  'SPRING_PROFILES_ACTIVE' \
  'SERVER_PORT' \
  'CONTEXT_PATH' \
  'JAVA_OPTS' \
  'name: ORCHESTAPI_OAUTH_ENABLED' \
  'name: ORCHESTAPI_OAUTH_TOKEN_ENDPOINT' \
  'name: ORCHESTAPI_OAUTH_CLIENT_ID' \
  'name: ORCHESTAPI_OAUTH_CLIENT_SECRET' \
  'name: ORCHESTAPI_OAUTH_SCOPES' \
  'name: ORCHESTAPI_OAUTH_AUDIENCE' \
  'name: ORCHESTAPI_OAUTH_CLIENT_AUTH_METHOD' \
  'name: ORCHESTAPI_OAUTH_REFRESH_SKEW_SECONDS' \
  'name: ORCHESTAPI_OAUTH_REQUEST_TIMEOUT_MS' \
  'name: orchestapi-oauth' \
  'key: client-secret' \
  'name: DB_URL' \
  'name: DB_USERNAME' \
  'name: DB_PASSWORD' \
  'name: orchestapi-db' \
  'key: DB_URL' \
  'key: DB_USERNAME' \
  'key: DB_PASSWORD'; do
  grep -Fq "$required_value" <<<"$rendered" || {
    echo "deployment-only overlay is missing: $required_value" >&2
    exit 1
  }
done

if grep -qE 'ORCHESTAPI_OAUTH_CLIENT_SECRET:[[:space:]]*[^[:space:]]|Bearer[[:space:]]+[A-Za-z0-9._~-]{20,}' <<<"$rendered"; then
  echo "deployment contains a literal OAuth credential or bearer token" >&2
  exit 1
fi

if grep -qE 'envFrom:|configMapRef:' <<<"$rendered"; then
  echo "deployment-only overlay must inline non-secret environment variables" >&2
  exit 1
fi

grep -Fq 'newTag: replace-me' "$OVERLAY_DIR/kustomization.yaml"

echo "Deployment-only overlay contract is present."
