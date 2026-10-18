-- ============================================================================
-- Driver steps + withdraw over LINE v1 (2026-10-15) — LOCAL MIGRATION, NOT APPLIED TO CLOUD.
-- Needs 20261008160000_line_operations_v1 and 20261010090000_dispatch_driver_line_v1 first.
-- Non-destructive: replaces line_task_postback and adds functions; no table, column or row
-- is changed by the migration itself.
--
-- 1. The job steps (work_order.events, append-only) are the only record of progress. A step
--    belongs to the current dispatch: the events after the latest DISPATCH. A new dispatch
--    (other driver) starts again at รับงาน; earlier steps stay in the list as history.
-- 2. The dispatched driver records each step from LINE, one at a time, in the fixed order of
--    the 9 steps (สั่งงาน and ปิดงาน stay with the shop). The time is the server time of the
--    press. A step already recorded is never written again. The last driver step closes the
--    LINE task (DONE); the appointment itself is closed only by the shop (ปิดงาน).
-- 3. Withdraw: when the job goes to another driver, or the appointment is cancelled, every
--    open LINE task of a driver who no longer holds the job is cancelled and that driver is
--    told on LINE (outbox). A withdrawn driver's buttons are refused from then on.
-- Nothing here touches bills, payments or stock.
-- ============================================================================

-- Placeholders of the LINE texts the OWNER may override (Settings › LINE), now with the driver
-- step / withdraw texts. Same list as LINE_TEMPLATES in lib/line/templates.ts.
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
        WHEN 'CUSTOMER_RETURN_REMINDER' THEN ARRAY['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน']
    END;
$$;

-- Step order of a job (same lists as lib/work-order-stages.ts).
CREATE OR REPLACE FUNCTION public._work_order_stages(p_appointment_type text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE WHEN p_appointment_type = 'RETURN'
        THEN ARRAY['DISPATCH', 'ACCEPT', 'TRANSIT', 'ARRIVED', 'INSPECT', 'COLLECTED', 'RETURN', 'RECEIVED', 'CLOSED']
        ELSE ARRAY['DISPATCH', 'ACCEPT', 'PREPARE', 'PREPARED', 'TRANSIT', 'ARRIVED', 'INSPECT', 'COMPLETED', 'CLOSED']
    END;
$$;

-- Stages recorded DONE in the current dispatch (events after the latest DISPATCH).
CREATE OR REPLACE FUNCTION public._work_order_run_done(p_events jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    WITH ev AS (
        SELECT upper(e ->> 'stage') AS stage, e ->> 'status' AS status, i
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_events) = 'array' THEN p_events ELSE '[]'::jsonb END)
               WITH ORDINALITY AS x(e, i)
    ), last_dispatch AS (
        SELECT COALESCE(max(i), 0) AS i FROM ev WHERE stage = 'DISPATCH' AND status = 'DONE'
    )
    SELECT COALESCE(array_agg(DISTINCT ev.stage), ARRAY[]::text[])
      FROM ev, last_dispatch d
     WHERE ev.i >= d.i AND ev.status = 'DONE';
$$;

-- Next step the driver records (after รับงาน, before ปิดงาน); NULL when all are done.
CREATE OR REPLACE FUNCTION public._work_order_next_driver_stage(p_appointment_type text, p_events jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT s.stage
      FROM unnest(public._work_order_stages(p_appointment_type)) WITH ORDINALITY AS s(stage, i)
     WHERE s.stage NOT IN ('DISPATCH', 'ACCEPT', 'CLOSED')
       AND NOT (s.stage = ANY (public._work_order_run_done(p_events)))
     ORDER BY s.i
     LIMIT 1;
$$;

-- The driver still holds this job: the appointment is open and dispatched to that driver.
CREATE OR REPLACE FUNCTION public._line_driver_holds(p_appointment public.appointments, p_driver text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT p_driver IS NOT NULL
       AND p_appointment.status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
       AND p_appointment.work_order -> 'driver' ->> 'id' = p_driver;
$$;

-- Task postback (webhook, service_role). Staff tasks: unchanged (รับงาน / เสร็จแล้ว).
-- Driver tasks: รับงาน only while the driver holds the job; "เสร็จแล้ว" is refused (the driver
-- records each step instead). The answer carries the next step for the reply button.
CREATE OR REPLACE FUNCTION public.line_task_postback(p_line_user_id text, p_task_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_t      public.line_tasks%ROWTYPE;
    v_a      public.appointments%ROWTYPE;
    v_actor  uuid;
    v_driver text;
    v_ok     boolean;
BEGIN
    PERFORM public._line_require_server();
    IF p_action NOT IN ('ACCEPT', 'DONE') THEN
        RETURN jsonb_build_object('result', 'INVALID_STATE');
    END IF;
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

    IF v_t.driver_code IS NOT NULL THEN
        IF p_action = 'DONE' OR v_t.status = 'CANCELLED' THEN
            RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
        END IF;
        SELECT * INTO v_a FROM public.appointments WHERE id = v_t.appointment_id FOR UPDATE;
        IF NOT FOUND OR NOT public._line_driver_holds(v_a, v_driver) THEN
            PERFORM public._audit_line(NULL, 'LINE_TASK_POSTBACK', 'LINE_TASK', p_task_id,
                                       jsonb_build_object('reason', 'NOT_HOLDER', 'driver_code', v_driver), 'FAILED');
            RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
        END IF;
        IF v_t.status IN ('ACCEPTED', 'DONE') THEN
            RETURN jsonb_build_object('result', 'ALREADY', 'status', v_t.status,
                                      'next_stage', public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events'));
        END IF;
        UPDATE public.line_tasks SET status = 'ACCEPTED', accepted_at = COALESCE(accepted_at, now()), updated_at = now()
         WHERE id = p_task_id;
        PERFORM public._audit_line(NULL, 'LINE_TASK_ACCEPT', 'LINE_TASK', p_task_id,
                                   jsonb_build_object('from', v_t.status, 'driver_code', v_driver));
        -- รับงาน of the current dispatch: appended once, earlier steps are never rewritten
        IF NOT ('ACCEPT' = ANY (public._work_order_run_done(v_a.work_order -> 'events'))) THEN
            UPDATE public.appointments a
               SET work_order = jsonb_set(COALESCE(a.work_order, '{}'::jsonb), '{events}',
                       (CASE WHEN jsonb_typeof(a.work_order -> 'events') = 'array' THEN a.work_order -> 'events' ELSE '[]'::jsonb END)
                       || jsonb_build_array(jsonb_build_object(
                           'id', gen_random_uuid(), 'stage', 'ACCEPT', 'status', 'DONE',
                           'by', COALESCE(public._line_driver_name(v_driver), v_driver) || ' (LINE)',
                           'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                           'note', 'รับงานทาง LINE')))
             WHERE a.id = v_a.id
            RETURNING * INTO v_a;
        END IF;
        RETURN jsonb_build_object('result', 'ACCEPTED',
                                  'next_stage', public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events'));
    END IF;

    -- Staff task (assignee): as in 20261008160000
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
                               'LINE_TASK', p_task_id, jsonb_build_object('from', v_t.status));
    RETURN jsonb_build_object('result', CASE WHEN p_action = 'ACCEPT' THEN 'ACCEPTED' ELSE 'DONE' END);
END;
$$;

-- One job step pressed by the driver on LINE (webhook, service_role). Only the next step in
-- order is recorded; the answer always names the step that comes next (NULL = all done).
CREATE OR REPLACE FUNCTION public.line_task_step(p_line_user_id text, p_task_id uuid, p_stage text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_t      public.line_tasks%ROWTYPE;
    v_a      public.appointments%ROWTYPE;
    v_driver text;
    v_stage  text := upper(btrim(COALESCE(p_stage, '')));
    v_next   text;
BEGIN
    PERFORM public._line_require_server();
    SELECT c.driver_code INTO v_driver FROM public.line_contacts c
     WHERE c.line_user_id = p_line_user_id AND c.status = 'LINKED';
    SELECT * INTO v_t FROM public.line_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    IF v_t.driver_code IS NULL OR v_driver IS DISTINCT FROM v_t.driver_code OR NOT public._line_driver_active(v_driver) THEN
        PERFORM public._audit_line(NULL, 'LINE_TASK_STEP', 'LINE_TASK', p_task_id,
                                   jsonb_build_object('reason', 'NOT_ASSIGNEE', 'stage', v_stage), 'FAILED');
        RETURN jsonb_build_object('result', 'NOT_ASSIGNEE');
    END IF;
    IF v_t.status = 'CANCELLED' THEN
        RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
    END IF;
    SELECT * INTO v_a FROM public.appointments WHERE id = v_t.appointment_id FOR UPDATE;
    IF NOT FOUND OR NOT public._line_driver_holds(v_a, v_driver) THEN
        PERFORM public._audit_line(NULL, 'LINE_TASK_STEP', 'LINE_TASK', p_task_id,
                                   jsonb_build_object('reason', 'NOT_HOLDER', 'stage', v_stage), 'FAILED');
        RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
    END IF;
    IF v_t.status = 'SENT' THEN
        RETURN jsonb_build_object('result', 'NOT_ACCEPTED');
    END IF;
    v_next := public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events');
    IF v_stage = ANY (public._work_order_run_done(v_a.work_order -> 'events')) THEN
        RETURN jsonb_build_object('result', 'ALREADY', 'stage', v_stage, 'next_stage', v_next);
    END IF;
    IF v_next IS NULL OR v_stage IS DISTINCT FROM v_next THEN
        RETURN jsonb_build_object('result', 'OUT_OF_ORDER', 'stage', v_stage, 'next_stage', v_next);
    END IF;

    UPDATE public.appointments a
       SET work_order = jsonb_set(COALESCE(a.work_order, '{}'::jsonb), '{events}',
               (CASE WHEN jsonb_typeof(a.work_order -> 'events') = 'array' THEN a.work_order -> 'events' ELSE '[]'::jsonb END)
               || jsonb_build_array(jsonb_build_object(
                   'id', gen_random_uuid(), 'stage', v_stage, 'status', 'DONE',
                   'by', COALESCE(public._line_driver_name(v_driver), v_driver) || ' (LINE)',
                   'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                   'note', 'อัปเดตทาง LINE')))
     WHERE a.id = v_a.id
    RETURNING * INTO v_a;
    v_next := public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events');
    IF v_next IS NULL THEN
        UPDATE public.line_tasks SET status = 'DONE', done_at = now(), updated_at = now() WHERE id = p_task_id;
    END IF;
    PERFORM public._audit_line(NULL, 'LINE_TASK_STEP', 'LINE_TASK', p_task_id,
                               jsonb_build_object('stage', v_stage, 'driver_code', v_driver, 'appointment_id', v_a.id));
    RETURN jsonb_build_object('result', 'STEP_DONE', 'stage', v_stage, 'next_stage', v_next);
END;
$$;

-- Withdraw (screen, appointments menu): REASSIGN after the job was dispatched to another
-- driver, CANCEL after the appointment was cancelled. Open tasks of drivers who no longer hold
-- the job are cancelled and each such driver gets p_messages on LINE once (outbox).
CREATE OR REPLACE FUNCTION public.line_driver_tasks_withdraw(p_appointment_id uuid, p_kind text, p_messages jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_a        public.appointments%ROWTYPE;
    v_t        record;
    v_contact  uuid;
    v_followed boolean;
    v_reason   text;
    v_n        integer := 0;
    v_sent     integer := 0;
BEGIN
    PERFORM public._require_menu('appointments');
    IF p_kind NOT IN ('REASSIGN', 'CANCEL') THEN
        RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = '22023';
    END IF;
    IF NOT public._line_messages_valid(p_messages) THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_a FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
    IF NOT FOUND
       OR (p_kind = 'CANCEL' AND v_a.status <> 'CANCELLED')
       OR (p_kind = 'REASSIGN' AND v_a.status IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')) THEN
        RAISE EXCEPTION 'APPOINTMENT_NOT_EDITABLE' USING ERRCODE = '23514';
    END IF;
    v_reason := CASE WHEN p_kind = 'CANCEL' THEN 'ยกเลิกงาน' ELSE 'ถอนงาน: เปลี่ยนผู้รับผิดชอบ' END;

    FOR v_t IN
        SELECT t.id, t.driver_code FROM public.line_tasks t
         WHERE t.appointment_id = p_appointment_id AND t.driver_code IS NOT NULL AND t.status IN ('SENT', 'ACCEPTED')
           AND (p_kind = 'CANCEL' OR t.driver_code IS DISTINCT FROM v_a.work_order -> 'driver' ->> 'id')
         ORDER BY t.created_at
         FOR UPDATE OF t
    LOOP
        v_n := v_n + 1;
        UPDATE public.line_deliveries SET status = 'CANCELLED', last_error_code = 'TASK_CANCELLED', updated_at = now()
         WHERE task_id = v_t.id AND status IN ('PENDING', 'FAILED');
        UPDATE public.line_tasks
           SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason, updated_at = now()
         WHERE id = v_t.id;
        SELECT id, followed INTO v_contact, v_followed FROM public.line_contacts
         WHERE driver_code = v_t.driver_code AND status = 'LINKED';
        IF v_contact IS NOT NULL AND v_followed THEN
            INSERT INTO public.line_deliveries (contact_id, source_type, source_id, task_id, template_key, messages, dedupe_key, requested_by)
            VALUES (v_contact, 'TASK', v_t.id, v_t.id,
                    CASE WHEN p_kind = 'CANCEL' THEN 'TASK_CANCELLED' ELSE 'TASK_WITHDRAWN' END,
                    p_messages, 'W:' || v_t.id, auth.uid())
            ON CONFLICT (dedupe_key) DO NOTHING;
            v_sent := v_sent + 1;
        END IF;
        PERFORM public._audit('LINE_TASK_WITHDRAW', 'LINE_TASK', v_t.id, NULL,
                              jsonb_build_object('kind', p_kind, 'driver_code', v_t.driver_code, 'appointment_id', p_appointment_id),
                              v_reason, NULL, false, NULL, NULL, 'LINE');
    END LOOP;
    RETURN jsonb_build_object('withdrawn', v_n, 'queued', v_sent, 'unreachable', v_n - v_sent);
END;
$$;

-- ----------------------------------------------------------------------------
-- Function grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
    public._work_order_stages(text),
    public._work_order_run_done(jsonb),
    public._work_order_next_driver_stage(text, jsonb),
    public._line_driver_holds(public.appointments, text)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.line_task_step(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_task_step(text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.line_driver_tasks_withdraw(uuid, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.line_driver_tasks_withdraw(uuid, text, jsonb) TO authenticated;
-- line_task_postback keeps the grants of 20261008160000 (same signature, replaced above).
