-- Rule tests for Settings Architecture Rebuild v1 (owner 2026-10-07), on top of
-- supabase/migrations/20261007094216_settings_architecture_v1.sql:
-- OWNER-only shop settings, VAT ON/OFF per bill with a server snapshot, and document numbers
-- PREFIX-DDMMBBBB-RUNNING with a daily restart. Runs after 10_rules_v42.sql (uses its customer c1).
-- Numbering cases use dates in 2031 so they never meet the numbers the other tests take today
-- (the owner's example ABC-07102569-001 is the same rule on 7 Oct 2026).
\set ON_ERROR_STOP 1

-- ===================================================================== PERMISSION
SELECT t.err('S1-PERM', 'USER cannot change shop settings (even a column)', 'cashier',
    $q$select public.settings_update('{"company_name":"hack"}'::jsonb, 'x')$q$, 'OWNER only');
SELECT t.err('S1-PERM', 'USER cannot write a shop policy key', 'finance',
    $q$select public.settings_update('{"policies":{"allow_backorder":true}}'::jsonb, 'x')$q$, 'OWNER only');
SELECT t.err('S1-PERM', 'USER without the products menu cannot write category defaults', 'cashier',
    $q$select public.settings_update('{"policies":{"category_defaults":{}}}'::jsonb, 'x')$q$, 'OWNER only');
SELECT t.ok('S1-PERM', 'USER with the finance menu still saves the finance quick-income list', 'finance',
    $q$select public.settings_update('{"policies":{"finance_income_items":["ค่าขนส่ง"]}}'::jsonb, 'test')$q$);
SELECT t.err('S1-PERM', 'the settings menu can no longer be granted to a USER', 'owner',
    format($q$select public.owner_set_member_menus(%L::uuid, ARRAY['pos','settings'], 'x')$q$, t.u('cashier')), 'OWNER_ONLY');
SELECT t.check('S1-PERM', 'settings is an owner-only menu', (SELECT owner_only FROM public.menu_catalog WHERE code = 'settings'));
SELECT t.err('S1-PERM', 'USER cannot read the numbering preview', 'cashier',
    $q$select to_jsonb(public.document_number_preview('BILL'))$q$, 'OWNER only');
SELECT t.ok('S2-PERM', 'OWNER changes shop settings', 'owner',
    $q$select public.settings_update('{"company_name":"ร้านทดสอบ","policies":{"business_profile":{"email":"a@b.th","lineId":"","authorizedPerson":""}}}'::jsonb, 'test')$q$);
SELECT t.err('S2-PERM', 'policy groups are type checked', 'owner',
    $q$select public.settings_update('{"policies":{"allow_backorder":"yes"}}'::jsonb, 'x')$q$, 'INVALID_POLICY');
SELECT t.err('S2-PERM', 'auto-lock options must come from the app list', 'owner',
    $q$select public.settings_update('{"policies":{"auto_lock_options_seconds":[7],"auto_lock_default_seconds":7}}'::jsonb, 'x')$q$, 'INVALID_POLICY');

-- ===================================================================== VAT PER BILL
SELECT t.err('S7-VAT', 'VAT ON/OFF is not a shop setting any more', 'owner',
    $q$select public.settings_update('{"vat_enabled":true}'::jsonb, 'x')$q$, 'UNKNOWN_FIELDS');
SELECT t.err('S7-VAT', 'a bill cannot switch VAT on before the OWNER sets rate + mode', 'cashier',
    t.draft($x$'vat_enabled', true,$x$, '', NULL), 'VAT_SETUP_REQUIRED');
SELECT t.err('S7-VAT', 'rate without price mode is refused', 'owner',
    $q$select public.settings_update('{"vat_rate":7}'::jsonb, 'x')$q$, 'VAT_SETUP_INCOMPLETE');
SELECT t.ok('S7-VAT', 'OWNER sets VAT 7% exclusive (test value only)', 'owner',
    $q$select public.settings_update('{"vat_rate":7,"vat_mode":"EXCLUSIVE"}'::jsonb, 'test')$q$);
SELECT t.set('vat_bill', (t.ok('S7-VAT', 'bill with VAT on', 'cashier',
    t.draft($x$'vat_enabled', true,$x$, '', NULL))) ->> 'id');
SELECT t.set('novat_bill', (t.ok('S8-VAT', 'next bill with VAT off', 'cashier', t.draft('', '', NULL))) ->> 'id');
SELECT t.check('S7-VAT', 'saving bills never changes the shop settings',
    (SELECT NOT vat_enabled AND vat_rate = 7 AND vat_mode = 'EXCLUSIVE' FROM public.store_settings));
SELECT t.check('S9-VAT', 'the VAT bill is priced by the server with its own snapshot',
    (SELECT vat_enabled AND vat_amount = round(taxable_amount * 0.07, 2) AND vat_amount > 0
            AND grand_total = taxable_amount + vat_amount
            AND pricing_snapshot ->> 'vat_enabled' = 'true' AND (pricing_snapshot ->> 'vat_rate')::numeric = 7
            AND pricing_snapshot ->> 'vat_mode' = 'EXCLUSIVE'
       FROM public.bills WHERE id = t.v('vat_bill')::uuid));
SELECT t.check('S8-VAT', 'VAT of the previous bill does not leak into the next one',
    (SELECT NOT vat_enabled AND vat_amount = 0 AND grand_total = taxable_amount AND pricing_snapshot ->> 'vat_enabled' = 'false'
       FROM public.bills WHERE id = t.v('novat_bill')::uuid));
SELECT t.err('S7-VAT', 'vat_enabled must be a boolean', 'cashier',
    t.draft($x$'vat_enabled', 'yes',$x$, '', NULL), 'INVALID_VAT_ENABLED');
SELECT t.set('vat_total', (SELECT grand_total::text FROM public.bills WHERE id = t.v('vat_bill')::uuid));
SELECT t.ok('S9-VAT', 'confirm the VAT bill', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-vat-confirm')$q$, t.v('vat_bill')));
SELECT t.ok('S9-VAT', 'OWNER changes the VAT rate afterwards', 'owner',
    $q$select public.settings_update('{"vat_rate":10,"vat_mode":"EXCLUSIVE"}'::jsonb, 'test')$q$);
SELECT t.check('S9-VAT', 'a confirmed bill keeps the VAT it was priced with',
    (SELECT status = 'CONFIRMED' AND grand_total::text = t.v('vat_total') AND (pricing_snapshot ->> 'vat_rate')::numeric = 7
            AND bill_no ~ '^BL-[0-9]{8}-[0-9]{3,}$'
       FROM public.bills WHERE id = t.v('vat_bill')::uuid));
SELECT t.err_admin('S9-VAT', 'VAT choice of a confirmed bill cannot be changed',
    format($q$update public.bills set vat_enabled = false where id = %L::uuid$q$, t.v('vat_bill')), 'BILL_TERMS_IMMUTABLE');
SELECT t.ok('S9-VAT', 'reset the test VAT rate', 'owner',
    $q$select public.settings_update('{"vat_rate":null,"vat_mode":null}'::jsonb, 'test done')$q$);

-- ===================================================================== DOCUMENT NUMBERS
SELECT t.err('S10-NO', 'prefix must be A-Z / 0-9', 'owner',
    $q$select public.settings_update('{"doc_number_formats":{"EXPENSE":{"prefix":"ab-","digits":3}}}'::jsonb, 'x')$q$,
    'INVALID_DOC_NUMBER_FORMAT');
SELECT t.err('S10-NO', 'digits must be 3-10', 'owner',
    $q$select public.settings_update('{"doc_number_formats":{"EXPENSE":{"prefix":"ABC","digits":2}}}'::jsonb, 'x')$q$,
    'INVALID_DOC_NUMBER_FORMAT');
SELECT t.err('S10-NO', 'unknown document type refused', 'owner',
    $q$select public.settings_update('{"doc_number_formats":{"FOO":{"prefix":"ABC","digits":3}}}'::jsonb, 'x')$q$,
    'INVALID_DOC_NUMBER_FORMAT');
SELECT t.ok('S10-NO', 'OWNER sets ABC with 3 digits', 'owner',
    $q$select public.settings_update('{"doc_number_formats":{"EXPENSE":{"prefix":"ABC","digits":3}}}'::jsonb, 'test')$q$);
SELECT t.check('S10-NO', 'first number of the day', public._next_document_no_at('EXPENSE', '2031-10-07 09:00+07') = 'ABC-07102574-001');
SELECT t.check('S10-NO', 'second number of the day', public._next_document_no_at('EXPENSE', '2031-10-07 18:00+07') = 'ABC-07102574-002');
SELECT t.check('S10-NO', 'next day restarts at 001', public._next_document_no_at('EXPENSE', '2031-10-08 00:05+07') = 'ABC-08102574-001');
SELECT t.check('S10-NO', 'the shop timezone decides the day (17:30 UTC = 00:30 next day in Bangkok)',
    public._next_document_no_at('EXPENSE', '2031-10-07 17:30+00') = 'ABC-08102574-002');
SELECT t.check('S10-NO', 'month rollover',
    public._next_document_no_at('EXPENSE', '2031-10-31 23:59+07') = 'ABC-31102574-001'
    AND public._next_document_no_at('EXPENSE', '2031-11-01 00:00+07') = 'ABC-01112574-001');
SELECT t.check('S10-NO', 'year rollover with the Buddhist year (2574 → 2575)',
    public._next_document_no_at('EXPENSE', '2031-12-31 23:59+07') = 'ABC-31122574-001'
    AND public._next_document_no_at('EXPENSE', '2032-01-01 00:01+07') = 'ABC-01012575-001');
SELECT t.check('S10-NO', 'a running number past the digits is printed in full, never cut',
    public._format_document_no('ABC', '2026-10-07', 1234, 3) = 'ABC-07102569-1234');
SELECT t.check('S10-NO', 'numbers are never reused within a day',
    (SELECT last_no = 2 FROM public.document_sequences WHERE doc_type = 'EXPENSE' AND period_key = '20311007'));
SELECT t.check('S10-NO', 'the app path (now) uses the same format',
    public._next_document_no('EXPENSE') ~ '^ABC-[0-9]{8}-[0-9]{3}$');
SELECT t.check('S10-NO', 'preview = the same formatter, next number of today, nothing consumed',
    (t.exec_as(t.u('owner'), 'authenticated', $q$select to_jsonb(public.document_number_preview('EXPENSE', 'XYZ', 4))$q$) #>> '{}')
        = public._format_document_no('XYZ', public._local_date(now()),
              (SELECT last_no + 1 FROM public.document_sequences WHERE doc_type = 'EXPENSE'
                 AND period_key = to_char(public._local_date(now()), 'YYYYMMDD')), 4)
    AND (t.exec_as(t.u('owner'), 'authenticated', $q$select to_jsonb(public.document_number_preview('EXPENSE'))$q$) #>> '{}')
        = (t.exec_as(t.u('owner'), 'authenticated', $q$select to_jsonb(public.document_number_preview('EXPENSE'))$q$) #>> '{}'));
SELECT t.check('S10-NO', 'types without a saved format use the server prefix and 3 digits',
    public._next_document_no_at('OTHER_INCOME', '2031-10-07 09:00+07') = 'OI-07102574-001');
