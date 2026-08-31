#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require_contains() {
  local file="$1"
  local expected="$2"
  if ! grep -Fq "$expected" "$ROOT_DIR/$file"; then
    echo "Missing expected text in $file: $expected" >&2
    return 1
  fi
}

reject_contains() {
  local file="$1"
  local rejected="$2"
  if grep -Fq "$rejected" "$ROOT_DIR/$file"; then
    echo "Found rejected text in $file: $rejected" >&2
    return 1
  fi
}

[[ -x "$ROOT_DIR/deploy.sh" ]] || {
  echo "deploy.sh is missing or not executable" >&2
  exit 1
}

dry_run_output="$("$ROOT_DIR/deploy.sh" test-contract --dry-run)"

grep -Fq "npm run build" <<<"$dry_run_output"
grep -Fq "mvn clean package" <<<"$dry_run_output"
grep -Fq "docker build" <<<"$dry_run_output"
grep -Fq "registry-stg.vestack.sbuxcf.net" <<<"$dry_run_output"

require_contains "backend/pom.xml" "<id>frontend-static</id>"
require_contains "backend/pom.xml" "maven-resources-plugin"
require_contains "Dockerfile" 'FROM ${RUNTIME_IMAGE}'
require_contains "Dockerfile" 'COPY --chown=185:0 ${JAR_FILE} app.jar'
require_contains "Dockerfile" "USER 185"
require_contains "Dockerfile" 'registry-stg.vestack.sbuxcf.net/yunxiao-paas/openjdk:21-ea-23-jdk-bullseye-1'
require_contains "deploy.sh" 'IMAGE_PLATFORM="${IMAGE_PLATFORM:-linux/amd64}"'
require_contains "k8s/overlays/internal-example/kustomization.yaml" "registry-stg.vestack.sbuxcf.net/agent-develop-lifecycle-management/orchestapi"
require_contains "docker-compose.yml" "ORCHESTAPI_IMAGE"
require_contains ".dockerignore" "!backend/target/orchestapi-*.jar"
reject_contains "Dockerfile" "FROM node:"
reject_contains "Dockerfile" "FROM maven:"

echo "Local frontend + Maven JAR deployment contract is present."
