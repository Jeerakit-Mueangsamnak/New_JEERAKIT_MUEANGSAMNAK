-- bill_void reverses write-offs (local test finding 2026-10-08).
-- Before: voiding a bill reversed its revenue, charges and adjustments but not its write-offs, so a bill
-- written off 40 and then voided still showed a 40 bad-debt loss in the ledger.
-- After: the same void, in the same transaction, adds one REVERSAL entry per write-off ledger entry
-- (_ledger_reverse_source, the pattern already used for CHARGE / ADJUSTMENT / BILL_CONFIRM;
-- reverses_entry_id is UNIQUE, so nothing is reversed twice). Nothing is deleted or edited.
-- Body = 20261007131509_member_action_grants.sql version + the write-off loop; signature,
-- SECURITY DEFINER, search_path and grants (CREATE OR REPLACE keeps them) are unchanged.
-- Existing VOID bills with write-offs are not touched here (none exist on Cloud as of 2026-10-08).

CREATE OR REPLACE FUNCTION public.bill_void(p_bill_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill   public.bills%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
    v_id     uuid;
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM public._require_action('BILL_VOID');
    PERFORM public._require_pin(p_pin_token, 'BILL_VOID');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_VOIDABLE' USING ERRCODE = '23514';
    END IF;
    PERFORM public._bill_recalculate(p_bill_id);

    IF EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND line_mode = 'RENTAL' AND obligation_held_here > 0) THEN
        RAISE EXCEPTION 'ITEMS_STILL_WITH_CUSTOMER: receive the return first' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND line_mode = 'SALE' AND delivered_qty > 0) THEN
        RAISE EXCEPTION 'SALE_ALREADY_DELIVERED: sale returns are not supported by this baseline' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rental_carry_forwards cf
                WHERE (cf.from_bill_id = p_bill_id OR cf.to_bill_id = p_bill_id)
                  AND NOT EXISTS (SELECT 1 FROM public.rental_carry_forward_reversals r WHERE r.carry_forward_id = cf.id)) THEN
        RAISE EXCEPTION 'CARRY_FORWARD_ACTIVE: reverse_carry_forward first' USING ERRCODE = '23514';
    END IF;

    FOR v_id IN SELECT id FROM public.charges WHERE bill_id = p_bill_id AND status = 'CONFIRMED' FOR UPDATE LOOP
        PERFORM public._ledger_reverse_source('CHARGE', v_id, v_corr);
        UPDATE public.charges SET status = 'REVERSED', cancelled_by = auth.uid(), cancelled_at = now(),
                                  cancel_reason = v_reason WHERE id = v_id;
    END LOOP;
    UPDATE public.charges SET status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
     WHERE bill_id = p_bill_id AND status = 'PENDING';
    FOR v_id IN SELECT id FROM public.bill_adjustments WHERE bill_id = p_bill_id LOOP
        PERFORM public._ledger_reverse_source('ADJUSTMENT', v_id, v_corr);
    END LOOP;
    -- A void bill keeps no bad-debt loss: each write-off gets a REVERSAL entry pointing at it
    -- (the write-off row and its original entry stay as history).
    FOR v_id IN SELECT id FROM public.write_offs WHERE bill_id = p_bill_id ORDER BY created_at, id LOOP
        PERFORM public._ledger_reverse_source('WRITE_OFF', v_id, v_corr);
    END LOOP;
    PERFORM public._bill_release_allocation(p_bill_id, v_corr);
    PERFORM public._ledger_reverse_source('BILL_CONFIRM', p_bill_id, v_corr);

    UPDATE public.bills SET status = 'VOID', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
     WHERE id = p_bill_id;
    PERFORM public._bill_recalculate(p_bill_id);
    PERFORM public._audit('BILL_VOID', 'BILL', p_bill_id, jsonb_build_object('status', v_bill.status),
                          jsonb_build_object('status', 'VOID'), v_reason, v_corr, true, v_bill.grand_total);
    RETURN jsonb_build_object('bill_id', p_bill_id, 'status', 'VOID');
END;
$$;
