-- Rule tests for supabase/migrations/20261111100000_deposit_unpaid_payment_allocation_v1.sql (owner 2026-11-11):
-- money is cut ค่าสินค้าขาย → ค่าขนส่ง → มัดจำ → ค่าเช่า; what is not paid (an unpaid deposit too) stays owed;
-- each payment keeps a record of what it paid. Runs after 40_money_stock.sql (uses c1, unit, its helpers).
\set ON_ERROR_STOP 1

SELECT t.set('as', (t.ok('A-SETUP', 'sale product T-ALLOC-S 10.00, 10 in stock', 'owner',
    format($q$select public.product_create(jsonb_build_object('sku', 'T-ALLOC-S', 'name', 'alloc sale', 'unit_id', %L,
        'can_sell', true, 'sale_price', 10), NULL, 10, false, %L::uuid)$q$, t.v('unit'), t.pin('owner', 'STOCK_RECEIVE')))) ->> 'id');
SELECT t.set('ar', (t.ok('A-SETUP', 'rental product T-ALLOC-R 10.00, 10 in stock', 'owner',
    format($q$select public.product_create(jsonb_build_object('sku', 'T-ALLOC-R', 'name', 'alloc rent', 'unit_id', %L,
        'can_rent', true, 'rental_price', 10), NULL, 10, false, %L::uuid)$q$, t.v('unit'), t.pin('owner', 'STOCK_RECEIVE')))) ->> 'id');

-- ===================================================================== MIXED BILL (sale 20 + rent 10 + delivery 100, deposit 50)
SELECT t.set('mx', (t.ok('A-MIX', 'draft: 2 × sale 10 + 1 × rent 10, delivery 100, deposit 50', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'delivery_fee', 100, 'deposit_amount', 50,
        'lines', jsonb_build_array(
            jsonb_build_object('product_id', %L, 'line_mode', 'SALE', 'ordered_qty', 2),
            jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'rental_calculation_type', 'PER_PERIOD',
                               'period_count', 1, 'rental_start_at', now(), 'rental_end_at', now() + interval '1 day'))))$q$,
        t.v('c1'), t.v('as'), t.v('ar')))) ->> 'id');
SELECT t.ok('A-MIX', 'confirm with CASH 60 (part of 130 + deposit 50)', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-alloc-mx1', '[{"method":"CASH","amount":60}]'::jsonb)$q$, t.v('mx')));
SELECT t.check('A-MIX', '60 = ค่าสินค้าขาย 20 + ค่าขนส่ง 40; deposit 50 and rent 10 still owed (balance 120)',
    (SELECT a.sale_amount = 20 AND a.shipping_amount = 40 AND a.deposit_amount = 0 AND a.rental_amount = 0
            AND a.outstanding_after = 120 AND a.receipt_id IS NOT NULL
       FROM public.bill_payment_allocations a WHERE a.bill_id = t.v('mx')::uuid AND a.total_amount = 60)
    AND (t.bill('mx')).paid_amount = 60 AND (t.bill('mx')).deposit_unpaid = 50
    AND (t.bill('mx')).balance_due = 120 AND (t.bill('mx')).payment_status = 'PARTIALLY_PAID');
SELECT t.ok('A-MIX', 'pay QR 100 later', 'cashier',
    format($q$select public.payment_receive(%L::uuid, '[{"method":"QR","amount":100}]'::jsonb, 'key-alloc-mx2')$q$, t.v('mx')));
SELECT t.check('A-MIX', '100 = rest of ค่าขนส่ง 60 + มัดจำ 40; only 40 goes to the bill',
    (SELECT a.shipping_amount = 60 AND a.deposit_amount = 40 AND a.rental_amount = 0 AND a.outstanding_after = 20
            AND a.deposit_tenders = '[{"method": "QR", "amount": 40}]'::jsonb
       FROM public.bill_payment_allocations a WHERE a.bill_id = t.v('mx')::uuid AND a.total_amount = 100)
    AND (t.bill('mx')).paid_amount = 120 AND (t.bill('mx')).deposit_unpaid = 10 AND (t.bill('mx')).balance_due = 20);
SELECT t.err('A-MIX', 'only the deposit received (40) can be given back', 'cashier',
    format($q$select public.bill_deposit_refund(%L::uuid, 50, 'CASH', 'key-alloc-mx-rf')$q$, t.v('mx')), 'DEPOSIT_EXCEEDED');
SELECT t.ok('A-MIX', 'pay CASH 20', 'cashier',
    format($q$select public.payment_receive(%L::uuid, '[{"method":"CASH","amount":20}]'::jsonb, 'key-alloc-mx3')$q$, t.v('mx')));
SELECT t.check('A-MIX', '20 = มัดจำ 10 + ค่าเช่า 10 → PAID, nothing owed, deposit 50 held',
    (SELECT a.deposit_amount = 10 AND a.rental_amount = 10 AND a.outstanding_after = 0
       FROM public.bill_payment_allocations a WHERE a.bill_id = t.v('mx')::uuid AND a.total_amount = 20)
    AND (t.bill('mx')).paid_amount = 130 AND (t.bill('mx')).deposit_unpaid = 0
    AND (t.bill('mx')).balance_due = 0 AND (t.bill('mx')).payment_status = 'PAID');
SELECT t.err('A-MIX', 'nothing more can be paid', 'cashier',
    format($q$select public.payment_receive(%L::uuid, '[{"method":"CASH","amount":1}]'::jsonb, 'key-alloc-mx4')$q$, t.v('mx')), 'OVERPAYMENT');
SELECT t.check('A-MIX', 'every payment wrote one allocation that adds up',
    (SELECT count(*) = 3 AND bool_and(sale_amount + shipping_amount + deposit_amount + rental_amount + other_amount = total_amount)
       FROM public.bill_payment_allocations WHERE bill_id = t.v('mx')::uuid));

-- ===================================================================== RENT ONLY, money covers only part of the deposit
SELECT t.set('rd', (t.ok('A-DEP', 'draft: rent 1 × 10, deposit 500, no delivery fee', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'deposit_amount', 500,
        'lines', jsonb_build_array(jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1,
            'rental_calculation_type', 'PER_PERIOD', 'period_count', 1, 'rental_start_at', now(),
            'rental_end_at', now() + interval '1 day'))))$q$, t.v('c1'), t.v('ar')))) ->> 'id');
SELECT t.ok('A-DEP', 'confirm with CASH 100, then ค้างชำระ for the rest', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-alloc-rd1', '[{"method":"CASH","amount":100}]'::jsonb)$q$, t.v('rd')));
SELECT t.check('A-DEP', 'all 100 is deposit: no receipt for the bill, 400 deposit + 10 rent owed, ชำระบางส่วน, ACTIVE',
    (SELECT a.deposit_amount = 100 AND a.receipt_id IS NULL AND a.outstanding_after = 410
       FROM public.bill_payment_allocations a WHERE a.bill_id = t.v('rd')::uuid)
    AND t.pay_count('rd') = 0 AND (t.bill('rd')).deposit_unpaid = 400 AND (t.bill('rd')).balance_due = 410
    AND (t.bill('rd')).payment_status = 'PARTIALLY_PAID' AND (t.bill('rd')).status = 'ACTIVE');
SELECT t.err('A-DEP', 'the deposit held (100) cannot pay more than the bill itself owes (10)', 'cashier',
    format($q$select public.bill_deposit_apply(%L::uuid, 50, 'key-alloc-rd-ap')$q$, t.v('rd')), 'OVERPAYMENT');
SELECT t.check('A-DEP', 'a bill confirmed with nothing taken owes its whole deposit',
    (SELECT (t.ok('A-DEP', 'confirm a deposit bill with no money', 'cashier',
        format($q$select public.bill_confirm((public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'deposit_amount', 200,
            'lines', jsonb_build_array(jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1,
            'rental_calculation_type', 'PER_PERIOD', 'period_count', 1, 'rental_start_at', now(),
            'rental_end_at', now() + interval '1 day')))) ->> 'id')::uuid, 'key-alloc-rd2')$q$, t.v('c1'), t.v('ar')))
        -> 'bill' ->> 'balance_due')::numeric = 210));
