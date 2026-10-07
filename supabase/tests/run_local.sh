#!/usr/bin/env bash
# Fresh-database test of the Supabase SQL on a THROWAWAY local container only.
# Never touches Supabase Cloud: no CLI, no remote URL, cloud env vars are cleared.
#
#   bash supabase/tests/run_local.sh            # build + all tests
#   BASELINE=path/to/file.sql bash supabase/tests/run_local.sh
#
# Builds:  auth-only/01_auth_profiles.sql → baseline/00_baseline.sql → seed/products_43.sql
# Tests:   every supabase/tests/sql/*.sql in name order, results in table t.results.
set -euo pipefail
unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF DATABASE_URL SUPABASE_DB_URL || true

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="pos-baseline-db"            # throwaway; never the rental-pos stack
PORT="127.0.0.1:54432"
IMAGE="public.ecr.aws/supabase/postgres:17.6.1.155"
BASELINE="${BASELINE:-$ROOT/supabase/baseline/00_baseline.sql}"

P() { MSYS_NO_PATHCONV=1 docker exec -i "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p "$PORT:5432" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  P -c "select 1 from pg_roles where rolname = 'authenticated'" 2>/dev/null | grep -q 1 && break
  sleep 2
done
sleep 3

echo "== build"
P --single-transaction < "$ROOT/supabase/auth-only/01_auth_profiles.sql"
P --single-transaction < "$BASELINE" 2>&1 | grep -v 'already exists, skipping' || true
P -c "select 'tables=' || (select count(*) from pg_tables where schemaname = 'public')
          || ' functions=' || (select count(*) from pg_proc where pronamespace = 'public'::regnamespace)"

echo "== plpgsql_check (errors / warnings)"
P -c "create extension if not exists plpgsql_check" >/dev/null
P -F ' | ' -c "select p.proname, r.lineno, r.level, r.message
  from pg_proc p join pg_language l on l.oid = p.prolang
  cross join lateral plpgsql_check_function_tb(p.oid,
        coalesce((select t.tgrelid from pg_trigger t where t.tgfoid = p.oid limit 1), 0)) r
 where p.pronamespace = 'public'::regnamespace and l.lanname = 'plpgsql' and r.level in ('error', 'warning')
 order by 1, 2;"
P -c "drop extension plpgsql_check" >/dev/null

echo "== tests"
# 00_* creates the owner, then the real product seed loads, then the rule tests run.
for f in "$ROOT"/supabase/tests/sql/00_*.sql; do P < "$f" >/dev/null; done
P < "$ROOT/supabase/seed/products_43.sql" >/dev/null
for f in "$ROOT"/supabase/tests/sql/*.sql; do
  case "$(basename "$f")" in 00_*) continue ;; esac
  P < "$f" >/dev/null
done
P -F ' | ' -c "select grp, count(*) filter (where pass), count(*) filter (where not pass) from t.results group by grp order by min(seq);"
echo "== failures"
P -F ' | ' -c "select seq, grp, name, detail from t.results where not pass order by seq;"
P -c "select 'TOTAL pass=' || count(*) filter (where pass) || ' fail=' || count(*) filter (where not pass) from t.results;"
