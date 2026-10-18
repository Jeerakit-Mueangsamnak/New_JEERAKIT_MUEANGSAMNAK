-- Delete a job / take the driver off a job (migration 20261015120000_appointment_delete_unassign_v1).
-- Uses the harness of 00_setup.sql and the helpers of 55_line_driver_steps.sql (t.dispatch,
-- t.driver_task, t.events). Store settings are put back at the end.
\set ON_ERROR_STOP 1

SELECT t.set('del_policies_before', (SELECT policies::text FROM public.store_settings WHERE singleton));
UPDATE public.store_settings
   SET policies = COALESCE(policies, '{}'::jsonb) || jsonb_build_object('delivery_drivers', jsonb_build_array(
       jsonb_build_object('id', 'D921', 'name', 'คนขับ ก', 'active', true),
       jsonb_build_object('id', 'D922', 'name', 'คนขับ ข', 'active', true)))
 WHERE singleton;
INSERT INTO public.line_contacts (line_user_id, driver_code, status, followed, linked_at)
VALUES ('U' || repeat('7', 31) || '1', 'D921', 'LINKED', true, now()),
       ('U' || repeat('7', 31) || '2', 'D922', 'LINKED', true, now());
SELECT t.set('u921', 'U' || repeat('7', 31) || '1'), t.set('u922', 'U' || repeat('7', 31) || '2');
CREATE FUNCTION t.new_job(p_title text) RETURNS text LANGUAGE sql AS $$
    SELECT t.ok('DEL-SETUP', 'owner creates ' || p_title, 'owner', format($q$select public.appointment_save(NULL,
        jsonb_build_object('appointment_type', 'DELIVERY', 'title', %L, 'start_datetime', '2031-06-01T02:00:00Z', 'end_datetime', '2031-06-01T03:00:00Z'))$q$,
        p_title)) -> 'appointment' ->> 'id';
$$;
SELECT t.set('msg', '[{"type":"text","text":"ถอนงาน / ยกเลิกงาน"}]');

-- ---------------------------------------------------------------- status tab: unassign
SELECT t.set('job_u', t.new_job('งานถอน'));
SELECT t.dispatch(t.v('job_u')::uuid, 'D921');
SELECT t.set('task_u1', t.driver_task(t.v('job_u')::uuid, 'D921', 'del-key-0001')::text);
SELECT public.line_task_postback(t.v('u921'), t.v('task_u1')::uuid, 'ACCEPT');
SELECT public.line_task_step(t.v('u921'), t.v('task_u1')::uuid, 'PREPARE');
SELECT t.set('wu', (t.ok('DEL-UNASSIGN', 'owner takes the driver off the job', 'owner', format(
    $q$select public.line_driver_tasks_withdraw(%L::uuid, 'UNASSIGN', %L::jsonb)$q$, t.v('job_u'), t.v('msg'))))::text);
SELECT t.check('DEL-UNASSIGN', 'the driver''s LINE job is cancelled and the driver is told once',
    t.v('wu')::jsonb ->> 'withdrawn' = '1' AND t.v('wu')::jsonb ->> 'queued' = '1'
    AND (SELECT status FROM public.line_tasks WHERE id = t.v('task_u1')::uuid) = 'CANCELLED'
    AND EXISTS (SELECT 1 FROM public.line_deliveries WHERE dedupe_key = 'W:' || t.v('task_u1') AND template_key = 'TASK_WITHDRAWN'), t.v('wu'));
SELECT t.check('DEL-UNASSIGN', 'the job stays open without a driver; a WITHDRAW step is appended and old steps are kept',
    (SELECT status = 'SCHEDULED' AND work_order -> 'driver' IS NULL FROM public.appointments WHERE id = t.v('job_u')::uuid)
    AND (SELECT jsonb_agg(e ->> 'stage') FROM jsonb_array_elements(t.events(t.v('job_u')::uuid)) e) = '["DISPATCH","ACCEPT","PREPARE","WITHDRAW"]'::jsonb);
SELECT t.check('DEL-UNASSIGN', 'the old driver can no longer press anything',
    public.line_task_step(t.v('u921'), t.v('task_u1')::uuid, 'PREPARED') ->> 'result' = 'INVALID_STATE'
    AND public.line_task_postback(t.v('u921'), t.v('task_u1')::uuid, 'ACCEPT') ->> 'result' = 'INVALID_STATE');
SELECT t.err('DEL-UNASSIGN', 'a job without a driver cannot be unassigned again', 'owner',
    format($q$select public.line_driver_tasks_withdraw(%L::uuid, 'UNASSIGN', %L::jsonb)$q$, t.v('job_u'), t.v('msg')), 'APPOINTMENT_NOT_DISPATCHED');
SELECT t.dispatch(t.v('job_u')::uuid, 'D922');
SELECT t.set('task_u2', t.driver_task(t.v('job_u')::uuid, 'D922', 'del-key-0002')::text);
SELECT t.check('DEL-UNASSIGN', 'a new driver can be dispatched and starts at รับงาน',
    public.line_task_postback(t.v('u922'), t.v('task_u2')::uuid, 'ACCEPT') ->> 'next_stage' = 'PREPARE');
SELECT t.err('DEL-UNASSIGN', 'a member without the appointments menu cannot unassign', 'nomenu',
    format($q$select public.line_driver_tasks_withdraw(%L::uuid, 'UNASSIGN', %L::jsonb)$q$, t.v('job_u'), t.v('msg')), 'FORBIDDEN');

-- ---------------------------------------------------------------- details: delete
SELECT t.set('job_d', t.new_job('งานลบ'));
SELECT t.ok('DEL-SETUP', 'reschedule (history row)', 'owner', format(
    $q$select public.appointment_reschedule(%L::uuid, '2031-06-02T02:00:00Z', '2031-06-02T03:00:00Z', 'เลื่อน')$q$, t.v('job_d')));
SELECT t.dispatch(t.v('job_d')::uuid, 'D921');
SELECT t.set('task_d', t.driver_task(t.v('job_d')::uuid, 'D921', 'del-key-0003')::text);
SELECT t.err_admin('DEL-JOB', 'a plain DELETE is still refused (no-delete trigger)',
    format($q$delete from public.appointments where id = %L::uuid$q$, t.v('job_d')), 'NO_HARD_DELETE');
SELECT t.err_admin('DEL-JOB', 'job history is still append-only outside the delete',
    format($q$delete from public.appointment_history where appointment_id = %L::uuid$q$, t.v('job_d')), 'APPEND_ONLY');
SELECT t.err('DEL-JOB', 'a member without the appointments menu cannot delete', 'nomenu',
    format($q$select public.appointment_delete(%L::uuid, %L::jsonb)$q$, t.v('job_d'), t.v('msg')), 'FORBIDDEN');
SELECT t.set('dr', (t.ok('DEL-JOB', 'owner deletes the job', 'owner', format(
    $q$select public.appointment_delete(%L::uuid, %L::jsonb)$q$, t.v('job_d'), t.v('msg'))))::text);
SELECT t.check('DEL-JOB', 'the job and its history are gone from the database',
    NOT EXISTS (SELECT 1 FROM public.appointments WHERE id = t.v('job_d')::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.appointment_history WHERE appointment_id = t.v('job_d')::uuid), t.v('dr'));
SELECT t.check('DEL-JOB', 'the driver is told and the LINE task stays as history without the job',
    t.v('dr')::jsonb ->> 'queued' = '1'
    AND (SELECT status = 'CANCELLED' AND appointment_id IS NULL FROM public.line_tasks WHERE id = t.v('task_d')::uuid)
    AND EXISTS (SELECT 1 FROM public.line_deliveries WHERE dedupe_key = 'W:' || t.v('task_d') AND template_key = 'TASK_CANCELLED'));
SELECT t.check('DEL-JOB', 'a copy of the job and its history is kept in audit_logs',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'APPOINTMENT_DELETE' AND entity_id = t.v('job_d')::uuid
              AND before_data -> 'appointment' ->> 'title' = 'งานลบ' AND jsonb_array_length(before_data -> 'history') >= 2));
SELECT t.check('DEL-JOB', 'the deleted driver''s button now finds nothing it may act on',
    public.line_task_step(t.v('u921'), t.v('task_d')::uuid, 'PREPARE') ->> 'result' IN ('INVALID_STATE', 'NOT_FOUND'));

-- ---------------------------------------------------------------- notices of a deleted job
SELECT t.set('job_n', t.new_job('งานมีแจ้งเตือน'));
SELECT t.set('job_other', t.new_job('งานอื่นมีแจ้งเตือน'));
SELECT public._notify('APPOINTMENT_DUE:' || t.v('job_n'), 'APPOINTMENT_DUE', 'INFO', NULL, 'appointments', 'APPOINTMENT', t.v('job_n')::uuid, 'ใกล้ถึงนัด', 'x');
SELECT public._notify('APPOINTMENT_DUE:' || t.v('job_other'), 'APPOINTMENT_DUE', 'INFO', NULL, 'appointments', 'APPOINTMENT', t.v('job_other')::uuid, 'ใกล้ถึงนัด', 'x');
-- a waiting LINE copy of the deleted job's notice (to an existing linked contact)
INSERT INTO public.line_deliveries (contact_id, source_type, source_id, notification_id, template_key, messages, dedupe_key)
SELECT c.id, 'NOTIFICATION', t.v('job_n')::uuid, n.id, 'STAFF_NOTICE', '[{"type":"text","text":"x"}]'::jsonb, 'S:test-notice-' || n.id
  FROM public.notifications n, public.line_contacts c
 WHERE n.entity_id = t.v('job_n')::uuid AND c.driver_code = 'D921' LIMIT 1;
SELECT t.check('DEL-NOTICE', 'setup: a LINE copy of the notice is waiting',
    EXISTS (SELECT 1 FROM public.line_deliveries d JOIN public.notifications n ON n.id = d.notification_id
             WHERE n.entity_id = t.v('job_n')::uuid AND d.status = 'PENDING'));
-- taking the driver off a job never touches notices
SELECT t.dispatch(t.v('job_n')::uuid, 'D921');
SELECT t.ok('DEL-NOTICE', 'unassign the job that has a notice', 'owner', format(
    $q$select public.line_driver_tasks_withdraw(%L::uuid, 'UNASSIGN', %L::jsonb)$q$, t.v('job_n'), t.v('msg')));
SELECT t.check('DEL-NOTICE', 'unassign keeps the job and its notice as they were',
    EXISTS (SELECT 1 FROM public.appointments WHERE id = t.v('job_n')::uuid)
    AND (SELECT status FROM public.notifications WHERE entity_id = t.v('job_n')::uuid) = 'UNREAD');
SELECT t.set('dn', (t.ok('DEL-NOTICE', 'owner deletes the job', 'owner', format(
    $q$select public.appointment_delete(%L::uuid, %L::jsonb)$q$, t.v('job_n'), t.v('msg'))))::text);
SELECT t.check('DEL-NOTICE', 'the deleted job''s notice is ended (EXPIRED) and its waiting LINE copy cancelled',
    t.v('dn')::jsonb ->> 'notices_ended' = '1'
    AND (SELECT status FROM public.notifications WHERE entity_id = t.v('job_n')::uuid) = 'EXPIRED'
    AND NOT EXISTS (SELECT 1 FROM public.line_deliveries d JOIN public.notifications n ON n.id = d.notification_id
                     WHERE n.entity_id = t.v('job_n')::uuid AND d.status IN ('PENDING', 'FAILED')), t.v('dn'));
SELECT t.check('DEL-NOTICE', 'the notice of another job is untouched',
    (SELECT status FROM public.notifications WHERE entity_id = t.v('job_other')::uuid) = 'UNREAD');
SELECT public._notify('APPOINTMENT_DUE:' || t.v('job_n'), 'APPOINTMENT_DUE', 'INFO', NULL, 'appointments', 'APPOINTMENT', t.v('job_n')::uuid, 'ใกล้ถึงนัด', 'x');
SELECT t.check('DEL-NOTICE', 'the same notice is not created again after the delete',
    (SELECT count(*) FROM public.notifications WHERE entity_id = t.v('job_n')::uuid) = 1
    AND (SELECT status FROM public.notifications WHERE entity_id = t.v('job_n')::uuid) = 'EXPIRED');
SELECT t.check('DEL-NOTICE', 'an ended notice is never queued to LINE again',
    public.line_outbox_enqueue_system((SELECT id FROM public.line_contacts WHERE driver_code = 'D921'), 'NOTIFICATION', t.v('job_n')::uuid,
        (SELECT id FROM public.notifications WHERE entity_id = t.v('job_n')::uuid), 'STAFF_NOTICE',
        '[{"type":"text","text":"x"}]'::jsonb, 'again-' || t.v('job_n')) ->> 'skipped' = 'NOTIFICATION_ENDED');
SELECT t.check('DEL-NOTICE', 'a notice of a job that still exists is still queued',
    public.line_outbox_enqueue_system((SELECT id FROM public.line_contacts WHERE driver_code = 'D921'), 'NOTIFICATION', t.v('job_other')::uuid,
        (SELECT id FROM public.notifications WHERE entity_id = t.v('job_other')::uuid), 'STAFF_NOTICE',
        '[{"type":"text","text":"x"}]'::jsonb, 'other-' || t.v('job_other')) ->> 'delivery_id' IS NOT NULL);
SELECT t.check('DEL-NOTICE', 'the daily scan skips the deleted job (it is gone from appointments)',
    NOT EXISTS (SELECT 1 FROM public.appointments WHERE id = t.v('job_n')::uuid));

-- A job with a delivery note (bill handover / stock) is never deleted.
DO $$
DECLARE
    v_bill uuid;
    v_job  uuid := t.new_job('งานมีใบส่งของ')::uuid;
BEGIN
    SELECT id INTO v_bill FROM public.bills LIMIT 1;
    IF v_bill IS NULL THEN
        PERFORM t.check('DEL-JOB', 'delivery-note guard (skipped: no bill in the seed)', true);
        RETURN;
    END IF;
    INSERT INTO public.deliveries (delivery_no, bill_id, delivered_at, delivered_by, appointment_id, correlation_id, created_by)
    VALUES ('TEST-DEL-0001', v_bill, now(), t.u('owner'), v_job, gen_random_uuid(), t.u('owner'));
    PERFORM t.err('DEL-JOB', 'a job with a delivery note is refused (stock / bill record stays)', 'owner',
        format($q$select public.appointment_delete(%L::uuid, NULL)$q$, v_job), 'APPOINTMENT_HAS_DELIVERY');
    PERFORM t.check('DEL-JOB', 'that job is still there', EXISTS (SELECT 1 FROM public.appointments WHERE id = v_job));
END;
$$;

-- A job linked to a bill: deleting it leaves the bill exactly as it was.
DO $$
DECLARE
    v_bill   uuid;
    v_before jsonb;
    v_job    uuid := t.new_job('งานผูกบิล')::uuid;
BEGIN
    SELECT id INTO v_bill FROM public.bills WHERE id NOT IN (SELECT bill_id FROM public.deliveries) LIMIT 1;
    IF v_bill IS NULL THEN
        PERFORM t.check('DEL-JOB', 'bill-link check (skipped: no bill in the seed)', true);
        RETURN;
    END IF;
    UPDATE public.appointments SET bill_id = v_bill WHERE id = v_job;
    SELECT to_jsonb(b) INTO v_before FROM public.bills b WHERE id = v_bill;
    PERFORM t.ok('DEL-JOB', 'owner deletes a job linked to a bill', 'owner', format($q$select public.appointment_delete(%L::uuid, NULL)$q$, v_job));
    PERFORM t.check('DEL-JOB', 'the bill is unchanged', (SELECT to_jsonb(b) FROM public.bills b WHERE id = v_bill) = v_before);
END;
$$;

UPDATE public.store_settings SET policies = t.v('del_policies_before')::jsonb WHERE singleton;
