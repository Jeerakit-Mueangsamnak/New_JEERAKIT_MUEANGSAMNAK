-- LINE full v1 (migration 20261022090000_line_full_v1): invite link + LIFF bind, notices to
-- LINE, customer reminders on a schedule and by hand, driver job progress, accept reminder,
-- flex messages, retry. Uses the harness of 00_setup.sql; server RPCs run as postgres (the
-- server), like 50_line_security.sql. Store settings are put back at the end.
\set ON_ERROR_STOP 1

SELECT t.set('lf_policies_before', (SELECT policies::text FROM public.store_settings WHERE singleton));
UPDATE public.store_settings
   SET policies = COALESCE(policies, '{}'::jsonb) || jsonb_build_object('delivery_drivers', jsonb_build_array(
       jsonb_build_object('id', 'D951', 'name', 'สมชาย ขับดี', 'active', true)))
 WHERE singleton;

-- ---------------------------------------------------------------- invite + LIFF bind
SELECT t.err('LF-INVITE', 'inviting needs an ACTIVE member (owner 2026-10-26: every ACTIVE member may; one waiting for approval may not)', 'pending',
    format($q$select public.line_invite_create('STAFF', %L)$q$, t.u('cashier')), 'FORBIDDEN');
SELECT t.set('lf_staff_code', t.ok('LF-INVITE', 'owner invites the cashier', 'owner',
    format($q$select public.line_invite_create('STAFF', %L)$q$, t.u('cashier'))) ->> 'code');
SELECT t.check('LF-INVITE', 'invite code is LINK- + 10 characters and lives for hours',
    t.v('lf_staff_code') ~ '^LINK-[A-HJ-NP-Z2-9]{10}$'
    AND (SELECT expires_at > now() + interval '1 hour' FROM public.line_link_codes
          WHERE code_hash = public._line_code_hash(t.v('lf_staff_code'))));
SELECT t.check('LF-INVITE', 'a typed name is required',
    public.line_liff_bind('U' || repeat('a', 31) || '1', 'cash', t.v('lf_staff_code'), '  ', NULL, NULL, true) ->> 'result' = 'NAME_REQUIRED');
SELECT t.set('lf_bind1', public.line_liff_bind('U' || repeat('a', 31) || '1', 'cash LINE', t.v('lf_staff_code'),
    'ชื่อที่ไม่ตรงเลย', NULL, '@cash.line', true)::text);
SELECT t.check('LF-INVITE', 'staff invite links; a name that does not match is flagged',
    t.v('lf_bind1')::jsonb ->> 'result' = 'LINKED_STAFF' AND (t.v('lf_bind1')::jsonb ->> 'needs_review')::boolean
    AND (SELECT needs_review AND line_handle = '@cash.line' AND profile_id = t.u('cashier')
           FROM public.line_contacts WHERE line_user_id = 'U' || repeat('a', 31) || '1'), t.v('lf_bind1'));
SELECT t.check('LF-INVITE', 'the issuer gets a review notice',
    EXISTS (SELECT 1 FROM public.notifications WHERE event_key LIKE 'LINE_REVIEW:%' AND recipient_user_id = t.u('owner')));
SELECT t.check('LF-INVITE', 'an invite is single use',
    public.line_liff_bind('U' || repeat('a', 31) || '2', 'x', t.v('lf_staff_code'), 'cashier', NULL, NULL, true) ->> 'result' = 'INVALID');
SELECT t.ok('LF-INVITE', 'owner confirms the flagged link', 'owner',
    format($q$select public.line_contact_review_ok(%L::uuid)$q$,
           (SELECT id FROM public.line_contacts WHERE line_user_id = 'U' || repeat('a', 31) || '1')));
SELECT t.check('LF-INVITE', 'flag cleared',
    NOT (SELECT needs_review FROM public.line_contacts WHERE line_user_id = 'U' || repeat('a', 31) || '1'));
SELECT t.err('LF-INVITE', 'an already linked member cannot be invited again', 'owner',
    format($q$select public.line_invite_create('STAFF', %L)$q$, t.u('cashier')), 'LINE_MEMBER_ALREADY_LINKED');

SELECT t.set('lf_cust', t.ok('LF-INVITE', 'owner adds a customer', 'owner',
    $q$select public.customer_create('{"name":"มานี ใจดี","phone":"081-234-5678","address":"กทม"}'::jsonb)$q$) ->> 'id');
SELECT t.set('lf_cust_code', t.ok('LF-INVITE', 'staff invites the customer', 'owner',
    format($q$select public.line_invite_create('CUSTOMER', %L)$q$, t.v('lf_cust'))) ->> 'code');
SELECT t.check('LF-INVITE', 'a customer must type a phone',
    public.line_liff_bind('U' || repeat('b', 31) || '1', 'Manee', t.v('lf_cust_code'), 'มานี', '', NULL, true) ->> 'result' = 'PHONE_REQUIRED');
SELECT t.set('lf_bind2', public.line_liff_bind('U' || repeat('b', 31) || '1', 'Manee', t.v('lf_cust_code'),
    'มานี', '0812345678', 'manee', true)::text);
SELECT t.check('LF-INVITE', 'customer with matching name and phone links without a flag',
    t.v('lf_bind2')::jsonb ->> 'result' = 'LINKED_CUSTOMER' AND NOT (t.v('lf_bind2')::jsonb ->> 'needs_review')::boolean, t.v('lf_bind2'));
SELECT t.set('lf_cust_contact', (SELECT id::text FROM public.line_contacts WHERE customer_id = t.v('lf_cust')::uuid AND status = 'LINKED'));

SELECT t.set('lf_drv_code', t.ok('LF-INVITE', 'owner invites the driver', 'owner',
    $q$select public.line_invite_create('DRIVER', 'D951')$q$) ->> 'code');
SELECT t.check('LF-INVITE', 'driver links through the invite',
    public.line_liff_bind('U' || repeat('c', 31) || '1', 'Somchai', t.v('lf_drv_code'), 'สมชาย', NULL, NULL, true) ->> 'result' = 'LINKED_DRIVER');
SELECT t.check('LF-INVITE', 'a typed 6-digit staff code still cannot use an invite path',
    public.line_link_code_consume('U' || repeat('a', 31) || '2', '123456') ->> 'result' IN ('INVALID', 'LOCKED'));

-- ---------------------------------------------------------------- options
DO $$
BEGIN
    UPDATE public.store_settings SET policies = jsonb_set(policies, '{line}', '{"reminders":{"PAYMENT_DUE":{"daysBefore":99}}}') WHERE singleton;
    PERFORM t.check('LF-POLICY', 'a day count out of range is refused', false);
EXCEPTION WHEN OTHERS THEN
    PERFORM t.check('LF-POLICY', 'a day count out of range is refused', SQLERRM LIKE 'INVALID_POLICY%', SQLERRM);
END;
$$;
UPDATE public.store_settings
   SET policies = jsonb_set(COALESCE(policies, '{}'::jsonb), '{line}', jsonb_build_object(
       'notify', jsonb_build_object('APPOINTMENT_DUE', true),
       'reminderHour', 0,
       'reminders', jsonb_build_object('APPOINTMENT_DUE', jsonb_build_object('enabled', true, 'daysBefore', 2)),
       'customerStages', jsonb_build_object('ACCEPT', true),
       'acceptTimeoutMinutes', 1))
 WHERE singleton;
SELECT t.check('LF-POLICY', 'schedule, stages and timeout are saved', public._line_option_int('acceptTimeoutMinutes', 0, 0, 1440) = 1);

-- ---------------------------------------------------------------- notices -> LINE
UPDATE public.notifications SET line_fanout_at = now() WHERE line_fanout_at IS NULL;
SELECT public._notify('LF-N1', 'APPOINTMENT_DUE', 'INFO', t.u('cashier'), NULL, 'APPOINTMENT', gen_random_uuid(), 'นัด', 'พรุ่งนี้');
SELECT public._notify('LF-N2', 'LOW_STOCK', 'INFO', t.u('cashier'), NULL, 'PRODUCT', gen_random_uuid(), 'สต็อก', 'ต่ำ');
SELECT t.set('lf_claim', (SELECT array_agg(notification_id)::text FROM public.line_notifications_claim(50)));
SELECT t.check('LF-NOTICE', 'only switched-on event types are handed to LINE',
    t.v('lf_claim')::uuid[] = ARRAY[(SELECT id FROM public.notifications WHERE event_key = 'LF-N1')], t.v('lf_claim'));
SELECT t.check('LF-NOTICE', 'every claimed notice is marked, so nothing is claimed twice',
    NOT EXISTS (SELECT 1 FROM public.line_notifications_claim(50))
    AND (SELECT line_fanout_at IS NOT NULL FROM public.notifications WHERE event_key = 'LF-N2'));
SELECT t.check('LF-NOTICE', 'the linked cashier is a recipient',
    EXISTS (SELECT 1 FROM public.line_notification_recipients((SELECT id FROM public.notifications WHERE event_key = 'LF-N1'))));

-- ---------------------------------------------------------------- customer reminders
SELECT t.set('lf_apt', (t.ok('LF-REMIND', 'owner books the customer for tomorrow', 'owner', format($q$select public.appointment_save(NULL,
    jsonb_build_object('appointment_type', 'DELIVERY', 'title', 'ส่งชุดโต๊ะ', 'customer_id', %L,
                       'start_datetime', (now() + interval '1 day')::text, 'end_datetime', (now() + interval '1 day 1 hour')::text))$q$,
    t.v('lf_cust'))) -> 'appointment' ->> 'id'));
SELECT t.set('lf_due', (SELECT row_to_json(r)::text FROM public.line_customer_reminders_due() r WHERE r.source_id = t.v('lf_apt')::uuid));
SELECT t.check('LF-REMIND', 'the scheduled appointment reminder is due for the linked customer',
    t.v('lf_due')::jsonb ->> 'rule' = 'APPOINTMENT_DUE' AND t.v('lf_due')::jsonb ->> 'contact_id' = t.v('lf_cust_contact'), t.v('lf_due'));
SELECT public.line_outbox_enqueue_server(t.v('lf_cust_contact')::uuid, 'APPOINTMENT', t.v('lf_apt')::uuid, NULL,
    'CUSTOMER_APPOINTMENT', '[{"type":"text","text":"เตือนนัด"}]'::jsonb, t.v('lf_due')::jsonb ->> 'dedupe_key');
SELECT t.check('LF-REMIND', 'once queued it is not due again',
    NOT EXISTS (SELECT 1 FROM public.line_customer_reminders_due() r WHERE r.source_id = t.v('lf_apt')::uuid));
SELECT t.check('LF-REMIND', 'the manual list shows it with the last queue time',
    (t.ok('LF-REMIND', 'owner reads candidates', 'owner', $q$select coalesce(jsonb_agg(r), '[]') from public.line_customer_reminder_candidates() r$q$)
     @> jsonb_build_array(jsonb_build_object('rule', 'APPOINTMENT_DUE', 'source_id', t.v('lf_apt')))));
SELECT t.err('LF-REMIND', 'sending by hand needs an ACTIVE member (owner 2026-10-26: every ACTIVE member may; one waiting for approval may not)', 'pending',
    format($q$select public.line_customer_reminder_send('APPOINTMENT_DUE', %L::uuid, 'CUSTOMER_APPOINTMENT', '[{"type":"text","text":"x"}]', 'lf-manual-0001')$q$, t.v('lf_apt')), 'FORBIDDEN');
SELECT t.set('lf_m1', t.ok('LF-REMIND', 'owner sends one by hand', 'owner',
    format($q$select public.line_customer_reminder_send('APPOINTMENT_DUE', %L::uuid, 'CUSTOMER_APPOINTMENT', '[{"type":"text","text":"x"}]', 'lf-manual-0001')$q$, t.v('lf_apt')))::text);
SELECT t.check('LF-REMIND', 'pressing again with the same key queues nothing new',
    (t.ok('LF-REMIND', 'owner presses again', 'owner',
        format($q$select public.line_customer_reminder_send('APPOINTMENT_DUE', %L::uuid, 'CUSTOMER_APPOINTMENT', '[{"type":"text","text":"x"}]', 'lf-manual-0001')$q$, t.v('lf_apt'))) ->> 'duplicate')::boolean);
SELECT t.err('LF-REMIND', 'something that is not a candidate cannot be sent', 'owner',
    format($q$select public.line_customer_reminder_send('APPOINTMENT_DUE', %L::uuid, 'CUSTOMER_APPOINTMENT', '[{"type":"text","text":"x"}]', 'lf-manual-0002')$q$, gen_random_uuid()), 'LINE_REMINDER_NOT_DUE');

-- ---------------------------------------------------------------- flex + retry
SELECT t.check('LF-FLEX', 'a flex bubble with https / postback actions is accepted',
    public._line_messages_valid('[{"type":"flex","altText":"งาน","contents":{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"button","action":{"type":"postback","label":"รับงาน","data":"kind=task"}},{"type":"button","action":{"type":"uri","label":"แผนที่","uri":"https://maps.google.com"}}]}}}]'));
SELECT t.check('LF-FLEX', 'a flex with an http link is refused',
    NOT public._line_messages_valid('[{"type":"flex","altText":"x","contents":{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"button","action":{"type":"uri","label":"x","uri":"http://x"}}]}}}]'));
UPDATE public.line_deliveries SET status = 'DEAD', last_error_code = 'HTTP_400' WHERE id = (t.v('lf_m1')::jsonb ->> 'delivery_id')::uuid;
SELECT t.ok('LF-RETRY', 'owner sends a dead row again', 'owner',
    format($q$select public.line_delivery_retry(%L::uuid)$q$, t.v('lf_m1')::jsonb ->> 'delivery_id'));
SELECT t.check('LF-RETRY', 'row is pending again with attempts reset',
    (SELECT status = 'PENDING' AND attempts = 0 FROM public.line_deliveries WHERE id = (t.v('lf_m1')::jsonb ->> 'delivery_id')::uuid));

-- ---------------------------------------------------------------- driver progress + accept reminder
UPDATE public.appointments
   SET work_order = jsonb_build_object('driver', jsonb_build_object('id', 'D951', 'name', 'สมชาย ขับดี'),
       'events', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'stage', 'DISPATCH', 'status', 'DONE', 'timestamp', now())))
 WHERE id = t.v('lf_apt')::uuid;
SELECT t.set('lf_task', gen_random_uuid()::text);
SELECT t.ok('LF-JOB', 'job sent to the driver', 'owner', format(
    $q$select public.line_task_create_driver(%L::uuid, 'D951', 'ส่งชุดโต๊ะ', NULL, %L::uuid, %L::jsonb, 'lf-task-0001')$q$,
    t.v('lf_task'), t.v('lf_apt'), jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'งาน ' || t.v('lf_task')))));
UPDATE public.line_tasks SET created_at = now() - interval '5 minutes' WHERE id = t.v('lf_task')::uuid;
SELECT t.set('lf_late', (SELECT row_to_json(r)::text FROM public.line_driver_accept_overdue() r WHERE r.task_id = t.v('lf_task')::uuid));
SELECT t.check('LF-JOB', 'a job not accepted in time is returned for a reminder and the shop is told',
    t.v('lf_late') IS NOT NULL AND EXISTS (SELECT 1 FROM public.notifications WHERE event_key = 'ACCEPT_LATE:' || t.v('lf_task')), t.v('lf_late'));
SELECT public.line_outbox_enqueue_server((t.v('lf_late')::jsonb ->> 'contact_id')::uuid, 'TASK', t.v('lf_task')::uuid, t.v('lf_task')::uuid,
    'DRIVER_ACCEPT_REMINDER', '[{"type":"text","text":"รับงานด้วย"}]'::jsonb, t.v('lf_late')::jsonb ->> 'dedupe_key');
SELECT t.check('LF-JOB', 'the accept reminder goes once',
    NOT EXISTS (SELECT 1 FROM public.line_driver_accept_overdue() r WHERE r.task_id = t.v('lf_task')::uuid));
SELECT t.check('LF-JOB', 'driver presses รับงาน',
    public.line_task_postback('U' || repeat('c', 31) || '1', t.v('lf_task')::uuid, 'ACCEPT') ->> 'result' = 'ACCEPTED');
SELECT t.set('lf_prog', public.line_task_progress(t.v('lf_task')::uuid, 'ACCEPT', 'รับงาน')::text);
SELECT t.check('LF-JOB', 'progress names the customer when the step is switched on',
    t.v('lf_prog')::jsonb -> 'customer' ->> 'contact_id' = t.v('lf_cust_contact')
    AND t.v('lf_prog')::jsonb ->> 'driver_name' = 'สมชาย ขับดี', t.v('lf_prog'));
SELECT t.check('LF-JOB', 'the shop gets an in-app notice of the step',
    EXISTS (SELECT 1 FROM public.notifications WHERE event_key = 'JOB_STEP:' || t.v('lf_task') || ':ACCEPT' AND recipient_menu = 'appointments'));
SELECT t.check('LF-JOB', 'a step that is switched off tells only the shop',
    public.line_task_progress(t.v('lf_task')::uuid, 'PREPARE', 'เตรียม') -> 'customer' = 'null'::jsonb);

UPDATE public.store_settings SET policies = t.v('lf_policies_before')::jsonb WHERE singleton;
