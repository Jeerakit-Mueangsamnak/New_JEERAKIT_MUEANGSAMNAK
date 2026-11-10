-- Rule tests for supabase/migrations/20261111130000_line_customer_link_review_v1.sql (owner 2026-11-11):
-- a customer who links with the shop's link waits for the shop to check it; no bill goes to that LINE
-- until the shop confirms; a wrong link is undone and a new link can be made.
-- Runs after 58_line_full.sql (uses the sale product 'ps' of 40_money_stock.sql).
\set ON_ERROR_STOP 1

SELECT t.set('rv_cust', t.ok('LINK-RV', 'owner adds a customer', 'owner',
    $q$select public.customer_create('{"name":"ลูกค้า ตรวจลิงก์","phone":"089-111-2222","address":"อุตรดิตถ์"}'::jsonb)$q$) ->> 'id');
SELECT t.set('rv_bill', (t.ok('LINK-RV', 'a bill for that customer', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines',
        jsonb_build_array(jsonb_build_object('product_id', %L, 'line_mode', 'SALE', 'ordered_qty', 1))))$q$,
        t.v('rv_cust'), t.v('ps')))) ->> 'id');
SELECT t.ok('LINK-RV', 'confirm it', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-rv-confirm')$q$, t.v('rv_bill')));
SELECT t.set('rv_code', t.ok('LINK-RV', 'the shop makes the customer''s link', 'owner',
    format($q$select public.line_link_code_create_customer(%L::uuid)$q$, t.v('rv_cust'))) ->> 'code');
SELECT public.line_webhook_event('e-rv-1', 'U' || repeat('f', 31) || '9', 'FOLLOW', NULL, NULL, now());
SELECT t.check('LINK-RV', 'the customer sends the code: linked',
    public.line_link_code_consume('U' || repeat('f', 31) || '9', t.v('rv_code')) ->> 'result' = 'LINKED_CUSTOMER');
SELECT t.check('LINK-RV', '... and waiting for the shop to check it',
    (SELECT needs_review FROM public.line_contacts WHERE customer_id = t.v('rv_cust')::uuid AND status = 'LINKED'));
SELECT t.set('rv_contact', (SELECT id::text FROM public.line_contacts WHERE customer_id = t.v('rv_cust')::uuid AND status = 'LINKED'));
SELECT t.check('LINK-RV', 'the shop is told to check it',
    EXISTS (SELECT 1 FROM public.notifications WHERE entity_id = t.v('rv_cust')::uuid AND title = 'ลูกค้าผูก LINE แล้ว รอร้านตรวจ'));
SELECT t.check('LINK-RV', 'the bill screen sees the waiting link (contact + flag)',
    (SELECT r ->> 'state' = 'LINKED' AND (r ->> 'needs_review')::boolean AND r ->> 'contact_id' = t.v('rv_contact')
       FROM (SELECT t.exec_as(t.u('owner'), 'authenticated',
            format($q$select public.line_bill_recipient(%L::uuid)$q$, t.v('rv_bill'))) AS r) x));
SELECT t.err('LINK-RV', 'no bill text goes to a link that waits', 'owner',
    format($q$select public.line_bill_send(%L::uuid, 'บิล', 'key-rv-send-1')$q$, t.v('rv_bill')), 'LINE_CONTACT_NEEDS_REVIEW');
SELECT t.err('LINK-RV', 'no bill card either', 'owner',
    format($q$select public.line_bill_send_card(%L::uuid, '[{"type":"text","text":"บิล"}]'::jsonb, 'key-rv-card-1')$q$, t.v('rv_bill')),
    'LINE_CONTACT_NEEDS_REVIEW');
SELECT t.ok('LINK-RV', 'the shop checks it: right person', 'owner',
    format($q$select public.line_contact_review_ok(%L::uuid)$q$, t.v('rv_contact')));
SELECT t.ok('LINK-RV', 'now the bill can be sent', 'owner',
    format($q$select public.line_bill_send(%L::uuid, 'บิล', 'key-rv-send-2')$q$, t.v('rv_bill')));
SELECT t.ok('LINK-RV', 'a wrong link is undone by the shop', 'owner',
    format($q$select public.line_contact_unlink(%L::uuid, 'ร้านตรวจแล้ว ผูกผิดคน')$q$, t.v('rv_contact')));
SELECT t.check('LINK-RV', 'then a new link can be made for the customer',
    (t.ok('LINK-RV', 'new link', 'owner', format($q$select public.line_link_code_create_customer(%L::uuid)$q$, t.v('rv_cust'))) ->> 'code')
        ~ '^LINK-[A-HJ-NP-Z2-9]{10}$');
