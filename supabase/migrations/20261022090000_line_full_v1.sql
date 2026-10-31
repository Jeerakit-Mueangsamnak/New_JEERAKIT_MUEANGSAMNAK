-- ============================================================================
-- LINE full v1 (2026-10-22) — LOCAL MIGRATION, NOT APPLIED TO CLOUD.
-- Needs the LINE migrations 20261008160000, 20261010090000 and 20261015090000 first.
-- Owner decision 2026-10-21: the LINE feature must work end to end; 1:1 chats only.
-- Non-destructive: adds columns, widens checks, replaces functions; no row is changed.
--
-- 1. Invite link (LIFF): a LINK- code for one staff member / driver / customer, sent to that
--    person's own LINE as https://liff.line.me/<id>?t=<code>. The LIFF page sends the code with
--    a LINE ID token that the server verified; line_liff_bind links the LINE userId and keeps
--    what the person typed (name, phone, LINE ID). A mismatch links but is flagged for review.
-- 2. notifications -> LINE: line_notifications_claim hands new notices to the worker, which
--    queues one push per eligible staff contact (lib/line/notification-fanout.ts).
-- 3. Customer reminders: the schedule lives in store_settings.policies.line.reminders (set in
--    Settings › LINE). The worker asks line_customer_reminders_due, renders, and queues once
--    per dedupe key. Staff can also send one by hand (line_customer_reminder_send).
-- 4. Driver job progress: line_task_progress tells the shop (in-app notice) and returns the
--    customer to tell when that step is switched on (policies.line.customerStages).
-- 5. Driver who has not pressed รับงาน in policies.line.acceptTimeoutMinutes gets a reminder.
-- 6. Flex messages are accepted by the outbox (https links / postbacks only).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.line_link_codes ADD COLUMN IF NOT EXISTS via text NOT NULL DEFAULT 'CODE';
ALTER TABLE public.line_link_codes DROP CONSTRAINT IF EXISTS line_link_codes_via_check;
ALTER TABLE public.line_link_codes ADD CONSTRAINT line_link_codes_via_check CHECK (via IN ('CODE', 'INVITE'));

ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS typed_name text;
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS typed_phone text;
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS line_handle text;
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.line_contacts DROP CONSTRAINT IF EXISTS line_contacts_typed_check;
ALTER TABLE public.line_contacts ADD CONSTRAINT line_contacts_typed_check CHECK (
    (typed_name IS NULL OR length(typed_name) <= 200)
    AND (typed_phone IS NULL OR length(typed_phone) <= 30)
    AND (line_handle IS NULL OR length(line_handle) <= 60));
GRANT SELECT (typed_name, typed_phone, line_handle, needs_review) ON public.line_contacts TO authenticated;

-- When a notice was handed to the LINE worker (NULL = not yet).
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS line_fanout_at timestamptz;
CREATE INDEX IF NOT EXISTS notifications_line_fanout_idx ON public.notifications (created_at) WHERE line_fanout_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Options and texts
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._line_template_vars(p_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_key
        WHEN 'LINK_SUCCESS'             THEN ARRAY['ชื่อ', 'ชื่อร้าน']
        WHEN 'LINK_INVALID'             THEN ARRAY[]::text[]
        WHEN 'LINK_EXPIRED'             THEN ARRAY[]::text[]
        WHEN 'LINK_LOCKED'              THEN ARRAY[]::text[]
        WHEN 'LINK_TAKEN'               THEN ARRAY[]::text[]
        WHEN 'TEST'                     THEN ARRAY['ชื่อร้าน']
        WHEN 'STAFF_NOTICE'             THEN ARRAY['หัวข้อ', 'รายละเอียด']
        WHEN 'TASK_NEW'                 THEN ARRAY['ผู้สั่ง', 'เรื่อง']
        WHEN 'TASK_ACCEPTED'            THEN ARRAY['เรื่อง']
        WHEN 'TASK_DONE'                THEN ARRAY['เรื่อง']
        WHEN 'TASK_NOT_ALLOWED'         THEN ARRAY[]::text[]
        WHEN 'TASK_STEP_DONE'           THEN ARRAY['ขั้นตอน', 'เรื่อง']
        WHEN 'TASK_ACCEPT_FIRST'        THEN ARRAY[]::text[]
        WHEN 'TASK_WITHDRAWN'           THEN ARRAY['เรื่อง']
        WHEN 'TASK_CANCELLED'           THEN ARRAY['เรื่อง', 'เหตุผล']
        WHEN 'DRIVER_ACCEPT_REMINDER'   THEN ARRAY['เรื่อง']
        WHEN 'CUSTOMER_RETURN_REMINDER' THEN ARRAY['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน']
        WHEN 'CUSTOMER_DUE_TODAY'       THEN ARRAY['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน']
        WHEN 'CUSTOMER_OVERDUE'         THEN ARRAY['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน']
        WHEN 'CUSTOMER_PAYMENT_DUE'     THEN ARRAY['ชื่อลูกค้า', 'เลขบิล', 'วันครบ', 'ยอดค้าง', 'ชื่อร้าน']
        WHEN 'CUSTOMER_APPOINTMENT'     THEN ARRAY['ชื่อลูกค้า', 'เรื่อง', 'วันนัด', 'ชื่อร้าน']
        WHEN 'CUSTOMER_JOB_STEP'        THEN ARRAY['ชื่อลูกค้า', 'เรื่อง', 'ขั้นตอน', 'คนขับ', 'ชื่อร้าน']
    END;
$$;

-- policies.line: every option the LINE screens save. Same rules as lib/line/policy.ts.
CREATE OR REPLACE FUNCTION public._line_policy_check(p_line jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_ints  jsonb := '{"linkCodeTtlMinutes": [2, 60], "linkMaxFailures": [3, 10],
                       "linkLockMinutes": [5, 1440], "linkGlobalMaxFailures": [10, 200],
                       "linkInviteTtlHours": [1, 720], "acceptTimeoutMinutes": [0, 1440],
                       "reminderHour": [0, 23]}'::jsonb;
    v_rule_ints jsonb := '{"daysBefore": [0, 30], "repeatDays": [0, 30]}'::jsonb;
    v_rules text[] := ARRAY['RENTAL_DUE_SOON', 'RENTAL_DUE_TODAY', 'RENTAL_OVERDUE', 'PAYMENT_DUE', 'APPOINTMENT_DUE'];
    v_key   text;
    v_val   jsonb;
    v_sub   text;
    v_subv  jsonb;
    v_f     text;
    v_fv    jsonb;
    v_vars  text[];
    v_ph    text[];
    v_num   numeric;
BEGIN
    IF p_line IS NULL OR p_line = 'null'::jsonb THEN
        RETURN;
    END IF;
    IF jsonb_typeof(p_line) <> 'object' THEN
        RAISE EXCEPTION 'INVALID_POLICY: line' USING ERRCODE = '22023';
    END IF;
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_line) LOOP
        IF v_ints ? v_key THEN
            IF jsonb_typeof(v_val) <> 'number' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.%', v_key USING ERRCODE = '22023';
            END IF;
            v_num := (v_val #>> '{}')::numeric;
            IF v_num <> trunc(v_num)
               OR v_num NOT BETWEEN (v_ints -> v_key ->> 0)::numeric AND (v_ints -> v_key ->> 1)::numeric THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.%', v_key USING ERRCODE = '22023';
            END IF;
        ELSIF v_key IN ('notify', 'customerStages') THEN
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.%', v_key USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                IF v_sub !~ '^[A-Z][A-Z0-9_]{1,59}$' OR jsonb_typeof(v_subv) <> 'boolean' THEN
                    RAISE EXCEPTION 'INVALID_POLICY: line.%.%', v_key, left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
            END LOOP;
        ELSIF v_key = 'reminders' THEN
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.reminders' USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                IF NOT (v_sub = ANY (v_rules)) OR jsonb_typeof(v_subv) <> 'object' THEN
                    RAISE EXCEPTION 'INVALID_POLICY: line.reminders.%', left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
                FOR v_f, v_fv IN SELECT * FROM jsonb_each(v_subv) LOOP
                    IF v_f = 'enabled' THEN
                        IF jsonb_typeof(v_fv) <> 'boolean' THEN
                            RAISE EXCEPTION 'INVALID_POLICY: line.reminders.%.%', v_sub, v_f USING ERRCODE = '22023';
                        END IF;
                    ELSIF v_rule_ints ? v_f THEN
                        IF jsonb_typeof(v_fv) <> 'number' THEN
                            RAISE EXCEPTION 'INVALID_POLICY: line.reminders.%.%', v_sub, v_f USING ERRCODE = '22023';
                        END IF;
                        v_num := (v_fv #>> '{}')::numeric;
                        IF v_num <> trunc(v_num)
                           OR v_num NOT BETWEEN (v_rule_ints -> v_f ->> 0)::numeric AND (v_rule_ints -> v_f ->> 1)::numeric THEN
                            RAISE EXCEPTION 'INVALID_POLICY: line.reminders.%.%', v_sub, v_f USING ERRCODE = '22023';
                        END IF;
                    ELSE
                        RAISE EXCEPTION 'INVALID_POLICY: line.reminders.%.% unknown', v_sub, left(v_f, 40) USING ERRCODE = '22023';
                    END IF;
                END LOOP;
            END LOOP;
        ELSIF v_key = 'templates' THEN
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.templates' USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                v_vars := public._line_template_vars(v_sub);
                IF v_vars IS NULL OR jsonb_typeof(v_subv) <> 'string'
                   OR btrim(v_subv #>> '{}') = '' OR length(v_subv #>> '{}') > 5000 THEN
                    RAISE EXCEPTION 'INVALID_POLICY: line.templates.%', left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
                FOR v_ph IN SELECT regexp_matches(v_subv #>> '{}', '\{([^{}]+)\}', 'g') LOOP
                    IF NOT (v_ph[1] = ANY (v_vars)) THEN
                        RAISE EXCEPTION 'INVALID_POLICY: line.templates.% placeholder', v_sub USING ERRCODE = '22023';
                    END IF;
                END LOOP;
            END LOOP;
        ELSE
            RAISE EXCEPTION 'INVALID_POLICY: line.% unknown', left(v_key, 60) USING ERRCODE = '22023';
        END IF;
    END LOOP;
END;
$$;

-- Outbox messages: text, buttons template, and flex (bubble / carousel up to 30 KB). Every
-- action inside a flex is a postback or an https link (same as buttons).
CREATE OR REPLACE FUNCTION public._line_messages_valid(p_messages jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_m jsonb;
BEGIN
    IF p_messages IS NULL OR jsonb_typeof(p_messages) <> 'array'
       OR jsonb_array_length(p_messages) NOT BETWEEN 1 AND 5 THEN
        RETURN false;
    END IF;
    FOR v_m IN SELECT * FROM jsonb_array_elements(p_messages) LOOP
        IF v_m ->> 'type' = 'text' THEN
            IF jsonb_typeof(v_m -> 'text') IS DISTINCT FROM 'string' OR btrim(v_m ->> 'text') = '' OR length(v_m ->> 'text') > 5000 THEN
                RETURN false;
            END IF;
        ELSIF v_m ->> 'type' = 'template' THEN
            IF jsonb_typeof(v_m -> 'altText') IS DISTINCT FROM 'string' OR length(v_m ->> 'altText') NOT BETWEEN 1 AND 400
               OR (v_m -> 'template' ->> 'type') IS DISTINCT FROM 'buttons'
               OR jsonb_typeof(v_m -> 'template' -> 'actions') IS DISTINCT FROM 'array'
               OR jsonb_array_length(v_m -> 'template' -> 'actions') NOT BETWEEN 1 AND 4 THEN
                RETURN false;
            END IF;
            IF EXISTS (
                SELECT 1 FROM jsonb_array_elements(v_m -> 'template' -> 'actions') a
                 WHERE jsonb_typeof(a -> 'label') IS DISTINCT FROM 'string'
                    OR length(a ->> 'label') NOT BETWEEN 1 AND 20
                    OR NOT ((a ->> 'type' = 'postback' AND jsonb_typeof(a -> 'data') = 'string'
                             AND length(a ->> 'data') BETWEEN 1 AND 300)
                         OR (a ->> 'type' = 'uri' AND jsonb_typeof(a -> 'uri') = 'string'
                             AND a ->> 'uri' ~ '^https://' AND length(a ->> 'uri') <= 1000))) THEN
                RETURN false;
            END IF;
        ELSIF v_m ->> 'type' = 'flex' THEN
            IF jsonb_typeof(v_m -> 'altText') IS DISTINCT FROM 'string' OR length(v_m ->> 'altText') NOT BETWEEN 1 AND 400
               OR jsonb_typeof(v_m -> 'contents') IS DISTINCT FROM 'object'
               OR (v_m -> 'contents' ->> 'type') NOT IN ('bubble', 'carousel')
               OR octet_length((v_m -> 'contents')::text) > 30000 THEN
                RETURN false;
            END IF;
            IF EXISTS (
                SELECT 1 FROM jsonb_path_query(v_m -> 'contents', 'strict $.**.action') a
                 WHERE jsonb_typeof(a) = 'object'
                   AND NOT ((a ->> 'type' = 'postback' AND jsonb_typeof(a -> 'data') = 'string'
                             AND length(a ->> 'data') BETWEEN 1 AND 300)
                         OR (a ->> 'type' = 'uri' AND jsonb_typeof(a -> 'uri') = 'string'
                             AND a ->> 'uri' ~ '^(https://|tel:)' AND length(a ->> 'uri') <= 1000))) THEN
                RETURN false;
            END IF;
        ELSE
            RETURN false;
        END IF;
    END LOOP;
    RETURN true;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Invite link (LIFF)
-- ----------------------------------------------------------------------------
-- p_kind STAFF (target = profiles.id, OWNER), DRIVER (target = driver code, OWNER),
-- CUSTOMER (target = customers.id, a member who serves customers). An open earlier code of
-- the same person is revoked. The code is returned once; only its hash is kept.
CREATE OR REPLACE FUNCTION public.line_invite_create(p_kind text, p_target text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ttl      integer := public._line_option_int('linkInviteTtlHours', 72, 1, 720);
    v_exp      timestamptz := now() + make_interval(hours => v_ttl);
    v_profile  uuid;
    v_customer uuid;
    v_driver   text;
    v_code     text;
    v_id       uuid;
    v_try      integer := 0;
BEGIN
    IF p_kind = 'STAFF' THEN
        PERFORM public._require_owner();
        v_profile := p_target::uuid;
        IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_profile AND p.status = 'ACTIVE') THEN
            RAISE EXCEPTION 'MEMBER_NOT_ACTIVE' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.profile_id = v_profile AND x.status = 'LINKED') THEN
            RAISE EXCEPTION 'LINE_MEMBER_ALREADY_LINKED' USING ERRCODE = '22023';
        END IF;
    ELSIF p_kind = 'DRIVER' THEN
        PERFORM public._require_owner();
        v_driver := p_target;
        IF NOT public._line_driver_active(v_driver) THEN
            RAISE EXCEPTION 'DRIVER_NOT_ACTIVE' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.driver_code = v_driver AND x.status = 'LINKED') THEN
            RAISE EXCEPTION 'LINE_DRIVER_ALREADY_LINKED' USING ERRCODE = '22023';
        END IF;
    ELSIF p_kind = 'CUSTOMER' THEN
        PERFORM public._require_menu('customers', 'bills', 'appointments', 'line');
        v_customer := p_target::uuid;
        IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_customer AND c.active) THEN
            RAISE EXCEPTION 'CUSTOMER_INACTIVE' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.customer_id = v_customer AND x.status = 'LINKED') THEN
            RAISE EXCEPTION 'LINE_CUSTOMER_ALREADY_LINKED' USING ERRCODE = '22023';
        END IF;
    ELSE
        RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = '22023';
    END IF;

    UPDATE public.line_link_codes SET revoked_at = now()
     WHERE used_at IS NULL AND revoked_at IS NULL
       AND ((v_profile IS NOT NULL AND profile_id = v_profile)
            OR (v_customer IS NOT NULL AND customer_id = v_customer)
            OR (v_driver IS NOT NULL AND driver_code = v_driver));
    LOOP
        v_try := v_try + 1;
        SELECT 'LINK-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b.r, i) % 32) + 1, 1), '' ORDER BY i)
          INTO v_code
          FROM (SELECT extensions.gen_random_bytes(10) AS r) b, generate_series(0, 9) AS i;
        BEGIN
            INSERT INTO public.line_link_codes (purpose, profile_id, customer_id, driver_code, code_hash, expires_at, created_by, via)
            VALUES (p_kind, v_profile, v_customer, v_driver, public._line_code_hash(v_code), v_exp, auth.uid(), 'INVITE')
            RETURNING id INTO v_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF v_try >= 5 THEN
                RAISE EXCEPTION 'LINE_CODE_BUSY: try again' USING ERRCODE = '40001';
            END IF;
        END;
    END LOOP;
    PERFORM public._audit('LINE_INVITE_CREATE', 'LINE_LINK_CODE', v_id, NULL,
                          jsonb_build_object('kind', p_kind, 'target', p_target, 'expires_at', v_exp),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('code', v_code, 'expires_at', v_exp);
END;
$$;

-- Same as 20261010090000 plus: a LINK- invite may be for a staff member too.
CREATE OR REPLACE FUNCTION public.line_link_code_consume(p_line_user_id text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c     public.line_contacts%ROWTYPE;
    v_k     public.line_link_codes%ROWTYPE;
    v_max   integer := public._line_option_int('linkMaxFailures', 5, 3, 10);
    v_lock  integer := public._line_option_int('linkLockMinutes', 15, 5, 1440);
    v_glob  integer := public._line_option_int('linkGlobalMaxFailures', 30, 10, 200);
    v_name  text;
    v_found boolean;
BEGIN
    PERFORM public._line_require_server();
    SELECT * INTO v_c FROM public.line_contacts WHERE line_user_id = p_line_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002';
    END IF;
    IF v_c.code_locked_until IS NOT NULL AND v_c.code_locked_until > now() THEN
        RETURN jsonb_build_object('result', 'LOCKED', 'until', v_c.code_locked_until);
    END IF;
    IF v_c.status = 'LINKED' THEN
        RETURN jsonb_build_object('result', 'ALREADY_LINKED');
    END IF;
    IF p_code IS NULL OR p_code !~ '^([0-9]{6}|LINK-[A-HJ-NP-Z2-9]{10})$' THEN
        RETURN jsonb_build_object('result', 'INVALID');
    END IF;
    IF (SELECT count(*) FROM public.audit_logs a
         WHERE a.created_at > now() - make_interval(mins => v_lock)
           AND a.action = 'LINE_LINK_ATTEMPT' AND a.result = 'FAILED') >= v_glob THEN
        RETURN jsonb_build_object('result', 'LOCKED');
    END IF;
    SELECT * INTO v_k FROM public.line_link_codes
     WHERE code_hash = public._line_code_hash(p_code) AND used_at IS NULL AND revoked_at IS NULL
     FOR UPDATE;
    v_found := FOUND AND CASE WHEN p_code LIKE 'LINK-%'
                              THEN v_k.purpose IN ('CUSTOMER', 'DRIVER') OR (v_k.purpose = 'STAFF' AND v_k.via = 'INVITE')
                              ELSE v_k.purpose = 'STAFF' AND v_k.via = 'CODE' END;
    IF NOT v_found OR v_k.expires_at <= now() THEN
        UPDATE public.line_contacts
           SET code_failures = code_failures + 1,
               code_locked_until = CASE WHEN code_failures + 1 >= v_max THEN now() + make_interval(mins => v_lock) END,
               updated_at = now()
         WHERE id = v_c.id;
        PERFORM public._audit_line(NULL, 'LINE_LINK_ATTEMPT', 'LINE_CONTACT', v_c.id,
                                   jsonb_build_object('reason', CASE WHEN v_found THEN 'EXPIRED' ELSE 'NO_MATCH' END), 'FAILED');
        RETURN jsonb_build_object('result', CASE WHEN v_c.code_failures + 1 >= v_max THEN 'LOCKED'
                                                 WHEN v_found THEN 'EXPIRED' ELSE 'INVALID' END);
    END IF;

    IF v_k.purpose = 'STAFF' THEN
        IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_k.profile_id AND p.status = 'ACTIVE') THEN
            RETURN jsonb_build_object('result', 'INVALID');
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.profile_id = v_k.profile_id AND x.status = 'LINKED') THEN
            RETURN jsonb_build_object('result', 'TARGET_TAKEN');
        END IF;
        UPDATE public.line_link_codes SET used_at = now() WHERE id = v_k.id;
        UPDATE public.line_contacts
           SET status = 'LINKED', profile_id = v_k.profile_id, customer_id = NULL, driver_code = NULL,
               code_failures = 0, code_locked_until = NULL, linked_at = now(), updated_at = now()
         WHERE id = v_c.id;
        SELECT COALESCE(NULLIF(p.display_name, ''), p.username) INTO v_name FROM public.profiles p WHERE p.id = v_k.profile_id;
        PERFORM public._audit_line(v_k.profile_id, 'LINE_LINK', 'PROFILE', v_k.profile_id,
                                   jsonb_build_object('contact_id', v_c.id, 'via', v_k.via));
        PERFORM public._notify('LINE_LINKED:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                               'LINE_LINKED', 'WARNING', v_k.profile_id, NULL, 'PROFILE', v_k.profile_id,
                               'ผูก LINE กับบัญชีของคุณแล้ว',
                               'LINE ' || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ')
                               || ' ถูกผูกกับบัญชีนี้ ถ้าไม่ได้ทำเอง ให้ยกเลิกการผูกทันทีและแจ้งเจ้าของร้าน');
        IF v_k.via = 'INVITE' AND v_k.created_by IS DISTINCT FROM v_k.profile_id THEN
            PERFORM public._notify('LINE_LINKED:' || v_c.id || ':issuer', 'LINE_LINKED', 'INFO', v_k.created_by, NULL,
                                   'PROFILE', v_k.profile_id, 'พนักงานผูก LINE แล้ว',
                                   COALESCE(v_name, '-') || ' ผูกกับ LINE ' || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ'));
        END IF;
        RETURN jsonb_build_object('result', 'LINKED_STAFF', 'name', v_name);
    END IF;

    IF v_k.purpose = 'DRIVER' THEN
        IF NOT public._line_driver_active(v_k.driver_code) THEN
            RETURN jsonb_build_object('result', 'INVALID');
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.driver_code = v_k.driver_code AND x.status = 'LINKED') THEN
            RETURN jsonb_build_object('result', 'TARGET_TAKEN');
        END IF;
        UPDATE public.line_link_codes SET used_at = now() WHERE id = v_k.id;
        UPDATE public.line_contacts
           SET status = 'LINKED', driver_code = v_k.driver_code, profile_id = NULL, customer_id = NULL,
               code_failures = 0, code_locked_until = NULL, linked_at = now(), updated_at = now()
         WHERE id = v_c.id;
        v_name := public._line_driver_name(v_k.driver_code);
        PERFORM public._audit_line(v_k.created_by, 'LINE_LINK', 'LINE_CONTACT', v_c.id,
                                   jsonb_build_object('driver_code', v_k.driver_code, 'code_created_by', v_k.created_by, 'via', v_k.via));
        PERFORM public._notify('LINE_LINKED:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                               'LINE_LINKED', 'INFO', v_k.created_by, NULL, 'LINE_CONTACT', v_c.id,
                               'คนขับผูก LINE แล้ว',
                               'คนขับ ' || v_k.driver_code || ' ' || COALESCE(v_name, '') || ' ผูกกับ LINE '
                               || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ')
                               || ' ถ้าไม่ใช่คนขับคนนี้ ให้ยกเลิกการผูกที่หน้า ตั้งค่า › LINE');
        RETURN jsonb_build_object('result', 'LINKED_DRIVER', 'name', v_name);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_k.customer_id AND c.active) THEN
        RETURN jsonb_build_object('result', 'INVALID');
    END IF;
    IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.customer_id = v_k.customer_id AND x.status = 'LINKED') THEN
        RETURN jsonb_build_object('result', 'TARGET_TAKEN');
    END IF;
    UPDATE public.line_link_codes SET used_at = now() WHERE id = v_k.id;
    UPDATE public.line_contacts
       SET status = 'LINKED', customer_id = v_k.customer_id, profile_id = NULL, driver_code = NULL,
           code_failures = 0, code_locked_until = NULL, linked_at = now(), updated_at = now()
     WHERE id = v_c.id;
    SELECT c.name INTO v_name FROM public.customers c WHERE c.id = v_k.customer_id;
    PERFORM public._audit_line(v_k.created_by, 'LINE_LINK', 'CUSTOMER', v_k.customer_id,
                               jsonb_build_object('contact_id', v_c.id, 'code_created_by', v_k.created_by, 'via', v_k.via));
    PERFORM public._notify('LINE_LINKED:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                           'LINE_LINKED', 'INFO', v_k.created_by, NULL, 'CUSTOMER', v_k.customer_id,
                           'ลูกค้าผูก LINE แล้ว',
                           'ลูกค้า ' || COALESCE(v_name, '-') || ' ผูกกับ LINE '
                           || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ')
                           || ' ถ้าไม่ใช่ลูกค้าคนนี้ ให้ยกเลิกการผูกที่หน้า LINE');
    RETURN jsonb_build_object('result', 'LINKED_CUSTOMER', 'name', v_name);
END;
$$;

-- Loose name match: one written name contains the other once spaces/case are removed.
CREATE OR REPLACE FUNCTION public._line_name_matches(p_typed text, p_known text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT COALESCE(
        length(regexp_replace(lower(p_typed), '\s', '', 'g')) >= 2
        AND (strpos(regexp_replace(lower(p_known), '\s', '', 'g'), regexp_replace(lower(p_typed), '\s', '', 'g')) > 0
             OR strpos(regexp_replace(lower(p_typed), '\s', '', 'g'), regexp_replace(lower(p_known), '\s', '', 'g')) > 0),
        false);
$$;

-- LIFF page -> server (service_role). The LINE userId comes from an ID token the server
-- verified with LINE, never from the page. The code decides who is linked; the typed name /
-- phone are kept and compared, and a mismatch flags the link for the issuer to check.
CREATE OR REPLACE FUNCTION public.line_liff_bind(
    p_line_user_id  text,
    p_display_name  text,
    p_code          text,
    p_typed_name    text,
    p_typed_phone   text,
    p_line_handle   text,
    p_is_friend     boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_k       public.line_link_codes%ROWTYPE;
    v_res     jsonb;
    v_known   text;
    v_phone   text;
    v_review  boolean := false;
    v_contact uuid;
    v_name    text := left(btrim(COALESCE(p_typed_name, '')), 200);
    v_tphone  text := left(regexp_replace(COALESCE(p_typed_phone, ''), '[^0-9]', '', 'g'), 30);
BEGIN
    PERFORM public._line_require_server();
    IF p_line_user_id IS NULL OR p_line_user_id !~ '^U[0-9a-f]{32}$' THEN
        RAISE EXCEPTION 'LINE_USER_INVALID' USING ERRCODE = '22023';
    END IF;
    IF v_name = '' THEN
        RETURN jsonb_build_object('result', 'NAME_REQUIRED');
    END IF;
    SELECT * INTO v_k FROM public.line_link_codes
     WHERE code_hash = public._line_code_hash(upper(btrim(COALESCE(p_code, '')))) AND used_at IS NULL AND revoked_at IS NULL;
    IF FOUND AND v_k.purpose = 'CUSTOMER' AND v_tphone = '' THEN
        RETURN jsonb_build_object('result', 'PHONE_REQUIRED');
    END IF;

    INSERT INTO public.line_contacts (line_user_id, display_name, followed, last_event_at)
    VALUES (p_line_user_id, left(p_display_name, 200), COALESCE(p_is_friend, false), now())
    ON CONFLICT (line_user_id) DO UPDATE
       SET display_name = COALESCE(left(EXCLUDED.display_name, 200), public.line_contacts.display_name),
           followed = COALESCE(p_is_friend, public.line_contacts.followed),
           updated_at = now()
    RETURNING id INTO v_contact;

    v_res := public.line_link_code_consume(p_line_user_id, upper(btrim(COALESCE(p_code, ''))));
    IF v_res ->> 'result' NOT IN ('LINKED_STAFF', 'LINKED_DRIVER', 'LINKED_CUSTOMER') THEN
        RETURN v_res;
    END IF;

    IF v_k.purpose = 'STAFF' THEN
        SELECT concat_ws(' ', p.first_name, p.last_name, p.display_name, p.username) INTO v_known
          FROM public.profiles p WHERE p.id = v_k.profile_id;
    ELSIF v_k.purpose = 'DRIVER' THEN
        v_known := public._line_driver_name(v_k.driver_code);
    ELSE
        SELECT c.name, regexp_replace(c.phone, '[^0-9]', '', 'g') INTO v_known, v_phone
          FROM public.customers c WHERE c.id = v_k.customer_id;
        v_review := right(v_tphone, 9) IS DISTINCT FROM right(COALESCE(v_phone, ''), 9);
    END IF;
    v_review := v_review OR NOT public._line_name_matches(v_name, COALESCE(v_known, ''));

    UPDATE public.line_contacts
       SET typed_name = v_name,
           typed_phone = NULLIF(v_tphone, ''),
           line_handle = NULLIF(left(btrim(COALESCE(p_line_handle, '')), 60), ''),
           needs_review = v_review,
           updated_at = now()
     WHERE id = v_contact;
    IF v_review THEN
        PERFORM public._notify('LINE_REVIEW:' || v_contact || ':' || extract(epoch FROM now())::bigint,
                               'LINE_LINKED', 'WARNING', v_k.created_by, NULL, 'LINE_CONTACT', v_contact,
                               'ตรวจการผูก LINE',
                               'ข้อมูลที่กรอก (' || v_name || COALESCE(' ' || NULLIF(v_tphone, ''), '')
                               || ') ไม่ตรงกับ ' || COALESCE(v_known, '-')
                               || ' ตรวจที่ ตั้งค่า › LINE แล้วกดยืนยันหรือยกเลิกการผูก');
    END IF;
    RETURN v_res || jsonb_build_object('needs_review', v_review, 'kind', v_k.purpose);
END;
$$;

-- Issuer (OWNER / LINE menu) clears the review flag after checking.
CREATE OR REPLACE FUNCTION public.line_contact_review_ok(p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_menu('line');
    UPDATE public.line_contacts SET needs_review = false, updated_at = now()
     WHERE id = p_contact_id AND status = 'LINKED';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = '22023';
    END IF;
    PERFORM public._audit('LINE_CONTACT_REVIEW_OK', 'LINE_CONTACT', p_contact_id, NULL, NULL,
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('contact_id', p_contact_id, 'needs_review', false);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Server outbox enqueue (worker / webhook only)
-- ----------------------------------------------------------------------------
-- Targets come from the server functions below (reminders, job progress, accept reminder),
-- so the recipient is already the right one; this only checks the message and the contact.
CREATE OR REPLACE FUNCTION public.line_outbox_enqueue_server(
    p_contact_id    uuid,
    p_source_type   text,
    p_source_id     uuid,
    p_task_id       uuid,
    p_template_key  text,
    p_messages      jsonb,
    p_dedupe_key    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    PERFORM public._line_require_server();
    IF p_source_type NOT IN ('BILL', 'APPOINTMENT', 'TASK') THEN
        RAISE EXCEPTION 'LINE_SOURCE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT public._line_messages_valid(p_messages) THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.id = p_contact_id AND c.status = 'LINKED' AND c.followed) THEN
        RETURN jsonb_build_object('skipped', 'CONTACT_NOT_LINKED');
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, task_id, template_key, messages, dedupe_key)
    VALUES (p_contact_id, p_source_type, p_source_id, p_task_id, p_template_key, p_messages, 'X:' || p_dedupe_key)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('delivery_id', v_id, 'duplicate', v_id IS NULL);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. notifications -> LINE
-- ----------------------------------------------------------------------------
-- Marks up to p_limit new notices as handed to LINE and returns those whose event type is
-- switched on (policies.line.notify). Only notices of the last day: switching LINE on later
-- never sends a backlog.
CREATE OR REPLACE FUNCTION public.line_notifications_claim(p_limit integer DEFAULT 100)
RETURNS TABLE (notification_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_notify jsonb := COALESCE(public._policy('line', '{}'::jsonb) -> 'notify', '{}'::jsonb);
BEGIN
    PERFORM public._line_require_server();
    RETURN QUERY
    WITH picked AS (
        SELECT n.id FROM public.notifications n
         WHERE n.line_fanout_at IS NULL AND n.created_at > now() - interval '1 day'
         ORDER BY n.created_at
         LIMIT least(greatest(COALESCE(p_limit, 100), 1), 500)
         FOR UPDATE SKIP LOCKED
    ), marked AS (
        UPDATE public.notifications n SET line_fanout_at = now()
          FROM picked WHERE n.id = picked.id
        RETURNING n.id, n.event_type
    )
    SELECT m.id FROM marked m WHERE COALESCE((v_notify ->> m.event_type)::boolean, false);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Customer reminders (schedule from Settings + manual send)
-- ----------------------------------------------------------------------------
-- Every reminder a customer with a linked LINE could get today. p_auto = true applies the
-- schedule (rule switched on, its days, reminderHour); false = every candidate (manual list).
CREATE OR REPLACE FUNCTION public._line_customer_reminder_rows(p_auto boolean)
RETURNS TABLE (rule text, source_type text, source_id uuid, contact_id uuid, customer_name text,
               ref_no text, due_at timestamptz, amount numeric, days_left integer, dedupe_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_r       jsonb := COALESCE(public._policy('line', '{}'::jsonb) -> 'reminders', '{}'::jsonb);
    v_hour    integer := public._line_option_int('reminderHour', 9, 0, 23);
    v_today   date := public._local_date(now());
    v_on      boolean;
    v_before  integer;
    v_repeat  integer;
BEGIN
    IF p_auto AND extract(hour FROM now() AT TIME ZONE 'Asia/Bangkok') < v_hour THEN
        RETURN;
    END IF;

    -- rental bills: earliest open return of the bill
    v_on := NOT p_auto OR COALESCE((v_r -> 'RENTAL_DUE_SOON' ->> 'enabled')::boolean, false);
    v_before := COALESCE((v_r -> 'RENTAL_DUE_SOON' ->> 'daysBefore')::integer, CASE WHEN p_auto THEN 1 ELSE 3 END);
    IF v_on THEN
        RETURN QUERY
        SELECT 'RENTAL_DUE_SOON', 'BILL', x.bill_id, c.id, cu.name, x.bill_no, x.end_at, x.balance_due,
               public._local_date(x.end_at) - v_today,
               'R:DUE_SOON:' || x.bill_id || ':' || public._local_date(x.end_at)
          FROM (SELECT b.id AS bill_id, b.bill_no, b.customer_id, b.balance_due, min(l.rental_end_at) AS end_at
                  FROM public.bills b JOIN public.bill_lines l ON l.bill_id = b.id
                 WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND b.status = 'ACTIVE'
                 GROUP BY b.id) x
          JOIN public.customers cu ON cu.id = x.customer_id
          JOIN public.line_contacts c ON c.customer_id = x.customer_id AND c.status = 'LINKED' AND c.followed
         WHERE public._local_date(x.end_at) - v_today BETWEEN 1 AND greatest(v_before, 1);
    END IF;

    v_on := NOT p_auto OR COALESCE((v_r -> 'RENTAL_DUE_TODAY' ->> 'enabled')::boolean, false);
    IF v_on THEN
        RETURN QUERY
        SELECT 'RENTAL_DUE_TODAY', 'BILL', x.bill_id, c.id, cu.name, x.bill_no, x.end_at, x.balance_due, 0,
               'R:DUE_TODAY:' || x.bill_id || ':' || public._local_date(x.end_at)
          FROM (SELECT b.id AS bill_id, b.bill_no, b.customer_id, b.balance_due, min(l.rental_end_at) AS end_at
                  FROM public.bills b JOIN public.bill_lines l ON l.bill_id = b.id
                 WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND b.status = 'ACTIVE'
                 GROUP BY b.id) x
          JOIN public.customers cu ON cu.id = x.customer_id
          JOIN public.line_contacts c ON c.customer_id = x.customer_id AND c.status = 'LINKED' AND c.followed
         WHERE public._local_date(x.end_at) = v_today;
    END IF;

    v_on := NOT p_auto OR COALESCE((v_r -> 'RENTAL_OVERDUE' ->> 'enabled')::boolean, false);
    v_repeat := COALESCE((v_r -> 'RENTAL_OVERDUE' ->> 'repeatDays')::integer, 0);
    IF v_on THEN
        RETURN QUERY
        SELECT 'RENTAL_OVERDUE', 'BILL', x.bill_id, c.id, cu.name, x.bill_no, x.end_at, x.balance_due,
               public._local_date(x.end_at) - v_today,
               'R:OVERDUE:' || x.bill_id || ':' || public._local_date(x.end_at)
               || CASE WHEN v_repeat > 0 THEN ':' || ((v_today - public._local_date(x.end_at) - 1) / v_repeat) ELSE '' END
          FROM (SELECT b.id AS bill_id, b.bill_no, b.customer_id, b.balance_due, min(l.rental_end_at) AS end_at
                  FROM public.bills b JOIN public.bill_lines l ON l.bill_id = b.id
                 WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND b.status = 'ACTIVE'
                 GROUP BY b.id) x
          JOIN public.customers cu ON cu.id = x.customer_id
          JOIN public.line_contacts c ON c.customer_id = x.customer_id AND c.status = 'LINKED' AND c.followed
         WHERE public._local_date(x.end_at) < v_today;
    END IF;

    v_on := NOT p_auto OR COALESCE((v_r -> 'PAYMENT_DUE' ->> 'enabled')::boolean, false);
    v_before := COALESCE((v_r -> 'PAYMENT_DUE' ->> 'daysBefore')::integer, CASE WHEN p_auto THEN 1 ELSE 3 END);
    v_repeat := COALESCE((v_r -> 'PAYMENT_DUE' ->> 'repeatDays')::integer, 0);
    IF v_on THEN
        RETURN QUERY
        SELECT 'PAYMENT_DUE', 'BILL', b.id, c.id, cu.name, b.bill_no, b.due_date::timestamptz, b.balance_due,
               b.due_date - v_today,
               'R:PAY:' || b.id || ':' || b.due_date
               || CASE WHEN b.due_date < v_today THEN ':late'
                       || CASE WHEN v_repeat > 0 THEN ':' || ((v_today - b.due_date - 1) / v_repeat) ELSE '' END
                       ELSE '' END
          FROM public.bills b
          JOIN public.customers cu ON cu.id = b.customer_id
          JOIN public.line_contacts c ON c.customer_id = b.customer_id AND c.status = 'LINKED' AND c.followed
         WHERE b.status IN ('CONFIRMED', 'ACTIVE', 'CLOSED') AND b.balance_due > 0 AND b.due_date IS NOT NULL
           AND b.due_date - v_today <= v_before;
    END IF;

    v_on := NOT p_auto OR COALESCE((v_r -> 'APPOINTMENT_DUE' ->> 'enabled')::boolean, false);
    v_before := COALESCE((v_r -> 'APPOINTMENT_DUE' ->> 'daysBefore')::integer, CASE WHEN p_auto THEN 1 ELSE 3 END);
    IF v_on THEN
        RETURN QUERY
        SELECT 'APPOINTMENT_DUE', 'APPOINTMENT', a.id, c.id, cu.name, a.title, a.start_datetime, NULL::numeric,
               public._local_date(a.start_datetime) - v_today,
               'R:APPT:' || a.id || ':' || public._local_date(a.start_datetime)
          FROM public.appointments a
          JOIN public.customers cu ON cu.id = a.customer_id
          JOIN public.line_contacts c ON c.customer_id = a.customer_id AND c.status = 'LINKED' AND c.followed
         WHERE a.status IN ('DRAFT', 'SCHEDULED', 'CONFIRMED', 'RESCHEDULED') AND a.start_datetime >= now()
           AND public._local_date(a.start_datetime) - v_today <= v_before;
    END IF;
END;
$$;

-- Worker: today's scheduled reminders not queued yet.
CREATE OR REPLACE FUNCTION public.line_customer_reminders_due()
RETURNS TABLE (rule text, source_type text, source_id uuid, contact_id uuid, customer_name text,
               ref_no text, due_at timestamptz, amount numeric, days_left integer, dedupe_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    PERFORM public._line_require_server();
    RETURN QUERY
    SELECT r.* FROM public._line_customer_reminder_rows(true) r
     WHERE NOT EXISTS (SELECT 1 FROM public.line_deliveries d WHERE d.dedupe_key = 'X:' || r.dedupe_key);
END;
$$;

-- Settings › LINE › ส่งเตือนเอง: every candidate with the last time one was queued.
CREATE OR REPLACE FUNCTION public.line_customer_reminder_candidates()
RETURNS TABLE (rule text, source_type text, source_id uuid, customer_name text, ref_no text,
               due_at timestamptz, amount numeric, days_left integer, last_queued_at timestamptz, last_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    PERFORM public._require_menu('bills', 'line');
    RETURN QUERY
    SELECT r.rule, r.source_type, r.source_id, r.customer_name, r.ref_no, r.due_at, r.amount, r.days_left,
           d.created_at, d.status
      FROM public._line_customer_reminder_rows(false) r
      LEFT JOIN LATERAL (
          SELECT x.created_at, x.status FROM public.line_deliveries x
           WHERE x.source_id = r.source_id AND x.contact_id = r.contact_id
             AND (x.dedupe_key LIKE 'X:R:%' OR x.dedupe_key LIKE 'M:%')
           ORDER BY x.created_at DESC LIMIT 1) d ON true
     ORDER BY r.days_left, r.ref_no;
END;
$$;

-- Manual send: the row must be a current candidate (rule + source); the recipient is the
-- source's own customer. p_messages is built by the server action from the template.
CREATE OR REPLACE FUNCTION public.line_customer_reminder_send(
    p_rule            text,
    p_source_id       uuid,
    p_template_key    text,
    p_messages        jsonb,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row record;
    v_id  uuid;
BEGIN
    PERFORM public._require_menu('bills', 'line');
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF p_template_key IS NULL OR p_template_key !~ '^CUSTOMER_[A-Z_]{2,30}$' OR NOT public._line_messages_valid(p_messages) THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_row FROM public._line_customer_reminder_rows(false) r
     WHERE r.rule = p_rule AND r.source_id = p_source_id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_REMINDER_NOT_DUE' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key, requested_by)
    VALUES (v_row.contact_id, v_row.source_type, v_row.source_id, p_template_key, p_messages, 'M:' || p_idempotency_key, auth.uid())
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.line_deliveries WHERE dedupe_key = 'M:' || p_idempotency_key;
        RETURN jsonb_build_object('delivery_id', v_id, 'duplicate', true);
    END IF;
    PERFORM public._audit('LINE_REMINDER_SEND', v_row.source_type, v_row.source_id, NULL,
                          jsonb_build_object('rule', p_rule, 'delivery_id', v_id), NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('delivery_id', v_id, 'duplicate', false);
END;
$$;

-- Settings › LINE › ประวัติการส่ง: send a failed / cancelled row again (same retry key).
CREATE OR REPLACE FUNCTION public.line_delivery_retry(p_delivery_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_menu('line');
    UPDATE public.line_deliveries
       SET status = 'PENDING', attempts = 0, next_attempt_at = now(), locked_until = NULL,
           last_error_code = NULL, updated_at = now()
     WHERE id = p_delivery_id AND status IN ('DEAD', 'FAILED', 'CANCELLED')
       AND EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.id = contact_id AND c.status = 'LINKED' AND c.followed);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_DELIVERY_NOT_RETRYABLE' USING ERRCODE = '22023';
    END IF;
    PERFORM public._audit('LINE_DELIVERY_RETRY', 'LINE_DELIVERY', p_delivery_id, NULL, NULL,
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', 'PENDING');
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Driver job progress -> shop + customer
-- ----------------------------------------------------------------------------
-- Called by the webhook after a recorded รับงาน / step. Always tells the shop (in-app notice
-- for the appointments menu; LINE too when JOB_STEP is switched on); returns the customer to
-- tell when policies.line.customerStages has that step on and the customer has LINE.
CREATE OR REPLACE FUNCTION public.line_task_progress(p_task_id uuid, p_stage text, p_stage_label text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_t      public.line_tasks%ROWTYPE;
    v_a      public.appointments%ROWTYPE;
    v_stage  text := upper(btrim(COALESCE(p_stage, '')));
    v_label  text := left(COALESCE(NULLIF(btrim(p_stage_label), ''), v_stage), 60);
    v_driver text;
    v_c      record;
BEGIN
    PERFORM public._line_require_server();
    SELECT * INTO v_t FROM public.line_tasks WHERE id = p_task_id;
    IF NOT FOUND OR v_t.appointment_id IS NULL THEN
        RETURN jsonb_build_object('customer', NULL);
    END IF;
    SELECT * INTO v_a FROM public.appointments WHERE id = v_t.appointment_id;
    v_driver := COALESCE(public._line_driver_name(v_t.driver_code), v_t.driver_code, '-');
    PERFORM public._notify('JOB_STEP:' || p_task_id || ':' || v_stage, 'JOB_STEP', 'INFO', NULL, 'appointments',
                           'APPOINTMENT', v_a.id, v_label || ': ' || COALESCE(v_a.title, v_t.title),
                           'คนขับ ' || v_driver || ' กด "' || v_label || '" ทาง LINE');
    IF NOT COALESCE((public._policy('line', '{}'::jsonb) -> 'customerStages' ->> v_stage)::boolean, false)
       OR v_a.customer_id IS NULL THEN
        RETURN jsonb_build_object('customer', NULL);
    END IF;
    SELECT c.id, cu.name INTO v_c
      FROM public.line_contacts c JOIN public.customers cu ON cu.id = c.customer_id
     WHERE c.customer_id = v_a.customer_id AND c.status = 'LINKED' AND c.followed;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('customer', NULL);
    END IF;
    RETURN jsonb_build_object(
        'customer', jsonb_build_object('contact_id', v_c.id, 'name', v_c.name),
        'appointment_id', v_a.id, 'title', COALESCE(v_a.title, v_t.title), 'driver_name', v_driver,
        'dedupe_key', 'JOB:' || p_task_id || ':' || v_stage);
END;
$$;

-- Driver jobs still waiting for รับงาน after policies.line.acceptTimeoutMinutes (0 = off).
-- Each is returned once (dedupe on the reminder), and the shop gets a notice.
CREATE OR REPLACE FUNCTION public.line_driver_accept_overdue()
RETURNS TABLE (task_id uuid, contact_id uuid, title text, dedupe_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_min integer := public._line_option_int('acceptTimeoutMinutes', 0, 0, 1440);
    v_row record;
BEGIN
    PERFORM public._line_require_server();
    IF v_min = 0 THEN
        RETURN;
    END IF;
    FOR v_row IN
        SELECT t.id, c.id AS contact_id, t.title, t.appointment_id, t.driver_code
          FROM public.line_tasks t
          JOIN public.line_contacts c ON c.driver_code = t.driver_code AND c.status = 'LINKED' AND c.followed
         WHERE t.status = 'SENT' AND t.driver_code IS NOT NULL
           AND t.created_at < now() - make_interval(mins => v_min) AND t.created_at > now() - interval '1 day'
           AND NOT EXISTS (SELECT 1 FROM public.line_deliveries d WHERE d.dedupe_key = 'X:ACCEPT_LATE:' || t.id)
    LOOP
        PERFORM public._notify('ACCEPT_LATE:' || v_row.id, 'JOB_ACCEPT_LATE', 'WARNING', NULL, 'appointments',
                               'APPOINTMENT', COALESCE(v_row.appointment_id, v_row.id),
                               'คนขับยังไม่รับงาน: ' || v_row.title,
                               'คนขับ ' || COALESCE(public._line_driver_name(v_row.driver_code), v_row.driver_code)
                               || ' ยังไม่กดรับงานเกิน ' || v_min || ' นาที');
        task_id := v_row.id;
        contact_id := v_row.contact_id;
        title := v_row.title;
        dedupe_key := 'ACCEPT_LATE:' || v_row.id;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._line_name_matches(text, text), public._line_customer_reminder_rows(boolean)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
    public.line_liff_bind(text, text, text, text, text, text, boolean),
    public.line_outbox_enqueue_server(uuid, text, uuid, uuid, text, jsonb, text),
    public.line_notifications_claim(integer),
    public.line_customer_reminders_due(),
    public.line_task_progress(uuid, text, text),
    public.line_driver_accept_overdue()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.line_liff_bind(text, text, text, text, text, text, boolean),
    public.line_outbox_enqueue_server(uuid, text, uuid, uuid, text, jsonb, text),
    public.line_notifications_claim(integer),
    public.line_customer_reminders_due(),
    public.line_task_progress(uuid, text, text),
    public.line_driver_accept_overdue()
TO service_role;

REVOKE ALL ON FUNCTION
    public.line_invite_create(text, text),
    public.line_contact_review_ok(uuid),
    public.line_customer_reminder_candidates(),
    public.line_customer_reminder_send(text, uuid, text, jsonb, text),
    public.line_delivery_retry(uuid)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
    public.line_invite_create(text, text),
    public.line_contact_review_ok(uuid),
    public.line_customer_reminder_candidates(),
    public.line_customer_reminder_send(text, uuid, text, jsonb, text),
    public.line_delivery_retry(uuid)
TO authenticated;

-- The worker runs the due-date scan as the system (auth.uid() NULL is the system job).
GRANT EXECUTE ON FUNCTION public.rental_overdue_scan() TO service_role;
