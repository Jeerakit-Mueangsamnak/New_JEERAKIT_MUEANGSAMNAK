-- Test harness for the throwaway local database only (supabase/tests/run_local.sh).
-- Not part of any migration. Users here are fake and exist only in the throwaway container.
\set ON_ERROR_STOP 1
CREATE SCHEMA t;
CREATE TABLE t.results (seq serial PRIMARY KEY, grp text, name text, pass boolean, detail text);
CREATE TABLE t.vars (k text PRIMARY KEY, v text);

CREATE FUNCTION t.u(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_name
        WHEN 'owner'     THEN '00000000-0000-0000-0000-0000000000a1'
        WHEN 'cashier'   THEN '00000000-0000-0000-0000-0000000000b1'
        WHEN 'nomenu'    THEN '00000000-0000-0000-0000-0000000000b2'
        WHEN 'finance'   THEN '00000000-0000-0000-0000-0000000000b3'
        WHEN 'pending'   THEN '00000000-0000-0000-0000-0000000000c1'
        WHEN 'suspended' THEN '00000000-0000-0000-0000-0000000000c2'
    END::uuid;
$$;
CREATE FUNCTION t.set(p_k text, p_v text) RETURNS text LANGUAGE sql AS $$
    INSERT INTO t.vars VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v RETURNING v;
$$;
CREATE FUNCTION t.v(p_k text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT v FROM t.vars WHERE k = p_k $$;

-- Run SQL as a client role with a JWT subject, like PostgREST does.
CREATE FUNCTION t.exec_as(p_uid uuid, p_role text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v jsonb;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
    PERFORM set_config('request.jwt.claim.role', p_role, true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    IF p_sql ~* '^\s*select' THEN
        EXECUTE p_sql INTO v;
    ELSE
        EXECUTE p_sql;
    END IF;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
    RETURN v;
END;
$$;

CREATE FUNCTION t.ok(p_grp text, p_name text, p_user text, p_sql text, p_role text DEFAULT 'authenticated')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v jsonb;
BEGIN
    BEGIN
        v := t.exec_as(t.u(p_user), p_role, p_sql);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO t.results (grp, name, pass, detail) VALUES (p_grp, p_name, false, 'UNEXPECTED ERROR: ' || SQLERRM);
        RETURN NULL;
    END;
    INSERT INTO t.results (grp, name, pass, detail) VALUES (p_grp, p_name, true, left(COALESCE(v::text, 'ok'), 160));
    RETURN v;
END;
$$;

CREATE FUNCTION t.err(p_grp text, p_name text, p_user text, p_sql text, p_expect text, p_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        PERFORM t.exec_as(t.u(p_user), p_role, p_sql);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO t.results (grp, name, pass, detail)
        VALUES (p_grp, p_name, SQLERRM ILIKE '%' || p_expect || '%', SQLERRM);
        RETURN;
    END;
    INSERT INTO t.results (grp, name, pass, detail) VALUES (p_grp, p_name, false, 'UNEXPECTED SUCCESS (expected ' || p_expect || ')');
END;
$$;

-- Same as t.err but as postgres (no client role) — for trigger / FK protections.
CREATE FUNCTION t.err_admin(p_grp text, p_name text, p_sql text, p_expect text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO t.results (grp, name, pass, detail)
        VALUES (p_grp, p_name, SQLERRM ILIKE '%' || p_expect || '%', SQLERRM);
        RETURN;
    END;
    INSERT INTO t.results (grp, name, pass, detail) VALUES (p_grp, p_name, false, 'UNEXPECTED SUCCESS (expected ' || p_expect || ')');
END;
$$;

CREATE FUNCTION t.check(p_grp text, p_name text, p_cond boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO t.results (grp, name, pass, detail) VALUES (p_grp, p_name, COALESCE(p_cond, false), p_detail);
$$;

-- A fresh single-use PIN confirmation for one action (every PIN is 123456 in these tests).
CREATE FUNCTION t.pin(p_user text, p_action text) RETURNS text LANGUAGE sql AS $$
    SELECT t.exec_as(t.u(p_user), 'authenticated',
                     format($q$select public.verify_pin('123456', 'ACTION', %L)$q$, p_action)) ->> 'pin_token';
$$;

-- Accounts sign up through auth.users exactly like GoTrue does.
INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, created_at)
SELECT t.u(n), 'authenticated', 'authenticated', n || '@example.test',
       jsonb_build_object('username', n, 'display_name', initcap(n), 'role', 'OWNER'), now()
  FROM unnest(ARRAY['owner', 'cashier', 'nomenu', 'finance', 'pending', 'suspended']) AS n;

SELECT t.check('SIGNUP', 'every signup is a PENDING USER even when metadata claims OWNER',
    (SELECT count(*) FROM public.profiles WHERE role = 'USER' AND status = 'PENDING') = 6);

SELECT public.bootstrap_owner('owner');
SELECT t.ok('MEMBERS', 'owner approves ' || n, 'owner',
            format($q$select public.owner_set_member_status(%L::uuid, 'ACTIVE', 'hired')$q$, t.u(n)))
  FROM unnest(ARRAY['cashier', 'nomenu', 'finance', 'suspended']) AS n;
SELECT t.ok('MEMBERS', 'owner suspends suspended', 'owner',
            format($q$select public.owner_set_member_status(%L::uuid, 'SUSPENDED', 'left')$q$, t.u('suspended')));
SELECT t.ok('MEMBERS', 'cashier gets pos + bills', 'owner',
            format($q$select public.owner_set_member_menus(%L::uuid, ARRAY['pos','bills'], 'job')$q$, t.u('cashier')));
SELECT t.ok('MEMBERS', 'finance user gets finance', 'owner',
            format($q$select public.owner_set_member_menus(%L::uuid, ARRAY['finance'], 'job')$q$, t.u('finance')));
SELECT t.ok('PIN', 'owner sets first PIN', 'owner', $q$select public.set_pin('123456')$q$);
SELECT t.ok('PIN', 'cashier sets first PIN', 'cashier', $q$select public.set_pin('123456')$q$);
SELECT t.ok('PIN', 'finance user sets first PIN', 'finance', $q$select public.set_pin('123456')$q$);
