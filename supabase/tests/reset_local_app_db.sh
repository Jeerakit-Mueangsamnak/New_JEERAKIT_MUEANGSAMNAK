#!/usr/bin/env bash
# Rebuild the database of the LOCAL Supabase stack (rental-pos, started with `supabase start`)
# so the app can be tried for real on this PC. Never touches Supabase Cloud.
#
#   bash supabase/tests/reset_local_app_db.sh
#
# Wipes:  schema public, every auth user, old policies on storage.objects, migration history.
# Builds: auth-only/01_auth_profiles.sql → baseline/00_baseline.sql → migrations/*.sql
#         → owner account (via local Auth API) → seed/products_43.sql
# `supabase db reset` cannot do this: the migrations folder starts after the baseline.
set -euo pipefail
unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF DATABASE_URL SUPABASE_DB_URL || true

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="supabase_db_rental-pos"
API="http://127.0.0.1:54321"
# Supabase CLI local default key (see `supabase status`); valid only on this machine.
SECRET="sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz"
OWNER_USERNAME="${OWNER_USERNAME:-owner}"
OWNER_EMAIL="${OWNER_EMAIL:-owner@example.com}"
OWNER_PASSWORD="${OWNER_PASSWORD:-Owner1234!}"

P() { MSYS_NO_PATHCONV=1 docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

# Docker must be this machine's engine, and the container must belong to the local CLI stack.
HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
case "$HOST" in npipe://*|unix://*) ;; *) echo "STOP: docker context is not local ($HOST)"; exit 1 ;; esac
PROJECT="$(docker container inspect -f '{{index .Config.Labels "com.supabase.cli.project"}}' "$DB" 2>/dev/null || true)"
if [ "$PROJECT" != "rental-pos" ]; then
  echo "STOP: $DB is not the running local stack of project rental-pos. Run 'supabase start' first."
  exit 1
fi

echo "== wipe"
P --single-transaction <<'SQL'
DROP SCHEMA public CASCADE;
DROP SCHEMA IF EXISTS private CASCADE;   -- left by the old 001-034 migrations
CREATE SCHEMA public AUTHORIZATION pg_database_owner;
-- Same grants as a new Supabase project; the baseline then revokes what it does not want.
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
DELETE FROM auth.users;                  -- identities, sessions, refresh tokens follow (cascade)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT polname FROM pg_policy WHERE polrelid = 'storage.objects'::regclass LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.polname);
  END LOOP;
END $$;
TRUNCATE supabase_migrations.schema_migrations;
SQL

echo "== build"
P --single-transaction < "$ROOT/supabase/auth-only/01_auth_profiles.sql"
P --single-transaction < "$ROOT/supabase/baseline/00_baseline.sql" 2>&1 | grep -v 'already exists, skipping' || true
P -c "select 1 from pg_proc where proname = 'bootstrap_owner'" | grep -q 1 || { echo "STOP: baseline did not apply"; exit 1; }
# Already folded into baseline/00_baseline.sql (2026-10-16): recorded as applied, not run again.
IN_BASELINE=" 20261016125110 20261016134524 "
for m in "$ROOT"/supabase/migrations/*.sql; do
  [ -e "$m" ] || continue
  f="$(basename "$m" .sql)"
  if [[ "$IN_BASELINE" == *" ${f%%_*} "* ]]; then
    echo "   migration $f (in baseline, skipped)"
  else
    echo "   migration $f"
    P --single-transaction < "$m"
  fi
  P -c "insert into supabase_migrations.schema_migrations (version, name) values ('${f%%_*}', '${f#*_}')"
done
# The baseline keeps an existing bucket as is; make it match the baseline definition.
P -c "update storage.buckets set public = false, file_size_limit = 5242880,
        allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
      where id = 'customer-documents'"

echo "== owner account ($OWNER_USERNAME / $OWNER_EMAIL)"
curl -sS -f -X POST "$API/auth/v1/admin/users" \
  -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\",\"email_confirm\":true,
       \"user_metadata\":{\"username\":\"$OWNER_USERNAME\",\"display_name\":\"เจ้าของร้าน (ทดสอบ)\"}}" >/dev/null
P -c "select public.bootstrap_owner('$OWNER_USERNAME')" >/dev/null

echo "== products"
P < "$ROOT/supabase/seed/products_43.sql" >/dev/null

P -c "select 'tables=' || (select count(*) from pg_tables where schemaname = 'public')
          || ' functions=' || (select count(*) from pg_proc where pronamespace = 'public'::regnamespace)
          || ' products=' || (select count(*) from public.products)
          || ' owner=' || (select username || '/' || status from public.profiles where role = 'OWNER')"
echo "RESULT: READY — log in at the app with username '$OWNER_USERNAME', password '$OWNER_PASSWORD'"
