-- Rule tests for supabase/migrations/20261112150000_money_once_and_guards_v1.sql (owner 2026-11-12):
-- a fee / a lost item / an added deposit is saved once per key (a retry gets the first answer back), each in one
-- transaction; the activity log takes only approved members; the bell marks all read in one call; the sign-in
-- slow-down is server-only. Runs after 45_payment_allocation.sql (uses c1 and the rental product ar).
\set ON_ERROR_STOP 1

SELECT t.set('mo', (t.ok('O-SETUP', 'rental draft: 3 × alloc rent, 1 round', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 3, 'rental_calculation_type', 'PER_PERIOD',
        'period_count', 1, 'rental_start_at', now(), 'rental_end_at', now() + interval '3 days'))))$q$, t.v('c1'), t.v('ar'))))
    ->> 'id');
SELECT t.set('mol', (SELECT id::text FROM public.bill_lines WHERE bill_id = t.v('mo')::uuid));
SELECT t.ok('O-SETUP', 'confirm, paid 30', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-mo-0', '[{"method":"CASH","amount":30}]'::jsonb)$q$, t.v('mo')));
SELECT t.ok('O-SETUP', 'deliver 3', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 3)), 'key-mo-dl')$q$,
           t.v('mo'), t.v('mol')));

-- ===================================================================== charge_add: create + confirm once
SELECT t.ok('O-CHARGE', 'extra rounds fee 20 (create + confirm in one call)', 'cashier',
    format($q$select public.charge_add(%L::uuid, 'OTHER', 20, 'ค่าเช่ารอบเพิ่ม 2 รอบ', 'key-mo-xr-1', %L::uuid, NULL,
        '{"kind":"EXTRA_ROUNDS","rounds":2,"quantity":3}'::jsonb)$q$, t.v('mo'), t.v('mol')));
SELECT t.check('O-CHARGE', 'one CONFIRMED charge of 20, nothing PENDING; the bill owes 20 more',
    (SELECT count(*) = 1 AND bool_and(status = 'CONFIRMED') FROM public.charges WHERE bill_id = t.v('mo')::uuid)
    AND (t.bill('mo')).balance_due = 20);
SELECT t.check('O-CHARGE', 'pressed again with the same key = the first answer, still one charge',
    (t.exec_as(t.u('cashier'), 'authenticated',
        format($q$select public.charge_add(%L::uuid, 'OTHER', 20, 'ค่าเช่ารอบเพิ่ม 2 รอบ', 'key-mo-xr-1', %L::uuid, NULL,
            '{"kind":"EXTRA_ROUNDS","rounds":2,"quantity":3}'::jsonb)$q$, t.v('mo'), t.v('mol'))) ->> 'idempotent_replay') = 'true'
    AND (SELECT count(*) FROM public.charges WHERE bill_id = t.v('mo')::uuid) = 1
    AND (t.bill('mo')).balance_due = 20);
SELECT t.err('O-CHARGE', 'the same key with another amount is refused (not a second fee)', 'cashier',
    format($q$select public.charge_add(%L::uuid, 'OTHER', 25, 'x', 'key-mo-xr-1', %L::uuid)$q$, t.v('mo'), t.v('mol')),
    'IDEMPOTENCY_CONFLICT');
SELECT t.err('O-CHARGE', 'an account waiting for approval cannot add a fee', 'pending',
    format($q$select public.charge_add(%L::uuid, 'OTHER', 5, 'x', 'key-mo-xr-nm')$q$, t.v('mo')), 'FORBIDDEN');
SELECT t.err('O-CHARGE', 'a fee that fails (zero amount) leaves no charge and no key behind', 'cashier',
    format($q$select public.charge_add(%L::uuid, 'OTHER', 0, 'x', 'key-mo-xr-zero')$q$, t.v('mo')), '');
SELECT t.check('O-CHARGE', 'after the failed call: still one charge, the key is free again',
    (SELECT count(*) FROM public.charges WHERE bill_id = t.v('mo')::uuid) = 1
    AND NOT EXISTS (SELECT 1 FROM public.idempotency_keys WHERE idempotency_key = 'key-mo-xr-zero'));

-- ===================================================================== lost_add: missing → lost → fee, once
SELECT t.ok('O-LOST', '1 piece lost with a fee of 150 (one call)', 'cashier',
    format($q$select public.lost_add(%L::uuid, %L::uuid, 1, 150, 'ลูกค้าแจ้งของหาย', 'key-mo-lost-1')$q$, t.v('mo'), t.v('mol')));
SELECT t.check('O-LOST', 'one LOST case (closed), its MISSING case closed, one confirmed LOST fee 150, stock LOST +1',
    (SELECT count(*) = 1 FROM public.incident_cases WHERE bill_id = t.v('mo')::uuid AND incident_type = 'LOST' AND status = 'RESOLVED')
    AND (SELECT count(*) = 1 FROM public.incident_cases WHERE bill_id = t.v('mo')::uuid AND incident_type = 'MISSING' AND status = 'RESOLVED')
    AND (SELECT count(*) = 1 AND sum(amount) = 150 FROM public.charges
          WHERE bill_id = t.v('mo')::uuid AND charge_type = 'LOST' AND status = 'CONFIRMED')
    AND t.stock('ar', 'LOST') >= 1);
SELECT t.check('O-LOST', 'pressed again = replay: still one lost case and one fee',
    (t.exec_as(t.u('cashier'), 'authenticated',
        format($q$select public.lost_add(%L::uuid, %L::uuid, 1, 150, 'ลูกค้าแจ้งของหาย', 'key-mo-lost-1')$q$, t.v('mo'), t.v('mol')))
        ->> 'idempotent_replay') = 'true'
    AND (SELECT count(*) FROM public.incident_cases WHERE bill_id = t.v('mo')::uuid AND incident_type = 'LOST') = 1
    AND (SELECT count(*) FROM public.charges WHERE bill_id = t.v('mo')::uuid AND charge_type = 'LOST') = 1);
SELECT t.err('O-LOST', 'more lost than the customer holds: refused as a whole, nothing left open', 'cashier',
    format($q$select public.lost_add(%L::uuid, %L::uuid, 9, 10, 'x', 'key-mo-lost-9')$q$, t.v('mo'), t.v('mol')), 'EXCEEDS');
SELECT t.check('O-LOST', 'the refused call left no MISSING case open',
    NOT EXISTS (SELECT 1 FROM public.incident_cases WHERE bill_id = t.v('mo')::uuid AND status NOT IN ('RESOLVED', 'REJECTED', 'FOUND')));
SELECT t.ok('O-LOST', '1 more lost with no fee: case closed, no charge', 'cashier',
    format($q$select public.lost_add(%L::uuid, %L::uuid, 1, 0, 'หาย ไม่คิดเงิน', 'key-mo-lost-2')$q$, t.v('mo'), t.v('mol')));
SELECT t.check('O-LOST', 'still one LOST fee; two LOST cases, both closed',
    (SELECT count(*) FROM public.charges WHERE bill_id = t.v('mo')::uuid AND charge_type = 'LOST') = 1
    AND (SELECT count(*) = 2 AND bool_and(status = 'RESOLVED') FROM public.incident_cases
          WHERE bill_id = t.v('mo')::uuid AND incident_type = 'LOST'));

-- ===================================================================== bill_deposit_add: once
SELECT t.ok('O-DEP', 'deposit becomes 100 (เพิ่มมัดจำ)', 'cashier',
    format($q$select public.bill_deposit_add(%L::uuid, 100, 'เพิ่มมัดจำ 100', 'key-mo-dep-1')$q$, t.v('mo')));
SELECT t.check('O-DEP', 'pressed again = replay; deposit 100, owed once',
    (t.exec_as(t.u('cashier'), 'authenticated',
        format($q$select public.bill_deposit_add(%L::uuid, 100, 'เพิ่มมัดจำ 100', 'key-mo-dep-1')$q$, t.v('mo'))) ->> 'idempotent_replay') = 'true'
    AND (t.bill('mo')).deposit_amount = 100
    AND (SELECT count(*) = 1 FROM public.idempotency_keys WHERE idempotency_key = 'key-mo-dep-1'));

-- ===================================================================== activity log: approved members only
SELECT t.ok('O-AUDIT', 'a member waiting for approval calls audit_log_failure: no error', 'pending',
    $q$select '{}'::jsonb from (select public.audit_log_failure('X_TEST_PENDING', 'boom', 'test')) x$q$);
SELECT t.check('O-AUDIT', '…and nothing is written',
    NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'X_TEST_PENDING'));
SELECT t.ok('O-AUDIT', 'an approved member still writes it', 'cashier',
    $q$select '{}'::jsonb from (select public.audit_log_failure('X_TEST_CASHIER', 'boom', 'test')) x$q$);
SELECT t.check('O-AUDIT', '…one row', (SELECT count(*) = 1 FROM public.audit_logs WHERE action = 'X_TEST_CASHIER'));

-- ===================================================================== bell: mark all read in one call
INSERT INTO public.notifications (event_key, event_type, severity, recipient_user_id, entity_type, entity_id, title, body, status)
SELECT 'test-mark-all-' || g, 'OTHER', 'INFO', t.u('cashier'), 'TEST', gen_random_uuid(), 'n' || g, '', 'UNREAD' FROM generate_series(1, 3) g;
INSERT INTO public.notifications (event_key, event_type, severity, recipient_user_id, entity_type, entity_id, title, body, status)
VALUES ('test-mark-all-other', 'OTHER', 'INFO', t.u('finance'), 'TEST', gen_random_uuid(), 'not mine', '', 'UNREAD');
SELECT t.ok('O-BELL', 'cashier marks all read', 'cashier', $q$select public.notification_mark_all_read()$q$);
SELECT t.check('O-BELL', 'the 3 of the cashier are READ; another member''s notice is untouched',
    (SELECT count(*) = 3 FROM public.notifications WHERE event_key LIKE 'test-mark-all-%' AND recipient_user_id = t.u('cashier') AND status = 'READ')
    AND (SELECT status = 'UNREAD' FROM public.notifications WHERE event_key = 'test-mark-all-other'));

-- ===================================================================== sign-in slow-down
SELECT t.check('O-LOGIN', 'only the server (service_role) may use the slow-down; the table is closed to members',
    NOT has_function_privilege('authenticated', 'public.login_throttle_record(text[], integer[], boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.login_throttle_wait(text[])', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.login_throttle_record(text[], integer[], boolean)', 'EXECUTE')
    AND NOT has_table_privilege('authenticated', 'public.login_throttle', 'SELECT'));
SELECT t.check('O-LOGIN', '9 wrong tries: may still try',
    (SELECT max(public.login_throttle_record(ARRAY['t-pair', 't-ip'], ARRAY[10, 30], false)) FROM generate_series(1, 9)) = 0);
SELECT t.set('o_wait10', public.login_throttle_record(ARRAY['t-pair', 't-ip'], ARRAY[10, 30], false)::text);
SELECT t.check('O-LOGIN', 'the 10th wrong try: that user name + address waits about 15 minutes, the address alone does not',
    t.v('o_wait10')::int BETWEEN 890 AND 900
    AND public.login_throttle_wait(ARRAY['t-pair']) > 0 AND public.login_throttle_wait(ARRAY['t-ip']) = 0);
SELECT t.set('o_wait_ok', public.login_throttle_record(ARRAY['t-pair', 't-ip'], ARRAY[10, 30], true)::text);
SELECT t.check('O-LOGIN', 'a correct sign-in clears the pair (the address counter keeps counting)',
    t.v('o_wait_ok')::int = 0
    AND public.login_throttle_wait(ARRAY['t-pair']) = 0
    AND (SELECT fail_count = 10 FROM public.login_throttle WHERE key = 't-ip'));

-- ===================================================================== member delete cascade stays harmless
-- 20261109220747 (owner: never change it) lets deleting a PENDING sign-up remove its setup rows. An approved member
-- can never be deleted, so the cascade cannot take any history with it.
SELECT t.err_admin('O-CASCADE', 'deleting an approved member (cashier) from sign-in is refused as a whole',
    format($q$delete from auth.users where id = %L::uuid$q$, t.u('cashier')), 'NO_HARD_DELETE');
SELECT t.check('O-CASCADE', 'the cashier, the menus and the PIN are all still there',
    EXISTS (SELECT 1 FROM public.profiles WHERE id = t.u('cashier'))
    AND EXISTS (SELECT 1 FROM public.user_menu_access WHERE user_id = t.u('cashier'))
    AND EXISTS (SELECT 1 FROM public.user_pins WHERE user_id = t.u('cashier')));
