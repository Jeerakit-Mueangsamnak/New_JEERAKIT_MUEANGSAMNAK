-- Owner 2026-11-06: the deposit (เงินมัดจำ) of a bill.
--  1. A bill that still owes money and holds a deposit: the deposit pays it first; what the
--     charges are above the deposit is what the customer still pays.
--  2. What is left of the deposit is shown as the amount to give back on the payment screen.
--  3. A bill that is fully paid and fully returned does NOT close while a deposit is still held;
--     the deposit is given back from the payment screen, then the bill closes.
--
-- bill_deposit_apply : the deposit pays part / all of what the bill owes (one receipt, method
--                      OTHER, reference 'หักจากมัดจำ'); bills.deposit_amount goes down by the same.
-- bill_deposit_refund: the deposit (or part of it) is handed back; bills.deposit_amount goes down.
-- Both are one transaction each, idempotent, audited, and try to close the bill afterwards.
-- _bill_try_close: the only change is the deposit condition (deposit_amount > 0 keeps the bill
-- open); the rest is unchanged from 20261102090000. No data is changed by this migration.

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

    -- deposit_resolved (owner 2026-11-06): a deposit still held keeps the bill open
    IF v_bill.deposit_amount > 0 THEN
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
                          'auto close: financial, merchandise, deposit and exceptions resolved', NULL);
    RETURN true;
END;
$$;

-- The deposit pays what the bill owes (all or part). Returns the receipt like payment_receive.
CREATE OR REPLACE FUNCTION public.bill_deposit_apply(
    p_bill_id          uuid,
    p_amount           numeric,
    p_idempotency_key  text,
    p_received_on      date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem    record;
    v_bill    public.bills%ROWTYPE;
    v_receipt jsonb;
    v_corr    uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('bill_deposit_apply', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 'a', p_amount, 'on', p_received_on)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    PERFORM 1 FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._bill_recalculate(p_bill_id);
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 2) <> p_amount THEN
        RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
    END IF;
    IF p_amount > v_bill.deposit_amount THEN
        RAISE EXCEPTION 'DEPOSIT_EXCEEDED: deposit %', v_bill.deposit_amount USING ERRCODE = '23514';
    END IF;
    IF p_amount > v_bill.balance_due THEN
        RAISE EXCEPTION 'OVERPAYMENT: balance due %, received %', v_bill.balance_due, p_amount USING ERRCODE = '23514';
    END IF;

    v_receipt := public._payment_receive_core(p_bill_id,
        jsonb_build_array(jsonb_build_object('method', 'OTHER', 'amount', p_amount, 'reference', 'หักจากมัดจำ')),
        v_idem.key_id, v_corr, p_received_on);
    UPDATE public.bills
       SET deposit_amount = deposit_amount - p_amount,
           deposit_note = concat_ws(' | ', NULLIF(btrim(COALESCE(deposit_note, '')), ''),
                                    'หักค่าบริการจากมัดจำ ' || to_char(p_amount, 'FM999,999,990.00') || ' บาท ('
                                    || public._local_date(now()) || ')')
     WHERE id = p_bill_id;
    PERFORM public._audit('DEPOSIT_APPLY', 'BILL', p_bill_id,
                          jsonb_build_object('deposit_amount', v_bill.deposit_amount),
                          jsonb_build_object('deposit_amount', v_bill.deposit_amount - p_amount,
                                             'receipt_no', v_receipt ->> 'receipt_no'),
                          NULL, v_corr, false, p_amount, NULL, 'DEPOSIT');
    PERFORM public._bill_settle(p_bill_id);
    RETURN public._idempotency_finish(v_idem.key_id, v_receipt || jsonb_build_object('bill',
        (SELECT to_jsonb(b) FROM public.bills b WHERE b.id = p_bill_id)));
END;
$$;

-- The deposit (or part of it) is handed back to the customer.
CREATE OR REPLACE FUNCTION public.bill_deposit_refund(
    p_bill_id          uuid,
    p_amount           numeric,
    p_method           text,
    p_idempotency_key  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem record;
    v_bill public.bills%ROWTYPE;
    v_corr uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('bill_deposit_refund', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 'a', p_amount, 'm', p_method)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_bill.status IN ('DRAFT', 'CANCELLED', 'VOID') THEN
        RAISE EXCEPTION 'BILL_NOT_REFUNDABLE: %', v_bill.status USING ERRCODE = '23514';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 2) <> p_amount THEN
        RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
    END IF;
    IF p_amount > v_bill.deposit_amount THEN
        RAISE EXCEPTION 'DEPOSIT_EXCEEDED: deposit %', v_bill.deposit_amount USING ERRCODE = '23514';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('CASH', 'TRANSFER', 'QR', 'OTHER') THEN
        RAISE EXCEPTION 'INVALID_METHOD: %', p_method USING ERRCODE = '22023';
    END IF;

    UPDATE public.bills
       SET deposit_amount = deposit_amount - p_amount,
           deposit_note = concat_ws(' | ', NULLIF(btrim(COALESCE(deposit_note, '')), ''),
                                    'คืนมัดจำ ' || to_char(p_amount, 'FM999,999,990.00') || ' บาท ('
                                    || CASE p_method WHEN 'CASH' THEN 'เงินสด' WHEN 'QR' THEN 'QR Code'
                                            WHEN 'TRANSFER' THEN 'โอนเงิน' ELSE 'อื่น ๆ' END
                                    || ' ' || public._local_date(now()) || ')')
     WHERE id = p_bill_id;
    PERFORM public._audit('DEPOSIT_REFUND', 'BILL', p_bill_id,
                          jsonb_build_object('deposit_amount', v_bill.deposit_amount),
                          jsonb_build_object('deposit_amount', v_bill.deposit_amount - p_amount, 'method', p_method),
                          NULL, v_corr, false, p_amount, NULL, p_method);
    PERFORM public._bill_settle(p_bill_id);
    RETURN public._idempotency_finish(v_idem.key_id, jsonb_build_object(
        'refunded', p_amount, 'method', p_method,
        'bill', (SELECT to_jsonb(b) FROM public.bills b WHERE b.id = p_bill_id)));
END;
$$;

REVOKE ALL ON FUNCTION public.bill_deposit_apply(uuid, numeric, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bill_deposit_refund(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_deposit_apply(uuid, numeric, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bill_deposit_refund(uuid, numeric, text, text) TO authenticated;
