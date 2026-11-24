-- Rule tests for supabase/migrations/20261119104511_bill_set_customer_v1.sql (owner 2026-11-19):
-- แก้ไขบิล may change the customer of a confirmed bill — another saved customer, or a typed name that is not a
-- saved customer (ลูกค้าทั่วไป). The same customer changes nothing. Credit and เช่าต่อ bills keep their customer.
-- Runs after 40_money_stock.sql (customer 'c1').
\set ON_ERROR_STOP 1

SELECT t.set('sc_c2', t.ok('SET-CUSTOMER', 'a second customer', 'cashier',
    $q$select public.customer_create('{"name":"ลูกค้า เปลี่ยนบิล สอง","phone":"","address":""}'::jsonb)$q$) ->> 'id');
SELECT t.set('sc', (t.ok('SET-CUSTOMER', 'a confirmed sale bill of c1', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', null, 'product_name', 'ค่าแรง', 'unit_name', 'งาน',
        'line_mode', 'SALE', 'ordered_qty', 1, 'unit_price', 100))))$q$, t.v('c1')))) ->> 'id');
SELECT t.ok('SET-CUSTOMER', '... issued', 'cashier', format($q$select public.bill_confirm(%L::uuid, 'key-sc-confirm')$q$, t.v('sc')));
SELECT t.set('sc_audits', (SELECT count(*)::text FROM public.audit_logs WHERE entity_id = t.v('sc')::uuid));
SELECT t.set('sc_total', (SELECT grand_total::text FROM public.bills WHERE id = t.v('sc')::uuid));

-- The same customer: nothing changes, nothing is written to the history.
SELECT t.ok('SET-CUSTOMER', 'the same customer again is accepted', 'cashier',
    format($q$select public.bill_set_customer(%L::uuid, %L::uuid, null)$q$, t.v('sc'), t.v('c1')));
SELECT t.check('SET-CUSTOMER', '... no history line for it',
    (SELECT count(*)::text FROM public.audit_logs WHERE entity_id = t.v('sc')::uuid) = t.v('sc_audits'));

-- Another saved customer.
SELECT t.ok('SET-CUSTOMER', 'change to another saved customer', 'cashier',
    format($q$select public.bill_set_customer(%L::uuid, %L::uuid, null)$q$, t.v('sc'), t.v('sc_c2')));
SELECT t.check('SET-CUSTOMER', '... the bill and its snapshot are the new customer, money untouched',
    (SELECT customer_id = t.v('sc_c2')::uuid AND guest_name IS NULL AND customer_snapshot ->> 'name' = 'ลูกค้า เปลี่ยนบิล สอง'
            AND grand_total::text = t.v('sc_total')
       FROM public.bills WHERE id = t.v('sc')::uuid));
SELECT t.check('SET-CUSTOMER', '... written to the history as BILL_SET_CUSTOMER',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id = t.v('sc')::uuid AND action = 'BILL_SET_CUSTOMER'
              AND before_data ->> 'customer_id' = t.v('c1') AND after_data ->> 'customer_id' = t.v('sc_c2')));

-- A typed name that is not a saved customer: ลูกค้าทั่วไป.
SELECT t.ok('SET-CUSTOMER', 'change to a typed guest name', 'cashier',
    format($q$select public.bill_set_customer(%L::uuid, null, '  คุณใหม่ ไม่มีในระบบ  ')$q$, t.v('sc')));
SELECT t.check('SET-CUSTOMER', '... the bill is a guest bill with the trimmed name',
    (SELECT customer_id IS NULL AND guest_name = 'คุณใหม่ ไม่มีในระบบ' AND customer_snapshot = '{"name":"คุณใหม่ ไม่มีในระบบ","guest":true}'::jsonb
       FROM public.bills WHERE id = t.v('sc')::uuid));
SELECT t.err('SET-CUSTOMER', 'neither a customer nor a name is refused', 'cashier',
    format($q$select public.bill_set_customer(%L::uuid, null, '   ')$q$, t.v('sc')), 'CUSTOMER_REQUIRED');
SELECT t.ok('SET-CUSTOMER', 'back to a saved customer from a guest', 'cashier',
    format($q$select public.bill_set_customer(%L::uuid, %L::uuid, null)$q$, t.v('sc'), t.v('c1')));
SELECT t.check('SET-CUSTOMER', '... guest name cleared',
    (SELECT customer_id = t.v('c1')::uuid AND guest_name IS NULL AND customer_snapshot ->> 'guest' IS NULL
       FROM public.bills WHERE id = t.v('sc')::uuid));

-- The snapshot stays locked for every other path.
SELECT t.err_admin('SET-CUSTOMER', 'a plain update of the customer of a confirmed bill is still refused',
    format($q$update public.bills set customer_id = %L::uuid where id = %L::uuid$q$, t.v('sc_c2'), t.v('sc')),
    'BILL_TERMS_IMMUTABLE_AFTER_CONFIRM');
SELECT t.err_admin('SET-CUSTOMER', 'a plain update of the guest name of a confirmed bill is still refused',
    format($q$update public.bills set customer_id = null, guest_name = 'x' where id = %L::uuid$q$, t.v('sc')),
    'IMMUTABLE');

-- Refused bills / customers.
UPDATE public.customers SET active = false WHERE id = t.v('sc_c2')::uuid;
SELECT t.err('SET-CUSTOMER', 'a suspended customer is refused', 'cashier',
    format($q$select public.bill_set_customer(%L::uuid, %L::uuid, null)$q$, t.v('sc'), t.v('sc_c2')), 'CUSTOMER_INACTIVE');
UPDATE public.customers SET active = true WHERE id = t.v('sc_c2')::uuid;
SELECT t.err('SET-CUSTOMER', 'a draft is refused (the POS sets its customer)', 'cashier',
    format($q$select public.bill_set_customer(%L::uuid, %L::uuid, null)$q$,
        (t.ok('SET-CUSTOMER', 'a draft', 'cashier', format($q2$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L))$q2$, t.v('c1'))) ->> 'id'),
        t.v('sc_c2')), 'BILL_NOT_REVISABLE');
SELECT t.err('SET-CUSTOMER', 'the anon role cannot call it', 'cashier',
    format($q$select public.bill_set_customer(%L::uuid, %L::uuid, null)$q$, t.v('sc'), t.v('sc_c2')), 'permission denied', 'anon');
