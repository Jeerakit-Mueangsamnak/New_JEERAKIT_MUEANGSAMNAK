-- Rule tests for supabase/migrations/20261111150000_bill_custom_lines_v1.sql (owner 2026-11-11):
-- รายการนอกร้าน — a line typed in at the counter (name, quantity, unit, price, rounds) with no shop
-- product: priced and counted as revenue like any line, takes no stock, never waits for a return,
-- and the bill closes on money alone. Runs after 40_money_stock.sql (customer 'c1', rental 'pr').
\set ON_ERROR_STOP 1

-- rental: 20 × 5.00 × 3 rounds = 300.00
SELECT t.set('cx', (t.ok('CUSTOM-LINE', 'draft with one typed-in rental line', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', null, 'product_name', '  ค้ำยันเหล็ก (ยืมร้านอื่น)  ', 'unit_name', 'ต้น',
        'line_mode', 'RENTAL', 'ordered_qty', 20, 'unit_price', 5, 'rental_calculation_type', 'PER_PERIOD',
        'period_count', 3, 'rental_start_at', now(), 'rental_end_at', now() + interval '3 days'))))$q$, t.v('c1'))))
    ->> 'id');
SELECT t.check('CUSTOM-LINE', '... the line keeps its own name and unit, no product, no SKU',
    (SELECT product_id IS NULL AND product_sku IS NULL AND product_name = 'ค้ำยันเหล็ก (ยืมร้านอื่น)' AND unit_name = 'ต้น'
       FROM public.bill_lines WHERE bill_id = t.v('cx')::uuid));
SELECT t.check('CUSTOM-LINE', '... priced 20 × 5 × 3 = 300.00, not a price override',
    (SELECT extended_amount = 300 AND NOT price_overridden FROM public.bill_lines WHERE bill_id = t.v('cx')::uuid)
    AND (SELECT grand_total = 300 FROM public.bills WHERE id = t.v('cx')::uuid));
SELECT t.err('CUSTOM-LINE', 'a typed-in line needs a name', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', null, 'product_name', '   ', 'line_mode', 'SALE', 'ordered_qty', 1, 'unit_price', 10))))$q$,
        t.v('c1')), 'CUSTOM_LINE_NAME_REQUIRED');
SELECT t.err('CUSTOM-LINE', 'a typed-in line needs a price', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', null, 'product_name', 'ของนอกร้าน', 'line_mode', 'SALE', 'ordered_qty', 1))))$q$,
        t.v('c1')), 'CUSTOM_LINE_PRICE_REQUIRED');

SELECT t.set('stock_before', (SELECT COALESCE(sum(quantity), 0)::text FROM public.stock_balances));
SELECT t.set('moves_before', (SELECT count(*)::text FROM public.stock_movements));
SELECT t.ok('CUSTOM-LINE', 'issue it unpaid', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-cx-confirm')$q$, t.v('cx')));
SELECT t.check('CUSTOM-LINE', '... no stock moved at all',
    (SELECT count(*)::text FROM public.stock_movements) = t.v('moves_before')
    AND (SELECT COALESCE(sum(quantity), 0)::text FROM public.stock_balances) = t.v('stock_before'));
SELECT t.check('CUSTOM-LINE', '... counts as handed over, nothing held, nothing to return',
    (SELECT delivered_qty = 20 AND obligation_held_here = 0 AND return_status = 'RETURNED'
            AND fulfillment_status = 'DELIVERED' AND rental_status = 'RESOLVED' AND allocated_qty = 0 AND backorder_qty = 0
       FROM public.bill_lines WHERE bill_id = t.v('cx')::uuid));
SELECT t.check('CUSTOM-LINE', '... rental revenue 300 is booked',
    (SELECT COALESCE(sum(amount * direction), 0) = 300 FROM public.finance_ledger_entries
      WHERE bill_id = t.v('cx')::uuid AND entry_type = 'REVENUE' AND revenue_class = 'RENTAL'));
SELECT t.check('CUSTOM-LINE', '... the bill is open, owes 300',
    (SELECT status = 'ACTIVE' AND balance_due = 300 FROM public.bills WHERE id = t.v('cx')::uuid));
SELECT t.err('CUSTOM-LINE', 'nothing can be delivered for it', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1)), 'key-cx-dlv')$q$,
        t.v('cx'), (SELECT id::text FROM public.bill_lines WHERE bill_id = t.v('cx')::uuid)), '');
SELECT t.ok('CUSTOM-LINE', 'paying 300 closes the bill (no return to wait for)', 'cashier',
    format($q$select public.payment_receive(%L::uuid, '[{"method":"CASH","amount":300}]'::jsonb, 'key-cx-pay')$q$, t.v('cx')));
SELECT t.check('CUSTOM-LINE', '... CLOSED, line CLOSED',
    (SELECT status = 'CLOSED' FROM public.bills WHERE id = t.v('cx')::uuid)
    AND (SELECT rental_status = 'CLOSED' FROM public.bill_lines WHERE bill_id = t.v('cx')::uuid));

-- mixed bill: a shop rental product + a typed-in sale line; voiding is still possible
SELECT t.set('cm', (t.ok('CUSTOM-LINE', 'draft: 1 × T-RENT + typed-in sale 2 × 15.00', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'rental_calculation_type', 'PER_PERIOD',
            'period_count', 1, 'rental_start_at', now(), 'rental_end_at', now() + interval '3 days'),
        jsonb_build_object('product_id', null, 'product_name', 'ตะปู (ซื้อมาให้)', 'unit_name', 'กล่อง',
            'line_mode', 'SALE', 'ordered_qty', 2, 'unit_price', 15))))$q$, t.v('c1'), t.v('pr'))))
    ->> 'id');
SELECT t.ok('CUSTOM-LINE', 'issue the mixed bill', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-cm-confirm')$q$, t.v('cm')));
SELECT t.check('CUSTOM-LINE', '... only the shop product is allocated stock',
    (SELECT allocated_qty = 1 FROM public.bill_lines WHERE bill_id = t.v('cm')::uuid AND product_id IS NOT NULL)
    AND (SELECT allocated_qty = 0 AND delivered_qty = 2 FROM public.bill_lines WHERE bill_id = t.v('cm')::uuid AND product_id IS NULL));
SELECT t.check('CUSTOM-LINE', '... total 10 + 30 = 40',
    (SELECT grand_total = 40 FROM public.bills WHERE id = t.v('cm')::uuid));
SELECT t.ok('CUSTOM-LINE', 'the typed-in sale line does not block voiding', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'wrong bill', %L::uuid)$q$, t.v('cm'), t.pin('cashier', 'BILL_VOID')));
SELECT t.check('CUSTOM-LINE', '... VOID, the shop product''s stock is released',
    (SELECT status = 'VOID' FROM public.bills WHERE id = t.v('cm')::uuid)
    AND (SELECT count(*) = 0 FROM public.stock_balances WHERE product_id = t.v('pr')::uuid AND stock_state = 'RESERVED' AND quantity > 0));

-- a shop product line still takes its name from the product
SELECT t.set('cp', (t.ok('CUSTOM-LINE', 'a shop product line ignores a typed name', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'product_name', 'ชื่ออื่น', 'line_mode', 'SALE', 'ordered_qty', 1))))$q$,
        t.v('c1'), t.v('ps')))) ->> 'id');
SELECT t.check('CUSTOM-LINE', '... name is the product''s',
    (SELECT l.product_name = p.name FROM public.bill_lines l JOIN public.products p ON p.id = l.product_id
      WHERE l.bill_id = t.v('cp')::uuid));
SELECT t.ok('CUSTOM-LINE', 'clean up that draft', 'cashier',
    format($q$select public.bill_draft_delete(%L::uuid)$q$, t.v('cp')));
