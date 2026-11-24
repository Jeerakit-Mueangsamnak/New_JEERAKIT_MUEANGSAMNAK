-- ============================================================================
-- ยกเลิกบิล undoes everything at once (owner 2026-11-19: "กดลบปุ้ปสต็อกคืน รายได้คืน ทุกอย่างคืน
-- เหมือนไม่มีไรเกิดขึ้น"). bill_void no longer asks for the return first; in one transaction it:
--   * gives the stock back: every stock movement the bill made (reserve, delivery, return, lost) is undone
--     with REVERSAL movements, so the goods count as never having left;
--   * hands goods carried in from an earlier bill (เช่าต่อ) back to that bill, and reopens it if it had closed;
--   * takes the money out: payments voided (their receipts too), refunds reversed, charges / adjustments /
--     write-offs and the bill's revenue reversed in the ledger;
--   * drops open damage / missing cases and cancels the bill's open appointments and LINE jobs.
-- Nothing is deleted: every step is a reversal record, audited once as BILL_VOID with a summary.
-- Still refused: a bill already continued into a later bill (that bill holds the goods now; void it first).
-- The bill stays in the list as ยกเลิก with its number; it counts in no total.
-- _line_recalculate: lines of a VOID / CANCELLED bill hold nothing (no "with the customer" quantity).
-- _bills_guard: a CLOSED bill may go back to ACTIVE only inside bill_void (app.bill_reopen, this transaction).
-- ============================================================================

-- Copy of the live _line_recalculate (20261111150000) plus the VOID / CANCELLED branch.
CREATE OR REPLACE FUNCTION public._line_recalculate(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_line         public.bill_lines%ROWTYPE;
    v_bill_status  text;
    v_delivered    numeric(12,3);
    v_carried_in   numeric(12,3);
    v_carried_fwd  numeric(12,3);
    v_returned     numeric(12,3);
    v_lost         numeric(12,3);
    v_last_return  timestamptz;
    v_held         numeric(12,3) := 0;
    v_return_st    text := 'NOT_RETURNED';
    v_rental_st    text := NULL;
    v_fulfil       text;
BEGIN
    SELECT * INTO v_line FROM public.bill_lines WHERE id = p_line_id FOR UPDATE;
    SELECT b.status INTO v_bill_status FROM public.bills b WHERE b.id = v_line.bill_id;

    SELECT COALESCE(sum(quantity), 0) INTO v_delivered FROM public.delivery_lines WHERE bill_line_id = p_line_id;
    SELECT COALESCE(sum(cf.quantity), 0) INTO v_carried_in
      FROM public.rental_carry_forwards cf
     WHERE cf.to_line_id = p_line_id
       AND NOT EXISTS (SELECT 1 FROM public.rental_carry_forward_reversals r WHERE r.carry_forward_id = cf.id);
    SELECT COALESCE(sum(cf.quantity), 0) INTO v_carried_fwd
      FROM public.rental_carry_forwards cf
     WHERE cf.from_line_id = p_line_id
       AND NOT EXISTS (SELECT 1 FROM public.rental_carry_forward_reversals r WHERE r.carry_forward_id = cf.id);
    SELECT COALESCE(sum(rl.quantity), 0), max(r.returned_at) INTO v_returned, v_last_return
      FROM public.return_lines rl JOIN public.returns r ON r.id = rl.return_id
     WHERE rl.bill_line_id = p_line_id;
    SELECT COALESCE(sum(quantity), 0) INTO v_lost
      FROM public.incident_cases
     WHERE bill_line_id = p_line_id AND incident_type = 'LOST' AND status IN ('CONFIRMED', 'RESOLVED');
    -- รายการนอกร้าน (owner 2026-11-11): no stock, no delivery, no return. Once the bill is issued it
    -- counts as handed over, so the bill can close on money alone.
    IF v_line.product_id IS NULL THEN
        v_delivered := CASE WHEN v_bill_status IN ('CONFIRMED', 'ACTIVE', 'CLOSED')
                            THEN v_line.ordered_qty - v_line.cancelled_qty ELSE 0 END;
    END IF;

    IF v_line.line_mode = 'RENTAL' THEN
        -- obligation_held_here = delivered + carried_in − resolved − carried_forward (CHECK ≥ 0)
        v_held := v_delivered + v_carried_in - (v_returned + v_lost + v_line.approved_disposition_qty) - v_carried_fwd;
        IF v_line.product_id IS NULL THEN
            v_held := 0;
        END IF;
        v_return_st := CASE
            WHEN v_returned = 0 THEN 'NOT_RETURNED'
            WHEN v_held = 0 THEN 'RETURNED'
            ELSE 'PARTIALLY_RETURNED' END;
        v_rental_st := CASE
            WHEN v_bill_status = 'CLOSED' THEN 'CLOSED'
            WHEN v_delivered + v_carried_in = 0 THEN 'SCHEDULED'
            WHEN v_held > 0 AND now() > v_line.rental_end_at THEN 'OVERDUE'
            WHEN v_held > 0 THEN 'ACTIVE'
            WHEN v_lost > 0 OR v_carried_fwd > 0 THEN 'RESOLVED'
            ELSE 'RETURNED' END;
        IF v_line.product_id IS NULL THEN
            v_return_st := 'RETURNED';
            v_rental_st := CASE WHEN v_bill_status = 'CLOSED' THEN 'CLOSED'
                                WHEN v_delivered = 0 THEN 'SCHEDULED' ELSE 'RESOLVED' END;
        END IF;
        -- ยกเลิกบิล (owner 2026-11-19): a voided / cancelled bill holds nothing; its stock was given back.
        IF v_bill_status IN ('VOID', 'CANCELLED') THEN
            v_held := 0;
            v_return_st := CASE WHEN v_delivered + v_carried_in > 0 THEN 'RETURNED' ELSE 'NOT_RETURNED' END;
            v_rental_st := CASE WHEN v_delivered + v_carried_in > 0 THEN 'RESOLVED' ELSE 'SCHEDULED' END;
        END IF;
        v_fulfil := CASE
            WHEN v_line.cancelled_qty >= v_line.ordered_qty THEN 'CANCELLED'
            WHEN v_held > 0 THEN 'RENTED_OUT'
            WHEN v_delivered + v_carried_in + v_line.cancelled_qty >= v_line.ordered_qty THEN 'DELIVERED'
            WHEN v_delivered + v_carried_in > 0 THEN 'PARTIALLY_DELIVERED'
            WHEN v_line.backorder_qty > 0 THEN 'BACKORDER'
            WHEN v_line.allocated_qty > 0 THEN 'RESERVED'
            ELSE 'PENDING' END;
    ELSE
        v_fulfil := CASE
            WHEN v_line.cancelled_qty >= v_line.ordered_qty THEN 'CANCELLED'
            WHEN v_delivered + v_line.cancelled_qty >= v_line.ordered_qty THEN 'DELIVERED'
            WHEN v_delivered > 0 THEN 'PARTIALLY_DELIVERED'
            WHEN v_line.backorder_qty > 0 THEN 'BACKORDER'
            WHEN v_line.allocated_qty > 0 THEN 'RESERVED'
            ELSE 'PENDING' END;
    END IF;

    UPDATE public.bill_lines
       SET delivered_qty = v_delivered,
           carried_in_qty = v_carried_in,
           physical_returned_qty = v_returned,
           approved_lost_qty = v_lost,
           carried_forward_qty = v_carried_fwd,
           obligation_held_here = v_held,
           return_status = v_return_st,
           rental_status = v_rental_st,
           fulfillment_status = v_fulfil,
           actual_return_at = CASE WHEN v_line.line_mode = 'RENTAL' THEN v_last_return END
     WHERE id = p_line_id;
END;
$function$;

-- Copy of the live _bills_guard plus CLOSED → ACTIVE inside bill_void only (a parent bill gets its goods back).
CREATE OR REPLACE FUNCTION public._bills_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    IF OLD.bill_no IS NOT NULL AND NEW.bill_no IS DISTINCT FROM OLD.bill_no THEN
        RAISE EXCEPTION 'BILL_NO_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    IF (NEW.parent_bill_id, NEW.original_bill_id, NEW.created_at, NEW.created_by)
       IS DISTINCT FROM (OLD.parent_bill_id, OLD.original_bill_id, OLD.created_at, OLD.created_by) THEN
        RAISE EXCEPTION 'BILL_LINEAGE_IMMUTABLE' USING ERRCODE = '42501';
    END IF;

    IF OLD.status <> 'DRAFT' AND NOT public._bill_revising() THEN
        -- deposit_amount / deposit_note stay editable through bill_correct (PIN + audit).
        IF (NEW.customer_id, NEW.quotation_id, NEW.vat_enabled, NEW.vat_mode,
            NEW.pricing_snapshot, NEW.bill_discount_type, NEW.bill_discount_value, NEW.delivery_fee,
            NEW.installation_fee, NEW.service_fee, NEW.sale_subtotal, NEW.rental_subtotal,
            NEW.bill_discount_amount, NEW.taxable_amount, NEW.vat_amount, NEW.grand_total,
            NEW.continuation_start_mode, NEW.continuation_reason, NEW.confirmed_at, NEW.confirmed_by)
           IS DISTINCT FROM
           (OLD.customer_id, OLD.quotation_id, OLD.vat_enabled, OLD.vat_mode,
            OLD.pricing_snapshot, OLD.bill_discount_type, OLD.bill_discount_value, OLD.delivery_fee,
            OLD.installation_fee, OLD.service_fee, OLD.sale_subtotal, OLD.rental_subtotal,
            OLD.bill_discount_amount, OLD.taxable_amount, OLD.vat_amount, OLD.grand_total,
            OLD.continuation_start_mode, OLD.continuation_reason, OLD.confirmed_at, OLD.confirmed_by) THEN
            RAISE EXCEPTION 'BILL_TERMS_IMMUTABLE_AFTER_CONFIRM: use adjustment / reversal / continuation'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'DRAFT' AND NEW.status IN ('CONFIRMED', 'CANCELLED'))
        OR (OLD.status = 'CONFIRMED' AND NEW.status IN ('ACTIVE', 'CANCELLED', 'VOID'))
        OR (OLD.status = 'ACTIVE' AND NEW.status IN ('CLOSED', 'VOID'))
        OR (OLD.status = 'CLOSED' AND NEW.status = 'ACTIVE'
            AND COALESCE(current_setting('app.bill_reopen', true), '') = 'on')) THEN
        RAISE EXCEPTION 'BILL_STATUS_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bill_void(p_bill_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill      public.bills%ROWTYPE;
    v_reason    text;
    v_corr      uuid := gen_random_uuid();
    v_id        uuid;
    v_parents   uuid[];
    v_mv        record;
    v_bal       numeric;
    v_qty       numeric;
    v_moved     integer := 0;
    v_short     jsonb := '[]'::jsonb;
    v_unit      uuid;
    v_dep       numeric(14,2);
    v_paid      numeric(14,2) := 0;
    v_refunded  numeric(14,2) := 0;
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM public._require_action('BILL_VOID');
    PERFORM public._require_pin(p_pin_token, 'BILL_VOID');

    -- Earlier bills this one continues (เช่าต่อ) are locked first: the lineage order used by reverse_carry_forward.
    SELECT array_agg(DISTINCT cf.from_bill_id) INTO v_parents
      FROM public.rental_carry_forwards cf
     WHERE cf.to_bill_id = p_bill_id
       AND NOT EXISTS (SELECT 1 FROM public.rental_carry_forward_reversals r WHERE r.carry_forward_id = cf.id);
    PERFORM 1 FROM public.bills WHERE id = ANY (COALESCE(v_parents, '{}')) ORDER BY id FOR UPDATE;

    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_VOIDABLE' USING ERRCODE = '23514';
    END IF;
    v_reason := public._bill_void_check(v_bill, p_reason);

    -- A later bill continues this one: that bill holds the goods now.
    IF EXISTS (SELECT 1 FROM public.rental_carry_forwards cf
                WHERE cf.from_bill_id = p_bill_id
                  AND NOT EXISTS (SELECT 1 FROM public.rental_carry_forward_reversals r WHERE r.carry_forward_id = cf.id)) THEN
        RAISE EXCEPTION 'BILL_HAS_CONTINUATION: void the later bill first' USING ERRCODE = '23514';
    END IF;

    -- 1. Goods carried in from an earlier bill go back to it.
    INSERT INTO public.rental_carry_forward_reversals (carry_forward_id, reason, correlation_id, created_by)
    SELECT cf.id, v_reason, v_corr, auth.uid()
      FROM public.rental_carry_forwards cf
     WHERE cf.to_bill_id = p_bill_id
       AND NOT EXISTS (SELECT 1 FROM public.rental_carry_forward_reversals r WHERE r.carry_forward_id = cf.id);

    -- 2. Stock: reserved goods are released, then every other stock change the bill made is undone.
    PERFORM public._bill_release_allocation(p_bill_id, v_corr);
    FOR v_mv IN
        WITH src AS (
            SELECT 'BILL_LINE'::text AS source_type, l.id AS source_id, l.id AS line_id
              FROM public.bill_lines l WHERE l.bill_id = p_bill_id
            UNION ALL
            SELECT 'DELIVERY_LINE', dl.id, dl.bill_line_id
              FROM public.delivery_lines dl JOIN public.bill_lines l ON l.id = dl.bill_line_id
             WHERE l.bill_id = p_bill_id
            UNION ALL
            SELECT 'RETURN_LINE', rl.id, rl.bill_line_id
              FROM public.return_lines rl JOIN public.bill_lines l ON l.id = rl.bill_line_id
             WHERE l.bill_id = p_bill_id
            UNION ALL
            SELECT 'INCIDENT', ic.id, ic.bill_line_id
              FROM public.incident_cases ic WHERE ic.bill_id = p_bill_id
        )
        SELECT src.line_id, m.product_id, m.stock_state, sum(m.quantity_delta) AS qty
          FROM public.stock_movements m
          JOIN src ON src.source_type = m.source_type AND src.source_id = m.source_id
         WHERE m.stock_state <> 'AVAILABLE'
         GROUP BY src.line_id, m.product_id, m.stock_state
        HAVING sum(m.quantity_delta) <> 0
         ORDER BY m.product_id, src.line_id, m.stock_state
    LOOP
        IF v_mv.qty > 0 THEN
            -- Goods the bill moved out of the shelf (rented, sold, lost, waiting inspection) come back.
            SELECT quantity INTO v_bal FROM public.stock_balances
             WHERE product_id = v_mv.product_id AND stock_state = v_mv.stock_state FOR UPDATE;
            v_qty := least(v_mv.qty, COALESCE(v_bal, 0));
            IF v_qty > 0 THEN
                PERFORM public._stock_move(v_mv.product_id, v_mv.stock_state, 'AVAILABLE', v_qty, 'REVERSAL',
                                           'BILL_LINE', v_mv.line_id, NULL, v_reason, v_corr);
                v_moved := v_moved + 1;
            END IF;
        ELSE
            -- Goods carried in and returned here go back out with the earlier bill.
            SELECT quantity INTO v_bal FROM public.stock_balances
             WHERE product_id = v_mv.product_id AND stock_state = 'AVAILABLE' FOR UPDATE;
            v_qty := least(-v_mv.qty, COALESCE(v_bal, 0));
            IF v_qty > 0 THEN
                PERFORM public._stock_move(v_mv.product_id, 'AVAILABLE', v_mv.stock_state, v_qty, 'REVERSAL',
                                           'BILL_LINE', v_mv.line_id, NULL, v_reason, v_corr);
                v_moved := v_moved + 1;
            END IF;
        END IF;
        -- Already moved elsewhere by a stock adjustment / repair: nothing left to take back; kept in the audit.
        IF v_qty < abs(v_mv.qty) THEN
            v_short := v_short || jsonb_build_object('product_id', v_mv.product_id, 'stock_state', v_mv.stock_state,
                                                     'quantity', abs(v_mv.qty) - greatest(v_qty, 0));
        END IF;
    END LOOP;

    -- Serial-numbered pieces the bill sent out (and still last handled by it) are back in stock;
    -- pieces carried in from the earlier bill are with the customer under that bill again.
    FOR v_unit IN
        SELECT DISTINCT dl.product_unit_id
          FROM public.delivery_lines dl JOIN public.bill_lines l ON l.id = dl.bill_line_id
         WHERE l.bill_id = p_bill_id AND dl.product_unit_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.delivery_lines d2 JOIN public.bill_lines l2 ON l2.id = d2.bill_line_id
                            WHERE d2.product_unit_id = dl.product_unit_id AND l2.bill_id <> p_bill_id
                              AND d2.created_at > dl.created_at)
    LOOP
        UPDATE public.product_units SET unit_state = 'IN_STOCK'
         WHERE id = v_unit AND unit_state IN ('RENTED_OUT', 'SOLD', 'INSPECTION', 'REPAIR', 'DAMAGED', 'LOST');
    END LOOP;
    UPDATE public.product_units pu SET unit_state = 'RENTED_OUT'
      FROM public.rental_carry_forward_units cu
      JOIN public.rental_carry_forwards cf ON cf.id = cu.carry_forward_id
      JOIN public.rental_carry_forward_reversals rv ON rv.carry_forward_id = cf.id AND rv.correlation_id = v_corr
     WHERE pu.id = cu.product_unit_id AND pu.unit_state <> 'RENTED_OUT';

    -- 3. Money: refunds, then payments (with their receipts and deposit part), then charges and revenue.
    FOR v_id IN SELECT id FROM public.refunds WHERE bill_id = p_bill_id AND status = 'PAID' ORDER BY created_at, id FOR UPDATE LOOP
        UPDATE public.refunds SET status = 'REVERSED' WHERE id = v_id RETURNING amount INTO v_dep;
        v_refunded := v_refunded + v_dep;
        PERFORM public._ledger_reverse_source('REFUND', v_id, v_corr);
    END LOOP;
    SELECT COALESCE(sum(amount), 0) INTO v_paid
      FROM public.payments WHERE bill_id = p_bill_id AND status = 'COMPLETED';
    UPDATE public.payments SET status = 'VOIDED', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
     WHERE bill_id = p_bill_id AND status IN ('COMPLETED', 'PENDING');
    WITH voided AS (
        UPDATE public.bill_payment_allocations SET voided_at = now()
         WHERE bill_id = p_bill_id AND voided_at IS NULL
        RETURNING deposit_amount)
    SELECT COALESCE(sum(deposit_amount), 0) INTO v_dep FROM voided;
    IF v_dep > 0 THEN
        UPDATE public.bills SET deposit_unpaid = least(deposit_amount, deposit_unpaid + v_dep) WHERE id = p_bill_id;
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
    FOR v_id IN SELECT id FROM public.write_offs WHERE bill_id = p_bill_id ORDER BY created_at, id LOOP
        PERFORM public._ledger_reverse_source('WRITE_OFF', v_id, v_corr);
    END LOOP;
    PERFORM public._ledger_reverse_source('BILL_CONFIRM', p_bill_id, v_corr);

    -- 4. Open cases, appointments and LINE jobs of the bill end with it.
    UPDATE public.incident_cases SET status = 'REJECTED', reason = COALESCE(reason, v_reason)
     WHERE bill_id = p_bill_id AND status IN ('OPEN', 'UNDER_INSPECTION', 'ASSESSED');
    UPDATE public.appointments SET status = 'CANCELLED', cancel_reason = v_reason, cancelled_by = auth.uid(),
                                   cancelled_at = now()
     WHERE bill_id = p_bill_id AND status IN ('DRAFT', 'SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'RESCHEDULED');
    UPDATE public.line_tasks SET status = 'CANCELLED', cancel_reason = v_reason, cancelled_by = auth.uid(),
                                 cancelled_at = now()
     WHERE bill_id = p_bill_id AND status IN ('SENT', 'ACCEPTED');

    UPDATE public.bills SET status = 'VOID', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
     WHERE id = p_bill_id;
    PERFORM public._bill_recalculate(p_bill_id);

    -- 5. The earlier bills hold their goods again: a closed one opens again.
    IF v_parents IS NOT NULL THEN
        PERFORM set_config('app.bill_reopen', 'on', true);
        FOR v_id IN SELECT unnest(v_parents) LOOP
            PERFORM public._bill_recalculate(v_id);
            UPDATE public.bills b SET status = 'ACTIVE', closed_at = NULL
             WHERE b.id = v_id AND b.status = 'CLOSED'
               AND EXISTS (SELECT 1 FROM public.bill_lines l WHERE l.bill_id = v_id AND l.obligation_held_here > 0);
            PERFORM public._bill_settle(v_id);
        END LOOP;
        PERFORM set_config('app.bill_reopen', 'off', true);
    END IF;

    PERFORM public._audit('BILL_VOID', 'BILL', p_bill_id, jsonb_build_object('status', v_bill.status),
                          jsonb_build_object('status', 'VOID', 'stock_reversed', v_moved, 'stock_not_found', v_short,
                                             'payments_voided', v_paid, 'refunds_reversed', v_refunded,
                                             'parent_bills', to_jsonb(v_parents)),
                          v_reason, v_corr, true, v_bill.grand_total);
    RETURN jsonb_build_object('bill_id', p_bill_id, 'status', 'VOID');
END;
$$;
