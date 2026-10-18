-- ============================================================================
-- Dispatch + Driver LINE v1 (2026-10-10) — LOCAL MIGRATION, NOT APPLIED (local or Cloud).
-- Needs 20261008160000_line_operations_v1 first. Non-destructive: adds columns, widens
-- checks, adds functions; no row is updated or deleted.
--
-- 1. appointment_save_guarded: an edit is saved only if the row is unchanged since the screen
--    read it (updated_at), checked under the row lock (no lost update between two screens).
-- 2. Driver <-> LINE: a driver (store_settings.policies.delivery_drivers, code D001…) is not an
--    app user and never signs in. One driver code = one LINE (line_contacts.driver_code), proven
--    by a single-use LINK- code the OWNER issues for that driver. A profiles.id is never used
--    as a driver id.
-- 3. line_tasks for a driver (driver_code instead of assignee_id), created by whoever may
--    dispatch appointments, only for the driver the appointment was dispatched to. Re-dispatch
--    cancels the earlier driver's open task. The driver's "รับงาน" appends the ACCEPT step to the
--    appointment; "เสร็จแล้ว" stays on the task (staff confirm the hand-over in the POS).
-- ============================================================================

-- 1. Optimistic concurrency for appointment edits -----------------------------------------
CREATE OR REPLACE FUNCTION public.appointment_save_guarded(p_appointment_id uuid, p_data jsonb, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_at timestamptz;
BEGIN
    PERFORM public._require_menu('appointments');
    SELECT a.updated_at INTO v_at FROM public.appointments a WHERE a.id = p_appointment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'APPOINTMENT_NOT_EDITABLE' USING ERRCODE = '23514';
    END IF;
    IF p_expected_updated_at IS NOT NULL AND v_at IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'APPOINTMENT_STALE' USING ERRCODE = '40001';
    END IF;
    RETURN public.appointment_save(p_appointment_id, p_data);
END;
$$;

-- 2. Driver identity on LINE ----------------------------------------------------------------
ALTER TABLE public.line_link_codes ADD COLUMN IF NOT EXISTS driver_code text;
ALTER TABLE public.line_link_codes DROP CONSTRAINT IF EXISTS line_link_codes_purpose_check;
ALTER TABLE public.line_link_codes ADD CONSTRAINT line_link_codes_purpose_check CHECK (purpose IN ('STAFF', 'CUSTOMER', 'DRIVER'));
ALTER TABLE public.line_link_codes DROP CONSTRAINT IF EXISTS line_link_codes_target_check;
ALTER TABLE public.line_link_codes ADD CONSTRAINT line_link_codes_target_check CHECK (
    (purpose = 'STAFF' AND profile_id IS NOT NULL AND customer_id IS NULL AND driver_code IS NULL)
    OR (purpose = 'CUSTOMER' AND customer_id IS NOT NULL AND profile_id IS NULL AND driver_code IS NULL)
    OR (purpose = 'DRIVER' AND driver_code ~ '^D[0-9]{3,6}$' AND profile_id IS NULL AND customer_id IS NULL));

ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS driver_code text;
ALTER TABLE public.line_contacts DROP CONSTRAINT IF EXISTS line_contacts_driver_code_check;
ALTER TABLE public.line_contacts ADD CONSTRAINT line_contacts_driver_code_check CHECK (driver_code IS NULL OR driver_code ~ '^D[0-9]{3,6}$');
ALTER TABLE public.line_contacts DROP CONSTRAINT IF EXISTS line_contacts_one_target_check;
ALTER TABLE public.line_contacts ADD CONSTRAINT line_contacts_one_target_check CHECK (num_nonnulls(profile_id, customer_id, driver_code) <= 1);
ALTER TABLE public.line_contacts DROP CONSTRAINT IF EXISTS line_contacts_linked_check;
ALTER TABLE public.line_contacts ADD CONSTRAINT line_contacts_linked_check CHECK (
    status <> 'LINKED' OR num_nonnulls(profile_id, customer_id, driver_code) = 1);
-- 1 driver code = 1 LINE
CREATE UNIQUE INDEX IF NOT EXISTS line_contacts_driver_uidx ON public.line_contacts (driver_code) WHERE status = 'LINKED' AND driver_code IS NOT NULL;
GRANT SELECT (driver_code) ON public.line_contacts TO authenticated;

-- A driver of the OWNER's driver list who is switched on.
CREATE OR REPLACE FUNCTION public._line_driver_active(p_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_code IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.store_settings s,
               jsonb_array_elements(CASE WHEN jsonb_typeof(s.policies -> 'delivery_drivers') = 'array'
                                         THEN s.policies -> 'delivery_drivers' ELSE '[]'::jsonb END) d
         WHERE s.singleton AND d ->> 'id' = p_code AND COALESCE(d ->> 'active', 'true') <> 'false');
$$;

CREATE OR REPLACE FUNCTION public._line_driver_name(p_code text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT d ->> 'name' FROM public.store_settings s,
           jsonb_array_elements(CASE WHEN jsonb_typeof(s.policies -> 'delivery_drivers') = 'array'
                                     THEN s.policies -> 'delivery_drivers' ELSE '[]'::jsonb END) d
     WHERE s.singleton AND d ->> 'id' = p_code
     LIMIT 1;
$$;

-- OWNER issues a single-use LINK- code for one driver (older open codes of that driver are revoked).
CREATE OR REPLACE FUNCTION public.line_link_code_create_driver(p_driver_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ttl   integer := public._line_option_int('linkCodeTtlMinutes', 10, 2, 60);
    v_code  text;
    v_id    uuid;
    v_exp   timestamptz := now() + make_interval(mins => v_ttl);
    v_try   integer := 0;
BEGIN
    PERFORM public._require_owner();
    IF NOT public._line_driver_active(p_driver_code) THEN
        RAISE EXCEPTION 'DRIVER_NOT_ACTIVE' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.driver_code = p_driver_code AND c.status = 'LINKED') THEN
        RAISE EXCEPTION 'LINE_DRIVER_ALREADY_LINKED' USING ERRCODE = '23505';
    END IF;
    UPDATE public.line_link_codes SET revoked_at = now()
     WHERE used_at IS NULL AND revoked_at IS NULL AND driver_code = p_driver_code;
    LOOP
        v_try := v_try + 1;
        SELECT 'LINK-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b.r, i) % 32) + 1, 1), '' ORDER BY i)
          INTO v_code
          FROM (SELECT extensions.gen_random_bytes(10) AS r) b, generate_series(0, 9) AS i;
        BEGIN
            INSERT INTO public.line_link_codes (purpose, driver_code, code_hash, expires_at, created_by)
            VALUES ('DRIVER', p_driver_code, public._line_code_hash(v_code), v_exp, auth.uid())
            RETURNING id INTO v_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF v_try >= 5 THEN
                RAISE EXCEPTION 'LINE_CODE_BUSY: try again' USING ERRCODE = '40001';
            END IF;
        END;
    END LOOP;
    PERFORM public._audit('LINE_LINK_CODE', 'LINE_LINK_CODE', v_id, NULL, jsonb_build_object('driver_code', p_driver_code),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('code_id', v_id, 'code', v_code, 'expires_at', v_exp);
END;
$$;

-- Link-code use (webhook, service_role): adds the DRIVER branch.
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
    -- Shop-wide throttle: many LINE accounts guessing codes together stop here, so the
    -- 10^6 staff code space cannot be swept inside a code's lifetime.
    IF (SELECT count(*) FROM public.audit_logs a
         WHERE a.created_at > now() - make_interval(mins => v_lock)
           AND a.action = 'LINE_LINK_ATTEMPT' AND a.result = 'FAILED') >= v_glob THEN
        RETURN jsonb_build_object('result', 'LOCKED');
    END IF;
    SELECT * INTO v_k FROM public.line_link_codes
     WHERE code_hash = public._line_code_hash(p_code) AND used_at IS NULL AND revoked_at IS NULL
     FOR UPDATE;
    -- LINK- codes are issued for a customer or a driver; 6 digits for a member's own account.
    v_found := FOUND AND CASE WHEN p_code LIKE 'LINK-%' THEN v_k.purpose IN ('CUSTOMER', 'DRIVER')
                              ELSE v_k.purpose = 'STAFF' END;
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
           SET status = 'LINKED', profile_id = v_k.profile_id, customer_id = NULL,
               code_failures = 0, code_locked_until = NULL, linked_at = now(), updated_at = now()
         WHERE id = v_c.id;
        SELECT COALESCE(NULLIF(p.display_name, ''), p.username) INTO v_name FROM public.profiles p WHERE p.id = v_k.profile_id;
        PERFORM public._audit_line(v_k.profile_id, 'LINE_LINK', 'PROFILE', v_k.profile_id,
                                   jsonb_build_object('contact_id', v_c.id));
        -- The member sees every new link in the app, so a link they did not make is noticed.
        PERFORM public._notify('LINE_LINKED:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                               'LINE_LINKED', 'WARNING', v_k.profile_id, NULL, 'PROFILE', v_k.profile_id,
                               'ผูก LINE กับบัญชีของคุณแล้ว',
                               'LINE ' || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ')
                               || ' ถูกผูกกับบัญชีนี้ ถ้าไม่ได้ทำเอง ให้ยกเลิกการผูกทันทีและแจ้งเจ้าของร้าน');
        RETURN jsonb_build_object('result', 'LINKED_STAFF', 'name', v_name);
    END IF;

    -- DRIVER: the OWNER issued the code for one driver code of the driver list
    -- (store_settings.policies.delivery_drivers) and handed it to that driver in person.
    -- Drivers never sign in to the POS: the driver code, not a profiles.id, is their identity.
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
                                   jsonb_build_object('driver_code', v_k.driver_code, 'code_created_by', v_k.created_by));
        PERFORM public._notify('LINE_LINKED:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                               'LINE_LINKED', 'INFO', v_k.created_by, NULL, 'LINE_CONTACT', v_c.id,
                               'คนขับผูก LINE แล้ว',
                               'คนขับ ' || v_k.driver_code || ' ' || COALESCE(v_name, '') || ' ผูกกับ LINE '
                               || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ')
                               || ' ถ้าไม่ใช่คนขับคนนี้ ให้ยกเลิกการผูกที่หน้า ตั้งค่า › LINE');
        RETURN jsonb_build_object('result', 'LINKED_DRIVER', 'name', v_name);
    END IF;

    -- CUSTOMER: the code itself is the proof. It was issued for this one customer by a member
    -- who serves customers, handed over in person (QR / link), is single use and short-lived.
    IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_k.customer_id AND c.active) THEN
        RETURN jsonb_build_object('result', 'INVALID');
    END IF;
    IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.customer_id = v_k.customer_id AND x.status = 'LINKED') THEN
        RETURN jsonb_build_object('result', 'TARGET_TAKEN');
    END IF;
    UPDATE public.line_link_codes SET used_at = now() WHERE id = v_k.id;
    UPDATE public.line_contacts
       SET status = 'LINKED', customer_id = v_k.customer_id, profile_id = NULL,
           code_failures = 0, code_locked_until = NULL, linked_at = now(), updated_at = now()
     WHERE id = v_c.id;
    SELECT c.name INTO v_name FROM public.customers c WHERE c.id = v_k.customer_id;
    PERFORM public._audit_line(v_k.created_by, 'LINE_LINK', 'CUSTOMER', v_k.customer_id,
                               jsonb_build_object('contact_id', v_c.id, 'code_created_by', v_k.created_by));
    -- The member who handed out the code sees which LINE took it.
    PERFORM public._notify('LINE_LINKED:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                           'LINE_LINKED', 'INFO', v_k.created_by, NULL, 'CUSTOMER', v_k.customer_id,
                           'ลูกค้าผูก LINE แล้ว',
                           'ลูกค้า ' || COALESCE(v_name, '-') || ' ผูกกับ LINE '
                           || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ')
                           || ' ถ้าไม่ใช่ลูกค้าคนนี้ ให้ยกเลิกการผูกที่หน้า LINE');
    RETURN jsonb_build_object('result', 'LINKED_CUSTOMER', 'name', v_name);
END;
$$;

-- Unlink also clears a driver code.
CREATE OR REPLACE FUNCTION public.line_contact_unlink(p_contact_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c       public.line_contacts%ROWTYPE;
    v_reason  text;
BEGIN
    PERFORM public._require_active_member();
    SELECT * INTO v_c FROM public.line_contacts WHERE id = p_contact_id FOR UPDATE;
    IF NOT FOUND OR v_c.status <> 'LINKED' THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = 'P0002';
    END IF;
    IF v_c.profile_id = auth.uid() THEN
        v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
    ELSIF public.is_owner() OR (v_c.customer_id IS NOT NULL AND public.has_menu('line')) THEN
        v_reason := public._require_reason(p_reason);
    ELSE
        RAISE EXCEPTION 'FORBIDDEN: cannot unlink another member''s LINE' USING ERRCODE = '42501';
    END IF;
    UPDATE public.line_contacts
       SET status = 'UNLINKED', profile_id = NULL, customer_id = NULL, driver_code = NULL,
           unlinked_at = now(), unlinked_by = auth.uid(), unlink_reason = v_reason, updated_at = now()
     WHERE id = p_contact_id;
    -- Nothing still queued may reach a person who is no longer linked.
    UPDATE public.line_deliveries SET status = 'CANCELLED', last_error_code = 'UNLINKED', updated_at = now()
     WHERE contact_id = p_contact_id AND status IN ('PENDING', 'FAILED');
    PERFORM public._audit('LINE_UNLINK', CASE WHEN v_c.profile_id IS NOT NULL THEN 'PROFILE'
                                              WHEN v_c.customer_id IS NOT NULL THEN 'CUSTOMER' ELSE 'LINE_CONTACT' END,
                          COALESCE(v_c.profile_id, v_c.customer_id, v_c.id),
                          jsonb_build_object('contact_id', v_c.id, 'driver_code', v_c.driver_code), jsonb_build_object('status', 'UNLINKED'),
                          v_reason, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('contact_id', p_contact_id, 'status', 'UNLINKED');
END;
$$;

-- 3. Work orders to drivers -----------------------------------------------------------------
ALTER TABLE public.line_tasks ADD COLUMN IF NOT EXISTS driver_code text;
ALTER TABLE public.line_tasks ALTER COLUMN assignee_id DROP NOT NULL;
ALTER TABLE public.line_tasks DROP CONSTRAINT IF EXISTS line_tasks_target_check;
ALTER TABLE public.line_tasks ADD CONSTRAINT line_tasks_target_check CHECK (
    num_nonnulls(assignee_id, driver_code) = 1 AND (driver_code IS NULL OR driver_code ~ '^D[0-9]{3,6}$'));
CREATE INDEX IF NOT EXISTS line_tasks_driver_idx ON public.line_tasks (driver_code, status) WHERE driver_code IS NOT NULL;

-- Whoever may dispatch appointments sees the LINE state of driver tasks.
DROP POLICY IF EXISTS line_tasks_select_dispatch ON public.line_tasks;
CREATE POLICY line_tasks_select_dispatch ON public.line_tasks
    FOR SELECT TO authenticated
    USING (driver_code IS NOT NULL AND (SELECT public.is_active_member()) AND (SELECT public.has_menu('appointments')));

-- Send the dispatched appointment to its driver over LINE (outbox). The driver must be the one
-- saved on the appointment (work_order.driver.id): the screen cannot send a job to anyone else.
CREATE OR REPLACE FUNCTION public.line_task_create_driver(
    p_task_id          uuid,
    p_driver_code      text,
    p_title            text,
    p_detail           text,
    p_appointment_id   uuid,
    p_messages         jsonb,
    p_idempotency_key  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_contact uuid;
    v_followed boolean;
    v_task    uuid;
    v_key     text;
    v_dup     uuid;
    v_a       public.appointments%ROWTYPE;
BEGIN
    PERFORM public._require_menu('appointments');
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    v_key := 'T:' || auth.uid() || ':' || p_idempotency_key;
    SELECT task_id INTO v_dup FROM public.line_deliveries WHERE dedupe_key = v_key;
    IF v_dup IS NOT NULL THEN
        RETURN jsonb_build_object('task_id', v_dup, 'duplicate', true);
    END IF;
    IF NOT public._line_messages_valid(p_messages) OR p_task_id IS NULL
       OR position(p_task_id::text IN p_messages::text) = 0 THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.line_tasks WHERE id = p_task_id) THEN
        RAISE EXCEPTION 'DUPLICATE: task id' USING ERRCODE = '23505';
    END IF;
    SELECT * INTO v_a FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
    IF NOT FOUND OR v_a.status IN ('COMPLETED', 'CANCELLED', 'NO_SHOW') THEN
        RAISE EXCEPTION 'APPOINTMENT_NOT_EDITABLE' USING ERRCODE = '23514';
    END IF;
    IF v_a.work_order -> 'driver' ->> 'id' IS DISTINCT FROM p_driver_code THEN
        RAISE EXCEPTION 'DRIVER_NOT_DISPATCHED' USING ERRCODE = '22023';
    END IF;
    IF NOT public._line_driver_active(p_driver_code) THEN
        RAISE EXCEPTION 'DRIVER_NOT_ACTIVE' USING ERRCODE = '22023';
    END IF;
    SELECT id, followed INTO v_contact, v_followed FROM public.line_contacts
     WHERE driver_code = p_driver_code AND status = 'LINKED';
    IF v_contact IS NULL THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = '22023';
    END IF;
    IF NOT v_followed THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNREACHABLE' USING ERRCODE = '22023';
    END IF;
    -- A job has one driver: an earlier driver's open task can no longer be accepted.
    UPDATE public.line_deliveries SET status = 'CANCELLED', last_error_code = 'TASK_CANCELLED', updated_at = now()
     WHERE status IN ('PENDING', 'FAILED')
       AND task_id IN (SELECT t.id FROM public.line_tasks t
                        WHERE t.appointment_id = p_appointment_id AND t.driver_code IS NOT NULL AND t.status IN ('SENT', 'ACCEPTED'));
    UPDATE public.line_tasks
       SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(),
           cancel_reason = 'สั่งงานใหม่', updated_at = now()
     WHERE appointment_id = p_appointment_id AND driver_code IS NOT NULL AND status IN ('SENT', 'ACCEPTED');

    INSERT INTO public.line_tasks (id, title, detail, assignee_id, driver_code, bill_id, appointment_id, created_by)
    VALUES (p_task_id, btrim(p_title), NULLIF(btrim(COALESCE(p_detail, '')), ''), NULL, p_driver_code, v_a.bill_id, p_appointment_id, auth.uid())
    RETURNING id INTO v_task;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, task_id, template_key, messages, dedupe_key, requested_by)
    VALUES (v_contact, 'TASK', v_task, v_task, 'TASK_NEW', p_messages, v_key, auth.uid());
    PERFORM public._audit('LINE_TASK_CREATE', 'LINE_TASK', v_task, NULL,
                          jsonb_build_object('driver_code', p_driver_code, 'appointment_id', p_appointment_id),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('task_id', v_task, 'duplicate', false);
END;
$$;

-- Task postback (webhook, service_role): the assignee is a member or the dispatched driver.
CREATE OR REPLACE FUNCTION public.line_task_postback(p_line_user_id text, p_task_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_t      public.line_tasks%ROWTYPE;
    v_actor  uuid;
    v_driver text;
    v_ok     boolean;
BEGIN
    PERFORM public._line_require_server();
    IF p_action NOT IN ('ACCEPT', 'DONE') THEN
        RETURN jsonb_build_object('result', 'INVALID_STATE');
    END IF;
    -- The sender is an ACTIVE member (profile) or a driver still switched on in the driver list.
    SELECT p.id, c.driver_code INTO v_actor, v_driver
      FROM public.line_contacts c LEFT JOIN public.profiles p ON p.id = c.profile_id AND p.status = 'ACTIVE'
     WHERE c.line_user_id = p_line_user_id AND c.status = 'LINKED';
    SELECT * INTO v_t FROM public.line_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    v_ok := (v_t.assignee_id IS NOT NULL AND v_t.assignee_id = v_actor)
         OR (v_t.driver_code IS NOT NULL AND v_t.driver_code = v_driver AND public._line_driver_active(v_driver));
    IF NOT COALESCE(v_ok, false) THEN
        PERFORM public._audit_line(NULL, 'LINE_TASK_POSTBACK', 'LINE_TASK', p_task_id,
                                   jsonb_build_object('reason', 'NOT_ASSIGNEE'), 'FAILED');
        RETURN jsonb_build_object('result', 'NOT_ASSIGNEE');
    END IF;
    IF (p_action = 'ACCEPT' AND v_t.status IN ('ACCEPTED', 'DONE')) OR (p_action = 'DONE' AND v_t.status = 'DONE') THEN
        RETURN jsonb_build_object('result', 'ALREADY', 'status', v_t.status);
    END IF;
    IF v_t.status = 'CANCELLED' THEN
        RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
    END IF;
    UPDATE public.line_tasks
       SET status = CASE WHEN p_action = 'ACCEPT' THEN 'ACCEPTED' ELSE 'DONE' END,
           accepted_at = COALESCE(accepted_at, now()),
           done_at = CASE WHEN p_action = 'DONE' THEN now() ELSE done_at END,
           updated_at = now()
     WHERE id = p_task_id;
    PERFORM public._audit_line(v_actor, CASE WHEN p_action = 'ACCEPT' THEN 'LINE_TASK_ACCEPT' ELSE 'LINE_TASK_DONE' END,
                               'LINE_TASK', p_task_id, jsonb_build_object('from', v_t.status, 'driver_code', v_t.driver_code));
    -- A driver's "รับงาน" is the job's ACCEPT step: appended once to the appointment's step list
    -- (work_order is the one record of job progress; earlier steps are never rewritten), and only
    -- while that driver is still the one dispatched. "เสร็จแล้ว" stays on the LINE task: staff
    -- confirm the hand-over step in the POS, so no bill, stock or appointment status moves here.
    IF p_action = 'ACCEPT' AND v_t.driver_code IS NOT NULL AND v_t.appointment_id IS NOT NULL THEN
        UPDATE public.appointments a
           SET work_order = jsonb_set(COALESCE(a.work_order, '{}'::jsonb), '{events}',
                   COALESCE(a.work_order -> 'events', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                       'id', gen_random_uuid(), 'stage', 'ACCEPT', 'status', 'DONE',
                       'by', COALESCE(public._line_driver_name(v_driver), v_driver) || ' (LINE)',
                       'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                       'note', 'รับงานทาง LINE')))
         WHERE a.id = v_t.appointment_id
           AND a.status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
           AND a.work_order -> 'driver' ->> 'id' = v_driver
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                               CASE WHEN jsonb_typeof(a.work_order -> 'events') = 'array' THEN a.work_order -> 'events' ELSE '[]'::jsonb END) e
                            WHERE upper(e ->> 'stage') = 'ACCEPT' AND e ->> 'status' = 'DONE');
    END IF;
    RETURN jsonb_build_object('result', CASE WHEN p_action = 'ACCEPT' THEN 'ACCEPTED' ELSE 'DONE' END);
END;
$$;

-- ----------------------------------------------------------------------------
-- Function grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._line_driver_active(text), public._line_driver_name(text)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
    public.appointment_save_guarded(uuid, jsonb, timestamptz),
    public.line_link_code_create_driver(text),
    public.line_task_create_driver(uuid, text, text, text, uuid, jsonb, text)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
    public.appointment_save_guarded(uuid, jsonb, timestamptz),
    public.line_link_code_create_driver(text),
    public.line_task_create_driver(uuid, text, text, text, uuid, jsonb, text)
TO authenticated;
-- line_link_code_consume, line_task_postback, line_contact_unlink keep the grants of
-- 20261008160000 (same signatures, replaced above).
