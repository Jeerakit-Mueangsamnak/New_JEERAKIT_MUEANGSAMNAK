-- ============================================================================
-- Appointment delete + unassign v1 (2026-10-15) — LOCAL MIGRATION, NOT APPLIED TO CLOUD.
-- Needs 20261015090000_driver_line_steps_v1 first. Owner-confirmed rules (Master §26):
--
-- 1. ยกเลิกงาน on the job details = the job is deleted from the database (gone from the calendar
--    and the job list). Only through appointment_delete: the no-delete triggers of appointments
--    and appointment_history let a row go only while that function deletes that one job.
--    - A job with a delivery note (deliveries -> delivery_lines -> stock) is refused: the
--      handover record of a bill must stay. Customers, bills, payments and stock are not touched.
--    - Open LINE jobs of its driver are cancelled and the driver is told (outbox); LINE task rows
--      stay as history, unlinked from the job. Waiting customer messages about it are cancelled.
--    - The job and its history are copied into audit_logs (APPOINTMENT_DELETE) before deletion.
--    - Its in-app notices (notifications of entity APPOINTMENT + this id) end as EXPIRED: they
--      leave every list, keep their event_key (so the same notice is never created again) and
--      their LINE copies still waiting are cancelled. Notices of other jobs are not touched.
-- 2. ยกเลิกงาน on the status tab = unassign: the driver's open LINE jobs are cancelled, the driver
--    is told and can no longer press anything; the driver is removed from the job and a WITHDRAW
--    step is appended. The job stays and can be dispatched to someone again.
-- ============================================================================

-- Steps of the current dispatch: after the latest DISPATCH, none once a WITHDRAW follows it.
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
    ), marks AS (
        SELECT COALESCE(max(i) FILTER (WHERE stage = 'DISPATCH' AND status = 'DONE'), 0) AS d,
               COALESCE(max(i) FILTER (WHERE stage = 'WITHDRAW' AND status = 'DONE'), 0) AS w
          FROM ev
    )
    SELECT COALESCE(array_agg(DISTINCT ev.stage), ARRAY[]::text[])
      FROM ev, marks m
     WHERE ev.i >= m.d AND m.w <= m.d AND ev.status = 'DONE';
$$;

-- Cancel the open LINE jobs of drivers on one appointment (all, or all but p_keep_driver) and
-- queue p_messages once to each such driver whose LINE can be reached.
CREATE OR REPLACE FUNCTION public._line_driver_tasks_cancel(
    p_appointment_id uuid,
    p_keep_driver    text,
    p_reason         text,
    p_template       text,
    p_messages       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_t        record;
    v_contact  uuid;
    v_followed boolean;
    v_n        integer := 0;
    v_sent     integer := 0;
BEGIN
    FOR v_t IN
        SELECT t.id, t.driver_code FROM public.line_tasks t
         WHERE t.appointment_id = p_appointment_id AND t.driver_code IS NOT NULL AND t.status IN ('SENT', 'ACCEPTED')
           AND (p_keep_driver IS NULL OR t.driver_code IS DISTINCT FROM p_keep_driver)
         ORDER BY t.created_at
         FOR UPDATE OF t
    LOOP
        v_n := v_n + 1;
        UPDATE public.line_deliveries SET status = 'CANCELLED', last_error_code = 'TASK_CANCELLED', updated_at = now()
         WHERE task_id = v_t.id AND status IN ('PENDING', 'FAILED');
        UPDATE public.line_tasks
           SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason, updated_at = now()
         WHERE id = v_t.id;
        v_contact := NULL;
        SELECT id, followed INTO v_contact, v_followed FROM public.line_contacts
         WHERE driver_code = v_t.driver_code AND status = 'LINKED';
        IF v_contact IS NOT NULL AND v_followed AND p_messages IS NOT NULL THEN
            INSERT INTO public.line_deliveries (contact_id, source_type, source_id, task_id, template_key, messages, dedupe_key, requested_by)
            VALUES (v_contact, 'TASK', v_t.id, v_t.id, p_template, p_messages, 'W:' || v_t.id, auth.uid())
            ON CONFLICT (dedupe_key) DO NOTHING;
            v_sent := v_sent + 1;
        END IF;
        PERFORM public._audit('LINE_TASK_WITHDRAW', 'LINE_TASK', v_t.id, NULL,
                              jsonb_build_object('driver_code', v_t.driver_code, 'appointment_id', p_appointment_id),
                              p_reason, NULL, false, NULL, NULL, 'LINE');
    END LOOP;
    RETURN jsonb_build_object('withdrawn', v_n, 'queued', v_sent, 'unreachable', v_n - v_sent);
END;
$$;

-- Withdraw (screen, appointments menu):
--   REASSIGN  after the job was dispatched to another driver (other drivers' jobs end)
--   CANCEL    after the appointment was cancelled by status (older jobs; kept as before)
--   UNASSIGN  ยกเลิกงาน on the status tab: the driver is taken off the job, the job stays open
CREATE OR REPLACE FUNCTION public.line_driver_tasks_withdraw(p_appointment_id uuid, p_kind text, p_messages jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_a      public.appointments%ROWTYPE;
    v_driver text;
    v_by     text;
    v_r      jsonb;
BEGIN
    PERFORM public._require_menu('appointments');
    IF p_kind NOT IN ('REASSIGN', 'CANCEL', 'UNASSIGN') THEN
        RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = '22023';
    END IF;
    IF NOT public._line_messages_valid(p_messages) THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_a FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
    IF NOT FOUND
       OR (p_kind = 'CANCEL' AND v_a.status <> 'CANCELLED')
       OR (p_kind IN ('REASSIGN', 'UNASSIGN') AND v_a.status IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')) THEN
        RAISE EXCEPTION 'APPOINTMENT_NOT_EDITABLE' USING ERRCODE = '23514';
    END IF;
    v_driver := v_a.work_order -> 'driver' ->> 'id';

    IF p_kind = 'UNASSIGN' THEN
        IF v_driver IS NULL THEN
            RAISE EXCEPTION 'APPOINTMENT_NOT_DISPATCHED' USING ERRCODE = '22023';
        END IF;
        v_r := public._line_driver_tasks_cancel(p_appointment_id, NULL, 'ถอนงาน: ร้านถอนงานเพื่อสั่งใหม่', 'TASK_WITHDRAWN', p_messages);
        SELECT COALESCE(NULLIF(btrim(display_name), ''), username) INTO v_by FROM public.profiles WHERE id = auth.uid();
        UPDATE public.appointments a
           SET work_order = jsonb_set(COALESCE(a.work_order, '{}'::jsonb) - 'driver', '{events}',
                   (CASE WHEN jsonb_typeof(a.work_order -> 'events') = 'array' THEN a.work_order -> 'events' ELSE '[]'::jsonb END)
                   || jsonb_build_array(jsonb_build_object(
                       'id', gen_random_uuid(), 'stage', 'WITHDRAW', 'status', 'DONE', 'by', v_by,
                       'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                       'note', 'ถอนงานจาก ' || COALESCE(public._line_driver_name(v_driver), v_driver) || ' (' || v_driver || ')')))
         WHERE a.id = p_appointment_id;
        PERFORM public._audit('APPOINTMENT_UNASSIGN', 'APPOINTMENT', p_appointment_id,
                              jsonb_build_object('driver_code', v_driver), NULL, NULL, NULL);
        RETURN v_r;
    END IF;

    RETURN public._line_driver_tasks_cancel(
        p_appointment_id,
        CASE WHEN p_kind = 'REASSIGN' THEN v_driver END,
        CASE WHEN p_kind = 'CANCEL' THEN 'ยกเลิกงาน' ELSE 'ถอนงาน: เปลี่ยนผู้รับผิดชอบ' END,
        CASE WHEN p_kind = 'CANCEL' THEN 'TASK_CANCELLED' ELSE 'TASK_WITHDRAWN' END,
        p_messages);
END;
$$;

-- The no-delete triggers of appointments / appointment_history (Master §3.3 still holds for
-- every other path): a row may go only while appointment_delete deletes that one job.
CREATE OR REPLACE FUNCTION public._appointment_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_job text := NULLIF(current_setting('pos.appointment_delete_id', true), '');
    v_row text;
BEGIN
    IF TG_OP = 'DELETE' AND v_job IS NOT NULL THEN
        IF TG_TABLE_NAME = 'appointments' THEN
            v_row := to_jsonb(OLD) ->> 'id';
        ELSE
            v_row := to_jsonb(OLD) ->> 'appointment_id';
        END IF;
        IF v_row = v_job THEN
            RETURN OLD;
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'appointment_history' THEN
        RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'NO_HARD_DELETE: deleting from %.% is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_no_delete ON public.appointments;
CREATE TRIGGER trg_appointments_no_delete BEFORE DELETE ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public._appointment_delete_guard();
DROP TRIGGER IF EXISTS trg_appointment_history_append_only ON public.appointment_history;
CREATE TRIGGER trg_appointment_history_append_only BEFORE UPDATE OR DELETE ON public.appointment_history
    FOR EACH ROW EXECUTE FUNCTION public._appointment_delete_guard();

-- ยกเลิกงาน on the job details: delete the job (appointments menu, same right as cancel).
CREATE OR REPLACE FUNCTION public.appointment_delete(p_appointment_id uuid, p_messages jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_a       public.appointments%ROWTYPE;
    v_history jsonb;
    v_r       jsonb;
    v_unlinked integer;
    v_notices  integer;
BEGIN
    PERFORM public._require_menu('appointments');
    IF p_messages IS NOT NULL AND NOT public._line_messages_valid(p_messages) THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_a FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- A delivery note is the bill's handover / stock record: never removed with a job.
    IF EXISTS (SELECT 1 FROM public.deliveries d WHERE d.appointment_id = p_appointment_id) THEN
        RAISE EXCEPTION 'APPOINTMENT_HAS_DELIVERY' USING ERRCODE = '23503';
    END IF;

    -- The driver is told first; LINE task rows stay as history without the job.
    v_r := public._line_driver_tasks_cancel(p_appointment_id, NULL, 'ยกเลิกงาน: ลบงาน', 'TASK_CANCELLED', p_messages);
    UPDATE public.line_tasks SET appointment_id = NULL, updated_at = now() WHERE appointment_id = p_appointment_id;
    GET DIAGNOSTICS v_unlinked = ROW_COUNT;
    UPDATE public.line_deliveries SET status = 'CANCELLED', last_error_code = 'APPOINTMENT_DELETED', updated_at = now()
     WHERE source_type = 'APPOINTMENT' AND source_id = p_appointment_id AND status IN ('PENDING', 'FAILED');

    -- Notices of this job only: ended (EXPIRED, out of every list) and their waiting LINE copies cancelled
    UPDATE public.notifications SET status = 'EXPIRED', expires_at = COALESCE(expires_at, now())
     WHERE entity_type = 'APPOINTMENT' AND entity_id = p_appointment_id AND status IN ('UNREAD', 'READ', 'HANDLED');
    GET DIAGNOSTICS v_notices = ROW_COUNT;
    UPDATE public.line_deliveries d SET status = 'CANCELLED', last_error_code = 'APPOINTMENT_DELETED', updated_at = now()
      FROM public.notifications n
     WHERE d.notification_id = n.id AND n.entity_type = 'APPOINTMENT' AND n.entity_id = p_appointment_id
       AND d.status IN ('PENDING', 'FAILED');

    SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.created_at), '[]'::jsonb) INTO v_history
      FROM public.appointment_history h WHERE h.appointment_id = p_appointment_id;
    PERFORM public._audit('APPOINTMENT_DELETE', 'APPOINTMENT', p_appointment_id,
                          jsonb_build_object('appointment', to_jsonb(v_a), 'history', v_history), NULL, NULL, NULL);

    PERFORM set_config('pos.appointment_delete_id', p_appointment_id::text, true);
    DELETE FROM public.appointment_history WHERE appointment_id = p_appointment_id;
    DELETE FROM public.appointments WHERE id = p_appointment_id;
    PERFORM set_config('pos.appointment_delete_id', '', true);

    RETURN v_r || jsonb_build_object('deleted', true, 'line_tasks_kept', v_unlinked, 'notices_ended', v_notices);
END;
$$;

-- System LINE copies of a notice (as in 20261008160000): an ended notice (EXPIRED, e.g. the job
-- was deleted) is never queued again.
CREATE OR REPLACE FUNCTION public.line_outbox_enqueue_system(
    p_contact_id       uuid,
    p_source_type      text,
    p_source_id        uuid,
    p_notification_id  uuid,
    p_template_key     text,
    p_messages         jsonb,
    p_dedupe_key       text
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
    IF p_source_type NOT IN ('NOTIFICATION', 'DAILY_SUMMARY') THEN
        RAISE EXCEPTION 'LINE_SOURCE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT public._line_messages_valid(p_messages) THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.id = p_contact_id AND c.status = 'LINKED' AND c.followed) THEN
        RETURN jsonb_build_object('skipped', 'CONTACT_NOT_LINKED');
    END IF;
    IF p_notification_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.notifications n WHERE n.id = p_notification_id AND n.status = 'EXPIRED') THEN
        RETURN jsonb_build_object('skipped', 'NOTIFICATION_ENDED');
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, notification_id, template_key, messages, dedupe_key)
    VALUES (p_contact_id, p_source_type, p_source_id, p_notification_id, p_template_key, p_messages, 'S:' || p_dedupe_key)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('delivery_id', v_id, 'duplicate', v_id IS NULL);
END;
$$;

-- ----------------------------------------------------------------------------
-- Function grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._line_driver_tasks_cancel(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._appointment_delete_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.appointment_delete(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.appointment_delete(uuid, jsonb) TO authenticated;
-- _work_order_run_done and line_driver_tasks_withdraw keep the grants of 20261015090000;
-- line_outbox_enqueue_system keeps the grants of 20261008160000 (same signature, replaced above).
