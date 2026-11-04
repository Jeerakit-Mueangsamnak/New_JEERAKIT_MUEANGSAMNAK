-- Owner 2026-11-02: a rental bill closes when everything is back and everything is paid —
-- late or not. Returning late no longer needs a separate "overdue reviewed" step before the
-- bill can close; extra time is charged only by recording a rental continuation (เช่าต่อ).
-- Only the overdue_reviewed_at condition is removed from exception_resolved; the rest of
-- _bill_try_close is unchanged from the baseline. No data is changed by this migration.
CREATE OR REPLACE FUNCTION public._bill_try_close(p_bill_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill public.bills%ROWTYPE;
BEGIN
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF v_bill.status <> 'ACTIVE' THEN
        RETURN false;
    END IF;

    -- merchandise_resolved
    IF EXISTS (
        SELECT 1 FROM public.bill_lines l
         WHERE l.bill_id = p_bill_id
           AND ((l.line_mode = 'RENTAL' AND (l.obligation_held_here > 0
                    OR (l.delivered_qty + l.carried_in_qty = 0 AND l.cancelled_qty < l.ordered_qty)))
             OR (l.line_mode = 'SALE' AND l.delivered_qty + l.cancelled_qty < l.ordered_qty))) THEN
        RETURN false;
    END IF;

    -- financial_resolved
    IF v_bill.balance_due <> 0
       OR EXISTS (SELECT 1 FROM public.payments p WHERE p.bill_id = p_bill_id AND p.status = 'PENDING') THEN
        RETURN false;
    END IF;

    -- exception_resolved
    IF EXISTS (SELECT 1 FROM public.incident_cases i
                WHERE i.bill_id = p_bill_id AND i.status NOT IN ('RESOLVED', 'REJECTED', 'FOUND'))
       OR EXISTS (SELECT 1 FROM public.charges c WHERE c.bill_id = p_bill_id AND c.status = 'PENDING') THEN
        RETURN false;
    END IF;

    UPDATE public.bills SET status = 'CLOSED', closed_at = now() WHERE id = p_bill_id;
    UPDATE public.bill_lines SET rental_status = 'CLOSED' WHERE bill_id = p_bill_id AND line_mode = 'RENTAL';
    PERFORM public._audit('BILL_CLOSE', 'BILL', p_bill_id, NULL, jsonb_build_object('status', 'CLOSED'),
                          'auto close: financial, merchandise and exceptions resolved', NULL);
    RETURN true;
END;
$$;
