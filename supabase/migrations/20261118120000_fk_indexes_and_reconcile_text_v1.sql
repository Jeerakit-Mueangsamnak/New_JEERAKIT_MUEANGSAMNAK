-- ============================================================================
-- Indexes for foreign keys used in lookups + reconcile wording (owner 2026-11-18, Supabase advisor review).
-- The advisor listed 92 foreign keys without an index. Most are "who did it" columns (created_by, voided_by …
-- → profiles): members are never deleted and nothing searches by them, so they are left as they are.
-- Indexed here: the links the system follows between bills / items / stock / documents / LINE, and the ones
-- checked before a product, category, unit or bill line may be deleted.
-- Tables are still small, so plain CREATE INDEX is quick (CONCURRENTLY cannot run inside the SQL Editor's block).
-- Nothing is deleted or changed in the data.
-- ============================================================================

-- bills and their lines
CREATE INDEX IF NOT EXISTS bills_quotation_id_idx                 ON public.bills (quotation_id);
CREATE INDEX IF NOT EXISTS bill_adjustments_bill_line_id_idx      ON public.bill_adjustments (bill_line_id);
CREATE INDEX IF NOT EXISTS bill_adjustments_return_id_idx         ON public.bill_adjustments (return_id);
CREATE INDEX IF NOT EXISTS charges_bill_line_id_idx               ON public.charges (bill_line_id);
CREATE INDEX IF NOT EXISTS finance_ledger_entries_bill_line_id_idx ON public.finance_ledger_entries (bill_line_id);
CREATE INDEX IF NOT EXISTS deliveries_appointment_id_idx          ON public.deliveries (appointment_id);

-- damage / missing items and write-offs
CREATE INDEX IF NOT EXISTS incident_cases_return_line_id_idx      ON public.incident_cases (return_line_id);
CREATE INDEX IF NOT EXISTS incident_cases_product_unit_id_idx     ON public.incident_cases (product_unit_id);
CREATE INDEX IF NOT EXISTS incident_cases_missing_case_id_idx     ON public.incident_cases (missing_case_id);
CREATE INDEX IF NOT EXISTS write_offs_incident_case_id_idx        ON public.write_offs (incident_case_id);
CREATE INDEX IF NOT EXISTS write_offs_charge_id_idx               ON public.write_offs (charge_id);

-- products and stock
CREATE INDEX IF NOT EXISTS products_category_id_idx               ON public.products (category_id);
CREATE INDEX IF NOT EXISTS products_unit_id_idx                   ON public.products (unit_id);
CREATE INDEX IF NOT EXISTS stock_movements_product_unit_id_idx    ON public.stock_movements (product_unit_id);
CREATE INDEX IF NOT EXISTS stock_count_lines_product_id_idx       ON public.stock_count_lines (product_id);
CREATE INDEX IF NOT EXISTS rental_carry_forwards_product_id_idx   ON public.rental_carry_forwards (product_id);

-- quotations and reservations turned into bills
CREATE INDEX IF NOT EXISTS quotation_items_product_id_idx         ON public.quotation_items (product_id);
CREATE INDEX IF NOT EXISTS quotations_converted_bill_id_idx       ON public.quotations (converted_bill_id);
CREATE INDEX IF NOT EXISTS reservations_converted_bill_id_idx     ON public.reservations (converted_bill_id);

-- LINE
CREATE INDEX IF NOT EXISTS line_deliveries_task_id_idx            ON public.line_deliveries (task_id);
CREATE INDEX IF NOT EXISTS line_messages_delivery_id_idx          ON public.line_messages (delivery_id);
CREATE INDEX IF NOT EXISTS line_contacts_register_customer_id_idx ON public.line_contacts (register_customer_id);

-- reconcile_stock_balances: open to every ACTIVE member since the owner's 2026-10-26 decision
-- (20261026200000_all_members_full_access_v1.sql, latest definition), but its refusal still said "OWNER only".
-- Only that text changes; who may run it and what it returns stay the same (it only reads).
CREATE OR REPLACE FUNCTION public.reconcile_stock_balances()
RETURNS TABLE (product_id uuid, stock_state text, cached numeric, ledger numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_active_member() THEN
        RAISE EXCEPTION 'FORBIDDEN: active member required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT COALESCE(b.product_id, m.product_id), COALESCE(b.stock_state, m.stock_state),
           COALESCE(b.quantity, 0)::numeric, COALESCE(m.total, 0)::numeric
      FROM public.stock_balances b
      FULL JOIN (SELECT sm.product_id, sm.stock_state, sum(sm.quantity_delta) AS total
                   FROM public.stock_movements sm GROUP BY sm.product_id, sm.stock_state) m
        ON m.product_id = b.product_id AND m.stock_state = b.stock_state
     WHERE COALESCE(b.quantity, 0) <> COALESCE(m.total, 0);
END;
$$;
