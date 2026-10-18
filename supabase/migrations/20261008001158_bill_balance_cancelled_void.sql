-- Bill balance for CANCELLED / VOID bills (local test finding 2026-10-08).
-- Before: _bill_recalculate always used grand_total + charges + adjustments as the amount due, so a
-- cancelled bill showed its full total as still owed (e.g. CANCELLED, balance_due 10.70, UNPAID) and a
-- VOID bill hid the money to give back (paid 20 → balance 0, refund suggestion 0).
-- After: a CANCELLED / VOID bill owes nothing; balance_due = -(paid - refunded), i.e. 0 when no money
-- is held and negative (refund due) when it is. Only the balance branch changes; signature,
-- SECURITY DEFINER, search_path, privileges and every other step are kept as in the baseline
-- (plus: a cancelled / void bill with no money stays UNPAID, as before, instead of reading PAID at 0).
-- Payments, refunds, ledger and audit rows are not touched.

CREATE OR REPLACE FUNCTION public._bill_recalculate(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill       public.bills%ROWTYPE;
    v_line_id    uuid;
    v_paid       numeric(14,2);
    v_refunded   numeric(14,2);
    v_adj        numeric(14,2);
    v_charges    numeric(14,2);
    v_write_off  numeric(14,2);
    v_due        numeric(14,2);
    v_balance    numeric(14,2);
    v_status     text;
BEGIN
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    FOR v_line_id IN SELECT id FROM public.bill_lines WHERE bill_id = p_bill_id ORDER BY line_no LOOP
        PERFORM public._line_recalculate(v_line_id);
    END LOOP;

    SELECT COALESCE(sum(amount), 0) INTO v_paid
      FROM public.payments WHERE bill_id = p_bill_id AND status IN ('COMPLETED', 'REFUNDED');
    SELECT COALESCE(sum(amount), 0) INTO v_refunded
      FROM public.refunds WHERE bill_id = p_bill_id AND status = 'PAID';
    SELECT COALESCE(sum(CASE adjustment_type WHEN 'DEBIT' THEN amount ELSE -amount END), 0) INTO v_adj
      FROM public.bill_adjustments WHERE bill_id = p_bill_id;
    SELECT COALESCE(sum(amount), 0) INTO v_charges
      FROM public.charges WHERE bill_id = p_bill_id AND status = 'CONFIRMED';
    SELECT COALESCE(sum(amount), 0) INTO v_write_off FROM public.write_offs WHERE bill_id = p_bill_id;

    IF v_bill.status IN ('CANCELLED', 'VOID') THEN
        -- No receivable any more (revenue, charges and adjustments were reversed or never posted).
        -- Money still held is owed back: balance_due < 0 drives the refund suggestion (Master §20).
        v_due := 0;
        v_balance := -(v_paid - v_refunded);
    ELSE
        v_due := v_bill.grand_total + v_charges + v_adj;
        v_balance := v_due - (v_paid - v_refunded) - v_write_off;
    END IF;
    v_status := CASE
        WHEN v_bill.status IN ('CANCELLED', 'VOID') AND v_paid = 0 THEN 'UNPAID'   -- as before: never shown PAID
        WHEN v_refunded > 0 AND v_paid - v_refunded <= 0 THEN 'REFUNDED'
        WHEN v_refunded > 0 THEN 'PARTIALLY_REFUNDED'
        WHEN v_balance <= 0 AND (v_paid > 0 OR v_due <= 0) THEN 'PAID'
        WHEN v_paid = 0 THEN 'UNPAID'
        ELSE 'PARTIALLY_PAID' END;

    UPDATE public.bills
       SET paid_amount = v_paid,
           refunded_amount = v_refunded,
           adjustment_net = v_adj,
           charge_total = v_charges,
           write_off_total = v_write_off,
           balance_due = v_balance,
           payment_status = v_status,
           status = CASE
               WHEN status = 'CONFIRMED' AND (v_paid > 0 OR EXISTS (
                        SELECT 1 FROM public.bill_lines l
                         WHERE l.bill_id = p_bill_id AND (l.delivered_qty > 0 OR l.carried_in_qty > 0)))
               THEN 'ACTIVE' ELSE status END
     WHERE id = p_bill_id;
END;
$$;

-- Bring the cached columns of existing CANCELLED / VOID bills in line (cached bill columns only).
DO $$
DECLARE
    v_id uuid;
BEGIN
    FOR v_id IN SELECT id FROM public.bills WHERE status IN ('CANCELLED', 'VOID') ORDER BY id LOOP
        PERFORM public._bill_recalculate(v_id);
    END LOOP;
END;
$$;
