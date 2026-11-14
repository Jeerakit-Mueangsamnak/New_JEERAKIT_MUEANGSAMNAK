-- LINE forms (migration 20261113100000_line_forms_v1): driver job form + OWNER income/expense form.
-- Uses 00_setup.sql and the helpers t.dispatch / t.driver_task / t.events of 55_line_driver_steps.sql.
-- Server functions are called as postgres (the server), like 50/55.
\set ON_ERROR_STOP 1

SELECT t.set('lf_policies_before', (SELECT policies::text FROM public.store_settings WHERE singleton));
UPDATE public.store_settings
   SET policies = COALESCE(policies, '{}'::jsonb) || jsonb_build_object(
       'delivery_drivers', jsonb_build_array(jsonb_build_object('id', 'D931', 'name', 'คนขับฟอร์ม', 'active', true)),
       'finance_income_items', jsonb_build_array('ค่าเช่าที่', 'รายรับอื่นๆ'))
 WHERE singleton;
INSERT INTO public.line_contacts (line_user_id, driver_code, status, followed, linked_at)
VALUES ('U' || repeat('3', 31) || '1', 'D931', 'LINKED', true, now());
-- owner / cashier may already have a LINE row from earlier files: keep it (status put back at the end)
CREATE FUNCTION t.lf_link(p_user text, p_digit text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    PERFORM t.set('lf_prev_' || p_user, COALESCE((SELECT c.status FROM public.line_contacts c WHERE c.profile_id = t.u(p_user)), ''));
    INSERT INTO public.line_contacts (line_user_id, profile_id, status, followed, linked_at)
    SELECT 'U' || repeat('3', 31) || p_digit, t.u(p_user), 'LINKED', true, now()
     WHERE NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.profile_id = t.u(p_user));
    UPDATE public.line_contacts SET status = 'LINKED', linked_at = COALESCE(linked_at, now()) WHERE profile_id = t.u(p_user);
    RETURN (SELECT c.line_user_id FROM public.line_contacts c WHERE c.profile_id = t.u(p_user));
END;
$$;
CREATE FUNCTION t.lf_unlink(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF t.v('lf_prev_' || p_user) = '' THEN
        DELETE FROM public.line_contacts WHERE profile_id = t.u(p_user);
    ELSE
        UPDATE public.line_contacts SET status = t.v('lf_prev_' || p_user) WHERE profile_id = t.u(p_user);
    END IF;
END;
$$;
SELECT t.set('u931', 'U' || repeat('3', 31) || '1'), t.set('u_owner', t.lf_link('owner', '2')),
       t.set('u_cashier', t.lf_link('cashier', '3')), t.set('u_none', 'U' || repeat('3', 31) || '4');

-- ---------------------------------------------------------------- driver job form
SELECT t.set('lf_apt', (t.ok('LFORM-SETUP', 'owner creates a job', 'owner', $q$select public.appointment_save(NULL,
    '{"appointment_type":"DELIVERY","title":"ส่งของ ฟอร์ม LINE","location":"บ้านลูกค้า","contact_name":"คุณฟอร์ม","contact_phone":"0811111111","start_datetime":"2031-06-01T02:00:00Z","end_datetime":"2031-06-01T03:00:00Z"}'::jsonb)$q$)
    -> 'appointment' ->> 'id'));
SELECT t.dispatch(t.v('lf_apt')::uuid, 'D931');
SELECT t.set('lf_task', t.driver_task(t.v('lf_apt')::uuid, 'D931', 'lf-key-0001')::text);

SELECT t.set('job1', public.line_driver_job(t.v('u931'), t.v('lf_task')::uuid)::text);
SELECT t.check('LFORM-JOB', 'the driver sees the job, place, contact and the next step',
    t.v('job1')::jsonb ->> 'result' = 'OK'
    AND t.v('job1')::jsonb #>> '{appointment,place}' = 'บ้านลูกค้า'
    AND t.v('job1')::jsonb #>> '{appointment,phone}' = '0811111111'
    AND t.v('job1')::jsonb #>> '{task,status}' = 'SENT'
    AND (t.v('job1')::jsonb ->> 'holds')::boolean, t.v('job1'));
SELECT t.check('LFORM-JOB', 'another LINE (not the job''s driver) sees nothing',
    public.line_driver_job(t.v('u_owner'), t.v('lf_task')::uuid) ->> 'result' = 'NOT_ASSIGNEE'
    AND public.line_driver_job(t.v('u_none'), t.v('lf_task')::uuid) ->> 'result' = 'NOT_ASSIGNEE'
    AND public.line_driver_job(t.v('u931'), gen_random_uuid()) ->> 'result' = 'NOT_FOUND');

SELECT public.line_task_postback(t.v('u931'), t.v('lf_task')::uuid, 'ACCEPT');
SELECT t.set('photo1', t.v('lf_task') || '/' || gen_random_uuid() || '.jpg');
SELECT t.set('step1', public.line_task_step(t.v('u931'), t.v('lf_task')::uuid, 'PREPARE', ' ของครบ ', ARRAY[t.v('photo1')])::text);
SELECT t.check('LFORM-STEP', 'a step from the form keeps the note and the photo',
    t.v('step1')::jsonb ->> 'result' = 'STEP_DONE'
    AND (SELECT e ->> 'note' = 'ของครบ' AND e -> 'photos' = jsonb_build_array(t.v('photo1'))
           FROM jsonb_array_elements(t.events(t.v('lf_apt')::uuid)) e WHERE e ->> 'stage' = 'PREPARE'), t.v('step1'));
SELECT t.check('LFORM-STEP', 'a step without a note keeps the old text (chat buttons unchanged)',
    public.line_task_step(t.v('u931'), t.v('lf_task')::uuid, 'PREPARED') ->> 'result' = 'STEP_DONE'
    AND (SELECT e ->> 'note' = 'อัปเดตทาง LINE' AND NOT e ? 'photos'
           FROM jsonb_array_elements(t.events(t.v('lf_apt')::uuid)) e WHERE e ->> 'stage' = 'PREPARED'));
SELECT t.check('LFORM-STEP', 'a photo of another job, 4 photos or a note over 500 letters is refused and nothing is added',
    public.line_task_step(t.v('u931'), t.v('lf_task')::uuid, 'TRANSIT', NULL, ARRAY[gen_random_uuid() || '/' || gen_random_uuid() || '.jpg']) ->> 'result' = 'INVALID_INPUT'
    AND public.line_task_step(t.v('u931'), t.v('lf_task')::uuid, 'TRANSIT', NULL,
          ARRAY[t.v('photo1'), t.v('photo1'), t.v('photo1'), t.v('photo1')]) ->> 'result' = 'INVALID_INPUT'
    AND public.line_task_step(t.v('u931'), t.v('lf_task')::uuid, 'TRANSIT', repeat('ก', 501)) ->> 'result' = 'INVALID_INPUT'
    AND public.line_task_step(t.v('u931'), t.v('lf_task')::uuid, 'TRANSIT', NULL, ARRAY[t.v('lf_task') || '/x.exe']) ->> 'result' = 'INVALID_INPUT'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.events(t.v('lf_apt')::uuid)) e WHERE e ->> 'stage' = 'TRANSIT'));
SELECT t.check('LFORM-STEP', 'the job form shows the recorded steps and the new next step',
    (SELECT r ->> 'next_stage' = 'TRANSIT' AND jsonb_array_length(r -> 'events') >= 4
       FROM public.line_driver_job(t.v('u931'), t.v('lf_task')::uuid) r));

-- ---------------------------------------------------------------- OWNER income / expense form
SELECT t.check('LFORM-FIN', 'the form opens only for the OWNER''s own LINE and lists the income items',
    (SELECT r ->> 'result' = 'OK' AND r -> 'income_items' = '["ค่าเช่าที่", "รายรับอื่นๆ"]'::jsonb
       FROM public.line_owner_finance_form(t.v('u_owner')) r)
    AND public.line_owner_finance_form(t.v('u_cashier')) ->> 'result' = 'NOT_OWNER'
    AND public.line_owner_finance_form(t.v('u931')) ->> 'result' = 'NOT_OWNER'
    AND public.line_owner_finance_form(t.v('u_none')) ->> 'result' = 'NOT_OWNER');

SELECT t.set('fin_ledger_before', (SELECT count(*) FROM public.finance_ledger_entries)::text);
SELECT t.set('exp1', public.line_finance_entry(t.v('u_owner'), 'EXPENSE', 'FUEL', 450.505, 'CASH', 'เติมน้ำมันรถส่งของ')::text);
SELECT t.check('LFORM-FIN', 'an expense goes straight into finance as the OWNER (entry, ledger, audit)',
    t.v('exp1')::jsonb ->> 'result' = 'OK'
    AND (SELECT e.amount = 450.51 AND e.category = 'FUEL' AND e.paid_method = 'CASH' AND e.created_by = t.u('owner') AND e.status = 'RECORDED'
           FROM public.expense_entries e WHERE e.expense_no = t.v('exp1')::jsonb ->> 'doc_no')
    AND (SELECT l.entry_type = 'EXPENSE' AND l.direction = -1 AND l.amount = 450.51 AND l.created_by = t.u('owner')
           FROM public.finance_ledger_entries l JOIN public.expense_entries e ON e.id = l.source_id
          WHERE e.expense_no = t.v('exp1')::jsonb ->> 'doc_no')
    AND EXISTS (SELECT 1 FROM public.audit_logs a JOIN public.expense_entries e ON e.id = a.entity_id
                 WHERE e.expense_no = t.v('exp1')::jsonb ->> 'doc_no' AND a.action = 'EXPENSE_CREATE'
                   AND a.actor_id = t.u('owner') AND a.channel = 'LINE' AND a.after_data ->> 'via' = 'LINE'), t.v('exp1'));
SELECT t.set('inc1', public.line_finance_entry(t.v('u_owner'), 'INCOME', 'ค่าเช่าที่', 1200, 'TRANSFER', NULL)::text);
SELECT t.check('LFORM-FIN', 'an income goes straight into finance as other income',
    t.v('inc1')::jsonb ->> 'result' = 'OK'
    AND (SELECT i.amount = 1200 AND i.category = 'ค่าเช่าที่' AND i.channel = 'TRANSFER' AND i.created_by = t.u('owner')
           FROM public.other_income_entries i WHERE i.income_no = t.v('inc1')::jsonb ->> 'doc_no')
    AND (SELECT count(*) FROM public.finance_ledger_entries)::bigint = t.v('fin_ledger_before')::bigint + 2, t.v('inc1'));
SELECT t.check('LFORM-FIN', 'staff, drivers and unknown LINE cannot save; bad values are refused; nothing is written',
    public.line_finance_entry(t.v('u_cashier'), 'EXPENSE', 'FUEL', 10, 'CASH', NULL) ->> 'result' = 'NOT_OWNER'
    AND public.line_finance_entry(t.v('u931'), 'INCOME', 'x', 10, 'CASH', NULL) ->> 'result' = 'NOT_OWNER'
    AND public.line_finance_entry(t.v('u_none'), 'INCOME', 'x', 10, 'CASH', NULL) ->> 'result' = 'NOT_OWNER'
    AND public.line_finance_entry(t.v('u_owner'), 'EXPENSE', 'ค่าอื่น', 10, 'CASH', NULL) ->> 'result' = 'INVALID_INPUT'
    AND public.line_finance_entry(t.v('u_owner'), 'INCOME', 'x', 0, 'CASH', NULL) ->> 'result' = 'INVALID_INPUT'
    AND public.line_finance_entry(t.v('u_owner'), 'INCOME', 'x', -5, 'CASH', NULL) ->> 'result' = 'INVALID_INPUT'
    AND public.line_finance_entry(t.v('u_owner'), 'INCOME', 'x', 10, 'BITCOIN', NULL) ->> 'result' = 'INVALID_INPUT'
    AND public.line_finance_entry(t.v('u_owner'), 'TRANSFER', 'x', 10, 'CASH', NULL) ->> 'result' = 'INVALID_INPUT'
    AND public.line_finance_entry(t.v('u_owner'), 'INCOME', ' ', 10, 'CASH', NULL) ->> 'result' = 'INVALID_INPUT'
    AND (SELECT count(*) FROM public.finance_ledger_entries)::bigint = t.v('fin_ledger_before')::bigint + 2);

-- ---------------------------------------------------------------- server only
SELECT t.err('LFORM-SEC', 'a signed-in member cannot call the job form function', 'owner',
    format($q$select public.line_driver_job(%L, %L::uuid)$q$, t.v('u931'), t.v('lf_task')), 'permission denied');
SELECT t.err('LFORM-SEC', 'a signed-in member cannot save finance through the LINE function', 'owner',
    format($q$select public.line_finance_entry(%L, 'INCOME', 'x', 10, 'CASH', NULL)$q$, t.v('u_owner')), 'permission denied');
SELECT t.err('LFORM-SEC', 'the public (anon) cannot read the OWNER form', 'owner',
    format($q$select public.line_owner_finance_form(%L)$q$, t.v('u_owner')), 'permission denied', 'anon');
DO $$
BEGIN
    IF to_regclass('storage.buckets') IS NOT NULL THEN
        PERFORM t.check('LFORM-SEC', 'job photos bucket is private',
            (SELECT NOT b.public FROM storage.buckets b WHERE b.id = 'job-photos'));
    END IF;
END;
$$;

-- ---------------------------------------------------------------- put things back
SELECT t.lf_unlink('owner'), t.lf_unlink('cashier');
UPDATE public.store_settings SET policies = t.v('lf_policies_before')::jsonb WHERE singleton;
