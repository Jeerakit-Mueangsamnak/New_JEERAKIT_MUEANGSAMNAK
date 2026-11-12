-- Owner 2026-11-12 ("จัดการงานให้ครบ"): the app now reads only what a screen shows.
-- 1) Indexes that match the reads the app makes (no data is changed).
-- 2) finance_statement_opening_balance: the money total before the statement window, so คงเหลือ
--    stays correct while the statement loads only the last 90 days (or the chosen start date).
-- Run once in the SQL Editor. Safe to run again (IF NOT EXISTS / OR REPLACE).

-- ─── 1. Indexes ─────────────────────────────────────────────────────────────

-- การเคลื่อนไหว of a bill (bill_movements): entity_id = bill OR after_data->>'bill_id' = bill
CREATE INDEX IF NOT EXISTS audit_logs_entity_id_idx ON public.audit_logs (entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_after_bill_id_idx ON public.audit_logs ((after_data ->> 'bill_id'));

-- Bills still in work (bills page / start-up), newest first
CREATE INDEX IF NOT EXISTS bills_open_created_idx ON public.bills (created_at DESC)
    WHERE status NOT IN ('CLOSED', 'CANCELLED', 'VOID');
-- Finished bills of a period (บิลที่ปิดแล้ว, reports)
CREATE INDEX IF NOT EXISTS bills_status_created_idx ON public.bills (status, created_at DESC);

-- Finance statement window (date >= start)
CREATE INDEX IF NOT EXISTS payments_received_at_idx ON public.payments (received_at);
CREATE INDEX IF NOT EXISTS refunds_paid_at_idx ON public.refunds (paid_at);
CREATE INDEX IF NOT EXISTS expense_entries_created_at_idx ON public.expense_entries (created_at);
CREATE INDEX IF NOT EXISTS other_income_entries_created_at_idx ON public.other_income_entries (created_at);

-- ─── 2. Opening balance of the statement ────────────────────────────────────
-- Same rows and signs as the statement (features/finance/api/finance-repository.ts):
-- + payments COMPLETED / REFUNDED, − refunds PAID, − expenses not VOIDED, + other income not VOIDED.
-- SECURITY INVOKER: the caller's own RLS applies (finance menu), nothing extra is exposed.
CREATE OR REPLACE FUNCTION public.finance_statement_opening_balance(p_before timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
          COALESCE((SELECT sum(p.amount) FROM public.payments p
                     WHERE p.status IN ('COMPLETED', 'REFUNDED') AND p.received_at < p_before), 0)
        - COALESCE((SELECT sum(r.amount) FROM public.refunds r
                     WHERE r.status = 'PAID' AND r.paid_at < p_before), 0)
        - COALESCE((SELECT sum(e.amount) FROM public.expense_entries e
                     WHERE e.status IS DISTINCT FROM 'VOIDED' AND e.created_at < p_before), 0)
        + COALESCE((SELECT sum(i.amount) FROM public.other_income_entries i
                     WHERE i.status IS DISTINCT FROM 'VOIDED' AND i.created_at < p_before), 0);
$$;

REVOKE ALL ON FUNCTION public.finance_statement_opening_balance(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_statement_opening_balance(timestamptz) TO authenticated;
