-- 20261112150000_money_once_and_guards_v1
-- Owner 2026-11-12 (audit follow-up, "อนุมัติทุกแผน"):
--  1. Money steps of the return / payment screen happen once: a fee (damage, loss, extra rounds) is created and
--     confirmed in ONE call with a duplicate guard (idempotency key, unique per member + action + key), a lost item
--     is recorded with its fee in one call, and adding to the deposit has a duplicate guard too. A retry or a double
--     tap with the same key gets the first answer back instead of a second fee.
--  2. audit_log_failure: only approved members write to the activity log.
--  3. "อ่านทั้งหมด" in the bell is one call (was one call per notice).
--  4. Sign-in attempts are slowed down per user name + device address (never a permanent lock): server-only table.
-- Existing functions are called as they are (their own checks, audit and ledger stay); nothing old is changed
-- except audit_log_failure.

-- ── 1. Fees in one call ─────────────────────────────────────────────────────────────────────────────────────────

-- Create + confirm a fee (and close its damage / loss case when asked) in one transaction.
CREATE OR REPLACE FUNCTION public.charge_add(
    p_bill_id uuid,
    p_charge_type text,
    p_amount numeric,
    p_reason text,
    p_idempotency_key text,
    p_bill_line_id uuid DEFAULT NULL,
    p_incident_case_id uuid DEFAULT NULL,
    p_basis jsonb DEFAULT NULL,
    p_resolve_incident boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_key    record;
    v_charge jsonb;
    v_out    jsonb;
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_key FROM public._idempotency_begin('CHARGE_ADD', p_idempotency_key,
        md5(jsonb_build_object('bill', p_bill_id, 'type', p_charge_type, 'amount', p_amount, 'line', p_bill_line_id,
                               'case', p_incident_case_id, 'basis', p_basis, 'resolve', p_resolve_incident)::text));
    IF v_key.replay IS NOT NULL THEN
        RETURN v_key.replay;
    END IF;

    v_charge := public.charge_create(p_bill_id, p_charge_type, p_amount, p_reason, p_bill_line_id, p_incident_case_id,
                                     p_basis, NULL, NULL, NULL);
    PERFORM public.charge_confirm((v_charge ->> 'id')::uuid);
    IF p_resolve_incident AND p_incident_case_id IS NOT NULL THEN
        PERFORM public.incident_resolve(p_incident_case_id, p_reason, false, NULL);
    END IF;

    v_out := jsonb_build_object('id', v_charge ->> 'id', 'charge_id', v_charge ->> 'id', 'status', 'CONFIRMED',
                                'amount', p_amount);
    RETURN public._idempotency_finish(v_key.key_id, v_out);
END;
$function$;

-- A damage / loss case closed with no fee, once.
CREATE OR REPLACE FUNCTION public.incident_waive(p_case_id uuid, p_reason text, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_key record;
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_key FROM public._idempotency_begin('INCIDENT_WAIVE', p_idempotency_key,
        md5(jsonb_build_object('case', p_case_id)::text));
    IF v_key.replay IS NOT NULL THEN
        RETURN v_key.replay;
    END IF;
    RETURN public._idempotency_finish(v_key.key_id, public.incident_resolve(p_case_id, p_reason, false, NULL));
END;
$function$;

-- Goods not returned and confirmed lost, with the loss fee (0 = no fee), in one transaction.
CREATE OR REPLACE FUNCTION public.lost_add(
    p_bill_id uuid,
    p_bill_line_id uuid,
    p_quantity numeric,
    p_amount numeric,
    p_reason text,
    p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_key     record;
    v_missing jsonb;
    v_lost    jsonb;
    v_charge  jsonb;
    v_amount  numeric(14,2) := round(COALESCE(p_amount, 0), 2);
    v_out     jsonb;
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_key FROM public._idempotency_begin('LOST_ADD', p_idempotency_key,
        md5(jsonb_build_object('bill', p_bill_id, 'line', p_bill_line_id, 'qty', p_quantity, 'amount', v_amount)::text));
    IF v_key.replay IS NOT NULL THEN
        RETURN v_key.replay;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bill_lines WHERE id = p_bill_line_id AND bill_id = p_bill_id) THEN
        RAISE EXCEPTION 'LINE_NOT_IN_BILL' USING ERRCODE = '23514';
    END IF;

    v_missing := public.incident_open(p_bill_line_id, 'MISSING', p_quantity, p_reason, NULL);
    v_lost := public.lost_record((v_missing ->> 'id')::uuid, p_quantity, 'REPLACEMENT', p_reason, NULL);
    IF v_amount > 0 THEN
        v_charge := public.charge_create(p_bill_id, 'LOST', v_amount, p_reason, p_bill_line_id, (v_lost ->> 'id')::uuid,
                                         NULL, NULL, NULL, NULL);
        PERFORM public.charge_confirm((v_charge ->> 'id')::uuid);
    END IF;
    PERFORM public.incident_resolve((v_lost ->> 'id')::uuid, p_reason, false, NULL);

    v_out := jsonb_build_object('lost_case_id', v_lost ->> 'id', 'charge_id', v_charge ->> 'id', 'amount', v_amount);
    RETURN public._idempotency_finish(v_key.key_id, v_out);
END;
$function$;

-- เพิ่มมัดจำ once: the bill's deposit becomes p_new_deposit_amount (same correction as before, with a duplicate guard).
CREATE OR REPLACE FUNCTION public.bill_deposit_add(
    p_bill_id uuid,
    p_new_deposit_amount numeric,
    p_deposit_note text,
    p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_key record;
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_key FROM public._idempotency_begin('BILL_DEPOSIT_ADD', p_idempotency_key,
        md5(jsonb_build_object('bill', p_bill_id, 'deposit', p_new_deposit_amount, 'note', p_deposit_note)::text));
    IF v_key.replay IS NOT NULL THEN
        RETURN v_key.replay;
    END IF;
    PERFORM public.bill_correct(p_bill_id,
                                jsonb_build_object('deposit_amount', p_new_deposit_amount, 'deposit_note', p_deposit_note),
                                '', NULL);
    RETURN public._idempotency_finish(v_key.key_id,
        jsonb_build_object('bill_id', p_bill_id, 'deposit_amount', p_new_deposit_amount));
END;
$function$;

REVOKE ALL ON FUNCTION public.charge_add(uuid, text, numeric, text, text, uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.incident_waive(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lost_add(uuid, uuid, numeric, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bill_deposit_add(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.charge_add(uuid, text, numeric, text, text, uuid, uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.incident_waive(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lost_add(uuid, uuid, numeric, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bill_deposit_add(uuid, numeric, text, text) TO authenticated;

-- ── 2. Activity log: approved members only ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_log_failure(p_rpc text, p_error text, p_screen text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    -- Not signed in, or not an approved member (e.g. a self-registered account waiting for approval): nothing is written.
    IF auth.uid() IS NULL OR p_rpc IS NULL OR btrim(p_rpc) = '' OR NOT public.is_active_member() THEN
        RETURN;
    END IF;
    INSERT INTO public.audit_logs (actor_id, actor_name, action, entity_type, after_data, result, correlation_id, screen)
    VALUES (auth.uid(),
            (SELECT COALESCE(NULLIF(p.display_name, ''), p.username) FROM public.profiles p WHERE p.id = auth.uid()),
            upper(left(btrim(p_rpc), 80)), 'RPC',
            jsonb_build_object('rpc', left(btrim(p_rpc), 80), 'error', left(COALESCE(p_error, ''), 500)),
            'FAILED', gen_random_uuid(), COALESCE(left(p_screen, 200), public._request_screen()));
END;
$function$;

-- ── 3. Bell: mark every unread notice I can see as read, in one call ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notification_mark_all_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_count integer;
BEGIN
    PERFORM public._require_active_member();
    -- Same visibility rule as notification_mark: mine, a menu I have, or any notice for the OWNER.
    UPDATE public.notifications n
       SET status = 'READ', read_at = COALESCE(n.read_at, now())
     WHERE n.status = 'UNREAD'
       AND (COALESCE(n.recipient_user_id = auth.uid(), false)
            OR (n.recipient_menu IS NOT NULL AND public.has_menu(n.recipient_menu))
            OR public.is_owner());
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.notification_mark_all_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_mark_all_read() TO authenticated;

-- ── 4. Sign-in slow-down (server only) ─────────────────────────────────────────────────────────────────────────
-- key = a hash made by the server (user name + device address, or the address alone); no user name is stored.
-- 10 wrong passwords for one user name from one address within 15 minutes → that pair waits 15 minutes;
-- 30 from one address (any user names) → that address waits 15 minutes. A correct sign-in clears the pair.

CREATE TABLE IF NOT EXISTS public.login_throttle (
    key               text PRIMARY KEY,
    fail_count        integer NOT NULL DEFAULT 0,
    window_started_at timestamptz NOT NULL DEFAULT now(),
    blocked_until     timestamptz
);
ALTER TABLE public.login_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.login_throttle FROM PUBLIC, anon, authenticated;

-- Seconds still to wait for any of the keys (0 = may try).
CREATE OR REPLACE FUNCTION public.login_throttle_wait(p_keys text[])
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
    SELECT COALESCE(max(ceil(extract(epoch FROM (t.blocked_until - now()))))::integer, 0)
      FROM public.login_throttle t
     WHERE t.key = ANY (p_keys) AND t.blocked_until > now();
$function$;

-- Records one attempt. p_limits = the fail limit of each key (same order). Returns seconds to wait after it.
CREATE OR REPLACE FUNCTION public.login_throttle_record(p_keys text[], p_limits integer[], p_success boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_window constant interval := interval '15 minutes';
    v_block  constant interval := interval '15 minutes';
BEGIN
    IF p_keys IS NULL OR array_length(p_keys, 1) IS NULL THEN
        RETURN 0;
    END IF;
    IF p_success THEN
        -- Only the user name + address pair is cleared; the address counter keeps counting.
        DELETE FROM public.login_throttle WHERE key = p_keys[1];
        RETURN 0;
    END IF;
    FOR i IN 1 .. array_length(p_keys, 1) LOOP
        INSERT INTO public.login_throttle AS t (key, fail_count, window_started_at)
        VALUES (p_keys[i], 1, now())
        ON CONFLICT (key) DO UPDATE
           SET fail_count = CASE WHEN t.window_started_at < now() - v_window THEN 1 ELSE t.fail_count + 1 END,
               window_started_at = CASE WHEN t.window_started_at < now() - v_window THEN now() ELSE t.window_started_at END,
               blocked_until = CASE
                   WHEN t.window_started_at >= now() - v_window AND t.fail_count + 1 >= COALESCE(p_limits[i], 10)
                   THEN now() + v_block ELSE t.blocked_until END;
    END LOOP;
    -- Old rows go away on their own.
    DELETE FROM public.login_throttle
     WHERE window_started_at < now() - interval '1 day' AND (blocked_until IS NULL OR blocked_until < now());
    RETURN public.login_throttle_wait(p_keys);
END;
$function$;

REVOKE ALL ON FUNCTION public.login_throttle_wait(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.login_throttle_record(text[], integer[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_throttle_wait(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.login_throttle_record(text[], integer[], boolean) TO service_role;
