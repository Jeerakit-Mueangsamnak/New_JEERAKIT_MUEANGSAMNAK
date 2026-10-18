-- Money / stock / return / VAT / atomicity tests (owner request 2026-10-08), throwaway local DB only.
-- Sequential cases live here. The real two-connection races run from run_local.sh right after this
-- file (they use the drafts prepared below), and 90_money_stock_after.sql checks their outcome plus the
-- report-level totals over every bill the whole suite created.
-- Products are created here (T-*) so the numbers never depend on what the earlier files did.
\set ON_ERROR_STOP 1

-- ===================================================================== HELPERS
-- Race log: one row per attempt, with its own start/finish time to prove the two calls overlapped.
CREATE TABLE t.conc (tag text, who text, ok boolean, msg text, started timestamptz, finished timestamptz);
CREATE FUNCTION t.try(p_tag text, p_who text, p_user text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v       jsonb;
BEGIN
    BEGIN
        v := t.exec_as(t.u(p_user), 'authenticated', p_sql);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO t.conc VALUES (p_tag, p_who, false, SQLERRM, v_start, clock_timestamp());
        RETURN;
    END;
    -- Keep the transaction (and its row locks) open a moment, so the other call is certainly in flight
    -- before this one commits: a fast call can no longer finish before the second one starts.
    PERFORM pg_sleep(0.3);
    INSERT INTO t.conc VALUES (p_tag, p_who, true,
        CASE WHEN v ? 'idempotent_replay' THEN 'REPLAY ' ELSE '' END || left(COALESCE(v::text, 'ok'), 300),
        v_start, clock_timestamp());
END;
$$;
-- A SALE draft for customer c1: p_lines is a list of (product var, qty).
CREATE FUNCTION t.sale(p_lines text[][], p_extra text DEFAULT '') RETURNS text LANGUAGE sql AS $f$
    SELECT format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, %s 'lines', %L::jsonb))$q$,
        t.v('c1'), p_extra,
        (SELECT jsonb_agg(jsonb_build_object('product_id', t.v(p_lines[i][1]), 'line_mode', 'SALE',
                                             'ordered_qty', p_lines[i][2]::numeric) ORDER BY i)
           FROM generate_subscripts(p_lines, 1) i));
$f$;
CREATE FUNCTION t.stock(p_prod text, p_state text) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT quantity FROM public.stock_balances
                      WHERE product_id = t.v(p_prod)::uuid AND stock_state = p_state), 0);
$$;
CREATE FUNCTION t.bill(p_var text) RETURNS public.bills LANGUAGE sql STABLE AS $$
    SELECT * FROM public.bills WHERE id = t.v(p_var)::uuid;
$$;
CREATE FUNCTION t.pay_count(p_var text) RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT count(*) FROM public.payments WHERE bill_id = t.v(p_var)::uuid AND status = 'COMPLETED';
$$;
CREATE FUNCTION t.ledger_net(p_var text, p_types text[] DEFAULT ARRAY['REVENUE', 'VAT']) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT COALESCE(sum(amount * direction), 0) FROM public.finance_ledger_entries
     WHERE bill_id = t.v(p_var)::uuid AND source_type = 'BILL_CONFIRM' AND entry_type = ANY (p_types);
$$;

-- ===================================================================== SETUP (own products)
-- 30_action_grants.sql ends with the cashier's risky actions revoked; refunds here need REFUND again.
SELECT t.ok('M-SETUP', 'owner grants the cashier REFUND again (test setup)', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['PRODUCT_PRICE_CHANGE','STOCK_ADJUST','BILL_VOID','REFUND','EXPENSE','WRITE_OFF'], 'test setup')$q$, t.u('cashier')));
SELECT t.set('unit', (SELECT id::text FROM public.units WHERE name = 'ชุด'));
SELECT t.set('ps', (t.ok('M-SETUP', 'sale product T-SALE 10.00, 40 in stock', 'owner',
    format($q$select public.product_create(jsonb_build_object('sku', 'T-SALE', 'name', 'test sale item', 'unit_id', %L,
        'can_sell', true, 'sale_price', 10), NULL, 40, false, %L::uuid)$q$, t.v('unit'), t.pin('owner', 'STOCK_RECEIVE')))) ->> 'id');
SELECT t.set('pl', (t.ok('M-SETUP', 'sale product T-LAST 25.00, exactly 1 in stock', 'owner',
    format($q$select public.product_create(jsonb_build_object('sku', 'T-LAST', 'name', 'test last unit', 'unit_id', %L,
        'can_sell', true, 'sale_price', 25), NULL, 1, false, %L::uuid)$q$, t.v('unit'), t.pin('owner', 'STOCK_RECEIVE')))) ->> 'id');
SELECT t.set('pz', (t.ok('M-SETUP', 'sale product T-ZERO 5.00, no stock', 'owner',
    format($q$select public.product_create(jsonb_build_object('sku', 'T-ZERO', 'name', 'test no stock', 'unit_id', %L,
        'can_sell', true, 'sale_price', 5))$q$, t.v('unit')))) ->> 'id');
SELECT t.set('pr', (t.ok('M-SETUP', 'rental product T-RENT 10.00, 5 in stock', 'owner',
    format($q$select public.product_create(jsonb_build_object('sku', 'T-RENT', 'name', 'test rental item', 'unit_id', %L,
        'can_rent', true, 'rental_price', 10), NULL, 5, false, %L::uuid)$q$, t.v('unit'), t.pin('owner', 'STOCK_RECEIVE')))) ->> 'id');

-- ===================================================================== DUPLICATE PAY / CONFIRM (sequential)
SELECT t.set('dA', (t.ok('M-DUP', 'draft A: 2 × T-SALE = 20', 'cashier', t.sale(ARRAY[['ps', '2']]))) ->> 'id');
SELECT t.ok('M-DUP', 'confirm A with CASH 20', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-dup-a1', '[{"method":"CASH","amount":20}]'::jsonb)$q$, t.v('dA')));
SELECT t.check('M-DUP', 'double click (same key, same request) returns the first result as a replay',
    (t.exec_as(t.u('cashier'), 'authenticated',
        format($q$select public.bill_confirm(%L::uuid, 'key-dup-a1', '[{"method":"CASH","amount":20}]'::jsonb)$q$, t.v('dA')))
        ->> 'idempotent_replay') = 'true');
SELECT t.check('M-DUP', 'after the double click: 1 receipt, 1 payment, paid 20, stock taken once (40 → 38)',
    t.pay_count('dA') = 1
    AND (SELECT count(*) FROM public.payment_receipts WHERE bill_id = t.v('dA')::uuid) = 1
    AND (t.bill('dA')).paid_amount = 20 AND (t.bill('dA')).payment_status = 'PAID'
    AND t.stock('ps', 'AVAILABLE') = 38 AND t.stock('ps', 'RESERVED') = 2);
SELECT t.err('M-DUP', 'same key with a different amount is refused, not paid twice', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-dup-a1', '[{"method":"CASH","amount":19}]'::jsonb)$q$, t.v('dA')),
    'IDEMPOTENCY_CONFLICT');
SELECT t.err('M-DUP', 'confirming again with a new key is refused (bill is no longer a draft)', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-dup-a2', '[{"method":"CASH","amount":20}]'::jsonb)$q$, t.v('dA')),
    'BILL_NOT_DRAFT');
SELECT t.check('M-DUP', 'revenue posted once for bill A (ledger = grand total 20)',
    t.ledger_net('dA') = 20
    AND (SELECT count(*) FROM public.finance_ledger_entries WHERE bill_id = t.v('dA')::uuid AND source_type = 'BILL_CONFIRM') = 1
    AND t.pay_count('dA') = 1);

SELECT t.set('dB', (t.ok('M-DUP', 'draft B: 1 × T-SALE = 10', 'cashier', t.sale(ARRAY[['ps', '1']]))) ->> 'id');
SELECT t.ok('M-DUP', 'confirm B without money', 'cashier', format($q$select public.bill_confirm(%L::uuid, 'key-dup-b0')$q$, t.v('dB')));
SELECT t.ok('M-DUP', 'receive 10 for B', 'cashier',
    format($q$select public.payment_receive(%L::uuid, '[{"method":"TRANSFER","amount":10}]'::jsonb, 'key-dup-b1', '2026-10-01'::date)$q$, t.v('dB')));
SELECT t.check('M-DUP', 'selected receive day is stored on receipt and payments',
    public._local_date((SELECT received_at FROM public.payment_receipts WHERE bill_id = t.v('dB')::uuid)) = '2026-10-01'::date
    AND public._local_date((SELECT received_at FROM public.payments WHERE bill_id = t.v('dB')::uuid)) = '2026-10-01'::date);
SELECT t.check('M-DUP', 'receive button pressed twice (same key) = replay, still 1 payment',
    (t.exec_as(t.u('cashier'), 'authenticated',
        format($q$select public.payment_receive(%L::uuid, '[{"method":"TRANSFER","amount":10}]'::jsonb, 'key-dup-b1', '2026-10-01'::date)$q$, t.v('dB')))
        ->> 'idempotent_replay') = 'true'
    AND t.pay_count('dB') = 1);
SELECT t.err('M-DUP', 'a second receive with a new key on a paid bill is refused as overpayment', 'cashier',
    format($q$select public.payment_receive(%L::uuid, '[{"method":"TRANSFER","amount":10}]'::jsonb, 'key-dup-b2')$q$, t.v('dB')),
    'OVERPAYMENT');
SELECT t.err('M-DUP', 'a payment date in the future is rejected', 'cashier',
    format($q$select public.payment_receive(%L::uuid, '[{"method":"TRANSFER","amount":1}]'::jsonb, 'key-dup-b-future', '2999-12-31'::date)$q$, t.v('dB')),
    'PAYMENT_DATE_IN_FUTURE');
SELECT t.err('M-DUP', 'amount with more than 2 decimals is refused', 'cashier',
    format($q$select public.payment_receive(%L::uuid, '[{"method":"CASH","amount":0.005}]'::jsonb, 'key-dup-b3')$q$, t.v('dB')),
    'INVALID_AMOUNT');
SELECT t.check('M-DUP', 'bill B: paid exactly 10, balance 0',
    (t.bill('dB')).paid_amount = 10 AND (t.bill('dB')).balance_due = 0 AND t.pay_count('dB') = 1);

-- ===================================================================== REFUND LIMITS
SELECT t.set('pA', (SELECT id::text FROM public.payments WHERE bill_id = t.v('dA')::uuid));
SELECT t.err('M-REFUND', 'refund 25 on a bill paid 20 is refused', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 25, 'CASH', 'too much', 'key-mrf-1', %L::uuid, %L::uuid)$q$,
           t.v('dA'), t.pin('cashier', 'REFUND'), t.v('pA')), 'REFUND_EXCEEDS_REFUNDABLE');
SELECT t.err('M-REFUND', 'refund 0 is refused', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 0, 'CASH', 'zero', 'key-mrf-2', %L::uuid, %L::uuid)$q$,
           t.v('dA'), t.pin('cashier', 'REFUND'), t.v('pA')), 'INVALID_AMOUNT');
SELECT t.err('M-REFUND', 'negative refund is refused', 'cashier',
    format($q$select public.refund_pay(%L::uuid, -5, 'CASH', 'negative', 'key-mrf-3', %L::uuid, %L::uuid)$q$,
           t.v('dA'), t.pin('cashier', 'REFUND'), t.v('pA')), 'INVALID_AMOUNT');
SELECT t.ok('M-REFUND', 'refund 8 of 20', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 8, 'CASH', 'part', 'key-mrf-4', %L::uuid, %L::uuid)$q$,
           t.v('dA'), t.pin('cashier', 'REFUND'), t.v('pA')));
SELECT t.check('M-REFUND', 'refund pressed twice (same key) = replay, money leaves once',
    (t.exec_as(t.u('cashier'), 'authenticated',
        format($q$select public.refund_pay(%L::uuid, 8, 'CASH', 'part', 'key-mrf-4', %L::uuid, %L::uuid)$q$,
               t.v('dA'), t.pin('cashier', 'REFUND'), t.v('pA'))) ->> 'idempotent_replay') = 'true'
    AND (SELECT count(*) FROM public.refunds WHERE bill_id = t.v('dA')::uuid) = 1);
SELECT t.err('M-REFUND', 'refund 13 when only 12 is left is refused', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 13, 'CASH', 'over', 'key-mrf-5', %L::uuid, %L::uuid)$q$,
           t.v('dA'), t.pin('cashier', 'REFUND'), t.v('pA')), 'REFUND_EXCEEDS');
SELECT t.ok('M-REFUND', 'refund the remaining 12', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 12, 'CASH', 'rest', 'key-mrf-6', %L::uuid, %L::uuid)$q$,
           t.v('dA'), t.pin('cashier', 'REFUND'), t.v('pA')));
SELECT t.err('M-REFUND', 'nothing left: even 0.01 more is refused', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 0.01, 'CASH', 'more', 'key-mrf-7', %L::uuid, %L::uuid)$q$,
           t.v('dA'), t.pin('cashier', 'REFUND'), t.v('pA')), 'REFUND_EXCEEDS');
SELECT t.check('M-REFUND', 'bill A: refunded 20 = paid 20, refund ledger 20, 2 refunds',
    (t.bill('dA')).refunded_amount = 20 AND (t.bill('dA')).paid_amount = 20
    AND (SELECT sum(amount) FROM public.finance_ledger_entries WHERE bill_id = t.v('dA')::uuid AND entry_type = 'REFUND') = 20
    AND (SELECT count(*) FROM public.refunds WHERE bill_id = t.v('dA')::uuid AND status = 'PAID') = 2);
-- split tender: a refund cannot take more than the payment it points to
SELECT t.set('dC', (t.ok('M-REFUND', 'draft C: 3 × T-SALE = 30', 'cashier', t.sale(ARRAY[['ps', '3']]))) ->> 'id');
SELECT t.ok('M-REFUND', 'confirm C paid CASH 10 + TRANSFER 20', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-mrf-c0',
        '[{"method":"CASH","amount":10},{"method":"TRANSFER","amount":20}]'::jsonb)$q$, t.v('dC')));
SELECT t.set('pC_cash', (SELECT id::text FROM public.payments WHERE bill_id = t.v('dC')::uuid AND method = 'CASH'));
SELECT t.err('M-REFUND', 'refund 15 against the CASH 10 payment is refused', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 15, NULL, 'split', 'key-mrf-c1', %L::uuid, %L::uuid)$q$,
           t.v('dC'), t.pin('cashier', 'REFUND'), t.v('pC_cash')), 'REFUND_EXCEEDS_PAYMENT');
SELECT t.ok('M-REFUND', 'refund 10 against the CASH payment (method taken from the payment)', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 10, NULL, 'split', 'key-mrf-c2', %L::uuid, %L::uuid)$q$,
           t.v('dC'), t.pin('cashier', 'REFUND'), t.v('pC_cash')));
SELECT t.check('M-REFUND', 'bill C: refunded 10 in CASH, 20 still refundable',
    (t.bill('dC')).refunded_amount = 10
    AND (SELECT method FROM public.refunds WHERE bill_id = t.v('dC')::uuid) = 'CASH');

-- ===================================================================== PARTIAL RETURN (rental)
SELECT t.set('dR', (t.ok('M-RETURN', 'rental draft: 3 × T-RENT', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 3, 'rental_calculation_type', 'PER_PERIOD',
        'period_count', 1, 'rental_start_at', now(), 'rental_end_at', now() + interval '3 days'))))$q$, t.v('c1'), t.v('pr'))))
    ->> 'id');
SELECT t.set('lR', (SELECT id::text FROM public.bill_lines WHERE bill_id = t.v('dR')::uuid));
SELECT t.ok('M-RETURN', 'confirm rental paid 30', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-mrt-0', '[{"method":"CASH","amount":30}]'::jsonb)$q$, t.v('dR')));
SELECT t.ok('M-RETURN', 'deliver 3', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 3)), 'key-mrt-dl')$q$,
           t.v('dR'), t.v('lR')));
SELECT t.check('M-RETURN', 'stock after delivery: AVAILABLE 2, RENTED_OUT 3',
    t.stock('pr', 'AVAILABLE') = 2 AND t.stock('pr', 'RENTED_OUT') = 3);
SELECT t.ok('M-RETURN', 'return 1 of 3 in normal condition', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1,
        'condition', 'NORMAL')), 'key-mrt-1')$q$, t.v('dR'), t.v('lR')));
SELECT t.check('M-RETURN', 'partial return: AVAILABLE 3, RENTED_OUT 2',
    t.stock('pr', 'AVAILABLE') = 3 AND t.stock('pr', 'RENTED_OUT') = 2);
SELECT t.check('M-RETURN', 'return pressed twice (same key) = replay, stock added once',
    (t.exec_as(t.u('cashier'), 'authenticated',
        format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1,
            'condition', 'NORMAL')), 'key-mrt-1')$q$, t.v('dR'), t.v('lR'))) ->> 'idempotent_replay') = 'true'
    AND t.stock('pr', 'AVAILABLE') = 3 AND t.stock('pr', 'RENTED_OUT') = 2
    AND (SELECT count(*) FROM public.returns WHERE bill_id = t.v('dR')::uuid) = 1);
SELECT t.err('M-RETURN', 'returning 3 when the customer holds 2 is refused', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 3,
        'condition', 'NORMAL')), 'key-mrt-2')$q$, t.v('dR'), t.v('lR')), 'RETURN_EXCEEDS_HELD');
SELECT t.err('M-RETURN', 'one return with a valid part (1) and a bad part (5) is refused as a whole', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(
        jsonb_build_object('bill_line_id', %L, 'quantity', 1, 'condition', 'NORMAL'),
        jsonb_build_object('bill_line_id', %L, 'quantity', 5, 'condition', 'NORMAL')), 'key-mrt-3')$q$,
        t.v('dR'), t.v('lR'), t.v('lR')), 'RETURN_EXCEEDS_HELD');
SELECT t.check('M-ATOMIC', 'failed return left nothing: stock unchanged, no return row, no movement',
    t.stock('pr', 'AVAILABLE') = 3 AND t.stock('pr', 'RENTED_OUT') = 2
    AND (SELECT count(*) FROM public.returns WHERE bill_id = t.v('dR')::uuid) = 1
    AND (SELECT count(*) FROM public.stock_movements WHERE product_id = t.v('pr')::uuid AND movement_type = 'RETURN') = 2);
SELECT t.check('M-RETURN', 'money stays consistent after the early return: refund suggestion never above what is refundable',
    (SELECT COALESCE((r ->> 'suggested_refund')::numeric, 0) <= (t.bill('dR')).paid_amount - (t.bill('dR')).refunded_amount
       FROM t.exec_as(t.u('cashier'), 'authenticated', format($q$select public.bill_refund_suggestion(%L::uuid)$q$, t.v('dR'))) r));
SELECT t.ok('M-RETURN', 'return the last 2', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 2,
        'condition', 'NORMAL')), 'key-mrt-4')$q$, t.v('dR'), t.v('lR')));
SELECT t.check('M-RETURN', 'paid in full and everything back: the bill closes by itself', (t.bill('dR')).status = 'CLOSED');
SELECT t.err('M-RETURN', 'nothing held any more (bill closed): one more piece is refused', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1,
        'condition', 'NORMAL')), 'key-mrt-5')$q$, t.v('dR'), t.v('lR')), 'BILL_NOT_OPEN');
SELECT t.check('M-RETURN', 'all back: AVAILABLE 5 = opening stock, RENTED_OUT 0, returned = delivered',
    t.stock('pr', 'AVAILABLE') = 5 AND t.stock('pr', 'RENTED_OUT') = 0
    AND (SELECT sum(quantity) FROM public.return_lines WHERE bill_line_id = t.v('lR')::uuid) = 3);

-- ===================================================================== VAT ROUNDING + LEDGER = BILL
SELECT t.ok('M-VAT', 'OWNER sets VAT 7% exclusive (test value)', 'owner',
    $q$select public.settings_update('{"vat_rate":7,"vat_mode":"EXCLUSIVE"}'::jsonb, 'test')$q$);
SELECT t.set('dV1', (t.ok('M-VAT', 'bill 10 + delivery 0.50, VAT on', 'cashier',
    t.sale(ARRAY[['ps', '1']], $x$'vat_enabled', true, 'delivery_fee', 0.50,$x$))) ->> 'id');
SELECT t.check('M-VAT', 'exclusive half-satang rounds up: 10.50 × 7% = 0.735 → 0.74, total 11.24',
    (t.bill('dV1')).taxable_amount = 10.50 AND (t.bill('dV1')).vat_amount = 0.74 AND (t.bill('dV1')).grand_total = 11.24);
SELECT t.set('dV2', (t.ok('M-VAT', 'bill 10 + delivery 0.07, VAT on', 'cashier',
    t.sale(ARRAY[['ps', '1']], $x$'vat_enabled', true, 'delivery_fee', 0.07,$x$))) ->> 'id');
SELECT t.check('M-VAT', 'exclusive rounds down below half: 10.07 × 7% = 0.7049 → 0.70, total 10.77',
    (t.bill('dV2')).vat_amount = 0.70 AND (t.bill('dV2')).grand_total = 10.77);
SELECT t.set('dV4', (t.ok('M-VAT', 'bill 30 with 3.33% bill discount, VAT on', 'cashier',
    t.sale(ARRAY[['ps', '3']], $x$'vat_enabled', true, 'bill_discount_type', 'PERCENT', 'bill_discount_value', 3.33,$x$))) ->> 'id');
SELECT t.check('M-VAT', 'discount before VAT: 30 − 1.00 (0.999 rounded) = 29.00, VAT 2.03, total 31.03',
    (t.bill('dV4')).bill_discount_amount = 1.00 AND (t.bill('dV4')).taxable_amount = 29.00
    AND (t.bill('dV4')).vat_amount = 2.03 AND (t.bill('dV4')).grand_total = 31.03);
SELECT t.ok('M-VAT', 'confirm V1 paid 11.24', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-vat-v1', '[{"method":"CASH","amount":11.24}]'::jsonb)$q$, t.v('dV1')));
SELECT t.ok('M-VAT', 'confirm V2 paid 10.00 of 10.77 (partial)', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-vat-v2', '[{"method":"CASH","amount":10}]'::jsonb)$q$, t.v('dV2')));
SELECT t.ok('M-VAT', 'confirm V4 paid 31.03', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-vat-v4', '[{"method":"QR","amount":31.03}]'::jsonb)$q$, t.v('dV4')));
SELECT t.check('M-VAT', 'V2 partial: paid 10.00, balance exactly 0.77, status PARTIALLY_PAID',
    (t.bill('dV2')).paid_amount = 10 AND (t.bill('dV2')).balance_due = 0.77 AND (t.bill('dV2')).payment_status = 'PARTIALLY_PAID');
SELECT t.check('M-VAT', 'ledger = bill for each VAT bill (revenue + VAT = grand total; VAT line = VAT amount)',
    (SELECT bool_and(t.ledger_net(v) = (t.bill(v)).grand_total AND t.ledger_net(v, ARRAY['VAT']) = (t.bill(v)).vat_amount)
       FROM unnest(ARRAY['dV1', 'dV2', 'dV4']) v));
SELECT t.check('M-VAT', 'bill discount posted as negative revenue 1.00 on V4',
    (SELECT sum(amount * direction) FROM public.finance_ledger_entries
      WHERE bill_id = t.v('dV4')::uuid AND revenue_class = 'DISCOUNT') = -1.00);
SELECT t.ok('M-VAT', 'OWNER switches to VAT 7% inclusive', 'owner',
    $q$select public.settings_update('{"vat_rate":7,"vat_mode":"INCLUSIVE"}'::jsonb, 'test')$q$);
SELECT t.set('dV3', (t.ok('M-VAT', 'inclusive bill 10 + delivery 0.50', 'cashier',
    t.sale(ARRAY[['ps', '1']], $x$'vat_enabled', true, 'delivery_fee', 0.50,$x$))) ->> 'id');
SELECT t.check('M-VAT', 'inclusive: 10.50 × 7/107 = 0.6869 → 0.69, taxable 9.81, total stays 10.50',
    (t.bill('dV3')).vat_amount = 0.69 AND (t.bill('dV3')).taxable_amount = 9.81 AND (t.bill('dV3')).grand_total = 10.50);
SELECT t.ok('M-VAT', 'confirm V3 paid 10.50', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-vat-v3', '[{"method":"CARD","amount":10.50}]'::jsonb)$q$, t.v('dV3')));
SELECT t.check('M-VAT', 'inclusive ledger: revenue 10.50 − VAT-included 0.69 + VAT 0.69 = 10.50',
    t.ledger_net('dV3') = 10.50 AND t.ledger_net('dV3', ARRAY['VAT']) = 0.69);
SELECT t.ok('M-VAT', 'reset the test VAT rate', 'owner',
    $q$select public.settings_update('{"vat_rate":null,"vat_mode":null}'::jsonb, 'test done')$q$);

-- ===================================================================== FAILED MULTI-STEP CONFIRM LEAVES NOTHING
SELECT t.set('dF', (t.ok('M-ATOMIC', 'draft F: 2 × T-SALE + 1 × T-ZERO (no stock)', 'cashier',
    t.sale(ARRAY[['ps', '2'], ['pz', '1']]))) ->> 'id');
SELECT t.set('ps_avail', t.stock('ps', 'AVAILABLE')::text);
SELECT t.set('bill_seq', (SELECT COALESCE(sum(last_no), 0)::text FROM public.document_sequences WHERE doc_type = 'BILL'));
SELECT t.err('M-ATOMIC', 'confirm F with payment fails on the second line (no stock)', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-atom-f', '[{"method":"CASH","amount":15}]'::jsonb)$q$, t.v('dF')),
    'INSUFFICIENT_STOCK');
SELECT t.check('M-ATOMIC', 'nothing of F was kept: still DRAFT, no bill number, no payment, no ledger, no reservation',
    (t.bill('dF')).status = 'DRAFT' AND (t.bill('dF')).bill_no IS NULL
    AND t.pay_count('dF') = 0
    AND NOT EXISTS (SELECT 1 FROM public.payment_receipts WHERE bill_id = t.v('dF')::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.finance_ledger_entries WHERE bill_id = t.v('dF')::uuid)
    AND t.stock('ps', 'AVAILABLE')::text = t.v('ps_avail')
    AND NOT EXISTS (SELECT 1 FROM public.stock_movements sm JOIN public.bill_lines l ON l.id = sm.source_id
                     WHERE l.bill_id = t.v('dF')::uuid));
SELECT t.check('M-ATOMIC', 'the failed confirm used no bill number and left no stuck request key',
    (SELECT COALESCE(sum(last_no), 0)::text FROM public.document_sequences WHERE doc_type = 'BILL') = t.v('bill_seq')
    AND NOT EXISTS (SELECT 1 FROM public.idempotency_keys WHERE idempotency_key = 'key-atom-f'));
SELECT t.ok('M-ATOMIC', 'owner receives 1 × T-ZERO', 'owner',
    format($q$select public.stock_receive(%L::uuid, 1, 'restock', 'key-atom-recv', %L::uuid)$q$, t.v('pz'), t.pin('owner', 'STOCK_RECEIVE')));
SELECT t.ok('M-ATOMIC', 'retry with the same key now succeeds (key was not left half-done)', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-atom-f', '[{"method":"CASH","amount":15}]'::jsonb)$q$, t.v('dF')));
SELECT t.check('M-ATOMIC', 'F confirmed once: total 25, paid 15 (1 payment), balance 10, T-ZERO now 0 available / 1 reserved',
    (t.bill('dF')).status <> 'DRAFT' AND (t.bill('dF')).grand_total = 25 AND (t.bill('dF')).paid_amount = 15
    AND (t.bill('dF')).balance_due = 10 AND t.pay_count('dF') = 1
    AND t.stock('pz', 'AVAILABLE') = 0 AND t.stock('pz', 'RESERVED') = 1 AND t.ledger_net('dF') = 25);

SELECT t.set('dG', (t.ok('M-ATOMIC', 'draft G: 1 × T-SALE = 10', 'cashier', t.sale(ARRAY[['ps', '1']]))) ->> 'id');
SELECT t.set('ps_avail', t.stock('ps', 'AVAILABLE')::text);
SELECT t.err('M-ATOMIC', 'confirm G fails at the last step (unknown payment method)', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-atom-g1', '[{"method":"BITCOIN","amount":10}]'::jsonb)$q$, t.v('dG')),
    'INVALID_METHOD');
SELECT t.err('M-ATOMIC', 'confirm G fails at the last step (overpayment 11 on 10)', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-atom-g2', '[{"method":"CASH","amount":11}]'::jsonb)$q$, t.v('dG')),
    'OVERPAYMENT');
SELECT t.check('M-ATOMIC', 'after both late failures G is untouched: DRAFT, no stock taken, no revenue, no money',
    (t.bill('dG')).status = 'DRAFT' AND (t.bill('dG')).bill_no IS NULL
    AND t.stock('ps', 'AVAILABLE')::text = t.v('ps_avail') AND t.pay_count('dG') = 0
    AND NOT EXISTS (SELECT 1 FROM public.finance_ledger_entries WHERE bill_id = t.v('dG')::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id = t.v('dG')::uuid AND action = 'BILL_CONFIRM'));
SELECT t.err('M-ATOMIC', 'refund on a draft bill is refused and records nothing', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 1, 'CASH', 'x', 'key-atom-rf', %L::uuid, %L::uuid)$q$,
           t.v('dG'), t.pin('cashier', 'REFUND'), t.v('pA')), 'BILL_NOT_REFUNDABLE');

-- ===================================================================== CANCEL / VOID BALANCE
-- A cancelled or voided bill is no longer a receivable. Money already received on a VOID bill stays
-- and is owed back (balance_due < 0 → refund suggestion), never hidden as 0 (Master §20).
SELECT t.set('dX', (t.ok('M-CANCEL', 'draft X: 1 × T-SALE = 10', 'cashier', t.sale(ARRAY[['ps', '1']]))) ->> 'id');
SELECT t.ok('M-CANCEL', 'cancel draft X', 'cashier', format($q$select public.bill_cancel(%L::uuid, 'customer left')$q$, t.v('dX')));
SELECT t.set('dY', (t.ok('M-CANCEL', 'draft Y: 1 × T-SALE = 10', 'cashier', t.sale(ARRAY[['ps', '1']]))) ->> 'id');
SELECT t.ok('M-CANCEL', 'confirm Y without money', 'cashier', format($q$select public.bill_confirm(%L::uuid, 'key-cx-y0')$q$, t.v('dY')));
SELECT t.ok('M-CANCEL', 'cancel confirmed Y (PIN)', 'cashier',
    format($q$select public.bill_cancel(%L::uuid, 'customer changed mind', %L::uuid)$q$, t.v('dY'), t.pin('cashier', 'BILL_CANCEL')));
SELECT t.check('M-CANCEL', 'cancelled draft X owes nothing',
    (t.bill('dX')).status = 'CANCELLED' AND (t.bill('dX')).balance_due = 0 AND (t.bill('dX')).paid_amount = 0);
SELECT t.check('M-CANCEL', 'cancelled confirmed Y owes nothing; stock back, revenue reversed',
    (t.bill('dY')).status = 'CANCELLED' AND (t.bill('dY')).balance_due = 0 AND (t.bill('dY')).payment_status = 'UNPAID'
    AND (SELECT COALESCE(sum(amount * direction), 0) FROM public.finance_ledger_entries WHERE bill_id = t.v('dY')::uuid) = 0);
SELECT t.set('dZ', (t.ok('M-CANCEL', 'draft Z: 2 × T-SALE = 20', 'cashier', t.sale(ARRAY[['ps', '2']]))) ->> 'id');
SELECT t.ok('M-CANCEL', 'confirm Z paid 20', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-cx-z0', '[{"method":"CASH","amount":20}]'::jsonb)$q$, t.v('dZ')));
SELECT t.err('M-CANCEL', 'a paid bill cannot be cancelled (workflow: void)', 'cashier',
    format($q$select public.bill_cancel(%L::uuid, 'x', %L::uuid)$q$, t.v('dZ'), t.pin('cashier', 'BILL_CANCEL')), 'BILL_NOT_CANCELLABLE');
SELECT t.ok('M-CANCEL', 'void paid Z (PIN)', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'wrong items', %L::uuid)$q$, t.v('dZ'), t.pin('cashier', 'BILL_VOID')));
SELECT t.check('M-CANCEL', 'void Z: no receivable; the 20 received is owed back (balance −20, suggestion 20)',
    (t.bill('dZ')).status = 'VOID' AND (t.bill('dZ')).balance_due = -20 AND (t.bill('dZ')).paid_amount = 20
    AND (t.exec_as(t.u('cashier'), 'authenticated', format($q$select public.bill_refund_suggestion(%L::uuid)$q$, t.v('dZ')))
         ->> 'suggested_refund')::numeric = 20);
SELECT t.check('M-CANCEL', 'void keeps the money history: payment still COMPLETED 20, revenue reversed to 0',
    t.pay_count('dZ') = 1
    AND (SELECT amount FROM public.payments WHERE bill_id = t.v('dZ')::uuid) = 20
    AND (SELECT COALESCE(sum(amount * direction), 0) FROM public.finance_ledger_entries WHERE bill_id = t.v('dZ')::uuid) = 0);
SELECT t.ok('M-CANCEL', 'refund the 20 on void Z', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 20, NULL, 'void refund', 'key-cx-z-rf', %L::uuid, %L::uuid)$q$, t.v('dZ'),
           t.pin('cashier', 'REFUND'), (SELECT id::text FROM public.payments WHERE bill_id = t.v('dZ')::uuid)));
SELECT t.check('M-CANCEL', 'void Z after refund: balance 0, REFUNDED, nothing more to suggest',
    (t.bill('dZ')).balance_due = 0 AND (t.bill('dZ')).refunded_amount = 20 AND (t.bill('dZ')).payment_status = 'REFUNDED'
    AND (t.exec_as(t.u('cashier'), 'authenticated', format($q$select public.bill_refund_suggestion(%L::uuid)$q$, t.v('dZ')))
         ->> 'suggested_refund')::numeric = 0);
SELECT t.check('M-CANCEL', 'reconcile X, Y, Z twice: nothing changes either time',
    (SELECT bool_and((r -> 'before') - 'updated_at' = (r -> 'after') - 'updated_at')
       FROM unnest(ARRAY['dX', 'dY', 'dZ', 'dX', 'dY', 'dZ']) v, LATERAL public.reconcile_bill(t.v(v)::uuid) r));
SELECT t.check('M-CANCEL', 'cancel / void are audited',
    (SELECT count(*) FROM public.audit_logs WHERE action = 'BILL_CANCEL' AND entity_id IN (t.v('dX')::uuid, t.v('dY')::uuid)) = 2
    AND EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'BILL_VOID' AND entity_id = t.v('dZ')::uuid));

-- ===================================================================== VOID + PARTIAL REFUND / WRITE-OFF
-- W1: paid 20 → void → refund 5 → 15 still owed back, and never more than that.
SELECT t.set('dW1', (t.ok('M-VOID', 'draft W1: 2 × T-SALE = 20', 'cashier', t.sale(ARRAY[['ps', '2']]))) ->> 'id');
SELECT t.ok('M-VOID', 'confirm W1 paid 20', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-w1-0', '[{"method":"CASH","amount":20}]'::jsonb)$q$, t.v('dW1')));
SELECT t.set('pW1', (SELECT id::text FROM public.payments WHERE bill_id = t.v('dW1')::uuid));
SELECT t.ok('M-VOID', 'void W1', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'wrong bill', %L::uuid)$q$, t.v('dW1'), t.pin('cashier', 'BILL_VOID')));
SELECT t.err('M-VOID', 'void W1 again is refused (no second reversal)', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'again', %L::uuid)$q$, t.v('dW1'), t.pin('cashier', 'BILL_VOID')), 'BILL_NOT_VOIDABLE');
SELECT t.ok('M-VOID', 'refund 5 of the 20 on void W1', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 5, NULL, 'void part', 'key-w1-rf1', %L::uuid, %L::uuid)$q$,
           t.v('dW1'), t.pin('cashier', 'REFUND'), t.v('pW1')));
SELECT t.check('M-VOID', 'W1 after refund 5: balance −15, PARTIALLY_REFUNDED, suggestion 15, payment refundable 15',
    (t.bill('dW1')).balance_due = -15 AND (t.bill('dW1')).payment_status = 'PARTIALLY_REFUNDED'
    AND (SELECT (r ->> 'suggested_refund')::numeric = 15 AND (r #>> '{payments,0,refundable}')::numeric = 15
           FROM t.exec_as(t.u('cashier'), 'authenticated', format($q$select public.bill_refund_suggestion(%L::uuid)$q$, t.v('dW1'))) r));
SELECT t.check('M-VOID', 'refund 5 pressed twice (same key) = replay, one refund row',
    (t.exec_as(t.u('cashier'), 'authenticated',
        format($q$select public.refund_pay(%L::uuid, 5, NULL, 'void part', 'key-w1-rf1', %L::uuid, %L::uuid)$q$,
               t.v('dW1'), t.pin('cashier', 'REFUND'), t.v('pW1'))) ->> 'idempotent_replay') = 'true'
    AND (SELECT count(*) FROM public.refunds WHERE bill_id = t.v('dW1')::uuid) = 1);
SELECT t.err('M-VOID', 'refund 16 when 15 is left is refused', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 16, NULL, 'too much', 'key-w1-rf2', %L::uuid, %L::uuid)$q$,
           t.v('dW1'), t.pin('cashier', 'REFUND'), t.v('pW1')), 'REFUND_EXCEEDS');
SELECT t.ok('M-VOID', 'refund the remaining 15', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 15, NULL, 'void rest', 'key-w1-rf3', %L::uuid, %L::uuid)$q$,
           t.v('dW1'), t.pin('cashier', 'REFUND'), t.v('pW1')));
SELECT t.err('M-VOID', 'nothing left on W1: 0.01 more is refused', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 0.01, NULL, 'more', 'key-w1-rf4', %L::uuid, %L::uuid)$q$,
           t.v('dW1'), t.pin('cashier', 'REFUND'), t.v('pW1')), 'REFUND_EXCEEDS');
SELECT t.check('M-VOID', 'W1 settled: balance 0, REFUNDED, refunds 5 + 15 = 20 in table and ledger, payment kept',
    (t.bill('dW1')).balance_due = 0 AND (t.bill('dW1')).payment_status = 'REFUNDED'
    AND (SELECT sum(amount) FROM public.refunds WHERE bill_id = t.v('dW1')::uuid AND status = 'PAID') = 20
    AND (SELECT sum(amount) FROM public.finance_ledger_entries WHERE bill_id = t.v('dW1')::uuid AND entry_type = 'REFUND') = 20
    AND (SELECT status FROM public.payments WHERE id = t.v('pW1')::uuid) = 'COMPLETED');

-- W2: bill 100 → paid 60 → write-off 40 → void: the customer gets 60 back and the bill leaves no write-off loss.
SELECT t.set('dW2', (t.ok('M-VOID', 'draft W2: 10 × T-SALE = 100', 'cashier', t.sale(ARRAY[['ps', '10']]))) ->> 'id');
SELECT t.ok('M-VOID', 'confirm W2 paid 60', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-w2-0', '[{"method":"TRANSFER","amount":60}]'::jsonb)$q$, t.v('dW2')));
SELECT t.err('M-VOID', 'write-off above the balance (41 > 40) is refused', 'cashier',
    format($q$select public.write_off_record(%L::uuid, 41, 'bad debt', %L::uuid)$q$, t.v('dW2'), t.pin('cashier', 'WRITE_OFF')),
    'WRITE_OFF_EXCEEDS_BALANCE');
SELECT t.set('wo2', (t.ok('M-VOID', 'write off the 40 still owed', 'cashier',
    format($q$select public.write_off_record(%L::uuid, 40, 'bad debt', %L::uuid)$q$, t.v('dW2'), t.pin('cashier', 'WRITE_OFF'))))
    ->> 'id');
SELECT t.check('M-VOID', 'after write-off: balance 0, write-off 40 in table and ledger (WRITE_OFF, −40), still open',
    (t.bill('dW2')).balance_due = 0 AND (t.bill('dW2')).write_off_total = 40 AND (t.bill('dW2')).status = 'ACTIVE'
    AND (SELECT sum(amount * direction) FROM public.finance_ledger_entries
          WHERE source_type = 'WRITE_OFF' AND source_id = t.v('wo2')::uuid) = -40);
SELECT t.ok('M-VOID', 'void W2', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'wrong customer', %L::uuid)$q$, t.v('dW2'), t.pin('cashier', 'BILL_VOID')));
SELECT t.check('M-VOID', 'void W2: customer is owed back the 60 received (balance −60, suggestion 60)',
    (t.bill('dW2')).status = 'VOID' AND (t.bill('dW2')).balance_due = -60
    AND (t.exec_as(t.u('cashier'), 'authenticated', format($q$select public.bill_refund_suggestion(%L::uuid)$q$, t.v('dW2')))
         ->> 'suggested_refund')::numeric = 60);
SELECT t.check('M-VOID', 'void W2: revenue reversed to 0',
    (SELECT COALESCE(sum(e.amount * e.direction), 0) FROM public.finance_ledger_entries e
      WHERE e.bill_id = t.v('dW2')::uuid AND (e.source_type = 'BILL_CONFIRM'
            OR e.reverses_entry_id IN (SELECT id FROM public.finance_ledger_entries WHERE source_type = 'BILL_CONFIRM'))) = 0);
SELECT t.check('M-VOID', 'void W2: no net write-off left (the −40 has a reversal entry pointing at it, net 0)',
    (SELECT COALESCE(sum(e.amount * e.direction), 0) FROM public.finance_ledger_entries e
      WHERE e.bill_id = t.v('dW2')::uuid AND (e.source_type = 'WRITE_OFF'
            OR e.reverses_entry_id IN (SELECT id FROM public.finance_ledger_entries WHERE source_type = 'WRITE_OFF'))) = 0
    AND EXISTS (SELECT 1 FROM public.finance_ledger_entries r JOIN public.finance_ledger_entries w ON w.id = r.reverses_entry_id
                 WHERE w.source_type = 'WRITE_OFF' AND w.source_id = t.v('wo2')::uuid AND r.entry_type = 'REVERSAL'
                   AND r.direction = 1 AND r.amount = 40));
SELECT t.check('M-VOID', 'write-off history kept: the write-off row and its original ledger entry still exist',
    EXISTS (SELECT 1 FROM public.write_offs WHERE id = t.v('wo2')::uuid AND amount = 40)
    AND EXISTS (SELECT 1 FROM public.finance_ledger_entries WHERE source_type = 'WRITE_OFF' AND source_id = t.v('wo2')::uuid
                  AND entry_type = 'WRITE_OFF' AND direction = -1 AND amount = 40));
SELECT t.err('M-VOID', 'no write-off on a void bill', 'cashier',
    format($q$select public.write_off_record(%L::uuid, 1, 'x', %L::uuid)$q$, t.v('dW2'), t.pin('cashier', 'WRITE_OFF')), 'BILL_NOT_OPEN');
SELECT t.ok('M-VOID', 'refund the 60 on void W2', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 60, NULL, 'void refund', 'key-w2-rf', %L::uuid, %L::uuid)$q$, t.v('dW2'),
           t.pin('cashier', 'REFUND'), (SELECT id::text FROM public.payments WHERE bill_id = t.v('dW2')::uuid)));
SELECT t.check('M-VOID', 'W2 settled: balance 0, REFUNDED, refund ledger 60',
    (t.bill('dW2')).balance_due = 0 AND (t.bill('dW2')).payment_status = 'REFUNDED'
    AND (SELECT sum(amount) FROM public.finance_ledger_entries WHERE bill_id = t.v('dW2')::uuid AND entry_type = 'REFUND') = 60);
SELECT t.check('M-VOID', 'audited: WRITE_OFF, BILL_VOID and REFUND_PAY for W2',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'WRITE_OFF' AND entity_id = t.v('dW2')::uuid)
    AND EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'BILL_VOID' AND entity_id = t.v('dW2')::uuid)
    AND EXISTS (SELECT 1 FROM public.audit_logs a JOIN public.refunds r ON r.id = a.entity_id
                 WHERE a.action = 'REFUND_PAY' AND r.bill_id = t.v('dW2')::uuid));

-- ===================================================================== DRAFTS FOR THE RACES (run_local.sh)
SELECT t.set('dK1', (t.ok('M-RACE-SETUP', 'race draft K1 (same key twice)', 'cashier', t.sale(ARRAY[['ps', '1']]))) ->> 'id');
SELECT t.set('dK2', (t.ok('M-RACE-SETUP', 'race draft K2 (two keys)', 'cashier', t.sale(ARRAY[['ps', '1']]))) ->> 'id');
SELECT t.set('dK3', (t.ok('M-RACE-SETUP', 'race bill K3 confirmed unpaid 10', 'cashier', t.sale(ARRAY[['ps', '1']]))) ->> 'id');
SELECT t.ok('M-RACE-SETUP', 'confirm K3 without money', 'cashier', format($q$select public.bill_confirm(%L::uuid, 'key-race-k3')$q$, t.v('dK3')));
SELECT t.set('dK5', (t.ok('M-RACE-SETUP', 'race bill K5 paid 10 (refund race)', 'cashier', t.sale(ARRAY[['ps', '1']]))) ->> 'id');
SELECT t.ok('M-RACE-SETUP', 'confirm K5 paid 10', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-race-k5', '[{"method":"CASH","amount":10}]'::jsonb)$q$, t.v('dK5')));
SELECT t.set('pK5', (SELECT id::text FROM public.payments WHERE bill_id = t.v('dK5')::uuid));
SELECT t.set('dL1', (t.ok('M-RACE-SETUP', 'last-unit draft L1', 'cashier', t.sale(ARRAY[['pl', '1']]))) ->> 'id');
SELECT t.set('dL2', (t.ok('M-RACE-SETUP', 'last-unit draft L2', 'cashier', t.sale(ARRAY[['pl', '1']]))) ->> 'id');
SELECT t.check('M-RACE-SETUP', 'T-LAST has exactly 1 available before the race', t.stock('pl', 'AVAILABLE') = 1);
