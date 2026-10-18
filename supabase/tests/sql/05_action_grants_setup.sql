-- Member action grants (migration 20261007b): a USER is denied the 6 risky actions until the
-- OWNER grants them. The v4.2 rule tests (10_*) were written for staff who may do these
-- actions, so the OWNER grants them here first; 30_action_grants.sql tests the grants themselves.
\set ON_ERROR_STOP 1
SELECT t.ok('ACT-SETUP', 'owner grants the risky actions to the cashier (test setup)', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['PRODUCT_PRICE_CHANGE','STOCK_ADJUST','BILL_VOID','REFUND','EXPENSE','WRITE_OFF'], 'test setup')$q$, t.u('cashier')));
SELECT t.ok('ACT-SETUP', 'owner grants the risky actions to the finance user (test setup)', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['PRODUCT_PRICE_CHANGE','STOCK_ADJUST','BILL_VOID','REFUND','EXPENSE','WRITE_OFF'], 'test setup')$q$, t.u('finance')));
