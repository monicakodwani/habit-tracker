#!/usr/bin/env bash
#
# Runs the RLS test suite against a throwaway Postgres container.
#
#   ./scripts/test-rls.sh     (or: npm run test:rls)
#
# Requires Docker. Nothing here touches your real Supabase project — it applies a
# small shim that fakes Supabase's auth schema and roles, then runs the real
# migration and asserts against it.
set -euo pipefail

CONTAINER=habit-tracker-rls-test
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and try again." >&2
  exit 1
fi

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "Starting Postgres..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=habits postgres:16 >/dev/null

for _ in $(seq 1 40); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

run_sql() {
  docker cp "$1" "$CONTAINER:/tmp/$(basename "$1")" >/dev/null
  docker exec "$CONTAINER" psql -U postgres -d habits -q -v ON_ERROR_STOP=1 \
    -f "/tmp/$(basename "$1")"
}

echo "Applying Supabase shim..."
run_sql "$ROOT/supabase/tests/00_supabase_shim.sql" >/dev/null

echo "Applying migration..."
for migration in "$ROOT"/supabase/migrations/*.sql; do
  run_sql "$migration" >/dev/null
done

echo "Running RLS assertions..."
# psql writes RAISE NOTICE to stderr; fold it into stdout so results are visible.
run_sql "$ROOT/supabase/tests/01_rls_test.sql" 2>&1 | sed 's/^psql:[^ ]* //'
