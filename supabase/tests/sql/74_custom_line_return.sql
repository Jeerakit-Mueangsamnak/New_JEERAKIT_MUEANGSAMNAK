-- Rule tests for supabase/migrations/20261125074619_custom_rental_lines_return_v1.sql (owner 2026-11-25:
-- "ให้เป็นการเช็คของคืนด้วย ตรวจคืนแล้วจบ ไม่ต้องคืนสต็อก"). A typed-in rental line (รายการนอกร้าน) is with the
-- customer until it is checked back, lost or continued; none of it moves stock.
-- Runs after 65_bill_void_full_reversal.sql (customer 'c1', helper t.line_of).
\set ON_ERROR_STOP 1

CREATE FUNCTION t.custom_rent_draft(p_name text, p_qty numeric) RETURNS text LANGUAGE sql AS $f$
    SELECT format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', null, 'product_name', %L, 'unit_name', 'เมตร', 'line_mode', 'RENTAL',
        'ordered_qty', %s, 'unit_price', 20, 'rental_calculation_type', 'PER_PERIOD', 'period_count', 1,
        'rental_start_at', now(), 'rental_end_at', now() + interval '3 days'))))$q$, t.v('c1'), p_name, p_qty);
$f$;
CREATE FUNCTION t.held(p_line text) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT obligation_held_here FROM public.bill_lines WHERE id = t.v(p_line)::uuid;
$$;

SELECT t.set('cr_moves', (SELECT count(*)::text FROM public.stock_movements));

-- ===================================================================== partly back, then lost
SELECT t.set('cr', (t.ok('CUSTOM-RETURN', 'bill: 10 m of a typed-in beam form (rental)', 'cashier',
    t.custom_rent_draft('แบบคาน40 ด้านหน้า', 10))) ->> 'id');
SELECT t.set('crL', t.line_of('cr'));
SELECT t.ok('CUSTOM-RETURN', '... issued unpaid', 'cashier', format($q$select public.bill_confirm(%L::uuid, 'key-cr-0')$q$, t.v('cr')));
SELECT t.check('CUSTOM-RETURN', '... 10 with the customer, not returned',
    t.held('crL') = 10 AND (SELECT return_status = 'NOT_RETURNED' FROM public.bill_lines WHERE id = t.v('crL')::uuid));
SELECT t.ok('CUSTOM-RETURN', 'check 4 back', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 4,
        'condition', 'NORMAL')), 'key-cr-r1')$q$, t.v('cr'), t.v('crL')));
SELECT t.check('CUSTOM-RETURN', '... 6 still out, partly returned, a return document with 4',
    t.held('crL') = 6
    AND (SELECT return_status = 'PARTIALLY_RETURNED' AND physical_returned_qty = 4 FROM public.bill_lines WHERE id = t.v('crL')::uuid)
    AND (SELECT sum(rl.quantity) = 4 FROM public.return_lines rl WHERE rl.bill_line_id = t.v('crL')::uuid));
SELECT t.err('CUSTOM-RETURN', 'more than is out is refused', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 7,
        'condition', 'NORMAL')), 'key-cr-r2')$q$, t.v('cr'), t.v('crL')), 'RETURN_EXCEEDS_HELD');
SELECT t.ok('CUSTOM-RETURN', '1 back damaged opens a damage case', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1,
        'condition', 'MAJOR_DAMAGE', 'to_stock_state', 'DAMAGED')), 'key-cr-r3')$q$, t.v('cr'), t.v('crL')));
SELECT t.check('CUSTOM-RETURN', '... 5 out, one open DAMAGE case',
    t.held('crL') = 5
    AND (SELECT count(*) = 1 FROM public.incident_cases WHERE bill_line_id = t.v('crL')::uuid AND incident_type = 'DAMAGE'));
SELECT t.ok('CUSTOM-RETURN', '1 recorded lost (fee 0)', 'cashier',
    format($q$select public.lost_add(%L::uuid, %L::uuid, 1, 0, 'ลูกค้าทำหาย', 'key-cr-lost')$q$, t.v('cr'), t.v('crL')));
SELECT t.check('CUSTOM-RETURN', '... 4 out, 1 lost',
    t.held('crL') = 4 AND (SELECT approved_lost_qty = 1 FROM public.bill_lines WHERE id = t.v('crL')::uuid));

-- ===================================================================== แก้ไขบิล: fewer than out
SELECT t.ok('CUSTOM-RETURN', 'แก้ไขบิล: the line to 8 m (re-written)', 'cashier',
    format($q$select public.bill_revise(%L::uuid, jsonb_build_object('bill_discount_amount', 0, 'fees_total', 0,
        'lines', jsonb_build_array(jsonb_build_object('line_id', %L, 'ordered_qty', 8))), 'key-cr-rev')$q$, t.v('cr'), t.v('crL')));
SELECT t.set('crL2', (SELECT id::text FROM public.bill_lines WHERE bill_id = t.v('cr')::uuid AND removed_at IS NULL AND line_mode = 'RENTAL'));
SELECT t.check('CUSTOM-RETURN', '... old line removed and holds nothing; the new 8 m line holds only the 4 still out',
    (SELECT removed_at IS NOT NULL AND obligation_held_here = 0 FROM public.bill_lines WHERE id = t.v('crL')::uuid)
    AND (SELECT product_id IS NULL AND product_name = 'แบบคาน40 ด้านหน้า' AND ordered_qty = 8 FROM public.bill_lines WHERE id = t.v('crL2')::uuid)
    AND t.held('crL2') = 4);

-- ===================================================================== เช่าต่อ
SELECT t.set('crc', (t.ok('CUSTOM-RETURN', '3 of the 4 continued into a new bill', 'cashier',
    format($q$select public.create_rental_continuation(%L::uuid, jsonb_build_array(jsonb_build_object('from_line_id', %L,
        'quantity', 3, 'rental_calculation_type', 'PER_PERIOD', 'period_count', 1,
        'rental_start_at', (select rental_end_at from public.bill_lines where id = %L::uuid),
        'rental_end_at', (select rental_end_at from public.bill_lines where id = %L::uuid) + interval '2 days')),
        'เช่าต่อ 2 วัน', 'key-crc-0')$q$, t.v('cr'), t.v('crL2'), t.v('crL2'), t.v('crL2')))) -> 'child_bill' ->> 'id');
SELECT t.set('crcL', t.line_of('crc'));
SELECT t.check('CUSTOM-RETURN', '... new bill line: same name and unit, price 20, holds 3 (carried in, not handed over again)',
    (SELECT product_id IS NULL AND product_name = 'แบบคาน40 ด้านหน้า' AND unit_name = 'เมตร' AND unit_price = 20
            AND carried_in_qty = 3 AND delivered_qty = 0 FROM public.bill_lines WHERE id = t.v('crcL')::uuid)
    AND t.held('crcL') = 3 AND t.held('crL2') = 1
    AND (SELECT product_id IS NULL FROM public.rental_carry_forwards WHERE to_line_id = t.v('crcL')::uuid));
SELECT t.ok('CUSTOM-RETURN', 'void the new bill', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'เช่าต่อผิด', %L::uuid)$q$, t.v('crc'), t.pin('cashier', 'BILL_VOID')));
SELECT t.check('CUSTOM-RETURN', '... the first bill holds the 4 again',
    t.held('crL2') = 4 AND t.held('crcL') = 0);
SELECT t.ok('CUSTOM-RETURN', 'check the 4 back', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 4,
        'condition', 'NORMAL')), 'key-cr-r4')$q$, t.v('cr'), t.v('crL2')));
SELECT t.check('CUSTOM-RETURN', '... nothing out, line returned',
    t.held('crL2') = 0 AND (SELECT return_status = 'RETURNED' FROM public.bill_lines WHERE id = t.v('crL2')::uuid));

-- ===================================================================== แก้ไขบิล: take the line off
SELECT t.set('crx', (t.ok('CUSTOM-RETURN', 'bill: 5 m typed-in, then a shop-less line removed by แก้ไขบิล', 'cashier',
    t.custom_rent_draft('แบบเสา', 5))) ->> 'id');
SELECT t.set('crxL', t.line_of('crx'));
SELECT t.ok('CUSTOM-RETURN', '... issued', 'cashier', format($q$select public.bill_confirm(%L::uuid, 'key-crx-0')$q$, t.v('crx')));
SELECT t.ok('CUSTOM-RETURN', '... แก้ไขบิล with the line left out and a new typed-in sale line', 'cashier',
    format($q$select public.bill_revise(%L::uuid, jsonb_build_object('bill_discount_amount', 0, 'fees_total', 0,
        'lines', jsonb_build_array(jsonb_build_object('product_id', null, 'product_name', 'ค่าขนส่งเพิ่ม', 'line_mode', 'SALE',
        'ordered_qty', 1, 'unit_price', 50))), 'key-crx-rev')$q$, t.v('crx')));
SELECT t.check('CUSTOM-RETURN', '... the removed line is counted back (5) and holds nothing',
    (SELECT removed_at IS NOT NULL AND obligation_held_here = 0 AND physical_returned_qty = 5 FROM public.bill_lines WHERE id = t.v('crxL')::uuid));

SELECT t.check('CUSTOM-RETURN', 'none of this moved any stock',
    (SELECT count(*)::text FROM public.stock_movements) = t.v('cr_moves'));
