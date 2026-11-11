-- Rule tests for supabase/migrations/20261111045151_customer_name_only_required_v1.sql (owner 2026-11-11):
-- a new customer needs only a name; phone and address may be empty; customers without a phone are not
-- "duplicates" of each other; the same phone or the same name still asks first.
\set ON_ERROR_STOP 1

SELECT t.set('no_phone_1', t.ok('CUST-NAME', 'a customer with only a name is saved', 'cashier',
    $q$select public.customer_create('{"name":"ลูกค้า ชื่ออย่างเดียว หนึ่ง","phone":"","address":""}'::jsonb)$q$) ->> 'id');
SELECT t.check('CUST-NAME', '... its phone and address are empty text, not NULL',
    (SELECT phone = '' AND address = '' FROM public.customers WHERE id = t.v('no_phone_1')::uuid));
SELECT t.ok('CUST-NAME', 'a second customer without a phone is not a duplicate of the first', 'cashier',
    $q$select public.customer_create('{"name":"ลูกค้า ชื่ออย่างเดียว สอง","phone":"","address":""}'::jsonb)$q$);
SELECT t.set('no_keys', t.ok('CUST-NAME', 'phone and address may be left out altogether', 'cashier',
    $q$select public.customer_create('{"name":"ลูกค้า ไม่ส่งเบอร์"}'::jsonb)$q$) ->> 'id');
SELECT t.check('CUST-NAME', '... saved as empty text',
    (SELECT phone = '' AND address = '' FROM public.customers WHERE id = t.v('no_keys')::uuid));
SELECT t.ok('CUST-NAME', 'a customer with a phone', 'cashier',
    $q$select public.customer_create('{"name":"ลูกค้า มีเบอร์","phone":"089-555-0101","address":""}'::jsonb)$q$);
SELECT t.err('CUST-NAME', 'the same phone still asks first', 'cashier',
    $q$select public.customer_create('{"name":"อีกคน เบอร์เดียวกัน","phone":"0895550101","address":""}'::jsonb)$q$, 'DUPLICATE_CUSTOMER');
SELECT t.err('CUST-NAME', 'the same name still asks first', 'cashier',
    $q$select public.customer_create('{"name":"ลูกค้า ชื่ออย่างเดียว หนึ่ง","phone":"","address":""}'::jsonb)$q$, 'DUPLICATE_CUSTOMER');
SELECT t.err('CUST-NAME', 'a customer without a name is refused', 'cashier',
    $q$select public.customer_create('{"name":"  ","phone":"0811111111","address":"x"}'::jsonb)$q$, 'customers_name_check');
SELECT t.ok('CUST-NAME', 'an existing customer can have the phone cleared', 'owner',
    format($q$select public.customer_update(%L::uuid, '{"phone":"","address":""}'::jsonb)$q$, t.v('no_keys')));
