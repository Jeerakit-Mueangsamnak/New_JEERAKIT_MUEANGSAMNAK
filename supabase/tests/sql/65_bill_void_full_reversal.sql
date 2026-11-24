-- Rule tests for supabase/migrations/20261119154921_bill_void_full_reversal_v1.sql (owner 2026-11-19):
-- ยกเลิกบิล undoes everything at once — stock back, money out, cases / appointments closed — as if the bill
-- never happened. Runs after 40_money_stock.sql (customer 'c1', unit 'unit', helpers t.stock / t.bill).
\set ON_ERROR_STOP 1

CREATE FUNCTION t.rent_draft(p_prod text, p_qty numeric) RETURNS text LANGUAGE sql AS $f$
    SELECT format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', %s, 'rental_calculation_type', 'PER_PERIOD',
        'period_count', 1, 'rental_start_at', now() - interval '1 day', 'rental_end_at', now() + interval '3 days'))))$q$,
        t.v('c1'), t.v(p_prod), p_qty);
$f$;
CREATE FUNCTION t.line_of(p_bill text) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT id::text FROM public.bill_lines WHERE bill_id = t.v(p_bill)::uuid ORDER BY line_no LIMIT 1;
$$;
CREATE FUNCTION t.stock_ok(p_prod text) RETURNS boolean LANGUAGE sql STABLE AS $$
    -- stock_balances = Σ stock_movements for every state of the product
    SELECT NOT EXISTS (
        SELECT 1 FROM public.stock_balances b
         WHERE b.product_id = t.v(p_prod)::uuid
           AND b.quantity <> COALESCE((SELECT sum(m.quantity_delta) FROM public.stock_movements m
                                        WHERE m.product_id = b.product_id AND m.stock_state = b.stock_state), 0));
$$;

SELECT t.set('pv', (t.ok('VOID-ALL', 'rental product T-VOID 10.00, 10 in stock', 'owner',
    format($q$select public.product_create(jsonb_build_object('sku', 'T-VOID', 'name', 'test void item', 'unit_id', %L,
        'can_rent', true, 'rental_price', 10), NULL, 10, false, %L::uuid)$q$, t.v('unit'), t.pin('owner', 'STOCK_RECEIVE')))) ->> 'id');

-- ===================================================================== goods out + paid → void
SELECT t.set('va', (t.ok('VOID-ALL', 'rental A: 4 × T-VOID', 'cashier', t.rent_draft('pv', 4))) ->> 'id');
SELECT t.set('vaL', t.line_of('va'));
SELECT t.ok('VOID-ALL', '... issued and paid 40', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-va-0', '[{"method":"CASH","amount":40}]'::jsonb)$q$, t.v('va')));
SELECT t.ok('VOID-ALL', '... 4 delivered', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 4)), 'key-va-dl')$q$,
           t.v('va'), t.v('vaL')));
SELECT t.set('va_apt', (t.ok('VOID-ALL', '... with a return job on the calendar', 'owner',
    format($q$select public.appointment_save(NULL, jsonb_build_object('appointment_type', 'RETURN', 'title', 'รับคืน A',
        'bill_id', %L, 'start_datetime', now() + interval '3 days', 'end_datetime', now() + interval '3 days 1 hour'))$q$, t.v('va'))))
    -> 'appointment' ->> 'id');
SELECT t.check('VOID-ALL', 'before: AVAILABLE 6, RENTED_OUT 4, the customer holds 4',
    t.stock('pv', 'AVAILABLE') = 6 AND t.stock('pv', 'RENTED_OUT') = 4
    AND (SELECT obligation_held_here = 4 FROM public.bill_lines WHERE id = t.v('vaL')::uuid));
SELECT t.ok('VOID-ALL', 'void A while the goods are still out (no return first)', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'ออกบิลผิด', %L::uuid)$q$, t.v('va'), t.pin('cashier', 'BILL_VOID')));
SELECT t.check('VOID-ALL', 'after: all 10 AVAILABLE, nothing RENTED_OUT, stock table = movements',
    t.stock('pv', 'AVAILABLE') = 10 AND t.stock('pv', 'RENTED_OUT') = 0 AND t.stock('pv', 'RESERVED') = 0 AND t.stock_ok('pv'));
SELECT t.check('VOID-ALL', '... the line holds nothing, the bill is VOID, owes nothing, money voided',
    (SELECT obligation_held_here = 0 AND return_status = 'RETURNED' AND rental_status = 'RESOLVED'
       FROM public.bill_lines WHERE id = t.v('vaL')::uuid)
    AND (t.bill('va')).status = 'VOID' AND (t.bill('va')).balance_due = 0 AND (t.bill('va')).paid_amount = 0
    AND (SELECT bool_and(status = 'VOIDED') FROM public.payments WHERE bill_id = t.v('va')::uuid)
    AND (SELECT COALESCE(sum(amount * direction), 0) FROM public.finance_ledger_entries WHERE bill_id = t.v('va')::uuid) = 0);
SELECT t.check('VOID-ALL', '... nothing deleted: the delivery stays, undone by REVERSAL movements',
    EXISTS (SELECT 1 FROM public.deliveries WHERE bill_id = t.v('va')::uuid)
    AND (SELECT count(*) FROM public.stock_movements WHERE source_type = 'BILL_LINE' AND source_id = t.v('vaL')::uuid
          AND movement_type = 'REVERSAL') = 2);
SELECT t.check('VOID-ALL', '... the return job is cancelled with the reason',
    (SELECT status = 'CANCELLED' AND cancel_reason = 'ออกบิลผิด' FROM public.appointments WHERE id = t.v('va_apt')::uuid));
SELECT t.check('VOID-ALL', '... one BILL_VOID audit with the summary',
    (SELECT count(*) = 1 AND bool_and((after_data ->> 'payments_voided')::numeric = 40
                                      AND (after_data ->> 'stock_reversed')::int = 1
                                      AND after_data -> 'stock_not_found' = '[]'::jsonb)
       FROM public.audit_logs WHERE action = 'BILL_VOID' AND entity_id = t.v('va')::uuid));
SELECT t.err('VOID-ALL', 'void A again is refused', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'again', %L::uuid)$q$, t.v('va'), t.pin('cashier', 'BILL_VOID')), 'BILL_NOT_VOIDABLE');

-- ===================================================================== part returned damaged + fee → void
SELECT t.set('vb', (t.ok('VOID-ALL', 'rental B: 3 × T-VOID', 'cashier', t.rent_draft('pv', 3))) ->> 'id');
SELECT t.set('vbL', t.line_of('vb'));
SELECT t.ok('VOID-ALL', '... issued', 'cashier', format($q$select public.bill_confirm(%L::uuid, 'key-vb-0')$q$, t.v('vb')));
SELECT t.ok('VOID-ALL', '... 3 delivered', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 3)), 'key-vb-dl')$q$,
           t.v('vb'), t.v('vbL')));
SELECT t.ok('VOID-ALL', '... 1 returned damaged (to inspection)', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1,
        'condition', 'MINOR_DAMAGE')), 'key-vb-rt')$q$, t.v('vb'), t.v('vbL')));
SELECT t.ok('VOID-ALL', '... a damage fee of 15', 'cashier',
    format($q$select public.charge_add(%L::uuid, 'DAMAGE', 15, 'ขาแตก', 'key-vb-ch', %L::uuid)$q$, t.v('vb'), t.v('vbL')));
SELECT t.check('VOID-ALL', 'before: AVAILABLE 7, RENTED_OUT 2, INSPECTION 1, an open damage case',
    t.stock('pv', 'AVAILABLE') = 7 AND t.stock('pv', 'RENTED_OUT') = 2 AND t.stock('pv', 'INSPECTION') = 1
    AND EXISTS (SELECT 1 FROM public.incident_cases WHERE bill_id = t.v('vb')::uuid AND status = 'OPEN'));
SELECT t.ok('VOID-ALL', 'void B', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'ลูกค้ายกเลิก', %L::uuid)$q$, t.v('vb'), t.pin('cashier', 'BILL_VOID')));
SELECT t.check('VOID-ALL', 'after: all 10 AVAILABLE, nothing out or in inspection, stock table = movements',
    t.stock('pv', 'AVAILABLE') = 10 AND t.stock('pv', 'RENTED_OUT') = 0 AND t.stock('pv', 'INSPECTION') = 0 AND t.stock_ok('pv'));
SELECT t.check('VOID-ALL', '... fee REVERSED, case closed (REJECTED), bill owes nothing, ledger net 0',
    (SELECT bool_and(status = 'REVERSED') FROM public.charges WHERE bill_id = t.v('vb')::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.incident_cases WHERE bill_id = t.v('vb')::uuid AND status = 'OPEN')
    AND (t.bill('vb')).balance_due = 0 AND (t.bill('vb')).charge_total = 0
    AND (SELECT COALESCE(sum(amount * direction), 0) FROM public.finance_ledger_entries WHERE bill_id = t.v('vb')::uuid) = 0);

-- ===================================================================== เช่าต่อ: parent P → child C
SELECT t.set('vp', (t.ok('VOID-ALL', 'rental P: 2 × T-VOID', 'cashier', t.rent_draft('pv', 2))) ->> 'id');
SELECT t.set('vpL', t.line_of('vp'));
SELECT t.ok('VOID-ALL', '... issued and paid 20', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-vp-0', '[{"method":"CASH","amount":20}]'::jsonb)$q$, t.v('vp')));
SELECT t.ok('VOID-ALL', '... 2 delivered', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 2)), 'key-vp-dl')$q$,
           t.v('vp'), t.v('vpL')));
SELECT t.set('vc', (t.ok('VOID-ALL', '... 1 of the 2 continued into child C', 'cashier',
    format($q$select public.create_rental_continuation(%L::uuid, jsonb_build_array(jsonb_build_object('from_line_id', %L,
        'quantity', 1, 'rental_calculation_type', 'PER_PERIOD', 'period_count', 1,
        'rental_start_at', (select rental_end_at from public.bill_lines where id = %L::uuid),
        'rental_end_at', (select rental_end_at from public.bill_lines where id = %L::uuid) + interval '2 days')),
        'เช่าต่อ 2 วัน', 'key-vc-0')$q$, t.v('vp'), t.v('vpL'), t.v('vpL'), t.v('vpL')))) -> 'child_bill' ->> 'id');
SELECT t.set('vcL', t.line_of('vc'));
SELECT t.check('VOID-ALL', 'before: P holds 1, C holds 1, RENTED_OUT 2',
    (SELECT obligation_held_here = 1 FROM public.bill_lines WHERE id = t.v('vpL')::uuid)
    AND (SELECT obligation_held_here = 1 FROM public.bill_lines WHERE id = t.v('vcL')::uuid)
    AND t.stock('pv', 'RENTED_OUT') = 2);
SELECT t.err('VOID-ALL', 'void P is refused while C continues it', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'x', %L::uuid)$q$, t.v('vp'), t.pin('cashier', 'BILL_VOID')), 'BILL_HAS_CONTINUATION');
SELECT t.check('VOID-ALL', '... the refusal changed nothing (P still open, still paid 20)',
    (t.bill('vp')).status = 'ACTIVE' AND (t.bill('vp')).paid_amount = 20 AND t.stock('pv', 'RENTED_OUT') = 2);
SELECT t.ok('VOID-ALL', 'void child C', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'เช่าต่อผิด', %L::uuid)$q$, t.v('vc'), t.pin('cashier', 'BILL_VOID')));
SELECT t.check('VOID-ALL', 'after C: P holds the 2 again; stock unchanged (still out with P)',
    (SELECT obligation_held_here = 2 FROM public.bill_lines WHERE id = t.v('vpL')::uuid)
    AND (SELECT obligation_held_here = 0 FROM public.bill_lines WHERE id = t.v('vcL')::uuid)
    AND (t.bill('vp')).status = 'ACTIVE' AND (t.bill('vc')).status = 'VOID'
    AND t.stock('pv', 'RENTED_OUT') = 2 AND t.stock('pv', 'AVAILABLE') = 8 AND t.stock_ok('pv'));
SELECT t.check('VOID-ALL', '... the carry-forward is reversed, not deleted',
    (SELECT count(*) = 1 FROM public.rental_carry_forwards cf JOIN public.rental_carry_forward_reversals r ON r.carry_forward_id = cf.id
      WHERE cf.to_bill_id = t.v('vc')::uuid));
SELECT t.ok('VOID-ALL', 'now void P too', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'ออกบิลผิดทั้งชุด', %L::uuid)$q$, t.v('vp'), t.pin('cashier', 'BILL_VOID')));
SELECT t.check('VOID-ALL', 'after P: all 10 AVAILABLE, the 20 voided, stock table = movements',
    t.stock('pv', 'AVAILABLE') = 10 AND t.stock('pv', 'RENTED_OUT') = 0 AND t.stock_ok('pv')
    AND (t.bill('vp')).status = 'VOID' AND (t.bill('vp')).paid_amount = 0 AND (t.bill('vp')).balance_due = 0);

-- A fully continued parent closes; voiding the child opens it again with the goods.
SELECT t.set('vq', (t.ok('VOID-ALL', 'rental Q: 1 × T-VOID, no charge', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'unit_price', 0,
        'rental_calculation_type', 'PER_PERIOD', 'period_count', 1,
        'rental_start_at', now() - interval '1 day', 'rental_end_at', now() + interval '3 days'))))$q$, t.v('c1'), t.v('pv'))))
    ->> 'id');
SELECT t.set('vqL', t.line_of('vq'));
SELECT t.ok('VOID-ALL', '... issued', 'cashier', format($q$select public.bill_confirm(%L::uuid, 'key-vq-0')$q$, t.v('vq')));
SELECT t.ok('VOID-ALL', '... delivered', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1)), 'key-vq-dl')$q$,
           t.v('vq'), t.v('vqL')));
SELECT t.set('vr', (t.ok('VOID-ALL', '... fully continued into child R', 'cashier',
    format($q$select public.create_rental_continuation(%L::uuid, jsonb_build_array(jsonb_build_object('from_line_id', %L,
        'quantity', 1, 'unit_price', 0, 'rental_calculation_type', 'PER_PERIOD', 'period_count', 1,
        'rental_start_at', (select rental_end_at from public.bill_lines where id = %L::uuid),
        'rental_end_at', (select rental_end_at from public.bill_lines where id = %L::uuid) + interval '2 days')),
        'เช่าต่อ', 'key-vr-0')$q$, t.v('vq'), t.v('vqL'), t.v('vqL'), t.v('vqL')))) -> 'child_bill' ->> 'id');
SELECT t.set('vq_before', (t.bill('vq')).status);
SELECT t.ok('VOID-ALL', 'void child R', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'เช่าต่อผิด', %L::uuid)$q$, t.v('vr'), t.pin('cashier', 'BILL_VOID')));
SELECT t.check('VOID-ALL', 'after R: Q (closed before: ' || t.v('vq_before') || ') is open and holds the piece again',
    (t.bill('vq')).status = 'ACTIVE'
    AND (SELECT obligation_held_here = 1 AND rental_status IN ('ACTIVE', 'OVERDUE') FROM public.bill_lines WHERE id = t.v('vqL')::uuid)
    AND t.stock('pv', 'RENTED_OUT') = 1 AND t.stock_ok('pv'));
SELECT t.ok('VOID-ALL', 'void Q', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'ทดสอบ', %L::uuid)$q$, t.v('vq'), t.pin('cashier', 'BILL_VOID')));

-- ===================================================================== rights unchanged
SELECT t.set('vd', (t.ok('VOID-ALL', 'owner''s rental D: 1 × T-VOID, issued', 'owner', t.rent_draft('pv', 1))) ->> 'id');
SELECT t.ok('VOID-ALL', '... issued', 'owner', format($q$select public.bill_confirm(%L::uuid, 'key-vd-0')$q$, t.v('vd')));
SELECT t.err('VOID-ALL', 'a member cannot void another member''s bill', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'x', %L::uuid)$q$, t.v('vd'), t.pin('cashier', 'BILL_VOID')), 'BILL_VOID_OWNER_ONLY');
SELECT t.err('VOID-ALL', 'a reason is required', 'owner',
    format($q$select public.bill_void(%L::uuid, '  ', %L::uuid)$q$, t.v('vd'), t.pin('owner', 'BILL_VOID')), 'REASON_REQUIRED');
SELECT t.ok('VOID-ALL', 'the owner voids D', 'owner',
    format($q$select public.bill_void(%L::uuid, 'ทดสอบ', %L::uuid)$q$, t.v('vd'), t.pin('owner', 'BILL_VOID')));
SELECT t.check('VOID-ALL', 'all 10 T-VOID back on the shelf at the end',
    t.stock('pv', 'AVAILABLE') = 10 AND t.stock('pv', 'RESERVED') = 0 AND t.stock_ok('pv'));
