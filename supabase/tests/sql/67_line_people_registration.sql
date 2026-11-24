-- Rule tests for supabase/migrations/20261121100000_line_people_registration_v1.sql (owner 2026-11-21):
-- the people lists and counts agree and never show line_user_id; the shop checks a request (approve into
-- a new or an existing customer, ask for more, reject with a reason) and cannot take a LINE that is
-- already linked; the form files the same request with address and consent; people who are not linked
-- yet can be answered, but never a blocked friend; link codes and the audit trail are the owner's.
-- Runs after 66_line_register_review.sql.
\set ON_ERROR_STOP 1

-- friends: a1 new phone, a2 existing customer, a3 / a4 for the error paths, a5 rejected, a6 rejected with the switch off,
-- a7 uses the form, a8 blocks the OA
SELECT public.line_webhook_event('e-pp-' || n, 'U' || repeat('8', 31) || n, 'FOLLOW', NULL, NULL, now())
  FROM unnest(ARRAY['1','2','3','4','5','6','7','8']) AS n;
SELECT public.line_contact_follow('U' || repeat('8', 31) || n, 'เพื่อน ' || n, 'https://profile.line-scdn.net/p' || n)
  FROM unnest(ARRAY['1','2','3','4','5','6','7','8']) AS n;

SELECT t.set('pp_cust', t.ok('PEOPLE', 'owner adds a customer without LINE', 'owner',
    $q$select public.customer_create('{"name":"ห้างหุ้นส่วน เชื่อมเดิม","phone":"085-555-0002","address":"อุตรดิตถ์"}'::jsonb)$q$) ->> 'id');
SELECT t.set('pp_cust2', t.ok('PEOPLE', 'owner adds another customer', 'owner',
    $q$select public.customer_create('{"name":"บริษัท เบอร์ซ้ำ จำกัด","phone":"085-555-0009","address":"อุตรดิตถ์"}'::jsonb)$q$) ->> 'id');

SELECT public.line_self_register('U' || repeat('8', 31) || '1', 'ร้านอนุมัติหนึ่ง', '0855550001');
SELECT public.line_self_register('U' || repeat('8', 31) || '2', 'ผู้ขอเชื่อม', '0855550002');
SELECT public.line_self_register('U' || repeat('8', 31) || '3', 'ผู้ขอสาม', '0855550003');
SELECT public.line_self_register('U' || repeat('8', 31) || '4', 'ผู้ขอสี่', '0855550009');
SELECT public.line_self_register('U' || repeat('8', 31) || '5', 'ผู้ขอห้า', '0855550005');
SELECT public.line_self_register('U' || repeat('8', 31) || '6', 'ผู้ขอหก', '0855550006');
SELECT public.line_webhook_event('e-pp-u8', 'U' || repeat('8', 31) || '8', 'UNFOLLOW', NULL, NULL, now());
SELECT t.set('pp_c1', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('8', 31) || '1'));
SELECT t.set('pp_c2', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('8', 31) || '2'));
SELECT t.set('pp_c3', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('8', 31) || '3'));
SELECT t.set('pp_c4', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('8', 31) || '4'));
SELECT t.set('pp_c5', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('8', 31) || '5'));
SELECT t.set('pp_c6', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('8', 31) || '6'));
SELECT t.set('pp_c7', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('8', 31) || '7'));
SELECT t.set('pp_c8', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('8', 31) || '8'));

-- 1. who may read the lists
SELECT t.err('PEOPLE', 'a suspended member cannot read the lists', 'suspended', $q$select public.line_people_counts()$q$, 'FORBIDDEN');
SELECT t.err('PEOPLE', 'nobody signed out can read the lists', 'owner', $q$select public.line_people_list('ALL')$q$, 'permission denied', 'anon');
SELECT t.err('PEOPLE', 'an unknown list name is refused', 'owner', $q$select public.line_people_list('EVERYTHING')$q$, 'LINE_VIEW_INVALID');

-- 2. counts and rows agree for every list; line_user_id is never in a row
SELECT t.check('PEOPLE', 'for every list the count equals the total of the list',
    (SELECT bool_and((t.exec_as(t.u('owner'), 'authenticated', format($q$select public.line_people_list(%L, NULL, 1, 0)$q$, v)) ->> 'total')::bigint
                     = (t.exec_as(t.u('owner'), 'authenticated', 'select public.line_people_counts()') ->> k)::bigint)
       FROM (VALUES ('ALL','all'),('UNREG','unreg'),('PENDING','pending'),('NEEDINFO','needinfo'),('CUSTOMERS','customers'),
                    ('STAFF','staff'),('DRIVERS','drivers'),('GENERAL','general'),('REJECTED','rejected'),
                    ('UNLINKED','unlinked'),('BLOCKED','blocked')) AS x(v, k)));
SELECT t.check('PEOPLE', 'seven fresh friends wait: 6 requests + the blocked one is in BLOCKED only',
    (t.exec_as(t.u('owner'), 'authenticated', 'select public.line_people_counts()') ->> 'pending')::int >= 6
    AND (t.exec_as(t.u('owner'), 'authenticated', $q$select public.line_people_list('BLOCKED')$q$) ->> 'total')::int >= 1);
SELECT t.check('PEOPLE', 'a row never carries line_user_id',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.exec_as(t.u('owner'), 'authenticated', $q$select public.line_people_list('ALL', NULL, 50, 0)$q$) -> 'rows') r
                 WHERE r ? 'line_user_id'));
SELECT t.check('PEOPLE', 'search by the typed phone finds exactly that request',
    (t.exec_as(t.u('owner'), 'authenticated', $q$select public.line_people_list('PENDING', '0855550001')$q$) ->> 'total')::int = 1);
SELECT t.check('PEOPLE', 'a page is at most the size asked for',
    jsonb_array_length(t.exec_as(t.u('owner'), 'authenticated', $q$select public.line_people_list('ALL', NULL, 2, 0)$q$) -> 'rows') = 2);

-- 3. ask for more
SELECT t.err('PEOPLE', 'a suspended member cannot ask', 'suspended',
    format($q$select public.line_contact_register_need_info(%L::uuid, 'ขอที่อยู่')$q$, t.v('pp_c3')), 'FORBIDDEN');
SELECT t.err('PEOPLE', 'asking for more needs words', 'owner',
    format($q$select public.line_contact_register_need_info(%L::uuid, '   ')$q$, t.v('pp_c3')), 'LINE_NOTE_REQUIRED');
SELECT t.check('PEOPLE', 'the shop asks for more: the request waits for the person',
    (t.ok('PEOPLE', 'need info', 'owner', format($q$select public.line_contact_register_need_info(%L::uuid, 'ขอที่อยู่ด้วยค่ะ')$q$, t.v('pp_c3'))) ->> 'register_status') = 'NEED_INFO');
SELECT t.check('PEOPLE', '... it is in the NEEDINFO list with the question kept',
    (SELECT register_status = 'NEED_INFO' AND register_note = 'ขอที่อยู่ด้วยค่ะ' FROM public.line_contacts WHERE id = t.v('pp_c3')::uuid)
    AND (t.exec_as(t.u('owner'), 'authenticated', $q$select public.line_people_list('NEEDINFO')$q$) ->> 'total')::int >= 1);
SELECT t.check('PEOPLE', 'the person answers: the request is back to PENDING and the question is cleared',
    (public.line_self_register('U' || repeat('8', 31) || '3', 'ผู้ขอสาม', '0855550003') ->> 'result') = 'PENDING');
SELECT t.check('PEOPLE', '... status PENDING, note cleared',
    (SELECT register_status = 'PENDING' AND register_note IS NULL FROM public.line_contacts WHERE id = t.v('pp_c3')::uuid));
SELECT t.err('PEOPLE', 'a friend who typed nothing cannot be approved', 'owner',
    format($q$select public.line_contact_register_approve(%L::uuid)$q$, t.v('pp_c7')), 'LINE_CONTACT_NOT_PENDING');

-- 4. approve: a new customer from what the person gave (the shop may correct it)
SELECT t.err('PEOPLE', 'a suspended member cannot approve', 'suspended',
    format($q$select public.line_contact_register_approve(%L::uuid)$q$, t.v('pp_c1')), 'FORBIDDEN');
SELECT t.set('pp_before', (SELECT count(*)::text FROM public.customers));
SELECT t.check('PEOPLE', 'approve with a new customer: linked, created, the person is told',
    (SELECT r ->> 'result' = 'LINKED_CUSTOMER' AND r ->> 'created' = 'true' AND r ->> 'notify' = 'true'
       FROM (SELECT t.ok('PEOPLE', 'approve new', 'owner',
                format($q$select public.line_contact_register_approve(%L::uuid, NULL, 'ร้านอนุมัติหนึ่ง (แก้ชื่อ)', NULL,
                          '{"address":"1 ถนนทดสอบ","subdistrict":"ท่าอิฐ","district":"เมือง","province":"อุตรดิตถ์","postcode":"53000"}'::jsonb)$q$, t.v('pp_c1'))) AS r) x));
SELECT t.check('PEOPLE', '... one customer more, with the corrected name and the address parts',
    (SELECT count(*) FROM public.customers) = t.v('pp_before')::bigint + 1
    AND EXISTS (SELECT 1 FROM public.customers cu JOIN public.line_contacts c ON c.customer_id = cu.id
                 WHERE c.id = t.v('pp_c1')::uuid AND cu.name = 'ร้านอนุมัติหนึ่ง (แก้ชื่อ)' AND cu.phone = '0855550001'
                   AND cu.contact_details ->> 'province' = 'อุตรดิตถ์' AND cu.contact_details ->> 'postalCode' = '53000'
                   AND cu.address LIKE '%ท่าอิฐ%' AND c.status = 'LINKED' AND c.register_status IS NULL AND NOT c.needs_review));
SELECT t.err('PEOPLE', 'the same request cannot be approved twice', 'owner',
    format($q$select public.line_contact_register_approve(%L::uuid)$q$, t.v('pp_c1')), 'LINE_CONTACT_NOT_PENDING');

-- 5. approve into an existing customer the shop is sure about
SELECT t.check('PEOPLE', 'approve into an existing customer: linked, nothing created',
    (SELECT r ->> 'created' = 'false' AND r ->> 'customer_id' = t.v('pp_cust')
       FROM (SELECT t.ok('PEOPLE', 'approve existing', 'owner',
                format($q$select public.line_contact_register_approve(%L::uuid, %L::uuid)$q$, t.v('pp_c2'), t.v('pp_cust'))) AS r) x));
SELECT t.check('PEOPLE', '... that LINE now belongs to that customer',
    (SELECT status = 'LINKED' AND customer_id = t.v('pp_cust')::uuid FROM public.line_contacts WHERE id = t.v('pp_c2')::uuid));
SELECT t.err('PEOPLE', 'a customer who already has a LINE is never taken over', 'owner',
    format($q$select public.line_contact_register_approve(%L::uuid, %L::uuid)$q$, t.v('pp_c3'), t.v('pp_cust')), 'LINE_CUSTOMER_ALREADY_LINKED');
SELECT t.err('PEOPLE', 'a phone the shop already has: link that customer instead of making a second one', 'owner',
    format($q$select public.line_contact_register_approve(%L::uuid)$q$, t.v('pp_c4')), 'LINE_CUSTOMER_PHONE_EXISTS');
SELECT t.check('PEOPLE', '... and that request is untouched',
    (SELECT status = 'UNLINKED' AND register_status = 'PENDING' FROM public.line_contacts WHERE id = t.v('pp_c4')::uuid));

-- 6. reject
SELECT t.check('PEOPLE', 'reject with a reason: the person is told (switch default on)',
    (SELECT r ->> 'register_status' = 'REJECTED' AND r ->> 'notify' = 'true'
       FROM (SELECT t.ok('PEOPLE', 'reject', 'owner', format($q$select public.line_contact_reject(%L::uuid, 'ไม่ใช่ลูกค้าของร้าน')$q$, t.v('pp_c5'))) AS r) x));
SELECT t.check('PEOPLE', '... and the reason is kept for the shop',
    (SELECT register_note = 'ไม่ใช่ลูกค้าของร้าน' AND register_status = 'REJECTED' FROM public.line_contacts WHERE id = t.v('pp_c5')::uuid));
UPDATE public.store_settings
   SET policies = jsonb_set(coalesce(policies, '{}'::jsonb), '{line,register}', '{"notifyRejected":false,"notifyApproved":false}'::jsonb, true);
SELECT t.check('PEOPLE', 'with the "tell the person" switch off, nothing is to be sent',
    (SELECT r ->> 'notify' = 'false'
       FROM (SELECT t.ok('PEOPLE', 'reject quietly', 'owner', format($q$select public.line_contact_reject(%L::uuid, 'ซ้ำกับรายการเดิม')$q$, t.v('pp_c6'))) AS r) x));
UPDATE public.store_settings SET policies = policies #- '{line,register}';
SELECT t.err_admin('PEOPLE', 'an unknown register key is refused',
    $q$update public.store_settings set policies = jsonb_set(coalesce(policies, '{}'::jsonb), '{line,register}', '{"hello":true}'::jsonb, true)$q$,
    'INVALID_POLICY: line.register.hello');
SELECT t.err_admin('PEOPLE', 'an unknown required field is refused',
    $q$update public.store_settings set policies = jsonb_set(coalesce(policies, '{}'::jsonb), '{line,register}', '{"required":{"shoe":true}}'::jsonb, true)$q$,
    'INVALID_POLICY: line.register.required.shoe');

-- 7. the form: consent, required fields, then the same request (with the address)
SELECT t.check('PEOPLE', 'no consent, no request',
    (public.line_register_submit('U' || repeat('8', 31) || '7', 'ผู้ใช้ฟอร์ม', '0855550007', '{"province":"อุตรดิตถ์"}'::jsonb, false) ->> 'result') = 'CONSENT_REQUIRED');
UPDATE public.store_settings
   SET policies = jsonb_set(coalesce(policies, '{}'::jsonb), '{line,register}', '{"required":{"province":true,"postcode":true}}'::jsonb, true);
SELECT t.check('PEOPLE', 'a required field left empty: MISSING lists it',
    (SELECT r ->> 'result' = 'MISSING' AND r -> 'fields' @> '["postcode"]'::jsonb
       FROM (SELECT public.line_register_submit('U' || repeat('8', 31) || '7', 'ผู้ใช้ฟอร์ม', '0855550007', '{"province":"อุตรดิตถ์"}'::jsonb, true) AS r) x));
SELECT t.check('PEOPLE', 'all required given: only a request (PENDING), address and consent kept, no customer, no link',
    (public.line_register_submit('U' || repeat('8', 31) || '7', 'ผู้ใช้ฟอร์ม', '0855550007',
        '{"province":"อุตรดิตถ์","postcode":"53000","address":"9 ถนนทดสอบ","evil":"<script>"}'::jsonb, true) ->> 'result') = 'PENDING');
SELECT t.check('PEOPLE', '... payload has the form channel, the address (only the known keys) and the consent time',
    (SELECT register_status = 'PENDING' AND customer_id IS NULL AND status = 'UNLINKED'
            AND register_payload ->> 'channel' = 'FORM' AND register_payload ? 'consent_at'
            AND register_payload -> 'address' ->> 'postcode' = '53000' AND NOT (register_payload -> 'address' ? 'evil')
       FROM public.line_contacts WHERE id = t.v('pp_c7')::uuid));
UPDATE public.store_settings SET policies = policies #- '{line,register}';
SELECT t.check('PEOPLE', 'a rejected friend cannot file again',
    (public.line_register_submit('U' || repeat('8', 31) || '5', 'ผู้ขอห้า', '0855550005', '{}'::jsonb, true) ->> 'result') = 'REJECTED');

-- 8. answers and messages: never to a friend who blocked the OA
SELECT t.check('PEOPLE', 'an answer to a request is queued for a friend who still follows (REGISTER source)',
    (SELECT r ->> 'duplicate' = 'false'
       FROM (SELECT public.line_outbox_enqueue_register(t.v('pp_c7')::uuid, 'REGISTER_NEED_INFO',
               '[{"type":"text","text":"ขอข้อมูลเพิ่ม"}]'::jsonb, 'pp-test-1') AS r) x));
SELECT t.check('PEOPLE', '... the same key twice is one message',
    (public.line_outbox_enqueue_register(t.v('pp_c7')::uuid, 'REGISTER_NEED_INFO', '[{"type":"text","text":"ขอข้อมูลเพิ่ม"}]'::jsonb, 'pp-test-1') ->> 'duplicate') = 'true');
SELECT t.check('PEOPLE', 'nothing is queued for a friend who blocked the OA',
    (public.line_outbox_enqueue_register(t.v('pp_c8')::uuid, 'REGISTER_REJECTED', '[{"type":"text","text":"x"}]'::jsonb, 'pp-test-2') ->> 'skipped') = 'CONTACT_UNREACHABLE');
SELECT t.err('PEOPLE', 'the app roles cannot queue an answer themselves', 'owner',
    format($q$select public.line_outbox_enqueue_register(%L::uuid, 'REGISTER_REJECTED', '[{"type":"text","text":"x"}]'::jsonb, 'pp-test-3')$q$, t.v('pp_c7')), 'permission denied');
SELECT t.check('PEOPLE', 'the shop writes to one friend: queued as SHOP_MESSAGE',
    (t.ok('PEOPLE', 'shop message', 'cashier', format($q$select public.line_contact_message_send(%L::uuid, 'สวัสดีค่ะ ร้านจีรกิตติ์', 'key-pp-msg-1')$q$, t.v('pp_c7'))) ->> 'duplicate') = 'false');
SELECT t.check('PEOPLE', '... a second press with the same key is the same message',
    (t.ok('PEOPLE', 'shop message again', 'cashier', format($q$select public.line_contact_message_send(%L::uuid, 'สวัสดีค่ะ ร้านจีรกิตติ์', 'key-pp-msg-1')$q$, t.v('pp_c7'))) ->> 'duplicate') = 'true');
SELECT t.check('PEOPLE', '... exactly one row in the outbox',
    (SELECT count(*) FROM public.line_deliveries WHERE source_type = 'SHOP_MESSAGE' AND contact_id = t.v('pp_c7')::uuid) = 1);
SELECT t.err('PEOPLE', 'no message to a friend who blocked the OA', 'cashier',
    format($q$select public.line_contact_message_send(%L::uuid, 'สวัสดีค่ะ', 'key-pp-msg-2')$q$, t.v('pp_c8')), 'LINE_CONTACT_UNREACHABLE');
SELECT t.err('PEOPLE', 'no empty message', 'cashier',
    format($q$select public.line_contact_message_send(%L::uuid, '  ', 'key-pp-msg-3')$q$, t.v('pp_c7')), 'LINE_MESSAGE_INVALID');
SELECT t.err('PEOPLE', 'a suspended member cannot write', 'suspended',
    format($q$select public.line_contact_message_send(%L::uuid, 'สวัสดีค่ะ', 'key-pp-msg-4')$q$, t.v('pp_c7')), 'FORBIDDEN');

-- 9. link codes (owner): list without the secret, revoke an open one once
SELECT t.set('pp_cust3', t.ok('PEOPLE', 'owner adds a customer for a code', 'owner',
    $q$select public.customer_create('{"name":"ร้านรหัสเชิญ ทดสอบ","phone":"085-555-0044","address":"อุตรดิตถ์"}'::jsonb)$q$) ->> 'id');
SELECT t.ok('PEOPLE', 'the shop makes a code', 'owner', format($q$select public.line_link_code_create_customer(%L::uuid)$q$, t.v('pp_cust3')));
SELECT t.check('PEOPLE', 'the list shows the open code for that customer, with no code or hash in it',
    (SELECT k ->> 'state' = 'OPEN' AND k ->> 'target' = 'ร้านรหัสเชิญ ทดสอบ' AND NOT (k ? 'code') AND NOT (k ? 'code_hash')
       FROM jsonb_array_elements(t.exec_as(t.u('owner'), 'authenticated', 'select public.line_codes_list(20)')) k
      WHERE k ->> 'target' = 'ร้านรหัสเชิญ ทดสอบ' LIMIT 1));
SELECT t.set('pp_code_id', (SELECT k ->> 'id' FROM jsonb_array_elements(t.exec_as(t.u('owner'), 'authenticated', 'select public.line_codes_list(20)')) k
                             WHERE k ->> 'target' = 'ร้านรหัสเชิญ ทดสอบ' LIMIT 1));
SELECT t.err('PEOPLE', 'only the owner lists codes', 'cashier', $q$select public.line_codes_list(20)$q$, 'OWNER only');
SELECT t.err('PEOPLE', 'only the owner revokes a code', 'cashier', format($q$select public.line_link_code_revoke(%L::uuid)$q$, t.v('pp_code_id')), 'OWNER only');
SELECT t.ok('PEOPLE', 'the owner revokes the open code', 'owner', format($q$select public.line_link_code_revoke(%L::uuid)$q$, t.v('pp_code_id')));
SELECT t.check('PEOPLE', '... it is REVOKED in the list',
    (SELECT k ->> 'state' = 'REVOKED' FROM jsonb_array_elements(t.exec_as(t.u('owner'), 'authenticated', 'select public.line_codes_list(20)')) k
      WHERE k ->> 'id' = t.v('pp_code_id')));
SELECT t.err('PEOPLE', 'a revoked code cannot be revoked again', 'owner', format($q$select public.line_link_code_revoke(%L::uuid)$q$, t.v('pp_code_id')), 'LINE_CODE_NOT_OPEN');

-- 10. the audit trail (owner)
SELECT t.check('PEOPLE', 'the owner reads the LINE audit trail: the approvals and the rejection are in it',
    (SELECT bool_or(a ->> 'action' = 'LINE_REGISTER_APPROVE') AND bool_or(a ->> 'action' = 'LINE_CONTACT_REJECT') AND bool_or(a ->> 'action' = 'LINE_CODE_REVOKE')
       FROM jsonb_array_elements(t.exec_as(t.u('owner'), 'authenticated', 'select public.line_audit_list(100, 0)')) a));
SELECT t.err('PEOPLE', 'only the owner reads it', 'cashier', $q$select public.line_audit_list(10, 0)$q$, 'OWNER only');
