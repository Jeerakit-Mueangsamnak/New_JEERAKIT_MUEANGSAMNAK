-- Rule tests for supabase/migrations/20261124083745_bill_issue_one_step_v1.sql (owner 2026-11-24: no draft bills).
-- bill_issue saves + confirms in one transaction: a refusal leaves no DRAFT behind; the money is cut to the
-- server's total. Runs after 40_money_stock.sql (customer 'c1', unit 'unit', helpers t.stock / t.bill).
\set ON_ERROR_STOP 1

CREATE FUNCTION t.issue(p_prod text, p_qty numeric, p_key text, p_tenders text, p_exact boolean, p_short boolean)
RETURNS text LANGUAGE sql AS $f$
    SELECT format($q$select public.bill_issue(jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', %s, 'rental_calculation_type', 'PER_PERIOD',
        'period_count', 1, 'rental_start_at', %L, 'rental_end_at', %L))),
        %L, %s, %L::boolean, %L::boolean)$q$,
        t.v('c1'), t.v(p_prod), p_qty, date_trunc('day', now()) - interval '1 day', date_trunc('day', now()) + interval '3 days', p_key, COALESCE(quote_literal(p_tenders) || '::jsonb', 'NULL'), p_exact, p_short);
$f$;
CREATE FUNCTION t.drafts() RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT count(*) FROM public.bills WHERE status = 'DRAFT';
$$;

SELECT t.set('pi', (t.ok('ISSUE', 'rental product T-ISS 10.00, 10 in stock', 'owner',
    format($q$select public.product_create(jsonb_build_object('sku', 'T-ISS', 'name', 'test issue item', 'unit_id', %L,
        'can_rent', true, 'rental_price', 10), NULL, 10, false, %L::uuid)$q$, t.v('unit'), t.pin('owner', 'STOCK_RECEIVE')))) ->> 'id');
SELECT t.set('drafts0', t.drafts()::text);

-- exact: one method pays the server's total, whatever amount the screen sent
-- built once: a repeated click sends exactly the same request
SELECT t.set('q1', t.issue('pi', 4, 'key-iss-1', '[{"method":"QR","amount":1}]', true, false));
SELECT t.set('i1', (t.ok('ISSUE', 'exact QR: 4 × 10 → bill confirmed', 'cashier', t.v('q1'))) -> 'bill' ->> 'id');
SELECT t.check('ISSUE', '... CONFIRMED/ACTIVE with a number, paid 40, owes 0, 4 reserved',
    (t.bill('i1')).status IN ('CONFIRMED', 'ACTIVE') AND (t.bill('i1')).bill_no IS NOT NULL
    AND (t.bill('i1')).paid_amount = 40 AND (t.bill('i1')).balance_due = 0 AND t.stock('pi', 'RESERVED') = 4);
SELECT t.check('ISSUE', '... no draft left', t.drafts() = t.v('drafts0')::bigint);

-- same click again (same key): the same bill, not a second one
SELECT t.check('ISSUE', 'same key again returns the same bill',
    (t.ok('ISSUE', '... replay', 'cashier', t.v('q1')))
        -> 'bill' ->> 'id' = t.v('i1'));
SELECT t.check('ISSUE', '... still one bill, 4 reserved', t.stock('pi', 'RESERVED') = 4
    AND (SELECT count(*) FROM public.bills WHERE status <> 'DRAFT' AND id IN
          (SELECT bill_id FROM public.bill_lines WHERE product_id = t.v('pi')::uuid)) = 1);

-- money short (not ค้างชำระ): refused, nothing saved
SELECT t.err('ISSUE', 'cash 30 for a 40 bill is refused', 'cashier',
    t.issue('pi', 4, 'key-iss-2', '[{"method":"CASH","amount":30}]', false, false), 'มากกว่าเงินที่รับมา');
SELECT t.check('ISSUE', '... no draft, no new reservation', t.drafts() = t.v('drafts0')::bigint AND t.stock('pi', 'RESERVED') = 4);

-- stock short: refused, nothing saved
SELECT t.err('ISSUE', 'more than the stock is refused', 'cashier',
    t.issue('pi', 99, 'key-iss-3', '[{"method":"CASH","amount":990}]', false, false), 'INSUFFICIENT_STOCK');
SELECT t.check('ISSUE', '... no draft left', t.drafts() = t.v('drafts0')::bigint);

-- ค้างชำระ with part taken: the part is kept, the rest owed
SELECT t.set('i4', (t.ok('ISSUE', 'ค้างชำระ with cash 15 for 20', 'cashier',
    t.issue('pi', 2, 'key-iss-4', '[{"method":"CASH","amount":15}]', false, true))) -> 'bill' ->> 'id');
SELECT t.check('ISSUE', '... paid 15, owes 5', (t.bill('i4')).paid_amount = 15 AND (t.bill('i4')).balance_due = 5);

-- ค้างชำระ, nothing taken
SELECT t.set('i5', (t.ok('ISSUE', 'ค้างชำระ, no money', 'cashier', t.issue('pi', 1, 'key-iss-5', NULL, false, true))) -> 'bill' ->> 'id');
SELECT t.check('ISSUE', '... paid 0, owes 10', (t.bill('i5')).paid_amount = 0 AND (t.bill('i5')).balance_due = 10);

-- cash + QR in the order taken, cut to the total (the change is not money taken)
SELECT t.set('i6', (t.ok('ISSUE', 'cash 15 then QR 10 for a 20 bill', 'cashier',
    t.issue('pi', 2, 'key-iss-6', '[{"method":"CASH","amount":15},{"method":"QR","amount":10}]', false, false))) -> 'bill' ->> 'id');
SELECT t.check('ISSUE', '... paid exactly 20: cash 15 + QR 5', (t.bill('i6')).paid_amount = 20 AND (t.bill('i6')).balance_due = 0
    AND (SELECT COALESCE(sum(amount), 0) FROM public.payments WHERE bill_id = t.v('i6')::uuid AND status = 'COMPLETED') = 20);

SELECT t.check('ISSUE', 'end: no DRAFT bill was created by any call', t.drafts() = t.v('drafts0')::bigint);
SELECT t.check('ISSUE', 'bill_issue: authenticated may run it, anon may not',
    has_function_privilege('authenticated', 'public.bill_issue(jsonb, text, jsonb, boolean, boolean, date, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.bill_issue(jsonb, text, jsonb, boolean, boolean, date, uuid)', 'EXECUTE'));
