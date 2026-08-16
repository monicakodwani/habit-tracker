#!/usr/bin/env bash
#
# Spin up a complete local copy of the app for testing: a local Supabase stack, three
# demo accounts, a group, and a few weeks of history.
#
#   npm run dev:local     then     npm run dev
#
# Nothing here can reach your real Supabase project — the script refuses to run unless
# the API it is talking to is on localhost (see the guard below). It is safe to re-run.
#
# Requires Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEMO_PASSWORD="password123"
GROUP_NAME="Us"          # must match group_name in supabase/bootstrap.sql
ACCOUNTS=(
  "monica@example.com|Monica|🌻"
  "ura@example.com|Ura|🦆"
  "ojas@example.com|Ojas|🪿"
)

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and try again." >&2
  exit 1
fi

echo "==> Starting local Supabase (first run pulls images, this can take a few minutes)"
npx -y supabase@latest start >/dev/null

STATUS_JSON="$(npx -y supabase@latest status -o json)"
read_key() { printf '%s' "$STATUS_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['$1'])"; }

API_URL="$(read_key API_URL)"
ANON_KEY="$(read_key ANON_KEY)"
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)"

# ---------------------------------------------------------------------------
# Safety guard. This script creates accounts with a well-known password, so it must
# never be pointed at a real project. Bail out unless the API is clearly local.
# ---------------------------------------------------------------------------
case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "Refusing to run: expected a local Supabase API, got '$API_URL'." >&2
    exit 1
    ;;
esac

echo "==> Writing .env  (points the app at local Supabase; .env is gitignored)"
cat > .env <<EOF
# Written by scripts/dev-local.sh — local Supabase only, not your real project.
VITE_SUPABASE_URL=$API_URL
VITE_SUPABASE_ANON_KEY=$ANON_KEY
EOF

echo "==> Creating demo accounts"
for entry in "${ACCOUNTS[@]}"; do
  IFS='|' read -r email name emoji <<<"$entry"
  response="$(curl -s -X POST "$API_URL/auth/v1/signup" \
    -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$DEMO_PASSWORD\",\"data\":{\"display_name\":\"$name\",\"avatar_emoji\":\"$emoji\",\"timezone\":\"America/New_York\"}}")"

  if printf '%s' "$response" | grep -q '"access_token"'; then
    echo "    created  $email"
  elif printf '%s' "$response" | grep -qi 'already registered\|already been registered'; then
    echo "    exists   $email"
  else
    echo "    WARNING  $email -> $(printf '%s' "$response" | head -c 160)"
  fi
done

run_sql_file() {
  docker cp "$1" "$DB_CONTAINER:/tmp/$(basename "$1")" >/dev/null
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
    -f "/tmp/$(basename "$1")" 2>&1 | grep -E 'NOTICE|ERROR' | sed 's/^psql:[^ ]* //' || true
}

echo "==> Creating the group (supabase/bootstrap.sql)"
run_sql_file supabase/bootstrap.sql | sed 's/^NOTICE:  /    /'

echo "==> Seeding habits and history (supabase/seed.sql)"
run_sql_file supabase/seed.sql | sed 's/^NOTICE:  /    /' | tail -5

# A private habit for the first account, so the privacy boundary is visible while
# testing: sign in as Ura and confirm it is nowhere to be seen.
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -q -c "
insert into public.habits (owner_id, group_id, name, emoji, recurrence_type, scheduled_days, visibility)
select u.id, g.id, 'Therapy', '🛋️', 'scheduled_days', '{1,2,3,4,5,6,7}', 'private'
from auth.users u, public.groups g
where u.email = '${ACCOUNTS[0]%%|*}'
  and g.name = '$GROUP_NAME'
  and not exists (
    select 1 from public.habits h where h.owner_id = u.id and h.name = 'Therapy'
  );" >/dev/null

cat <<EOF

────────────────────────────────────────────────────────────
  Ready. Now run:

      npm run dev

  Sign in with any of these (password: $DEMO_PASSWORD):

      monica@example.com    — has a PRIVATE habit, "Therapy"
      ura@example.com     — cannot see it, by database policy
      ojas@example.com

  Supabase Studio:  http://127.0.0.1:54323
  Inbox (emails):   http://127.0.0.1:54324

  When you're done:

      npx supabase stop

────────────────────────────────────────────────────────────
EOF
