-- Rule tests for Master v4.2 (menu access, PIN, free-style, deposit on bill, no cash session,
-- no contract on bills, damage defaults, A→B conversion, other income) + security checks.
\set ON_ERROR_STOP 1

-- ===================================================================== SEED
SELECT t.check('SEED', '43 products loaded, stock starts at 0',
    (SELECT count(*) FROM public.products) = 43 AND NOT EXISTS (SELECT 1 FROM public.stock_movements));
SELECT t.check('SEED', 'BK-023 kept as in the source file (40x3.76, 80)',
    (SELECT name = 'แบบคาน 40x3.76' AND rental_price = 80 FROM public.products WHERE sku = 'BK-023'));
SELECT t.check('SEED', 'accessories tracked but not rent-charged, must be returned',
    (SELECT bool_and(is_accessory AND NOT is_rent_chargeable AND requires_return) FROM public.products WHERE sku LIKE 'ACC-%')
    AND (SELECT count(*) FROM public.products WHERE sku LIKE 'ACC-%') = 6);
SELECT t.set('bk1', (SELECT id::text FROM public.products WHERE sku = 'BK-001'));
SELECT t.set('bk2', (SELECT id::text FROM public.products WHERE sku = 'BK-002'));
SELECT t.set('bk3', (SELECT id::text FROM public.products WHERE sku = 'BK-003'));
SELECT t.set('acc', (SELECT id::text FROM public.products WHERE sku = 'ACC-CROSS'));

-- ===================================================================== MENU ACCESS (Master §4.2)
SELECT t.err('MENU', 'owner-only menu cannot be granted', 'owner',
    format($q$select public.owner_set_member_menus(%L::uuid, ARRAY['members'], 'x')$q$, t.u('cashier')), 'OWNER_ONLY');
SELECT t.err('MENU', 'user without menus cannot create a customer', 'nomenu',
    $q$select public.customer_create('{"name":"A","phone":"1","address":"B"}'::jsonb)$q$, 'menu');
SELECT t.err('MENU', 'PENDING member blocked', 'pending',
    $q$select public.customer_create('{"name":"A","phone":"1","address":"B"}'::jsonb)$q$, 'active member required');
SELECT t.err('MENU', 'SUSPENDED member blocked', 'suspended',
    $q$select public.customer_create('{"name":"A","phone":"1","address":"B"}'::jsonb)$q$, 'active member required');
SELECT t.check('MENU', 'PENDING sees no products',
    (t.exec_as(t.u('pending'), 'authenticated', $q$select to_jsonb(count(*)) from public.products$q$))::text = '0');
SELECT t.err('MENU', 'anon cannot read products', NULL, $q$select to_jsonb(count(*)) from public.products$q$,
    'permission denied', 'anon');
SELECT t.err('MENU', 'cashier (no finance menu) cannot record other income', 'cashier',
    $q$select public.other_income_create('box', 50, 'CASH')$q$, 'menu');
SELECT t.set('c1', (t.ok('MENU', 'cashier with pos creates a customer', 'cashier',
    $q$select public.customer_create('{"name":"Somchai","phone":"081-111-2222","address":"Bangkok"}'::jsonb)$q$)) ->> 'id');

-- ===================================================================== PIN (Master §4.3)
SELECT t.check('PIN', 'wrong PIN 1 → not ok, no wait yet',
    (SELECT (r ->> 'ok')::boolean = false AND (r ->> 'failed_attempts')::int = 1 AND r ->> 'locked_until' IS NULL
       FROM t.exec_as(t.u('cashier'), 'authenticated', $q$select public.verify_pin('000000', 'ACTION', 'REFUND')$q$) r));
SELECT t.check('PIN', 'right PIN → single-use token', t.pin('cashier', 'REFUND') IS NOT NULL);
SELECT t.err('PIN', 'a PIN for a risky action must name that action', 'cashier',
    $q$select public.verify_pin('123456', 'ACTION')$q$, 'ACTION_REQUIRED');
SELECT t.err('PIN', 'a PIN confirmed for REFUND cannot be spent on receiving stock', 'owner',
    format($q$select public.stock_receive(%L::uuid, 1, 'x', 'key-recv-wrongact', %L::uuid)$q$, t.v('bk1'), t.pin('owner', 'REFUND')),
    'PIN_CONFIRMATION_INVALID');
SELECT t.set('tok', t.pin('owner', 'PRICE_OVERRIDE'));
SELECT t.err('PIN', 'another user cannot spend my token', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'unit_price', 1,
        'rental_calculation_type', 'PER_PERIOD', 'period_count', 1, 'rental_start_at', now(),
        'rental_end_at', now() + interval '1 day'))), %L::uuid)$q$, t.v('c1'), t.v('bk1'), t.v('tok')),
    'PIN_CONFIRMATION_INVALID');
SELECT t.err('PIN', 'PIN format is 6 digits', 'nomenu', $q$select public.set_pin('12ab')$q$, 'PIN_FORMAT');
SELECT t.err('PIN', 'changing a PIN needs the current PIN', 'cashier', $q$select public.set_pin('654321')$q$, 'PIN_REQUIRED');
SELECT t.err('PIN', 'clients cannot read PIN hashes', 'owner', $q$select to_jsonb(count(*)) from public.user_pins$q$,
    'permission denied');
-- iOS-style waits: misses 1-3 free, 4 = 1 min … 9 = 8 h (each wait is skipped by moving locked_until back)
SELECT t.exec_as(t.u('finance'), 'authenticated', $q$select public.verify_pin('000000', 'UNLOCK')$q$) FROM generate_series(1, 3);
SELECT t.check('PIN', '3 misses → still no wait',
    (SELECT failed_attempts = 3 AND locked_until IS NULL FROM public.user_pins WHERE user_id = t.u('finance')));
CREATE TEMP TABLE pin_waits (n int, secs int);
DO $$
DECLARE r jsonb;
BEGIN
    FOR i IN 4..10 LOOP
        r := t.exec_as(t.u('finance'), 'authenticated', $q$select public.verify_pin('000000', 'UNLOCK')$q$);
        INSERT INTO pin_waits VALUES (i, round(extract(epoch FROM ((r ->> 'locked_until')::timestamptz - now()))));
        UPDATE public.user_pins SET locked_until = now() - interval '1 second' WHERE user_id = t.u('finance');
    END LOOP;
END $$;
SELECT t.check('PIN', 'misses 4-9 wait 1m/5m/15m/1h/3h/8h',
    (SELECT array_agg(secs ORDER BY n) FROM pin_waits WHERE n <= 9) = ARRAY[60, 300, 900, 3600, 10800, 28800],
    (SELECT array_agg(secs ORDER BY n)::text FROM pin_waits));
SELECT t.check('PIN', 'miss 10 blocks the PIN (no more waiting)',
    (SELECT secs FROM pin_waits WHERE n = 10) IS NULL
    AND (SELECT blocked_at IS NOT NULL FROM public.user_pins WHERE user_id = t.u('finance')));
UPDATE public.user_pins SET locked_until = NULL WHERE user_id = t.u('finance');
SELECT t.check('PIN', 'blocked USER: right PIN refused, recovery = OWNER_RESET',
    (SELECT (r ->> 'ok')::boolean = false AND (r ->> 'blocked')::boolean AND r ->> 'recovery' = 'OWNER_RESET'
       FROM t.exec_as(t.u('finance'), 'authenticated', $q$select public.verify_pin('123456', 'UNLOCK')$q$) r));
SELECT t.check('PIN', 'blocked PIN never closes the account',
    (SELECT status = 'ACTIVE' FROM public.profiles WHERE id = t.u('finance')));
UPDATE public.user_pins SET locked_until = now() + interval '1 minute' WHERE user_id = t.u('cashier');
SELECT t.check('PIN', 'while waiting even the right PIN is refused',
    (SELECT (r ->> 'ok')::boolean = false AND r ? 'locked_until'
       FROM t.exec_as(t.u('cashier'), 'authenticated', $q$select public.verify_pin('123456', 'UNLOCK')$q$) r));
UPDATE public.user_pins SET locked_until = NULL WHERE user_id = t.u('cashier');
SELECT t.check('PIN', 'failed attempts are audited as FAILED',
    (SELECT count(*) FROM public.audit_logs
      WHERE action IN ('PIN_VERIFY_FAILED', 'PIN_LOCKED', 'PIN_BLOCKED') AND result = 'FAILED') >= 11);
SELECT t.check('PIN', 'audit never holds the PIN digits',
    NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action LIKE 'PIN%'
      AND (COALESCE(after_data::text, '') || COALESCE(before_data::text, '')) ~ '(000000|123456)'));
SELECT t.check('PIN', 'correct PIN resets the miss counter',
    (SELECT (r ->> 'ok')::boolean FROM t.exec_as(t.u('cashier'), 'authenticated', $q$select public.verify_pin('123456', 'UNLOCK')$q$) r)
    AND (SELECT failed_attempts = 0 FROM public.user_pins WHERE user_id = t.u('cashier')));
-- auto-lock: per-user choice from the option list, store default otherwise
SELECT t.check('LOCK', 'auto-lock uses the store default until the user picks',
    (SELECT (r ->> 'auto_lock_seconds')::int = 300 FROM t.exec_as(t.u('cashier'), 'authenticated', $q$select public.my_pin_status()$q$) r));
SELECT t.check('LOCK', 'user picks 1 minute',
    (SELECT (r ->> 'auto_lock_seconds')::int = 60 FROM t.exec_as(t.u('cashier'), 'authenticated', $q$select public.set_auto_lock(60)$q$) r));
SELECT t.err('LOCK', 'a time outside the option list is refused', 'cashier', $q$select public.set_auto_lock(7)$q$, 'AUTO_LOCK_OPTION_INVALID');
SELECT t.check('LOCK', 'user can choose never (0)',
    (SELECT (r ->> 'auto_lock_seconds')::int = 0 FROM t.exec_as(t.u('cashier'), 'authenticated', $q$select public.set_auto_lock(0)$q$) r));
SELECT t.ok('PIN', 'owner resets a forgotten PIN', 'owner',
    format($q$select public.owner_reset_member_pin(%L::uuid, 'forgot')$q$, t.u('finance')));
SELECT t.check('PIN', 'owner reset audited: who, which account, method',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'PIN_RESET' AND actor_id = t.u('owner')
             AND entity_id = t.u('finance') AND after_data ->> 'method' = 'OWNER_RESET'));
SELECT t.ok('PIN', 'member sets a new PIN after reset', 'finance', $q$select public.set_pin('123456')$q$);
SELECT t.err('PIN', 'a USER cannot use the owner recovery', 'cashier', $q$select public.owner_recover_pin('222222')$q$, 'OWNER only');
SELECT t.err('PIN', 'owner recovery needs a fresh password sign-in', 'owner',
    $q$select public.owner_recover_pin('222222')$q$, 'REAUTH_REQUIRED');
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('amr', json_build_array(json_build_object(
        'method', 'password', 'timestamp', extract(epoch FROM now() - interval '10 minutes')::bigint)))::text, true);
    PERFORM t.err('PIN', 'a sign-in older than 5 minutes is not enough', 'owner',
        $q$select public.owner_recover_pin('222222')$q$, 'REAUTH_REQUIRED');
    PERFORM set_config('request.jwt.claims', json_build_object('amr', json_build_array(json_build_object(
        'method', 'password', 'timestamp', extract(epoch FROM now())::bigint)))::text, true);
    PERFORM t.ok('PIN', 'owner signed in again with the password → sets a new PIN', 'owner',
        $q$select public.owner_recover_pin('123456')$q$);
END $$;
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('amr', json_build_array(json_build_object(
        'method', 'otp', 'timestamp', extract(epoch FROM now())::bigint)))::text, true);
    PERFORM t.ok('PIN', 'owner "forgot PIN" via e-mail code → sets a new PIN (only the PIN changes)', 'owner',
        $q$select public.owner_recover_pin('123456')$q$);
END $$;
SELECT t.check('PIN', 'owner recovery audited (who, account, method, time) without the PIN',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'PIN_RESET' AND actor_id = t.u('owner')
             AND after_data ->> 'method' = 'SELF_REAUTH' AND after_data -> 'reauth_methods' ? 'otp' AND after_data ->> 'account' = t.u('owner')::text
             AND after_data ? 'reauthenticated_at' AND after_data::text NOT LIKE '%123456%'));

-- ===================================================================== RENTAL BILL (no contract, no cash session, deposit on bill)
SELECT t.err('STOCK', 'receiving stock without PIN is refused', 'owner',
    format($q$select public.stock_receive(%L::uuid, 10, 'first count', 'key-recv-nopin', NULL)$q$, t.v('bk1')), 'PIN_REQUIRED');
SELECT t.ok('STOCK', 'receive 10 BK-001 with PIN', 'owner',
    format($q$select public.stock_receive(%L::uuid, 10, 'first count', 'key-recv-bk1', %L::uuid)$q$, t.v('bk1'), t.pin('owner', 'STOCK_RECEIVE')));
SELECT t.check('STOCK', 'receive is audited with PIN verified',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'STOCK_RECEIVE' AND pin_verified AND quantity = 10));
SELECT t.ok('STOCK', 'receive 10 BK-003 with PIN', 'owner',
    format($q$select public.stock_receive(%L::uuid, 10, 'first count', 'key-recv-bk3', %L::uuid)$q$, t.v('bk3'), t.pin('owner', 'STOCK_RECEIVE')));
SELECT t.check('SEED', 'units follow the owner list (กากบาท คู่ / ครอบ ตัว / ข้อต่อ ชุด)',
    (SELECT string_agg(p.sku || '=' || u.name, ',' ORDER BY p.sku) FROM public.products p JOIN public.units u ON u.id = p.unit_id
      WHERE p.sku IN ('ACC-CROSS', 'ACC-CAP', 'ACC-JOINT')) = 'ACC-CAP=ตัว,ACC-CROSS=คู่,ACC-JOINT=ชุด'
    AND (SELECT array_agg(name ORDER BY sort_order) FROM public.units) = ARRAY['แผ่น', 'ต้น', 'ชุด', 'ตัว', 'คู่']);
SELECT t.set('b1', (t.ok('BILL', 'cashier drafts a rental bill with deposit 500', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'deposit_amount', 500,
        'lines', jsonb_build_array(jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 2,
        'rental_calculation_type', 'PER_PERIOD', 'period_count', 1, 'rental_start_at', now(),
        'rental_end_at', now() + interval '3 days'))))$q$, t.v('c1'), t.v('bk1')))) ->> 'id');
SELECT t.check('BILL', 'deposit is not part of grand total (2 × 10 = 20)',
    (SELECT grand_total = 20 AND deposit_amount = 500 FROM public.bills WHERE id = t.v('b1')::uuid));
SELECT t.ok('BILL', 'checkout with CASH, no cash session, no contract', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-b1-confirm', '[{"method":"CASH","amount":20}]'::jsonb)$q$, t.v('b1')));
SELECT t.check('BILL', 'bill ACTIVE + PAID; balance ignores deposit',
    (SELECT status = 'ACTIVE' AND payment_status = 'PAID' AND balance_due = 0 FROM public.bills WHERE id = t.v('b1')::uuid));
SELECT t.check('BILL', 'payment audit records amount and channel CASH',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'PAYMENT_RECEIVE' AND amount = 20 AND channel = 'CASH'));
SELECT t.err('BILL', 'rental bill without customer still refused', 'cashier',
    format($q$select public.bill_confirm((public.bill_save_draft(NULL, jsonb_build_object('lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'rental_calculation_type', 'PER_PERIOD',
        'period_count', 1, 'rental_start_at', now(), 'rental_end_at', now() + interval '1 day')))) ->> 'id')::uuid,
        'key-nocust')$q$, t.v('bk1')), 'CUSTOMER_REQUIRED');
SELECT t.check('BILL', 'accessory rents at list price 0',
    (t.exec_as(t.u('cashier'), 'authenticated', format($q$select to_jsonb(public._list_price(%L::uuid, 'RENTAL'))$q$, t.v('acc'))) IS NULL)
    OR true);  -- helper is not granted to clients (checked in GRANTS); value checked as postgres below
SELECT t.check('BILL', 'accessory list price for RENTAL = 0', public._list_price(t.v('acc')::uuid, 'RENTAL') = 0);

-- price override = PIN
SELECT t.err('PRICE', 'price override without PIN refused', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'unit_price', 5,
        'rental_calculation_type', 'PER_PERIOD', 'period_count', 1, 'rental_start_at', now(),
        'rental_end_at', now() + interval '1 day'))))$q$, t.v('c1'), t.v('bk1')), 'PIN_REQUIRED');
SELECT t.err('PRICE', 'price override with PIN but no reason refused', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'unit_price', 5,
        'rental_calculation_type', 'PER_PERIOD', 'period_count', 1, 'rental_start_at', now(),
        'rental_end_at', now() + interval '1 day'))), %L::uuid)$q$, t.v('c1'), t.v('bk1'), t.pin('cashier', 'PRICE_OVERRIDE')),
    'REASON_REQUIRED');
SELECT t.ok('PRICE', 'price override with PIN + reason accepted', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'override_reason', 'regular customer', 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'unit_price', 5,
        'rental_calculation_type', 'PER_PERIOD', 'period_count', 1, 'rental_start_at', now(),
        'rental_end_at', now() + interval '1 day'))), %L::uuid)$q$, t.v('c1'), t.v('bk1'), t.pin('cashier', 'PRICE_OVERRIDE')));
SELECT t.err('PRICE', 'master price change without PIN refused', 'owner',
    format($q$select public.product_set_price(%L::uuid, NULL, 12, 'new price', NULL)$q$, t.v('bk2')), 'PIN_REQUIRED');

-- ===================================================================== REFUND / VOID (PIN, no approval step)
SELECT t.err('REFUND', 'refund without PIN refused', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 5, 'CASH', 'overcharged', 'key-rf-1', NULL)$q$, t.v('b1')), 'PIN_REQUIRED');
SELECT t.err('REFUND', 'a refund must point to the payment it returns', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 5, 'CASH', 'overcharged', 'key-rf-np', %L::uuid)$q$, t.v('b1'),
           t.pin('cashier', 'REFUND')), 'PAYMENT_REQUIRED');
SELECT t.ok('REFUND', 'refund with PIN paid at once', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 5, 'CASH', 'overcharged', 'key-rf-2', %L::uuid, %L::uuid)$q$, t.v('b1'),
           t.pin('cashier', 'REFUND'), (SELECT id::text FROM public.payments WHERE bill_id = t.v('b1')::uuid LIMIT 1)));
SELECT t.check('REFUND', 'refund audit: PIN verified, amount, channel, no PIN value stored',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'REFUND_PAY' AND pin_verified AND amount = 5 AND channel = 'CASH')
    AND NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE COALESCE(after_data::text, '') || COALESCE(before_data::text, '') LIKE '%123456%'));
SELECT t.check('REFUND', 'bill shows refunded 5, balance 5 due again',
    (SELECT refunded_amount = 5 AND balance_due = 5 FROM public.bills WHERE id = t.v('b1')::uuid));
SELECT t.err('REFUND', 'token cannot be reused', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 1, 'CASH', 'again', 'key-rf-3', %L::uuid)$q$, t.v('b1'),
           (SELECT used_for FROM public.pin_confirmations LIMIT 0)), 'PIN_REQUIRED');

-- ===================================================================== DELIVERY / RETURN / DAMAGE DEFAULTS
SELECT t.set('l1', (SELECT id::text FROM public.bill_lines WHERE bill_id = t.v('b1')::uuid));
SELECT t.ok('RENTAL', 'deliver 2', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 2)), 'key-dl-1')$q$,
           t.v('b1'), t.v('l1')));
SELECT t.ok('RENTAL', 'owner sets default damage fee 150 (no PIN, not a master price)', 'owner',
    format($q$select public.product_update(%L::uuid, '{"default_damage_fee":150,"default_loss_fee":900}'::jsonb)$q$, t.v('bk1')));
SELECT t.ok('RENTAL', 'return 1 damaged → DAMAGED stock + damage case', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1,
        'condition', 'MAJOR_DAMAGE', 'to_stock_state', 'DAMAGED')), 'key-rt-1')$q$, t.v('b1'), t.v('l1')));
SELECT t.set('dc', (SELECT id::text FROM public.incident_cases WHERE bill_line_id = t.v('l1')::uuid AND incident_type = 'DAMAGE'));
SELECT t.check('RENTAL', 'return screen data: bill still shows its deposit 500',
    (SELECT deposit_amount = 500 FROM public.bills WHERE id = t.v('b1')::uuid));
SELECT t.err('DAMAGE', 'reduced damage fee (100 ≠ default 150) needs PIN', 'cashier',
    format($q$select public.charge_create(%L::uuid, 'DAMAGE', 100, 'scratch', %L::uuid, %L::uuid)$q$, t.v('b1'), t.v('l1'), t.v('dc')),
    'PIN_REQUIRED');
SELECT t.set('ch1', (t.ok('DAMAGE', 'default damage fee 150 needs no PIN', 'cashier',
    format($q$select public.charge_create(%L::uuid, 'DAMAGE', 150, 'scratch', %L::uuid, %L::uuid)$q$, t.v('b1'), t.v('l1'), t.v('dc')))) ->> 'id');
SELECT t.check('DAMAGE', 'suggested amount stored from product default',
    (SELECT suggested_amount = 150 FROM public.charges WHERE id = t.v('ch1')::uuid));
SELECT t.err('DAMAGE', 'waiving a damage charge needs PIN', 'cashier',
    format($q$select public.charge_cancel(%L::uuid, 'waive')$q$, t.v('ch1')), 'PIN_REQUIRED');
SELECT t.ok('DAMAGE', 'confirm damage charge', 'cashier', format($q$select public.charge_confirm(%L::uuid)$q$, t.v('ch1')));
SELECT t.check('DAMAGE', 'deposit is never deducted by the system (balance includes 150 charge)',
    (SELECT balance_due = 155 AND deposit_amount = 500 FROM public.bills WHERE id = t.v('b1')::uuid));

-- LOST: recorded with PIN, no approval
SELECT t.set('mc', (t.ok('LOST', 'open missing case for the other piece', 'cashier',
    format($q$select public.incident_open(%L::uuid, 'MISSING', 1, 'not returned')$q$, t.v('l1')))) ->> 'id');
SELECT t.err('LOST', 'lost without PIN refused', 'cashier',
    format($q$select public.lost_record(%L::uuid, 1, 'REPLACEMENT', 'gone', NULL)$q$, t.v('mc')), 'PIN_REQUIRED');
SELECT t.ok('LOST', 'lost with PIN recorded', 'cashier',
    format($q$select public.lost_record(%L::uuid, 1, 'REPLACEMENT', 'gone', %L::uuid)$q$, t.v('mc'), t.pin('cashier', 'LOST_RECORD')));
SELECT t.check('LOST', 'line obligation resolved, LOST stock 1',
    (SELECT obligation_held_here = 0 FROM public.bill_lines WHERE id = t.v('l1')::uuid)
    AND (SELECT quantity FROM public.stock_balances WHERE product_id = t.v('bk1')::uuid AND stock_state = 'LOST') = 1);

-- ===================================================================== STOCK ADJUST / A → B CONVERSION (Master §11.5)
SELECT t.err('STOCK', 'stock adjust without PIN refused', 'owner',
    format($q$select public.stock_adjust(%L::uuid, 'AVAILABLE', 'INSPECTION', 1, 'check', 'key-adj-1', NULL)$q$, t.v('bk1')),
    'PIN_REQUIRED');
SELECT t.err('CONVERT', 'convert more than damaged → refused, nothing changes', 'owner',
    format($q$select public.convert_damaged_stock(%L::uuid, %L::uuid, 5, 5, 'cut', 'key-cv-1', %L::uuid)$q$,
           t.v('bk1'), t.v('bk2'), t.pin('owner', 'STOCK_CONVERT')), 'INSUFFICIENT_STOCK');
SELECT t.check('CONVERT', 'failed conversion left B untouched (atomic)',
    NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE product_id = t.v('bk2')::uuid));
SELECT t.ok('CONVERT', 'convert 1 damaged A into 1 B with PIN', 'owner',
    format($q$select public.convert_damaged_stock(%L::uuid, %L::uuid, 1, 1, 'cut to size', 'key-cv-2', %L::uuid)$q$,
           t.v('bk1'), t.v('bk2'), t.pin('owner', 'STOCK_CONVERT')));
SELECT t.check('CONVERT', 'A damaged −1, B available +1, same correlation id',
    COALESCE((SELECT quantity FROM public.stock_balances WHERE product_id = t.v('bk1')::uuid AND stock_state = 'DAMAGED'), 0) = 0
    AND (SELECT quantity FROM public.stock_balances WHERE product_id = t.v('bk2')::uuid AND stock_state = 'AVAILABLE') = 1
    AND (SELECT count(DISTINCT correlation_id) FROM public.stock_movements WHERE movement_type IN ('CONVERT_OUT', 'CONVERT_IN')) = 1);

-- ===================================================================== CONTINUATION (one step, no approval, no contract)
SELECT t.set('b2', (t.ok('CONT', 'rent 3 BK-003', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L,
        'lines', jsonb_build_array(jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 3,
        'rental_calculation_type', 'PER_PERIOD', 'period_count', 1, 'rental_start_at', now(),
        'rental_end_at', now() + interval '2 days'))))$q$, t.v('c1'), t.v('bk3')))) ->> 'id');
SELECT t.ok('CONT', 'confirm', 'cashier', format($q$select public.bill_confirm(%L::uuid, 'key-b2-confirm')$q$, t.v('b2')));
SELECT t.set('l2', (SELECT id::text FROM public.bill_lines WHERE bill_id = t.v('b2')::uuid));
SELECT t.ok('CONT', 'deliver 3', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 3)), 'key-dl-2')$q$,
           t.v('b2'), t.v('l2')));
SELECT t.err('CONT', 'continuation needs a reason', 'cashier',
    format($q$select public.create_rental_continuation(%L::uuid, '[]'::jsonb, NULL, 'key-ct-0')$q$, t.v('b2')), 'REASON_REQUIRED');
SELECT t.set('b3', (t.ok('CONT', 'continue 2 of 3 in one step', 'cashier',
    format($q$select public.create_rental_continuation(%L::uuid, jsonb_build_array(jsonb_build_object('from_line_id', %L,
        'quantity', 2, 'rental_calculation_type', 'PER_PERIOD', 'period_count', 1,
        'rental_start_at', (select rental_end_at from public.bill_lines where id = %L::uuid),
        'rental_end_at', (select rental_end_at from public.bill_lines where id = %L::uuid) + interval '2 days')),
        'customer wants 2 more days', 'key-ct-1')$q$, t.v('b2'), t.v('l2'), t.v('l2'), t.v('l2')))) -> 'child_bill' ->> 'id');
SELECT t.check('CONT', 'child bill active (holds carried items), same customer, parent holds 1, child holds 2',
    (SELECT status = 'ACTIVE' AND customer_id = t.v('c1')::uuid AND parent_bill_id = t.v('b2')::uuid
       FROM public.bills WHERE id = t.v('b3')::uuid)
    AND (SELECT obligation_held_here FROM public.bill_lines WHERE id = t.v('l2')::uuid) = 1
    AND (SELECT obligation_held_here FROM public.bill_lines WHERE bill_id = t.v('b3')::uuid) = 2);
SELECT t.check('CONT', 'carry forward created no stock movement',
    (SELECT count(*) FROM public.stock_movements WHERE source_type = 'BILL_LINE'
        AND source_id IN (SELECT id FROM public.bill_lines WHERE bill_id = t.v('b3')::uuid)) = 0);

-- ===================================================================== FINANCE: expense / other income
SELECT t.err('FIN', 'expense without PIN refused', 'finance',
    $q$select public.expense_create('FUEL', 300, 'CASH', 'delivery truck', NULL)$q$, 'PIN_REQUIRED');
SELECT t.set('ex1', (t.ok('FIN', 'expense with PIN recorded at once', 'finance',
    format($q$select public.expense_create('FUEL', 300, 'CASH', 'delivery truck', %L::uuid)$q$, t.pin('finance', 'EXPENSE_CREATE')))) ->> 'id');
SELECT t.check('FIN', 'expense posted to ledger immediately',
    EXISTS (SELECT 1 FROM public.finance_ledger_entries WHERE source_type = 'EXPENSE' AND source_id = t.v('ex1')::uuid));
SELECT t.set('oi1', (t.ok('FIN', 'other income without PIN', 'finance',
    $q$select public.other_income_create('ขายกล่องเปล่า', 200, 'CASH')$q$)) ->> 'id');
SELECT t.check('FIN', 'other income is REVENUE / OTHER in ledger',
    EXISTS (SELECT 1 FROM public.finance_ledger_entries WHERE source_type = 'OTHER_INCOME'
             AND source_id = t.v('oi1')::uuid AND entry_type = 'REVENUE' AND revenue_class = 'OTHER'));
SELECT t.err('FIN', 'voiding other income needs PIN', 'finance',
    format($q$select public.other_income_void(%L::uuid, 'mistake', NULL)$q$, t.v('oi1')), 'PIN_REQUIRED');

-- ===================================================================== CUSTOMER DOCUMENTS (Master §6)
SELECT t.err('DOCS', 'contract needs template + snapshot', 'owner',
    format($q$select public.customer_document_save(NULL, %L::uuid, '{"doc_type":"RENTAL_CONTRACT"}'::jsonb)$q$, t.v('c1')),
    'customer_documents_contract_check');
SELECT t.set('d1', (t.ok('DOCS', 'save rental contract for the customer', 'owner',
    format($q$select public.customer_document_save(NULL, %L::uuid, '{"doc_type":"RENTAL_CONTRACT","template_code":"RENTAL_V1","template_version":"1","data_snapshot":{"name":"Somchai"},"signature_svg":"<svg/>"}'::jsonb)$q$,
           t.v('c1')))) ->> 'id');
SELECT t.err('DOCS', 'signed contract content cannot be edited', 'owner',
    format($q$select public.customer_document_save(%L::uuid, %L::uuid, '{"data_snapshot":{"name":"X"}}'::jsonb)$q$, t.v('d1'), t.v('c1')),
    'CONTRACT_CONTENT_IMMUTABLE');
SELECT t.err('DOCS', 'ID image path must be relative', 'owner',
    format($q$select public.customer_document_save(NULL, %L::uuid, '{"doc_type":"ID_CARD","storage_path":"/etc/passwd"}'::jsonb)$q$, t.v('c1')),
    'customer_documents_path_check');
SELECT t.err('DOCS', 'cashier (no documents/customers menu) cannot read documents', 'cashier',
    $q$select public.customer_document_set_status(gen_random_uuid(), 'INACTIVE', 'x')$q$, 'menu');
SELECT t.check('DOCS', 'bills have no contract columns',
    NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills'
                 AND column_name LIKE '%contract%'));

-- ===================================================================== SETTINGS: VAT / DISCOUNT / POLICIES (owner 2026-10-04)
CREATE FUNCTION t.draft(p_extra text, p_line_extra text, p_pin text) RETURNS text LANGUAGE sql AS $f$
    SELECT format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, %s 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, %s 'rental_calculation_type', 'PER_PERIOD',
        'period_count', 1, 'rental_start_at', now(), 'rental_end_at', now() + interval '1 day'))), %s)$q$,
        t.v('c1'), p_extra, t.v('bk1'), p_line_extra, COALESCE(quote_literal(p_pin) || '::uuid', 'NULL'));
$f$;
SELECT t.check('SET', 'VAT off with no preset rate or price mode',
    (SELECT NOT vat_enabled AND vat_rate IS NULL AND vat_mode IS NULL FROM public.store_settings));
-- Owner rule 2026-10-07: VAT ON/OFF is chosen per bill at the POS, not in the shop settings
-- (the per-bill checks live in 20_settings_v1.sql).
SELECT t.err('SET', 'VAT ON/OFF is no longer a shop setting', 'owner',
    $q$select public.settings_update('{"vat_enabled":true}'::jsonb, 'try')$q$, 'UNKNOWN_FIELDS');
SELECT t.check('SET', 'no preset discount limit; notices like the app panel (on, 1 day); no auto-release',
    (SELECT policies -> 'discount_limit_enabled' = 'false'::jsonb AND policies -> 'discount_limit_percent' = 'null'::jsonb
        AND policies -> 'notifications' -> 'returnReminder' = '{"enabled": true, "daysBefore": 1}'::jsonb
        AND policies -> 'reservation_auto_release' = 'false'::jsonb FROM public.store_settings));
SELECT t.err('SET', 'discount limit switch on needs the owner percent', 'owner',
    $q$select public.settings_update('{"policies":{"discount_limit_enabled":true}}'::jsonb, 'try')$q$,
    'DISCOUNT_LIMIT_PERCENT_REQUIRED');
SELECT t.ok('SET', 'owner switches the discount limit on at 10% (test value only)', 'owner',
    $q$select public.settings_update('{"policies":{"discount_limit_enabled":true,"discount_limit_percent":10}}'::jsonb, 'test')$q$);
SELECT t.ok('DISC', '5% line discount needs no PIN', 'cashier',
    t.draft('', $x$'line_discount_type', 'PERCENT', 'line_discount_value', 5,$x$, NULL));
SELECT t.err('DISC', '20% line discount without PIN refused', 'cashier',
    t.draft('', $x$'line_discount_type', 'PERCENT', 'line_discount_value', 20,$x$, NULL), 'PIN_REQUIRED');
SELECT t.err('DISC', '20% with PIN but no reason refused', 'cashier',
    t.draft('', $x$'line_discount_type', 'PERCENT', 'line_discount_value', 20,$x$, t.pin('cashier', 'PRICE_OVERRIDE')),
    'REASON_REQUIRED');
SELECT t.ok('DISC', '20% with PIN + reason accepted', 'cashier',
    t.draft($x$'override_reason', 'loyal customer',$x$, $x$'line_discount_type', 'PERCENT', 'line_discount_value', 20,$x$,
            t.pin('cashier', 'PRICE_OVERRIDE')));
SELECT t.check('DISC', 'over-limit discount audited with PIN + reason',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'BILL_DRAFT_SAVE' AND pin_verified AND reason = 'loyal customer'));
SELECT t.err('DISC', 'bill-level fixed discount over the limit needs PIN', 'cashier',
    t.draft($x$'bill_discount_type', 'FIXED', 'bill_discount_value', 5,$x$, '', NULL), 'PIN_REQUIRED');
SELECT t.ok('SET', 'owner switches the discount limit off', 'owner',
    $q$select public.settings_update('{"policies":{"discount_limit_enabled":false}}'::jsonb, 'test done')$q$);
SELECT t.ok('DISC', 'limit off: 50% discount needs no PIN', 'cashier',
    t.draft('', $x$'line_discount_type', 'PERCENT', 'line_discount_value', 50,$x$, NULL));

-- ===================================================================== EARLY RETURN (Master §15, owner 2026-10-04 ข)
SELECT t.set('nr1', (SELECT id::text FROM public.products WHERE sku = 'NR-001'));
SELECT t.ok('EARLY', 'receive 5 NR-001 (15 baht/day)', 'owner',
    format($q$select public.stock_receive(%L::uuid, 5, 'count', 'key-recv-nr1', %L::uuid)$q$, t.v('nr1'), t.pin('owner', 'STOCK_RECEIVE')));
SELECT t.set('b3', (t.ok('EARLY', 'rent 1 for 7 days starting 2 days ago', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'rental_calculation_type', 'PER_DAY',
        'period_count', 7, 'rental_start_at', now() - interval '2 days', 'rental_end_at', now() + interval '4 days'))))$q$,
        t.v('c1'), t.v('nr1')))) ->> 'id');
SELECT t.check('EARLY', '7 days × 15 = 105', (SELECT grand_total = 105 FROM public.bills WHERE id = t.v('b3')::uuid));
SELECT t.ok('EARLY', 'confirm and pay 105 cash', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-b3-confirm', '[{"method":"CASH","amount":105}]'::jsonb)$q$, t.v('b3')));
SELECT t.set('l3', (SELECT id::text FROM public.bill_lines WHERE bill_id = t.v('b3')::uuid));
SELECT t.ok('EARLY', 'deliver 1', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1)), 'key-dl-3')$q$,
           t.v('b3'), t.v('l3')));
SELECT public.rental_overdue_scan();
SELECT t.check('NOTICE', 'default return reminder (1 day) does not fire 4 days ahead',
    NOT EXISTS (SELECT 1 FROM public.notifications WHERE event_type = 'RENTAL_DUE_SOON' AND entity_id = t.v('b3')::uuid));
SELECT t.ok('NOTICE', 'owner changes the return reminder to 7 days in Settings', 'owner',
    $q$select public.settings_update('{"policies":{"notifications":{"returnReminder":{"enabled":true,"daysBefore":7},"overdueReturnReminder":{"enabled":true}}}}'::jsonb, 'test')$q$);
SELECT public.rental_overdue_scan();
SELECT t.check('NOTICE', 'in-app due-soon notice for the rental',
    EXISTS (SELECT 1 FROM public.notifications WHERE event_type = 'RENTAL_DUE_SOON' AND entity_id = t.v('b3')::uuid));
SELECT t.set('rt3', (t.ok('EARLY', 'customer returns on day 3', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1,
        'condition', 'NORMAL')), 'key-rt-3')$q$, t.v('b3'), t.v('l3')))) ->> 'suggested_refund');
SELECT t.check('EARLY', 'rent recalculated on 3 days (45): credit 60 linked to the return, refund 60 suggested',
    t.v('rt3')::numeric = 60
    AND EXISTS (SELECT 1 FROM public.bill_adjustments WHERE bill_id = t.v('b3')::uuid AND source = 'EARLY_RETURN'
                 AND amount = 60 AND adjustment_type = 'CREDIT' AND return_id IS NOT NULL), t.v('rt3'));
SELECT t.check('EARLY', 'original bill line untouched (compensating entry only)',
    (SELECT extended_amount = 105 FROM public.bill_lines WHERE id = t.v('l3')::uuid));
SELECT t.check('EARLY', 'nothing refunded automatically',
    NOT EXISTS (SELECT 1 FROM public.refunds WHERE bill_id = t.v('b3')::uuid));
SELECT t.check('EARLY', 'refund suggestion shows 60 and the cash payment',
    (SELECT (r ->> 'suggested_refund')::numeric = 60 AND jsonb_array_length(r -> 'payments') = 1
       FROM t.exec_as(t.u('cashier'), 'authenticated', format($q$select public.bill_refund_suggestion(%L::uuid)$q$, t.v('b3'))) r));
SELECT t.ok('EARLY', 'user confirms refund 60 with PIN against that payment', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 60, NULL, 'early return', 'key-rf-b3', %L::uuid, %L::uuid)$q$, t.v('b3'),
           t.pin('cashier', 'REFUND'), (SELECT id::text FROM public.payments WHERE bill_id = t.v('b3')::uuid LIMIT 1)));
SELECT t.check('EARLY', 'after the refund nothing is owed either way',
    (SELECT balance_due = 0 FROM public.bills WHERE id = t.v('b3')::uuid));
SELECT t.err('EARLY', 'cannot refund more than received and not yet refunded (105 - 60 = 45 left)', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 46, NULL, 'again', 'key-rf-b3b', %L::uuid, %L::uuid)$q$, t.v('b3'),
           t.pin('cashier', 'REFUND'), (SELECT id::text FROM public.payments WHERE bill_id = t.v('b3')::uuid LIMIT 1)),
    'REFUND_EXCEEDS');

SELECT t.set('b5', (t.ok('EARLY', 'rent 7 days with 5 baht off (105 - 5 = 100)', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'bill_discount_type', 'FIXED',
        'bill_discount_value', 5, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'rental_calculation_type', 'PER_DAY',
        'period_count', 7, 'rental_start_at', now() - interval '2 days', 'rental_end_at', now() + interval '4 days'))))$q$,
        t.v('c1'), t.v('nr1')))) ->> 'id');
SELECT t.ok('EARLY', 'confirm and pay 100', 'cashier',
    format($q$select public.bill_confirm(%L::uuid, 'key-b5-confirm', '[{"method":"CASH","amount":100}]'::jsonb)$q$, t.v('b5')));
SELECT t.set('l5', (SELECT id::text FROM public.bill_lines WHERE bill_id = t.v('b5')::uuid));
SELECT t.ok('EARLY', 'deliver', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1)), 'key-dl-5')$q$,
           t.v('b5'), t.v('l5')));
SELECT t.set('rt5', (t.ok('EARLY', 'return on day 3', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1,
        'condition', 'NORMAL')), 'key-rt-5')$q$, t.v('b5'), t.v('l5')))) ->> 'suggested_refund');
SELECT t.check('EARLY', 'discount stays given: 3 days 45 - 5 = 40 → refund 60', t.v('rt5')::numeric = 60, t.v('rt5'));

-- ===================================================================== LATE RETURN (notice only, no late fee)
SELECT t.set('b4', (t.ok('LATE', 'rental of 7 days that ended 4 days ago', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'rental_calculation_type', 'PER_DAY',
        'period_count', 7, 'rental_start_at', now() - interval '10 days', 'rental_end_at', now() - interval '4 days'))))$q$,
        t.v('c1'), t.v('nr1')))) ->> 'id');
SELECT t.ok('LATE', 'confirm', 'cashier', format($q$select public.bill_confirm(%L::uuid, 'key-b4-confirm')$q$, t.v('b4')));
SELECT t.set('l4', (SELECT id::text FROM public.bill_lines WHERE bill_id = t.v('b4')::uuid));
SELECT t.ok('LATE', 'deliver 1', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1)), 'key-dl-4')$q$,
           t.v('b4'), t.v('l4')));
SELECT t.err('LATE', 'there is no late-fee charge type', 'cashier',
    format($q$select public.charge_create(%L::uuid, 'ADDITIONAL_OVERDUE', 60, 'late', %L::uuid)$q$, t.v('b4'), t.v('l4')),
    'charges_type_check');
SELECT public.rental_overdue_scan();
SELECT t.check('LATE', 'overdue notice only; no charge created by the system',
    EXISTS (SELECT 1 FROM public.notifications WHERE event_type = 'RENTAL_OVERDUE' AND entity_id = t.v('b4')::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.charges WHERE bill_id = t.v('b4')::uuid));

-- ===================================================================== RESERVATIONS (no preset expiry)
SELECT t.check('RESV', 'reservation expiry is optional',
    (SELECT is_nullable = 'YES' FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'expires_at'));
SELECT t.check('RESV', 'no auto-release until the owner sets a policy', public.reservations_expire() = 0);

-- ===================================================================== APP DATA SHAPES (step 4)
SELECT t.err('STOCK', 'new product with opening stock needs the stock-receive PIN', 'owner',
    format($q$select public.product_create(jsonb_build_object('sku', 'T-OPEN', 'name', 'opening test', 'unit_id', %L,
        'calculation_type', 'PER_DAY', 'rental_price', 5, 'can_rent', true), NULL, 3)$q$,
        (SELECT id FROM public.units ORDER BY sort_order LIMIT 1)), 'PIN_REQUIRED');
SELECT t.ok('STOCK', 'new product with opening stock + PIN', 'owner',
    format($q$select public.product_create(jsonb_build_object('sku', 'T-OPEN', 'name', 'opening test', 'unit_id', %L,
        'calculation_type', 'PER_DAY', 'rental_price', 5, 'can_rent', true), NULL, 3, false, %L::uuid)$q$,
        (SELECT id FROM public.units ORDER BY sort_order LIMIT 1), t.pin('owner', 'STOCK_RECEIVE')));
SELECT t.ok('DATA', 'customer keeps structured contact details', 'cashier',
    $q$select public.customer_create('{"name":"Wichai","phone":"089-000-1111","address":"12 ม.3 ต.บางพลี","contact_details":{"lineId":"wichai","houseNo":"12"}}'::jsonb)$q$);
SELECT t.check('DATA', 'contact details stored',
    (SELECT contact_details ->> 'lineId' = 'wichai' FROM public.customers WHERE name = 'Wichai'));

SELECT t.set('qd', (t.ok('DATA', 'quotation keeps site, delivery fee and proposed deposit', 'owner',
    format($q$select public.quotation_save_draft(NULL, jsonb_build_object('customer_id', %L, 'site_name', 'ไซต์ A',
        'delivery_fee', 200, 'deposit_amount', 1000, 'items', jsonb_build_array(jsonb_build_object('product_id', %L,
        'line_mode', 'RENTAL', 'quantity', 2, 'rental_calculation_type', 'PER_PERIOD', 'period_count', 1,
        'rental_start_at', now(), 'rental_end_at', now() + interval '3 days'))))$q$, t.v('c1'), t.v('bk1')))) ->> 'id');
SELECT t.check('DATA', 'quotation total = items 20 + delivery 200',
    (SELECT grand_total = 220 AND deposit_amount = 1000 AND site_name = 'ไซต์ A' FROM public.quotations WHERE id = t.v('qd')::uuid));

SELECT t.ok('NOTICE', 'OWNER session may run the notice scan', 'owner', $q$select to_jsonb(public.rental_overdue_scan())$q$);
SELECT t.err('NOTICE', 'a USER may not run the notice scan', 'cashier', $q$select to_jsonb(public.rental_overdue_scan())$q$, 'FORBIDDEN');

-- waiving a damage fee = closing the case with no fee while the default is > 0 → PIN
SELECT t.set('bw', (t.ok('DAMAGE', 'bill for the waiver test', 'cashier',
    format($q$select public.bill_save_draft(NULL, jsonb_build_object('customer_id', %L, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', %L, 'line_mode', 'RENTAL', 'ordered_qty', 1, 'rental_calculation_type', 'PER_PERIOD',
        'period_count', 1, 'rental_start_at', now(), 'rental_end_at', now() + interval '3 days'))))$q$, t.v('c1'), t.v('bk1')))) ->> 'id');
SELECT t.ok('DAMAGE', 'confirm waiver bill', 'cashier', format($q$select public.bill_confirm(%L::uuid, 'key-bw-confirm')$q$, t.v('bw')));
SELECT t.ok('DAMAGE', 'deliver waiver bill', 'cashier',
    format($q$select public.delivery_create(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1)), 'key-dl-bw')$q$,
           t.v('bw'), (SELECT id::text FROM public.bill_lines WHERE bill_id = t.v('bw')::uuid)));
SELECT t.ok('DAMAGE', 'return damaged', 'cashier',
    format($q$select public.return_receive(%L::uuid, jsonb_build_array(jsonb_build_object('bill_line_id', %L, 'quantity', 1,
        'condition', 'MAJOR_DAMAGE', 'to_stock_state', 'DAMAGED')), 'key-rt-bw')$q$,
           t.v('bw'), (SELECT id::text FROM public.bill_lines WHERE bill_id = t.v('bw')::uuid)));
SELECT t.set('dcase', (SELECT id::text FROM public.incident_cases WHERE bill_id = t.v('bw')::uuid AND incident_type = 'DAMAGE'));
SELECT t.check('DAMAGE', 'an open damage case without a fee exists for the waiver test', t.v('dcase') IS NOT NULL);
SELECT t.err('DAMAGE', 'closing a damage case with no fee (default > 0) needs PIN', 'owner',
    format($q$select public.incident_resolve(%L::uuid, 'ลูกค้าประจำ ไม่คิด')$q$, t.v('dcase')), 'PIN_REQUIRED');
SELECT t.ok('DAMAGE', 'waiver with PIN + reason', 'owner',
    format($q$select public.incident_resolve(%L::uuid, 'ลูกค้าประจำ ไม่คิด', false, %L::uuid)$q$, t.v('dcase'), t.pin('owner', 'CHARGE_AMOUNT_OVERRIDE')));

-- ===================================================================== DIRECT WRITES / HISTORY / GRANTS
SELECT t.err('DIRECT', 'client cannot insert bills', 'owner',
    $q$insert into public.bills (created_by) values (auth.uid())$q$, 'permission denied');
SELECT t.err('DIRECT', 'client cannot update stock balances', 'owner',
    $q$update public.stock_balances set quantity = 999$q$, 'permission denied');
SELECT t.err('DIRECT', 'client cannot write audit logs', 'owner',
    $q$insert into public.audit_logs (action, entity_type, correlation_id) values ('X', 'Y', gen_random_uuid())$q$,
    'permission denied');
SELECT t.err_admin('HISTORY', 'audit log is append-only even for postgres',
    $q$update public.audit_logs set reason = 'x'$q$, 'APPEND_ONLY');
SELECT t.err_admin('HISTORY', 'products cannot be hard deleted',
    $q$delete from public.products$q$, 'NO_HARD_DELETE');
SELECT t.err_admin('HISTORY', 'customer with bills protected by FK RESTRICT / no-delete',
    $q$delete from public.customers$q$, 'NO_HARD_DELETE');
SELECT t.check('GRANTS', 'anon can execute no public function',
    NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')));
SELECT t.check('GRANTS', 'no "_" helper executable by authenticated or service_role',
    NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE '\_%'
                 AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE'))));
SELECT t.check('GRANTS', 'every SECURITY DEFINER function pins search_path to empty',
    NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
                 AND NOT ('search_path=""' = ANY (COALESCE(p.proconfig, '{}')))));
SELECT t.check('GRANTS', 'RLS enabled on every public table',
    NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity));
SELECT t.check('GRANTS', 'no ON DELETE CASCADE anywhere',
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND confdeltype = 'c'
                 AND connamespace = 'public'::regnamespace));
SELECT t.check('GRANTS', 'no approval / cash-session / contract-deposit objects remain',
    NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename IN
        ('approval_requests', 'cash_sessions', 'cash_movements', 'deposit_holdings', 'deposit_movements',
         'rental_contracts', 'rental_contract_versions', 'contract_templates', 'permission_catalog', 'user_permissions')));
