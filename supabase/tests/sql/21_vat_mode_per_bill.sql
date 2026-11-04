-- Rule tests for the VAT mode chosen per bill (owner 2026-11-04), on top of
-- supabase/migrations/20261104100000_bill_vat_mode_v1.sql:
-- the POS payment page has "รวม VAT" (INCLUSIVE) / "ไม่รวม VAT" (EXCLUSIVE); the shop only sets the RATE.
-- Runs after 20_settings_v1.sql (uses its helpers and customer c1; it leaves the shop VAT rate empty).
\set ON_ERROR_STOP 1

-- The shop sets the rate (the settings page still stores a price mode beside it: the fallback).
SELECT t.ok('V1-MODE', 'OWNER sets VAT 7% with price mode EXCLUSIVE (test values only)', 'owner',
    $q$select public.settings_update('{"vat_rate":7,"vat_mode":"EXCLUSIVE"}'::jsonb, 'test')$q$);

-- รวม VAT: the bill says INCLUSIVE although the shop setting says EXCLUSIVE → the bill wins.
SELECT t.set('inc_bill', (t.ok('V1-MODE', 'bill with รวม VAT', 'cashier',
    t.draft($x$'vat_enabled', true, 'vat_mode', 'INCLUSIVE',$x$, '', NULL))) ->> 'id');
SELECT t.check('V1-MODE', 'รวม VAT: VAT is inside the price, grand total stays the net amount',
    (SELECT vat_enabled AND vat_mode = 'INCLUSIVE' AND vat_amount > 0
            AND vat_amount = round((taxable_amount + vat_amount) * 7 / 107, 2)
            AND grand_total = taxable_amount + vat_amount
            AND pricing_snapshot ->> 'vat_mode' = 'INCLUSIVE'
       FROM public.bills WHERE id = t.v('inc_bill')::uuid));

-- ไม่รวม VAT: VAT is added on top.
SELECT t.set('exc_bill', (t.ok('V2-MODE', 'bill with ไม่รวม VAT', 'cashier',
    t.draft($x$'vat_enabled', true, 'vat_mode', 'EXCLUSIVE',$x$, '', NULL))) ->> 'id');
SELECT t.check('V2-MODE', 'ไม่รวม VAT: VAT = 7% of the amount, added to the grand total',
    (SELECT vat_enabled AND vat_mode = 'EXCLUSIVE' AND vat_amount > 0
            AND vat_amount = round(taxable_amount * 0.07, 2)
            AND grand_total = taxable_amount + vat_amount
            AND pricing_snapshot ->> 'vat_mode' = 'EXCLUSIVE'
       FROM public.bills WHERE id = t.v('exc_bill')::uuid));
SELECT t.check('V2-MODE', 'the same lines cost more with ไม่รวม VAT than with รวม VAT',
    (SELECT e.grand_total > i.grand_total AND e.taxable_amount = i.taxable_amount + i.vat_amount
       FROM public.bills e, public.bills i
      WHERE e.id = t.v('exc_bill')::uuid AND i.id = t.v('inc_bill')::uuid));

-- No button chosen = no VAT, and a stray mode is not kept.
SELECT t.set('off_bill', (t.ok('V3-MODE', 'bill with no VAT button chosen', 'cashier',
    t.draft($x$'vat_enabled', false, 'vat_mode', 'INCLUSIVE',$x$, '', NULL))) ->> 'id');
SELECT t.check('V3-MODE', 'no VAT: no VAT amount, no stored mode',
    (SELECT NOT vat_enabled AND vat_mode IS NULL AND vat_amount = 0 AND grand_total = taxable_amount
            AND pricing_snapshot ->> 'vat_mode' IS NULL
       FROM public.bills WHERE id = t.v('off_bill')::uuid));

-- Old callers that send only vat_enabled keep the shop's price mode (nothing existing is priced differently).
SELECT t.set('legacy_bill', (t.ok('V4-MODE', 'bill with VAT on and no mode sent', 'cashier',
    t.draft($x$'vat_enabled', true,$x$, '', NULL))) ->> 'id');
SELECT t.check('V4-MODE', 'falls back to the shop price mode (EXCLUSIVE)',
    (SELECT vat_mode IS NULL AND vat_amount = round(taxable_amount * 0.07, 2) AND pricing_snapshot ->> 'vat_mode' = 'EXCLUSIVE'
       FROM public.bills WHERE id = t.v('legacy_bill')::uuid));

-- Saving the same draft again with the other button replaces the mode.
SELECT t.ok('V5-MODE', 'the draft is saved again with the other button', 'cashier',
    format($q$select public.bill_save_draft(%L::uuid, jsonb_build_object('customer_id', %L, 'vat_enabled', true, 'vat_mode', 'INCLUSIVE', 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'rental_calculation_type', 'PER_PERIOD',
        'period_count', 1, 'rental_start_at', now(), 'rental_end_at', now() + interval '1 day'))), NULL)$q$,
        t.v('exc_bill'), t.v('c1'), t.v('bk1')));
SELECT t.check('V5-MODE', 'the saved bill now uses รวม VAT',
    (SELECT vat_mode = 'INCLUSIVE' AND grand_total = taxable_amount + vat_amount
            AND vat_amount = round(grand_total * 7 / 107, 2)
       FROM public.bills WHERE id = t.v('exc_bill')::uuid));

-- Wrong values / missing rate
SELECT t.err('V6-MODE', 'only รวม / ไม่รวม are accepted', 'cashier',
    t.draft($x$'vat_enabled', true, 'vat_mode', 'HALF',$x$, '', NULL), 'INVALID_VAT_MODE');
SELECT t.ok('V6-MODE', 'OWNER clears the shop VAT settings', 'owner',
    $q$select public.settings_update('{"vat_rate":null,"vat_mode":null}'::jsonb, 'test done')$q$);
SELECT t.err('V6-MODE', 'no VAT rate in Settings: the buttons cannot price a bill', 'cashier',
    t.draft($x$'vat_enabled', true, 'vat_mode', 'INCLUSIVE',$x$, '', NULL), 'VAT_SETUP_REQUIRED');

-- Confirmed bills keep their mode.
SELECT t.ok('V7-MODE', 'OWNER sets VAT 7% again', 'owner',
    $q$select public.settings_update('{"vat_rate":7,"vat_mode":"EXCLUSIVE"}'::jsonb, 'test')$q$);
SELECT t.ok('V7-MODE', 'confirm the รวม VAT bill', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-vat-mode-confirm')$q$, t.v('inc_bill')));
SELECT t.err_admin('V7-MODE', 'the VAT mode of a confirmed bill cannot be changed',
    format($q$update public.bills set vat_mode = 'EXCLUSIVE' where id = %L::uuid$q$, t.v('inc_bill')), 'BILL_TERMS_IMMUTABLE');
SELECT t.ok('V7-MODE', 'reset the test VAT settings', 'owner',
    $q$select public.settings_update('{"vat_rate":null,"vat_mode":null}'::jsonb, 'test done')$q$);

-- ===================================================================== ใช้ของใหม่ (owner 2026-11-04)
-- Settings hold only the rate (no price mode); quotations pick รวม / ไม่รวม VAT like bills.
SELECT t.ok('V8-NEW', 'OWNER sets only the VAT rate 7% (no price mode)', 'owner',
    $q$select public.settings_update('{"vat_rate":7}'::jsonb, 'test')$q$);
SELECT t.check('V8-NEW', 'the shop has a rate and no price mode',
    (SELECT vat_rate = 7 AND vat_mode IS NULL FROM public.store_settings));
SELECT t.set('nb_exc', (t.ok('V8-NEW', 'bill with ไม่รวม VAT works with the rate alone', 'cashier',
    t.draft($x$'vat_enabled', true, 'vat_mode', 'EXCLUSIVE',$x$, '', NULL))) ->> 'id');
SELECT t.check('V8-NEW', 'ไม่รวม VAT bill: 7% added',
    (SELECT vat_mode = 'EXCLUSIVE' AND vat_amount = round(taxable_amount * 0.07, 2) AND vat_amount > 0
       FROM public.bills WHERE id = t.v('nb_exc')::uuid));
SELECT t.err('V8-NEW', 'a bill with VAT on but no button chosen (and no old shop mode) is refused', 'cashier',
    t.draft($x$'vat_enabled', true,$x$, '', NULL), 'VAT_SETUP_REQUIRED');

CREATE FUNCTION t.quote(p_extra text) RETURNS text LANGUAGE sql AS $f$
    SELECT format($q$select public.quotation_save_draft(NULL, jsonb_build_object('customer_id', %L, %s 'items', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'quantity', 2, 'rental_calculation_type', 'PER_PERIOD',
        'period_count', 1, 'rental_start_at', now(), 'rental_end_at', now() + interval '3 days'))))$q$,
        t.v('c1'), p_extra, t.v('bk1'));
$f$;
SELECT t.set('q_inc', (t.ok('V9-QUOTE', 'quotation with รวม VAT', 'owner',
    t.quote($x$'vat_enabled', true, 'vat_mode', 'INCLUSIVE',$x$))) ->> 'id');
SELECT t.check('V9-QUOTE', 'รวม VAT quotation: total unchanged, VAT taken out of it, mode kept',
    (SELECT vat_amount = round(grand_total * 7 / 107, 2) AND vat_amount > 0 AND grand_total = subtotal + delivery_fee
            AND pricing_snapshot ->> 'vat_mode' = 'INCLUSIVE' AND (pricing_snapshot ->> 'vat_rate')::numeric = 7
       FROM public.quotations WHERE id = t.v('q_inc')::uuid));
SELECT t.set('q_exc', (t.ok('V9-QUOTE', 'quotation with ไม่รวม VAT', 'owner',
    t.quote($x$'vat_enabled', true, 'vat_mode', 'EXCLUSIVE',$x$))) ->> 'id');
SELECT t.check('V9-QUOTE', 'ไม่รวม VAT quotation: 7% added on top',
    (SELECT vat_amount = round((subtotal + delivery_fee) * 0.07, 2) AND grand_total = subtotal + delivery_fee + vat_amount
            AND pricing_snapshot ->> 'vat_mode' = 'EXCLUSIVE'
       FROM public.quotations WHERE id = t.v('q_exc')::uuid));
SELECT t.set('q_off', (t.ok('V9-QUOTE', 'quotation with no VAT button', 'owner',
    t.quote($x$'vat_enabled', false, 'vat_mode', 'INCLUSIVE',$x$))) ->> 'id');
SELECT t.check('V9-QUOTE', 'no VAT: nothing added, no mode kept',
    (SELECT vat_amount = 0 AND grand_total = subtotal + delivery_fee AND pricing_snapshot ->> 'vat_mode' IS NULL
       FROM public.quotations WHERE id = t.v('q_off')::uuid));
SELECT t.err('V9-QUOTE', 'only รวม / ไม่รวม are accepted on a quotation', 'owner',
    t.quote($x$'vat_enabled', true, 'vat_mode', 'HALF',$x$), 'INVALID_VAT_MODE');
SELECT t.err('V9-QUOTE', 'a quotation with VAT on but no button chosen (and no old shop mode) is refused', 'owner',
    t.quote($x$'vat_enabled', true,$x$), 'VAT_SETUP_REQUIRED');
SELECT t.ok('V9-QUOTE', 'reset the test VAT settings', 'owner',
    $q$select public.settings_update('{"vat_rate":null,"vat_mode":null}'::jsonb, 'test done')$q$);
