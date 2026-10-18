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

LABEL="pos.test-kit=run_local"   # marks the container as this script's own

# Docker must be this machine's engine, never a remote one.
HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
case "$HOST" in npipe://*|unix://*) ;; *) echo "STOP: docker context is not local ($HOST)"; exit 1 ;; esac

# Remove an old container only when it carries this kit's label. Image or port alone is not
# proof: anything else with the same name is left alone and the run stops.
if docker container inspect "$NAME" >/dev/null 2>&1; then
  OWN_LABEL="$(docker container inspect -f '{{index .Config.Labels "pos.test-kit"}}' "$NAME")"
  if [ "$OWN_LABEL" = "run_local" ]; then
    docker rm -f -v "$NAME" >/dev/null   # -v: only its own anonymous data volume, never named ones
  else
    echo "STOP: a container named $NAME exists without label $LABEL. Not removed; remove or rename it yourself."
    exit 1
  fi
fi
# Kept after the run for inspection; its data lives only in its own anonymous volume.
docker run -d --name "$NAME" --label "$LABEL" -e POSTGRES_PASSWORD=postgres -p "$PORT:5432" "$IMAGE" >/dev/null
# The image runs its init scripts on a temporary server, then restarts: wait for 3 good answers in a row.
ok=0
for _ in $(seq 1 90); do
  if P -c "select 1 from pg_roles where rolname = 'authenticated'" 2>/dev/null | grep -q 1; then
    ok=$((ok + 1)); [ "$ok" -ge 3 ] && break
  else
    ok=0
  fi
  sleep 2
done

echo "== build"
P --single-transaction < "$ROOT/supabase/auth-only/01_auth_profiles.sql"
P --single-transaction < "$BASELINE" 2>&1 | grep -v 'already exists, skipping' || true
# Local migrations made after the baseline, in name order (never applied to Cloud from here).
for m in "$ROOT"/supabase/migrations/*.sql; do
  [ -e "$m" ] || continue
  echo "   migration $(basename "$m")"
  P --single-transaction < "$m"
done
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
  case "$(basename "$f")" in 00_*|9*_*) continue ;; esac   # 9*_ = checks that run after the races
  P < "$f" >/dev/null
done
echo "== concurrent document numbers (2 connections x 50)"
P -c "select t.set('conc_before', coalesce((select last_no from public.document_sequences where doc_type = 'INVENTORY_COUNT' and period_key = '20311231'), 0)::text)" >/dev/null
for _ in 1 2; do
  ( for _ in $(seq 1 50); do echo "select public._next_document_no_at('INVENTORY_COUNT', '2031-12-31 12:00+07');"; done | P >/dev/null ) &
done
wait
P -c "select t.check('S10-NO', 'two connections at once: 100 numbers, all different, no gap',
        (select last_no - t.v('conc_before')::bigint = 100 from public.document_sequences
          where doc_type = 'INVENTORY_COUNT' and period_key = '20311231'))" >/dev/null
echo "== money / stock races (2 connections at once, released together by an advisory-lock barrier)"
# race TAG SQL_A SQL_B: a holder takes lock 4242; both workers queue on it and start the moment it is
# released, so their calls really overlap. Each attempt is logged by t.try into t.conc.
# The holder releases only once BOTH workers are queued on the lock (not after a fixed sleep: a slow
# `docker exec` start on Windows could reach the barrier after it opened). Gives up after 30 s.
race() {
  P -c "select pg_advisory_lock(4242)" -c "do \$\$ begin
      for i in 1..600 loop
        exit when (select count(*) from pg_locks where locktype = 'advisory' and objid = 4242 and not granted) >= 2;
        perform pg_sleep(0.05);
      end loop;
    end \$\$" -c "select pg_advisory_unlock(4242)" >/dev/null &
  until [ "$(P -c "select count(*) from pg_locks where locktype = 'advisory' and objid = 4242 and granted")" = "1" ]; do sleep 0.1; done
  for s in "$2" "$3"; do
    ( P -c "select pg_advisory_lock_shared(4242)" -c "select pg_advisory_unlock_shared(4242)" -c "$s" >/dev/null ) &
  done
  wait
}
TEN="'[{\"method\":\"CASH\",\"amount\":10}]'::jsonb"
race K1   "select t.try('K1', 'a', 'cashier', format(\$q\$select public.bill_confirm(%L::uuid, 'key-race-k1-same', $TEN)\$q\$, t.v('dK1')))"   "select t.try('K1', 'b', 'cashier', format(\$q\$select public.bill_confirm(%L::uuid, 'key-race-k1-same', $TEN)\$q\$, t.v('dK1')))"
race K2   "select t.try('K2', 'a', 'cashier', format(\$q\$select public.bill_confirm(%L::uuid, 'key-race-k2-a', $TEN)\$q\$, t.v('dK2')))"   "select t.try('K2', 'b', 'cashier', format(\$q\$select public.bill_confirm(%L::uuid, 'key-race-k2-b', $TEN)\$q\$, t.v('dK2')))"
race K3   "select t.try('K3', 'a', 'cashier', format(\$q\$select public.payment_receive(%L::uuid, $TEN, 'key-race-k3-a')\$q\$, t.v('dK3')))"   "select t.try('K3', 'b', 'cashier', format(\$q\$select public.payment_receive(%L::uuid, $TEN, 'key-race-k3-b')\$q\$, t.v('dK3')))"
# PIN tokens first (one PIN row per user serializes verify_pin; the race is on the refund itself).
P -c "select t.set('tok_k5a', t.pin('cashier', 'REFUND')), t.set('tok_k5b', t.pin('cashier', 'REFUND'))" >/dev/null
race K5   "select t.try('K5', 'a', 'cashier', format(\$q\$select public.refund_pay(%L::uuid, 10, 'CASH', 'race', 'key-race-k5-a', %L::uuid, %L::uuid)\$q\$, t.v('dK5'), t.v('tok_k5a'), t.v('pK5')))"   "select t.try('K5', 'b', 'cashier', format(\$q\$select public.refund_pay(%L::uuid, 10, 'CASH', 'race', 'key-race-k5-b', %L::uuid, %L::uuid)\$q\$, t.v('dK5'), t.v('tok_k5b'), t.v('pK5')))"
race LAST   "select t.try('LAST', 'a', 'cashier', format(\$q\$select public.bill_confirm(%L::uuid, 'key-race-last-a')\$q\$, t.v('dL1')))"   "select t.try('LAST', 'b', 'cashier', format(\$q\$select public.bill_confirm(%L::uuid, 'key-race-last-b')\$q\$, t.v('dL2')))"
for f in "$ROOT"/supabase/tests/sql/9*_*.sql; do
  [ -e "$f" ] || continue
  P < "$f" >/dev/null
done
P -F ' | ' -c "select grp, count(*) filter (where pass), count(*) filter (where not pass) from t.results group by grp order by min(seq);"
echo "== failures"
P -F ' | ' -c "select seq, grp, name, detail from t.results where not pass order by seq;"
P -c "select 'TOTAL pass=' || count(*) filter (where pass) || ' fail=' || count(*) filter (where not pass) from t.results;"
# Non-zero exit when any check failed, or when no check ran at all.
if [ "$(P -c "select count(*) = 0 or bool_or(not pass) from t.results")" != "f" ]; then
  echo "RESULT: FAIL"; exit 1
fi
echo "RESULT: PASS"
