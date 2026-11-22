-- Rule tests for supabase/migrations/20261121090000_line_register_review_v1.sql (owner 2026-11-21):
-- what a stranger types in the OA chat only files a request; no customer is created, no LINE is
-- linked, nothing about a customer is disclosed; the shop decides. FOLLOW keeps the picture, the time
-- added, never wipes a pending request, and obeys policies.line.friend.
-- Runs after 59_line_link_review.sql.
\set ON_ERROR_STOP 1

-- A real customer whose phone a stranger may type, and one that already has a LINE.
SELECT t.set('rg_cust', t.ok('REG-REVIEW', 'owner adds a customer', 'owner',
    $q$select public.customer_create('{"name":"ลูกค้า ลงทะเบียน","phone":"086-666-0001","address":"อุตรดิตถ์"}'::jsonb)$q$) ->> 'id');
SELECT t.set('rg_cust_taken', t.ok('REG-REVIEW', 'owner adds a customer that has a LINE', 'owner',
    $q$select public.customer_create('{"name":"ลูกค้า มี LINE แล้ว","phone":"086-666-0002","address":"อุตรดิตถ์"}'::jsonb)$q$) ->> 'id');
SELECT t.set('rg_code', t.ok('REG-REVIEW', 'the shop makes that customer''s link', 'owner',
    format($q$select public.line_link_code_create_customer(%L::uuid)$q$, t.v('rg_cust_taken'))) ->> 'code');
SELECT public.line_webhook_event('e-rg-0', 'U' || repeat('5', 31) || '0', 'FOLLOW', NULL, NULL, now());
SELECT public.line_link_code_consume('U' || repeat('5', 31) || '0', t.v('rg_code'));
SELECT t.check('REG-REVIEW', 'that customer now has a LINE',
    EXISTS (SELECT 1 FROM public.line_contacts WHERE customer_id = t.v('rg_cust_taken')::uuid AND status = 'LINKED'));
SELECT t.set('rg_customers_before', (SELECT count(*)::text FROM public.customers));

-- 1. a stranger adds the OA
SELECT public.line_webhook_event('e-rg-1', 'U' || repeat('5', 31) || '1', 'FOLLOW', NULL, NULL, now());
SELECT t.check('REG-REVIEW', 'follow: a new friend (picture kept, time added kept, waits for nothing typed yet)',
    (SELECT r ->> 'is_new' = 'true' AND r ->> 'send_welcome' = 'true' AND r ->> 'status' = 'UNLINKED' AND r ->> 'register_status' = 'WAITING'
       FROM (SELECT public.line_contact_follow('U' || repeat('5', 31) || '1', 'คนแปลกหน้า', 'https://profile.line-scdn.net/abc') AS r) x));
SELECT t.check('REG-REVIEW', 'follow: picture and added time stored',
    (SELECT picture_url = 'https://profile.line-scdn.net/abc' AND followed_at IS NOT NULL
       FROM public.line_contacts WHERE line_user_id = 'U' || repeat('5', 31) || '1'));
SELECT t.check('REG-REVIEW', 'follow: an http picture is ignored',
    (SELECT (public.line_contact_follow('U' || repeat('5', 31) || '1', 'คนแปลกหน้า', 'http://evil.example/x.png') ->> 'status') = 'UNLINKED'
        AND picture_url = 'https://profile.line-scdn.net/abc'
       FROM public.line_contacts WHERE line_user_id = 'U' || repeat('5', 31) || '1'));
SELECT t.check('REG-REVIEW', 'follow: nobody is a customer yet',
    (SELECT customer_id IS NULL AND profile_id IS NULL AND driver_code IS NULL FROM public.line_contacts WHERE line_user_id = 'U' || repeat('5', 31) || '1'));

-- 2. the stranger types the phone of a customer without LINE
SELECT t.check('REG-REVIEW', 'typed phone of a known customer: only a request (PENDING), no link',
    (public.line_self_register('U' || repeat('5', 31) || '1', 'คนแปลกหน้า', '0866660001') ->> 'result') = 'PENDING');
SELECT t.check('REG-REVIEW', '... still UNLINKED, not that customer, status PENDING, hint = ONE for the shop',
    (SELECT status = 'UNLINKED' AND customer_id IS NULL AND register_status = 'PENDING'
            AND register_customer_id = t.v('rg_cust')::uuid AND register_payload ->> 'match' = 'ONE'
            AND typed_name = 'คนแปลกหน้า' AND typed_phone = '0866660001'
       FROM public.line_contacts WHERE line_user_id = 'U' || repeat('5', 31) || '1'));
SELECT t.check('REG-REVIEW', '... the customer has no LINE and bill cards cannot reach the stranger',
    NOT EXISTS (SELECT 1 FROM public.line_contacts WHERE customer_id = t.v('rg_cust')::uuid AND status = 'LINKED'));
SELECT t.check('REG-REVIEW', 'the owner is told a request waits',
    EXISTS (SELECT 1 FROM public.notifications n JOIN public.line_contacts c ON c.id = n.entity_id
             WHERE n.event_type = 'LINE_REGISTER_PENDING' AND c.line_user_id = 'U' || repeat('5', 31) || '1'));

-- 3. a phone nobody has: no customer is created by itself
SELECT public.line_webhook_event('e-rg-2', 'U' || repeat('5', 31) || '2', 'FOLLOW', NULL, NULL, now());
SELECT public.line_contact_follow('U' || repeat('5', 31) || '2', 'อีกคน');
SELECT t.check('REG-REVIEW', 'typed new phone: only a request (PENDING)',
    (public.line_self_register('U' || repeat('5', 31) || '2', 'ร้านใหม่', '0866660003') ->> 'result') = 'PENDING');
SELECT t.check('REG-REVIEW', '... the hint for the shop = NONE, nobody pre-selected',
    (SELECT register_payload ->> 'match' = 'NONE' AND register_customer_id IS NULL
       FROM public.line_contacts WHERE line_user_id = 'U' || repeat('5', 31) || '2'));
SELECT t.check('REG-REVIEW', 'no customer was created in the POS',
    (SELECT count(*) FROM public.customers) = t.v('rg_customers_before')::bigint);

-- 4. a phone that already has a LINE: same neutral answer, nothing disclosed, nothing replaced
SELECT public.line_webhook_event('e-rg-3', 'U' || repeat('5', 31) || '3', 'FOLLOW', NULL, NULL, now());
SELECT public.line_contact_follow('U' || repeat('5', 31) || '3', 'ผู้สวมสิทธิ์');
SELECT t.check('REG-REVIEW', 'typed phone of a customer who has a LINE: the stranger only gets PENDING (no PHONE_TAKEN hint)',
    (public.line_self_register('U' || repeat('5', 31) || '3', 'ผู้สวมสิทธิ์', '0866660002') ->> 'result') = 'PENDING');
SELECT t.check('REG-REVIEW', '... the first LINE keeps the customer; the hint for the shop = TAKEN',
    (SELECT (SELECT line_user_id FROM public.line_contacts WHERE customer_id = t.v('rg_cust_taken')::uuid AND status = 'LINKED') = 'U' || repeat('5', 31) || '0'
        AND c.register_payload ->> 'match' = 'TAKEN' AND c.customer_id IS NULL
       FROM public.line_contacts c WHERE c.line_user_id = 'U' || repeat('5', 31) || '3'));

-- 5. wrong input / already linked
SELECT t.check('REG-REVIEW', 'a short phone is INVALID and changes nothing',
    (public.line_self_register('U' || repeat('5', 31) || '2', 'ร้านใหม่', '12345') ->> 'result') = 'INVALID');
SELECT t.check('REG-REVIEW', 'a linked contact typing again: ALREADY_LINKED',
    (public.line_self_register('U' || repeat('5', 31) || '0', 'x', '0866660009') ->> 'result') = 'ALREADY_LINKED');

-- 6. a follow again never wipes a request; an unblock never resets or welcomes
SELECT t.check('REG-REVIEW', 're-follow keeps the pending request and its typed data',
    (public.line_contact_follow('U' || repeat('5', 31) || '1', 'คนแปลกหน้า') ->> 'register_status') = 'PENDING'
    AND (SELECT typed_name = 'คนแปลกหน้า' AND register_customer_id = t.v('rg_cust')::uuid
           FROM public.line_contacts WHERE line_user_id = 'U' || repeat('5', 31) || '1'));
SELECT t.set('rg_followed_at', (SELECT followed_at::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('5', 31) || '1'));
SELECT t.check('REG-REVIEW', 'unblock: no welcome, added time unchanged, not new',
    (SELECT r ->> 'send_welcome' = 'false' AND r ->> 'is_unblock' = 'true' AND r ->> 'is_new' = 'false'
       FROM (SELECT public.line_contact_follow('U' || repeat('5', 31) || '1', 'คนแปลกหน้า', NULL, true) AS r) x)
    AND (SELECT followed_at::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('5', 31) || '1') = t.v('rg_followed_at'));
SELECT t.check('REG-REVIEW', 'a linked friend is not welcomed again',
    (public.line_contact_follow('U' || repeat('5', 31) || '0', 'ลูกค้า') ->> 'send_welcome') = 'false');

-- 7. the shop checks a request (its own typing keeps the old rule: a member of the shop is the checker)
SELECT t.set('rg_pending', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('5', 31) || '1'));
SELECT t.check('REG-REVIEW', 'the shop confirms the request: right customer, linked',
    (t.ok('REG-REVIEW', 'shop links the pending contact', 'owner',
        format($q$select public.line_contact_register_by_shop(%L::uuid, 'คนแปลกหน้า', '0866660001')$q$, t.v('rg_pending'))) ->> 'result') = 'LINKED_CUSTOMER');
SELECT t.check('REG-REVIEW', '... now linked to the customer, request cleared, no new customer',
    (SELECT status = 'LINKED' AND customer_id = t.v('rg_cust')::uuid AND register_status IS NULL AND register_customer_id IS NULL
       FROM public.line_contacts WHERE id = t.v('rg_pending')::uuid)
    AND (SELECT count(*) FROM public.customers) = t.v('rg_customers_before')::bigint);
SELECT t.ok('REG-REVIEW', 'the shop can reject another request', 'owner',
    format($q$select public.line_contact_reject(%L::uuid, 'ไม่ใช่ลูกค้าของร้าน')$q$,
        (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('5', 31) || '3')));
SELECT t.check('REG-REVIEW', 'a rejected stranger typing again is REJECTED (no request)',
    (public.line_self_register('U' || repeat('5', 31) || '3', 'ผู้สวมสิทธิ์', '0866660002') ->> 'result') = 'REJECTED');

-- 8. the owner's switches policies.line.friend
SELECT t.err_admin('REG-REVIEW', 'an unknown friend key is refused',
    $q$update public.store_settings set policies = jsonb_set(coalesce(policies, '{}'::jsonb), '{line,friend}', '{"hello":true}'::jsonb, true)$q$,
    'INVALID_POLICY: line.friend.hello');
SELECT t.err_admin('REG-REVIEW', 'a non-boolean welcome is refused',
    $q$update public.store_settings set policies = jsonb_set(coalesce(policies, '{}'::jsonb), '{line,friend}', '{"welcome":"yes"}'::jsonb, true)$q$,
    'INVALID_POLICY: line.friend.welcome');
UPDATE public.store_settings
   SET policies = jsonb_set(coalesce(policies, '{}'::jsonb), '{line,friend}', '{"welcome":false,"notifyOwner":true}'::jsonb, true);
SELECT public.line_webhook_event('e-rg-4', 'U' || repeat('5', 31) || '4', 'FOLLOW', NULL, NULL, now());
SELECT t.check('REG-REVIEW', 'welcome switched off: the database says do not send',
    (public.line_contact_follow('U' || repeat('5', 31) || '4', 'เพื่อนใหม่ล่าสุด') ->> 'send_welcome') = 'false');
SELECT t.check('REG-REVIEW', 'notify switched on: the owner gets a new-friend notice that says nobody is confirmed',
    EXISTS (SELECT 1 FROM public.notifications n JOIN public.line_contacts c ON c.id = n.entity_id
             WHERE n.event_type = 'LINE_FRIEND_NEW' AND c.line_user_id = 'U' || repeat('5', 31) || '4'
               AND n.body LIKE '%ยังไม่ได้ยืนยัน%'));
UPDATE public.store_settings SET policies = policies #- '{line,friend}';
SELECT t.check('REG-REVIEW', 'switch removed: welcome is on again by default',
    (public.line_contact_follow('U' || repeat('5', 31) || '4', 'เพื่อนใหม่ล่าสุด') ->> 'send_welcome') = 'true');
