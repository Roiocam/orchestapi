#!/usr/bin/env bash
# Run the pagination API regression against an isolated PostgreSQL database and real Flyway migrations.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_id="$(docker run -d -e POSTGRES_PASSWORD=cursor-test-only -e POSTGRES_DB=cursor_pagination \
  -p 127.0.0.1::5432 postgres:16-alpine)"
trap 'docker rm -f "$container_id" >/dev/null' EXIT
ready=false
for ((attempt = 0; attempt < 30; attempt++)); do
  if docker exec "$container_id" pg_isready -U postgres -d cursor_pagination >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  printf '%s\n' 'PostgreSQL did not become ready within 30 seconds' >&2
  exit 1
fi
port="$(docker port "$container_id" 5432/tcp)"
export CURSOR_TEST_JDBC_URL="jdbc:postgresql://127.0.0.1:${port##*:}/cursor_pagination"
export CURSOR_TEST_JDBC_DRIVER=org.postgresql.Driver
export CURSOR_TEST_DB_USER=postgres
export CURSOR_TEST_DB_PASSWORD=cursor-test-only
export CURSOR_TEST_DIALECT=org.hibernate.dialect.PostgreSQLDialect
export CURSOR_TEST_DDL=validate
export CURSOR_TEST_FLYWAY=true
cd "$repo_root/backend"
bash ./mvnw -Dtest=CursorPaginationApiIntegrationTest test
