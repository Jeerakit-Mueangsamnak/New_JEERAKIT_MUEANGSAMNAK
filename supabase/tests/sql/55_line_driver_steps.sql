-- Driver steps + withdraw over LINE (migration 20261015090000_driver_line_steps_v1).
-- Uses the harness of 00_setup.sql. Webhook RPCs are called as the server (postgres), like
-- 50_line_security.sql. Store settings are put back at the end.
\set ON_ERROR_STOP 1

SELECT t.set('drv_policies_before', (SELECT policies::text FROM public.store_settings WHERE singleton));
UPDATE public.store_settings
   SET policies = COALESCE(policies, '{}'::jsonb) || jsonb_build_object('delivery_drivers', jsonb_build_array(
       jsonb_build_object('id', 'D901', 'name', 'คนขับเก่า', 'active', true),
       jsonb_build_object('id', 'D902', 'name', 'คนขับใหม่', 'active', true)))
 WHERE singleton;
INSERT INTO public.line_contacts (line_user_id, driver_code, status, followed, linked_at)
VALUES ('U' || repeat('9', 31) || '1', 'D901', 'LINKED', true, now()),
       ('U' || repeat('9', 31) || '2', 'D902', 'LINKED', true, now());
SELECT t.set('u901', 'U' || repeat('9', 31) || '1'), t.set('u902', 'U' || repeat('9', 31) || '2');

-- A job dispatched to D901 (the shop's สั่งงาน = driver + DISPATCH step), then its LINE task.
SELECT t.set('drv_apt', (t.ok('DRV-SETUP', 'owner creates a job', 'owner', $q$select public.appointment_save(NULL,
    '{"appointment_type":"DELIVERY","title":"ส่งสินค้า ทดสอบ LINE","start_datetime":"2031-05-01T02:00:00Z","end_datetime":"2031-05-01T03:00:00Z"}'::jsonb)$q$)
    -> 'appointment' ->> 'id'));
CREATE FUNCTION t.dispatch(p_apt uuid, p_driver text) RETURNS void LANGUAGE sql AS $$
    UPDATE public.appointments
       SET work_order = jsonb_build_object('driver', jsonb_build_object('id', p_driver, 'name', p_driver),
           'events', COALESCE(work_order -> 'events', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'id', gen_random_uuid(), 'stage', 'DISPATCH', 'status', 'DONE', 'timestamp', now())))
     WHERE id = p_apt;
$$;
CREATE FUNCTION t.driver_task(p_apt uuid, p_driver text, p_key text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid := gen_random_uuid();
BEGIN
    PERFORM t.ok('DRV-SETUP', 'task sent to ' || p_driver, 'owner', format(
        $q$select public.line_task_create_driver(%L::uuid, %L, 'ส่งสินค้า', NULL, %L::uuid, %L::jsonb, %L)$q$,
        v_id, p_driver, p_apt, jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'งาน ' || v_id)), p_key));
    RETURN v_id;
END;
$$;
CREATE FUNCTION t.events(p_apt uuid) RETURNS jsonb LANGUAGE sql AS $$
    SELECT COALESCE(work_order -> 'events', '[]'::jsonb) FROM public.appointments WHERE id = p_apt;
$$;
SELECT t.dispatch(t.v('drv_apt')::uuid, 'D901');
SELECT t.set('task1', t.driver_task(t.v('drv_apt')::uuid, 'D901', 'drv-key-0001')::text);

-- ---------------------------------------------------------------- steps from LINE
SELECT t.check('DRV-STEP', 'a step before รับงาน is refused',
    public.line_task_step(t.v('u901'), t.v('task1')::uuid, 'PREPARE') ->> 'result' = 'NOT_ACCEPTED');
SELECT t.set('acc1', public.line_task_postback(t.v('u901'), t.v('task1')::uuid, 'ACCEPT')::text);
SELECT t.check('DRV-STEP', 'รับงาน records ACCEPT and names the next step',
    t.v('acc1')::jsonb ->> 'result' = 'ACCEPTED' AND t.v('acc1')::jsonb ->> 'next_stage' = 'PREPARE'
    AND (SELECT count(*) FROM jsonb_array_elements(t.events(t.v('drv_apt')::uuid)) e WHERE e ->> 'stage' = 'ACCEPT') = 1, t.v('acc1'));
SELECT t.set('acc_time', (SELECT e ->> 'timestamp' FROM jsonb_array_elements(t.events(t.v('drv_apt')::uuid)) e WHERE e ->> 'stage' = 'ACCEPT'));
SELECT t.check('DRV-STEP', 'pressing รับงาน again adds nothing',
    public.line_task_postback(t.v('u901'), t.v('task1')::uuid, 'ACCEPT') ->> 'result' = 'ALREADY'
    AND jsonb_array_length(t.events(t.v('drv_apt')::uuid)) = 2);
SELECT t.check('DRV-STEP', '"เสร็จแล้ว" is refused on a driver job (steps are recorded one by one)',
    public.line_task_postback(t.v('u901'), t.v('task1')::uuid, 'DONE') ->> 'result' = 'INVALID_STATE');
SELECT t.check('DRV-STEP', 'a step out of order is refused and the right next step is named',
    (SELECT r ->> 'result' = 'OUT_OF_ORDER' AND r ->> 'next_stage' = 'PREPARE'
       FROM public.line_task_step(t.v('u901'), t.v('task1')::uuid, 'TRANSIT') r)
    AND jsonb_array_length(t.events(t.v('drv_apt')::uuid)) = 2);
SELECT t.check('DRV-STEP', 'shop steps (สั่งงาน / ปิดงาน) cannot be pressed from LINE',
    public.line_task_step(t.v('u901'), t.v('task1')::uuid, 'CLOSED') ->> 'result' = 'OUT_OF_ORDER'
    AND public.line_task_step(t.v('u901'), t.v('task1')::uuid, 'DISPATCH') ->> 'result' IN ('OUT_OF_ORDER', 'ALREADY')
    AND jsonb_array_length(t.events(t.v('drv_apt')::uuid)) = 2);
SELECT t.check('DRV-STEP', 'another driver cannot press this job',
    public.line_task_step(t.v('u902'), t.v('task1')::uuid, 'PREPARE') ->> 'result' = 'NOT_ASSIGNEE');
SELECT t.set('st1', public.line_task_step(t.v('u901'), t.v('task1')::uuid, 'PREPARE')::text);
SELECT t.check('DRV-STEP', 'the next step is recorded with its own time, by the driver (LINE)',
    t.v('st1')::jsonb ->> 'result' = 'STEP_DONE' AND t.v('st1')::jsonb ->> 'next_stage' = 'PREPARED'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.events(t.v('drv_apt')::uuid)) e
                 WHERE e ->> 'stage' = 'PREPARE' AND e ->> 'status' = 'DONE' AND e ->> 'timestamp' IS NOT NULL
                   AND e ->> 'by' = 'คนขับเก่า (LINE)'), t.v('st1'));
SELECT t.check('DRV-STEP', 'the earlier step time is not rewritten',
    (SELECT e ->> 'timestamp' FROM jsonb_array_elements(t.events(t.v('drv_apt')::uuid)) e WHERE e ->> 'stage' = 'ACCEPT') = t.v('acc_time'));
SELECT t.check('DRV-STEP', 'pressing the same step again adds nothing',
    public.line_task_step(t.v('u901'), t.v('task1')::uuid, 'PREPARE') ->> 'result' = 'ALREADY'
    AND jsonb_array_length(t.events(t.v('drv_apt')::uuid)) = 3);
SELECT t.err('DRV-STEP', 'a signed-in member cannot call the LINE step RPC', 'owner',
    format($q$select public.line_task_step('U00000000000000000000000000000000', %L::uuid, 'PREPARE')$q$, t.v('task1')), 'permission denied');

-- ---------------------------------------------------------------- re-dispatch to another driver
SELECT t.dispatch(t.v('drv_apt')::uuid, 'D902');
SELECT t.set('w1', (t.ok('DRV-MOVE', 'withdraw after re-dispatch', 'owner', format(
    $q$select public.line_driver_tasks_withdraw(%L::uuid, 'REASSIGN', '[{"type":"text","text":"ถอนงาน: ส่งสินค้า"}]'::jsonb)$q$,
    t.v('drv_apt'))))::text);
SELECT t.check('DRV-MOVE', 'the old driver''s task is cancelled and one withdraw notice is queued to him',
    t.v('w1')::jsonb ->> 'withdrawn' = '1' AND t.v('w1')::jsonb ->> 'queued' = '1'
    AND (SELECT status FROM public.line_tasks WHERE id = t.v('task1')::uuid) = 'CANCELLED'
    AND EXISTS (SELECT 1 FROM public.line_deliveries d JOIN public.line_contacts c ON c.id = d.contact_id
                 WHERE d.dedupe_key = 'W:' || t.v('task1') AND d.template_key = 'TASK_WITHDRAWN' AND c.driver_code = 'D901'
                   AND d.status = 'PENDING'), t.v('w1'));
SELECT t.check('DRV-MOVE', 'the old driver can no longer press steps or รับงาน',
    public.line_task_step(t.v('u901'), t.v('task1')::uuid, 'PREPARED') ->> 'result' = 'INVALID_STATE'
    AND public.line_task_postback(t.v('u901'), t.v('task1')::uuid, 'ACCEPT') ->> 'result' = 'INVALID_STATE');
SELECT t.check('DRV-MOVE', 'withdrawing again sends nothing more',
    (t.ok('DRV-MOVE', 'second withdraw', 'owner', format(
        $q$select public.line_driver_tasks_withdraw(%L::uuid, 'REASSIGN', '[{"type":"text","text":"ถอนงาน"}]'::jsonb)$q$,
        t.v('drv_apt')))) ->> 'withdrawn' = '0'
    AND (SELECT count(*) FROM public.line_deliveries WHERE dedupe_key LIKE 'W:%' AND task_id = t.v('task1')::uuid) = 1);
SELECT t.err('DRV-MOVE', 'a member without the appointments menu cannot withdraw', 'nomenu',
    format($q$select public.line_driver_tasks_withdraw(%L::uuid, 'REASSIGN', '[{"type":"text","text":"x"}]'::jsonb)$q$, t.v('drv_apt')),
    'FORBIDDEN');

SELECT t.set('task2', t.driver_task(t.v('drv_apt')::uuid, 'D902', 'drv-key-0002')::text);
SELECT t.check('DRV-MOVE', 'the new driver starts again at รับงาน; the earlier steps stay as history',
    public.line_task_postback(t.v('u902'), t.v('task2')::uuid, 'ACCEPT') ->> 'next_stage' = 'PREPARE'
    AND (SELECT count(*) FROM jsonb_array_elements(t.events(t.v('drv_apt')::uuid)) e WHERE e ->> 'stage' = 'ACCEPT') = 2
    AND (SELECT count(*) FROM jsonb_array_elements(t.events(t.v('drv_apt')::uuid)) e WHERE e ->> 'stage' = 'PREPARE') = 1);
DO $$
DECLARE
    v_stage text;
    v_r     jsonb;
BEGIN
    FOREACH v_stage IN ARRAY ARRAY['PREPARE', 'PREPARED', 'TRANSIT', 'ARRIVED', 'INSPECT', 'COMPLETED'] LOOP
        v_r := public.line_task_step(t.v('u902'), t.v('task2')::uuid, v_stage);
        PERFORM t.check('DRV-MOVE', 'new driver records ' || v_stage, v_r ->> 'result' = 'STEP_DONE', v_r::text);
    END LOOP;
    PERFORM t.check('DRV-MOVE', 'after the last driver step nothing is next and the LINE task is done',
        v_r ->> 'next_stage' IS NULL AND (SELECT status FROM public.line_tasks WHERE id = t.v('task2')::uuid) = 'DONE', v_r::text);
END;
$$;
SELECT t.check('DRV-MOVE', 'LINE steps never close the job or touch bills: the appointment stays open for the shop',
    (SELECT status FROM public.appointments WHERE id = t.v('drv_apt')::uuid) = 'SCHEDULED'
    AND (SELECT bill_id FROM public.appointments WHERE id = t.v('drv_apt')::uuid) IS NULL);

-- ---------------------------------------------------------------- cancel tells the driver
SELECT t.set('drv_apt2', (t.ok('DRV-SETUP', 'owner creates a second job', 'owner', $q$select public.appointment_save(NULL,
    '{"appointment_type":"RETURN","title":"เก็บแบบ ทดสอบ LINE","start_datetime":"2031-05-02T02:00:00Z","end_datetime":"2031-05-02T03:00:00Z"}'::jsonb)$q$)
    -> 'appointment' ->> 'id'));
SELECT t.dispatch(t.v('drv_apt2')::uuid, 'D901');
SELECT t.set('task3', t.driver_task(t.v('drv_apt2')::uuid, 'D901', 'drv-key-0003')::text);
SELECT t.check('DRV-CANCEL', 'a return job follows the return steps',
    public.line_task_postback(t.v('u901'), t.v('task3')::uuid, 'ACCEPT') ->> 'next_stage' = 'TRANSIT');
SELECT t.err('DRV-CANCEL', 'a cancel notice is refused while the job is still open', 'owner',
    format($q$select public.line_driver_tasks_withdraw(%L::uuid, 'CANCEL', '[{"type":"text","text":"ยกเลิก"}]'::jsonb)$q$, t.v('drv_apt2')),
    'APPOINTMENT_NOT_EDITABLE');
SELECT t.ok('DRV-CANCEL', 'owner cancels the job with a reason', 'owner',
    format($q$select public.appointment_set_status(%L::uuid, 'CANCELLED', 'ลูกค้ายกเลิก')$q$, t.v('drv_apt2')));
SELECT t.check('DRV-CANCEL', 'a cancelled job cannot be stepped even before the notice',
    public.line_task_step(t.v('u901'), t.v('task3')::uuid, 'TRANSIT') ->> 'result' = 'INVALID_STATE');
SELECT t.set('w3', (t.ok('DRV-CANCEL', 'cancel notice', 'owner', format(
    $q$select public.line_driver_tasks_withdraw(%L::uuid, 'CANCEL', '[{"type":"text","text":"งานถูกยกเลิก: เก็บแบบ"}]'::jsonb)$q$,
    t.v('drv_apt2'))))::text);
SELECT t.check('DRV-CANCEL', 'the responsible driver is told once and the task is cancelled',
    t.v('w3')::jsonb ->> 'queued' = '1'
    AND (SELECT status FROM public.line_tasks WHERE id = t.v('task3')::uuid) = 'CANCELLED'
    AND EXISTS (SELECT 1 FROM public.line_deliveries WHERE dedupe_key = 'W:' || t.v('task3') AND template_key = 'TASK_CANCELLED'), t.v('w3'));
SELECT t.check('DRV-CANCEL', 'the cancelled job keeps its status and steps (history)',
    (SELECT status FROM public.appointments WHERE id = t.v('drv_apt2')::uuid) = 'CANCELLED'
    AND (SELECT count(*) FROM jsonb_array_elements(t.events(t.v('drv_apt2')::uuid)) e WHERE e ->> 'stage' = 'ACCEPT') = 1);

-- ---------------------------------------------------------------- put settings back
UPDATE public.store_settings SET policies = t.v('drv_policies_before')::jsonb WHERE singleton;
