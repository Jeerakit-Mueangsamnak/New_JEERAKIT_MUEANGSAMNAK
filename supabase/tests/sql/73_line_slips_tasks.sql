-- Rule tests for supabase/migrations/20261125100000_line_slips_tasks_staff_qr_v1.sql (owner 2026-11-25).
-- Slip -> approve takes the money once; reject takes none; the bill card accepts only its own pay buttons;
-- staff task states; staff QR is single-use; owner chat commands only for the owner with the switch on.
-- Runs after 72_bill_issue_one_step.sql (t.issue, product 'pi') and 63_line_forms.sql (t.lf_link / t.lf_unlink).
\set ON_ERROR_STOP 1

SELECT t.set('sl_policies_before', (SELECT policies::text FROM public.store_settings WHERE singleton));

-- a bill of customer c1 that owes 20 (ค้างชำระ, nothing taken)
SELECT t.set('slip_prod', (t.ok('SLIP', 'rental product T-SLIP 10.00, 10 in stock', 'owner',
    format($q$select public.product_create(jsonb_build_object('sku', 'T-SLIP', 'name', 'test slip item', 'unit_id', %L,
        'can_rent', true, 'rental_price', 10), NULL, 10, false, %L::uuid)$q$, t.v('unit'), t.pin('owner', 'STOCK_RECEIVE')))) ->> 'id');
SELECT t.set('sb', (t.ok('SLIP', 'bill owing 20', 'cashier', t.issue('slip_prod', 2, 'key-slip-bill-1', NULL, false, true))) -> 'bill' ->> 'id');
SELECT t.check('SLIP', '... owes 20', (t.bill('sb')).balance_due = 20 AND (t.bill('sb')).paid_amount = 0);

-- the customer's LINE (checked), and a LINE that is nobody's
SELECT t.set('sl_prev_cust', COALESCE((SELECT id::text FROM public.line_contacts WHERE customer_id = t.v('c1')::uuid AND status = 'LINKED'), ''));
INSERT INTO public.line_contacts (line_user_id, customer_id, status, followed, linked_at)
SELECT 'U' || repeat('e', 31) || '1', t.v('c1')::uuid, 'LINKED', true, now()
 WHERE NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.customer_id = t.v('c1')::uuid AND c.status = 'LINKED');
UPDATE public.line_contacts SET needs_review = false, followed = true WHERE customer_id = t.v('c1')::uuid AND status = 'LINKED';
SELECT t.set('uc', (SELECT line_user_id FROM public.line_contacts WHERE customer_id = t.v('c1')::uuid AND status = 'LINKED'));
INSERT INTO public.line_contacts (line_user_id, status, followed) VALUES ('U' || repeat('e', 31) || '2', 'UNLINKED', true);
SELECT t.set('ux', 'U' || repeat('e', 31) || '2');
SELECT t.set('u_owner', t.lf_link('owner', '8'));

-- pay form
SELECT t.set('pf', public.line_pay_form(t.v('uc'), t.v('sb')::uuid)::text);
SELECT t.check('SLIP', 'pay form: OK, owes 20, payable', t.v('pf')::jsonb ->> 'result' = 'OK'
    AND (t.v('pf')::jsonb -> 'bill' ->> 'balance_due')::numeric = 20 AND (t.v('pf')::jsonb -> 'bill' ->> 'payable')::boolean);
SELECT t.check('SLIP', 'pay form: another LINE sees nothing', public.line_pay_form(t.v('ux'), t.v('sb')::uuid) ->> 'result' = 'NOT_FOUND');
SELECT t.err('SLIP', 'pay form: not for a signed-in user', 'cashier',
    format($q$select public.line_pay_form(%L, %L::uuid)$q$, t.v('uc'), t.v('sb')), 'permission denied');

-- submit
SELECT t.check('SLIP', 'submit: a path of another bill is refused',
    public.line_slip_submit(t.v('uc'), t.v('sb')::uuid, 10, gen_random_uuid() || '/' || gen_random_uuid() || '.jpg', NULL) ->> 'result' = 'INVALID_INPUT');
SELECT t.check('SLIP', 'submit: more than owed is refused',
    public.line_slip_submit(t.v('uc'), t.v('sb')::uuid, 25, t.v('sb') || '/' || gen_random_uuid() || '.jpg', NULL) ->> 'result' = 'INVALID_INPUT');
SELECT t.check('SLIP', 'submit: another LINE is refused',
    public.line_slip_submit(t.v('ux'), t.v('sb')::uuid, 10, t.v('sb') || '/' || gen_random_uuid() || '.jpg', NULL) ->> 'result' = 'NOT_FOUND');
SELECT t.set('s1', public.line_slip_submit(t.v('uc'), t.v('sb')::uuid, 15, t.v('sb') || '/' || gen_random_uuid() || '.jpg',
    '[{"type":"text","text":"ลูกค้าแนบสลิป"}]'::jsonb) ->> 'slip_id');
SELECT t.check('SLIP', 'submit: saved PENDING, no money taken', t.v('s1') IS NOT NULL
    AND (SELECT status FROM public.line_payment_slips WHERE id = t.v('s1')::uuid) = 'PENDING' AND (t.bill('sb')).paid_amount = 0);
SELECT t.check('SLIP', 'submit: the owner gets an in-app notice and a LINE notice',
    EXISTS (SELECT 1 FROM public.notifications WHERE event_key LIKE 'LINE_SLIP:' || t.v('s1') || ':%')
    AND EXISTS (SELECT 1 FROM public.line_deliveries WHERE dedupe_key LIKE 'SLIP:' || t.v('s1') || ':%' AND template_key = 'SLIP_OWNER_NEW'));
SELECT t.check('SLIP', 'slips table is not readable by a client',
    NOT has_table_privilege('authenticated', 'public.line_payment_slips', 'SELECT'));

-- list + approve once
SELECT t.check('SLIP', 'list: the slip is waiting',
    ((t.ok('SLIP', 'list', 'cashier', $q$select public.line_slips_list('PENDING', 25, 0)$q$)) -> 'counts' ->> 'PENDING')::int >= 1);
SELECT t.set('pays0', t.pay_count('sb')::text);
SELECT t.ok('SLIP', 'approve 15', 'cashier',
    format($q$select public.line_slip_approve(%L::uuid, 15, NULL, '[{"type":"text","text":"รับยอดแล้ว"}]'::jsonb)$q$, t.v('s1')));
SELECT t.check('SLIP', '... paid 15, owes 5, one TRANSFER payment', (t.bill('sb')).paid_amount = 15 AND (t.bill('sb')).balance_due = 5
    AND t.pay_count('sb') = t.v('pays0')::bigint + 1
    AND EXISTS (SELECT 1 FROM public.payments WHERE bill_id = t.v('sb')::uuid AND method = 'TRANSFER' AND amount = 15 AND status = 'COMPLETED'));
SELECT t.check('SLIP', '... slip APPROVED, the customer is told once',
    (SELECT status FROM public.line_payment_slips WHERE id = t.v('s1')::uuid) = 'APPROVED'
    AND (SELECT count(*) FROM public.line_deliveries WHERE dedupe_key = 'SLIP_APPROVED:' || t.v('s1')) = 1);
SELECT t.err('SLIP', 'approve again is refused', 'cashier',
    format($q$select public.line_slip_approve(%L::uuid, 15, NULL, NULL)$q$, t.v('s1')), 'LINE_SLIP_NOT_PENDING');
SELECT t.check('SLIP', '... still paid 15 (no second cut)', (t.bill('sb')).paid_amount = 15 AND t.pay_count('sb') = t.v('pays0')::bigint + 1);

-- reject
SELECT t.set('s2', public.line_slip_submit(t.v('uc'), t.v('sb')::uuid, 5, t.v('sb') || '/' || gen_random_uuid() || '.png', NULL) ->> 'slip_id');
SELECT t.err('SLIP', 'reject without a reason is refused', 'cashier',
    format($q$select public.line_slip_reject(%L::uuid, '  ', NULL)$q$, t.v('s2')), 'REASON_REQUIRED');
SELECT t.ok('SLIP', 'reject with a reason', 'cashier',
    format($q$select public.line_slip_reject(%L::uuid, 'ยอดไม่ตรง', '[{"type":"text","text":"สลิปไม่ผ่าน"}]'::jsonb)$q$, t.v('s2')));
SELECT t.check('SLIP', '... REJECTED, no money, still owes 5',
    (SELECT status FROM public.line_payment_slips WHERE id = t.v('s2')::uuid) = 'REJECTED' AND (t.bill('sb')).balance_due = 5);
SELECT t.err('SLIP', 'approve after reject is refused', 'cashier',
    format($q$select public.line_slip_approve(%L::uuid, 5, NULL, NULL)$q$, t.v('s2')), 'LINE_SLIP_NOT_PENDING');

-- bill card: only this bill's own pay buttons
SELECT t.ok('CARD', 'card with the two pay buttons of this bill', 'cashier', format($q$select public.line_bill_send_card(%L::uuid, %L::jsonb, 'key-card-pay-1')$q$,
    t.v('sb'), jsonb_build_array(jsonb_build_object('type', 'flex', 'altText', 'บิล', 'contents', jsonb_build_object('type', 'bubble',
        'body', jsonb_build_object('type', 'box', 'layout', 'vertical', 'contents', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'บิล'))),
        'footer', jsonb_build_object('type', 'box', 'layout', 'vertical', 'contents', jsonb_build_array(
            jsonb_build_object('type', 'button', 'action', jsonb_build_object('type', 'uri', 'label', 'ชำระเงิน', 'uri', 'https://liff.line.me/1234567890-AbCd/pay?bill=' || t.v('sb'))),
            jsonb_build_object('type', 'button', 'action', jsonb_build_object('type', 'uri', 'label', 'แนบสลิป', 'uri', 'https://liff.line.me/1234567890-AbCd/pay?bill=' || t.v('sb') || '&tab=slip')))))))));
SELECT t.err('CARD', 'a card with any other link is refused', 'cashier', format($q$select public.line_bill_send_card(%L::uuid, %L::jsonb, 'key-card-pay-2')$q$,
    t.v('sb'), jsonb_build_array(jsonb_build_object('type', 'flex', 'altText', 'บิล', 'contents', jsonb_build_object('type', 'bubble',
        'body', jsonb_build_object('type', 'box', 'layout', 'vertical', 'contents', jsonb_build_array(
            jsonb_build_object('type', 'button', 'action', jsonb_build_object('type', 'uri', 'label', 'x', 'uri', 'https://example.com/pay?bill=' || t.v('sb'))))))))),
    'LINE_MESSAGE_INVALID');

-- staff tasks
SELECT t.set('u_cashier', t.lf_link('cashier', '9'));
SELECT t.set('tk', gen_random_uuid()::text);
SELECT t.ok('TASK', 'owner sends a task to cashier', 'owner', format($q$select public.line_task_create(%L::uuid, %L::uuid, 'ส่งของ', NULL, NULL, NULL, %L::jsonb, 'key-task-73-1')$q$,
    t.v('tk'), t.u('cashier'), jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'งาน ' || t.v('tk')))));
SELECT t.ok('TASK', 'set ISSUE with a note', 'owner', format($q$select public.line_task_set_status(%L::uuid, 'ISSUE', 'รถเสีย')$q$, t.v('tk')));
SELECT t.check('TASK', '... ISSUE + note', (SELECT status = 'ISSUE' AND issue_note = 'รถเสีย' FROM public.line_tasks WHERE id = t.v('tk')::uuid));
SELECT t.ok('TASK', 'set DONE', 'cashier', format($q$select public.line_task_set_status(%L::uuid, 'DONE')$q$, t.v('tk')));
SELECT t.check('TASK', '... DONE with accepted_at and done_at',
    (SELECT status = 'DONE' AND accepted_at IS NOT NULL AND done_at IS NOT NULL FROM public.line_tasks WHERE id = t.v('tk')::uuid));
SELECT t.ok('TASK', 'back to SENT', 'owner', format($q$select public.line_task_set_status(%L::uuid, 'SENT')$q$, t.v('tk')));
SELECT t.check('TASK', '... SENT clears accepted / done', (SELECT status = 'SENT' AND accepted_at IS NULL AND done_at IS NULL FROM public.line_tasks WHERE id = t.v('tk')::uuid));
SELECT t.err('TASK', 'an unknown state is refused', 'owner', format($q$select public.line_task_set_status(%L::uuid, 'CANCELLED')$q$, t.v('tk')), 'LINE_TASK_STATUS_INVALID');
SELECT t.check('TASK', 'list counts the task',
    ((t.ok('TASK', 'list', 'cashier', $q$select public.line_tasks_list(NULL, 25, 0)$q$)) -> 'counts' ->> 'SENT')::int >= 1);

-- staff QR: OWNER only, single use
SELECT t.err('QR', 'cashier cannot make a staff QR', 'cashier', format($q$select public.line_staff_qr_create(%L::uuid)$q$, t.u('nomenu')), 'FORBIDDEN');
SELECT t.set('qr', (t.ok('QR', 'owner makes a QR for nomenu', 'owner', format($q$select public.line_staff_qr_create(%L::uuid)$q$, t.u('nomenu'))))::text);
SELECT t.check('QR', '... a scan token, no code, about 5 minutes', t.v('qr')::jsonb ->> 'token' ~ '^[A-HJ-NP-Z2-9]{32}$'
    AND NOT (t.v('qr')::jsonb ? 'code')
    AND (t.v('qr')::jsonb ->> 'expires_at')::timestamptz BETWEEN now() + interval '4 minutes' AND now() + interval '6 minutes');
SELECT t.check('QR', '... state OPEN', (t.ok('QR', 'state', 'owner', format($q$select public.line_link_code_state(%L::uuid)$q$, t.v('qr')::jsonb ->> 'code_id'))) ->> 'state' = 'OPEN');
SELECT t.err('QR', 'a client cannot scan', 'owner', format($q$select public.line_staff_qr_scan(%L)$q$, t.v('qr')::jsonb ->> 'token'), 'permission denied');
SELECT t.set('scan', public.line_staff_qr_scan(t.v('qr')::jsonb ->> 'token')::text);
SELECT t.check('QR', 'first scan: the chat code', t.v('scan')::jsonb ->> 'result' = 'OK' AND t.v('scan')::jsonb ->> 'code' ~ '^LINK-[A-HJ-NP-Z2-9]{10}$');
SELECT t.check('QR', 'second scan: nothing', public.line_staff_qr_scan(t.v('qr')::jsonb ->> 'token') ->> 'result' = 'DEAD');
SELECT t.check('QR', '... state SCANNED', (t.ok('QR', 'state scanned', 'owner', format($q$select public.line_link_code_state(%L::uuid)$q$, t.v('qr')::jsonb ->> 'code_id'))) ->> 'state' = 'SCANNED');
SELECT t.check('QR', 'the staff member sends it: linked', public.line_link_code_consume(t.v('ux'), t.v('scan')::jsonb ->> 'code') ->> 'result' = 'LINKED_STAFF');
SELECT t.check('QR', '... state USED', (t.ok('QR', 'state used', 'owner', format($q$select public.line_link_code_state(%L::uuid)$q$, t.v('qr')::jsonb ->> 'code_id'))) ->> 'state' = 'USED');
INSERT INTO public.line_contacts (line_user_id, status, followed) VALUES ('U' || repeat('e', 31) || '3', 'UNLINKED', true);
SELECT t.check('QR', 'the same code again is dead', public.line_link_code_consume('U' || repeat('e', 31) || '3', t.v('scan')::jsonb ->> 'code') ->> 'result' IN ('INVALID', 'EXPIRED'));

-- owner chat commands
SELECT t.check('CMD', 'switch off: not answered', public.line_owner_summary(t.v('u_owner')) ->> 'result' = 'NOT_OWNER');
UPDATE public.store_settings SET policies = jsonb_set(COALESCE(policies, '{}'::jsonb), '{line}', COALESCE(policies -> 'line', '{}'::jsonb) || '{"ownerCommands": true}'::jsonb) WHERE singleton;
SELECT t.set('sum', public.line_owner_summary(t.v('u_owner'))::text);
SELECT t.check('CMD', 'owner: summary with today and what is owed', t.v('sum')::jsonb ->> 'result' = 'OK'
    AND (t.v('sum')::jsonb ->> 'owed')::numeric >= 5 AND (t.v('sum')::jsonb ->> 'income')::numeric >= 15
    AND (t.v('sum')::jsonb ->> 'income')::numeric = (SELECT COALESCE(sum(x.amount), 0) FROM public._line_income_today(public._local_date(now())) x));
SELECT t.check('CMD', 'a staff LINE gets nothing', public.line_owner_summary(t.v('u_cashier')) ->> 'result' = 'NOT_OWNER');
SELECT t.set('rs', public.line_owner_task_resolve(t.v('u_owner'), 'Cashier ล้างรถ หน้าร้าน')::text);
SELECT t.check('CMD', '#สั่งงาน finds the member and the task', t.v('rs')::jsonb ->> 'result' = 'OK'
    AND t.v('rs')::jsonb ->> 'assignee_id' = t.u('cashier')::text AND t.v('rs')::jsonb ->> 'title' = 'ล้างรถ หน้าร้าน');
SELECT t.check('CMD', 'unknown name', public.line_owner_task_resolve(t.v('u_owner'), 'ไม่มีคนนี้ ทำงาน') ->> 'result' = 'NO_MEMBER');
SELECT t.check('CMD', 'name only, no task', public.line_owner_task_resolve(t.v('u_owner'), 'cashier') ->> 'result' = 'NO_DETAIL');
SELECT t.set('ot', gen_random_uuid()::text);
SELECT t.check('CMD', 'task made once', public.line_owner_task_create(t.v('u_owner'), 'evt-73-1', t.v('ot')::uuid, t.u('cashier'), 'ล้างรถ',
    jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'งาน ' || t.v('ot')))) ->> 'duplicate' = 'false');
SELECT t.check('CMD', '... the same LINE message again is the same task', public.line_owner_task_create(t.v('u_owner'), 'evt-73-1', gen_random_uuid(), t.u('cashier'), 'ล้างรถ',
    jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'x'))) ->> 'task_id' = t.v('ot'));
SELECT t.err_admin('CMD', 'switch must be true/false', $q$UPDATE public.store_settings SET policies = jsonb_set(policies, '{line,ownerCommands}', '"yes"') WHERE singleton$q$, 'INVALID_POLICY');

SELECT t.check('GRANTS', 'server-only functions are not for clients',
    NOT has_function_privilege('authenticated', 'public.line_slip_submit(text, uuid, numeric, text, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.line_owner_summary(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.line_slip_approve(uuid, numeric, date, jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.line_slip_approve(uuid, numeric, date, jsonb)', 'EXECUTE'));

-- put back what later files may read
UPDATE public.line_contacts SET status = 'UNLINKED', profile_id = NULL, unlinked_at = now() WHERE line_user_id = t.v('ux');
SELECT t.lf_unlink('owner'), t.lf_unlink('cashier');
UPDATE public.store_settings SET policies = t.v('sl_policies_before')::jsonb WHERE singleton;
