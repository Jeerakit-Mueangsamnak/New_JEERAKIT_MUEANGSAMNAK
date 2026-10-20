-- Rule tests for member action grants (migration 20261007131509_member_action_grants.sql):
-- menu -> action grant -> PIN, USER default DENY, OWNER full, only the OWNER grants, audited.
\set ON_ERROR_STOP 1

-- ===================================================================== GRANT / REVOKE
SELECT t.err('A-GRANT', 'a USER cannot grant actions to themself', 'cashier',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['REFUND'], 'me')$q$, t.u('cashier')), 'OWNER only');
SELECT t.err('A-GRANT', 'a USER cannot write the grants table directly', 'cashier',
    format($q$insert into public.member_action_grants (user_id, action_code, granted_by) values (%L::uuid, 'REFUND', %L::uuid)$q$,
           t.u('cashier'), t.u('owner')), 'permission denied');
SELECT t.err('A-GRANT', 'an OWNER has every action already', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['REFUND'], 'x')$q$, t.u('owner')), 'OWNER_HAS_ALL_ACTIONS');
SELECT t.err('A-GRANT', 'unknown action refused', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['DELETE_EVERYTHING'], 'x')$q$, t.u('cashier')), 'UNKNOWN_ACTION');
SELECT t.err('A-GRANT', 'a reason is required', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['REFUND'], '')$q$, t.u('cashier')), 'REASON');
SELECT t.ok('A-GRANT', 'owner revokes every action from the cashier', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY[]::text[], 'test revoke')$q$, t.u('cashier')));
SELECT t.check('A-GRANT', 'revoke is audited with before and after',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'MEMBER_ACTIONS_CHANGE' AND entity_id = t.u('cashier')
             AND reason = 'test revoke' AND jsonb_array_length(after_data -> 'actions') = 0
             AND jsonb_array_length(before_data -> 'actions') = 6));
SELECT t.check('A-GRANT', 'the cashier sees only their own grants (none)',
    (t.exec_as(t.u('cashier'), 'authenticated', $q$select to_jsonb(count(*)) from public.member_action_grants$q$))::text = '0');

-- ===================================================================== USER DEFAULT DENY (menu ok, no grant)
SELECT t.err('A-DENY', 'void refused without the grant', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'x', NULL)$q$, gen_random_uuid()), 'ACTION_NOT_GRANTED: BILL_VOID');
SELECT t.err('A-DENY', 'refund refused without the grant', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 1, 'CASH', 'x', 'key-act-rf-0', NULL, NULL)$q$, gen_random_uuid()), 'ACTION_NOT_GRANTED: REFUND');
SELECT t.err('A-DENY', 'cancelling a CONFIRMED bill needs the void grant', 'cashier',
    format($q$select public.bill_cancel(%L::uuid, 'x', NULL)$q$, t.v('vat_bill')), 'ACTION_NOT_GRANTED: BILL_VOID');
SELECT t.set('act_draft', (t.ok('A-DENY', 'a draft for the free cancel', 'cashier', t.draft('', '', NULL))) ->> 'id');
SELECT t.ok('A-DENY', 'a DRAFT still cancels freely (no grant, no PIN)', 'cashier',
    format($q$select public.bill_cancel(%L::uuid, 'not needed', NULL)$q$, t.v('act_draft')));
SELECT t.err('A-DENY', 'a grant without the menu does not open the action', 'nomenu',
    format($q$select public.refund_pay(%L::uuid, 1, 'CASH', 'x', 'key-act-rf-nm', NULL, NULL)$q$, gen_random_uuid()), 'menu');

-- ===================================================================== VOID / REFUND are separate
SELECT t.ok('A-SPLIT', 'owner grants REFUND only', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['REFUND'], 'refund only')$q$, t.u('cashier')));
SELECT t.err('A-SPLIT', 'REFUND granted: refund passes the grant and still asks the PIN', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 1, 'CASH', 'x', 'key-act-rf-1', NULL, NULL)$q$, t.v('b1')), 'PIN_REQUIRED');
SELECT t.err('A-SPLIT', 'REFUND granted: void is still refused', 'cashier',
    format($q$select public.bill_void(%L::uuid, 'x', NULL)$q$, gen_random_uuid()), 'ACTION_NOT_GRANTED: BILL_VOID');
SELECT t.ok('A-SPLIT', 'owner grants BILL_VOID only', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['BILL_VOID'], 'void only')$q$, t.u('cashier')));
SELECT t.err('A-SPLIT', 'BILL_VOID granted: refund is refused again', 'cashier',
    format($q$select public.refund_pay(%L::uuid, 1, 'CASH', 'x', 'key-act-rf-2', NULL, NULL)$q$, t.v('b1')), 'ACTION_NOT_GRANTED: REFUND');
SELECT t.err('A-SPLIT', 'BILL_VOID granted: cancelling a confirmed bill still asks the PIN', 'cashier',
    format($q$select public.bill_cancel(%L::uuid, 'x', NULL)$q$, t.v('vat_bill')), 'PIN_REQUIRED');
SELECT t.ok('A-SPLIT', 'menu + grant + PIN: the confirmed bill is cancelled', 'cashier',
    format($q$select public.bill_cancel(%L::uuid, 'customer changed mind', %L::uuid)$q$, t.v('vat_bill'), t.pin('cashier', 'BILL_CANCEL')));

-- ===================================================================== PRICE / STOCK are separate
SELECT t.ok('A-SPLIT', 'owner gives the cashier the products menu', 'owner',
    format($q$select public.owner_set_member_menus(%L::uuid, ARRAY['pos','bills','products'], 'test')$q$, t.u('cashier')));
SELECT t.ok('A-SPLIT', 'owner grants STOCK_ADJUST only', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['STOCK_ADJUST'], 'stock only')$q$, t.u('cashier')));
SELECT t.err('A-SPLIT', 'STOCK_ADJUST granted: main price change refused', 'cashier',
    format($q$select public.product_set_price(%L::uuid, NULL, 12, 'x', NULL)$q$, t.v('bk2')), 'ACTION_NOT_GRANTED: PRODUCT_PRICE_CHANGE');
SELECT t.err('A-SPLIT', 'STOCK_ADJUST granted: stock adjust passes the grant and asks the PIN', 'cashier',
    format($q$select public.stock_adjust(%L::uuid, 'AVAILABLE', 'INSPECTION', 1, 'x', 'key-act-adj', NULL)$q$, t.v('bk1')), 'PIN_REQUIRED');
SELECT t.ok('A-SPLIT', 'owner grants PRODUCT_PRICE_CHANGE only', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['PRODUCT_PRICE_CHANGE'], 'price only')$q$, t.u('cashier')));
SELECT t.err('A-SPLIT', 'PRODUCT_PRICE_CHANGE granted: stock adjust refused', 'cashier',
    format($q$select public.stock_adjust(%L::uuid, 'AVAILABLE', 'INSPECTION', 1, 'x', 'key-act-adj2', NULL)$q$, t.v('bk1')), 'ACTION_NOT_GRANTED: STOCK_ADJUST');
SELECT t.err('A-SPLIT', 'PRODUCT_PRICE_CHANGE granted: price change passes the grant and asks the PIN', 'cashier',
    format($q$select public.product_set_price(%L::uuid, NULL, 12, 'x', NULL)$q$, t.v('bk2')), 'PIN_REQUIRED');

-- ===================================================================== FINANCE actions
SELECT t.ok('A-FIN', 'owner revokes every action from the finance user', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY[]::text[], 'test')$q$, t.u('finance')));
SELECT t.err('A-FIN', 'expense refused without the grant', 'finance',
    $q$select public.expense_create('FUEL', 1, 'CASH', 'x', NULL)$q$, 'ACTION_NOT_GRANTED: EXPENSE');
SELECT t.err('A-FIN', 'write-off refused without the grant', 'finance',
    format($q$select public.write_off_record(%L::uuid, 1, 'x', NULL, NULL, NULL)$q$, gen_random_uuid()), 'ACTION_NOT_GRANTED: WRITE_OFF');

-- ===================================================================== OWNER full
SELECT t.err('A-OWNER', 'the OWNER needs no grant (only the PIN)', 'owner',
    format($q$select public.product_set_price(%L::uuid, NULL, 12, 'x', NULL)$q$, t.v('bk2')), 'PIN_REQUIRED');
SELECT t.err('A-OWNER', 'the OWNER needs no grant for refunds (only the PIN)', 'owner',
    format($q$select public.refund_pay(%L::uuid, 1, 'CASH', 'x', 'key-act-rf-o', NULL, NULL)$q$, t.v('b1')), 'PIN_REQUIRED');
