-- Rule tests for supabase/migrations/20261111120000_bill_movements_v1.sql (owner 2026-11-11):
-- the การเคลื่อนไหว of a bill is seen by everyone who works with bills, not only the OWNER;
-- audit_logs itself stays OWNER-only. Runs after 45_payment_allocation.sql (uses its bill 'mx').
\set ON_ERROR_STOP 1

SELECT t.check('MOVE', 'the cashier cannot read audit_logs directly (still OWNER-only)',
    (t.exec_as(t.u('cashier'), 'authenticated',
        format($q$select to_jsonb(count(*)) from public.audit_logs where entity_id = %L::uuid$q$, t.v('mx'))))::text = '0');
SELECT t.check('MOVE', 'the cashier reads the bill''s movements through bill_movements(): confirm + 3 payments, with names',
    (SELECT count(*) FILTER (WHERE m ->> 'action' = 'BILL_CONFIRM') = 1
            AND count(*) FILTER (WHERE m ->> 'action' = 'PAYMENT_ALLOCATE') = 3
            AND bool_and(COALESCE(m ->> 'actor_name', '') <> '')
       FROM jsonb_array_elements(t.exec_as(t.u('cashier'), 'authenticated',
            format($q$select COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.bill_movements(%L::uuid) r$q$, t.v('mx')))) m));
SELECT t.check('MOVE', 'oldest first',
    (SELECT bool_and(ok) FROM (
        SELECT (m ->> 'created_at')::timestamptz >= lag((m ->> 'created_at')::timestamptz) OVER (ORDER BY ord) IS NOT FALSE AS ok
          FROM jsonb_array_elements(t.exec_as(t.u('cashier'), 'authenticated',
               format($q$select COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.bill_movements(%L::uuid) r$q$, t.v('mx'))))
               WITH ORDINALITY AS x(m, ord)) s));
SELECT t.check('MOVE', 'anon cannot call it',
    NOT has_function_privilege('anon', 'public.bill_movements(uuid)', 'EXECUTE'));
