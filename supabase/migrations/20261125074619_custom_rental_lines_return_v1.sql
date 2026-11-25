-- ============================================================================
-- รายการนอกร้าน ที่เป็นเช่า ต้องตรวจรับคืน (owner 2026-11-25: "ให้เป็นการเช็คของคืนด้วย ตรวจคืนแล้วจบ
-- ไม่ต้องคืนสต็อก"). Before, a typed-in rental line counted as returned the moment the bill was issued.
-- Now:
--   * it is with the customer (obligation_held_here) until it is checked back, lost, or continued (เช่าต่อ);
--     overdue / return reminders and the bill's auto-close see it like any rental line;
--   * checking it back (return_receive), recording it lost (lost_record) and taking it off the bill (แก้ไขบิล)
--     move no stock — there is no shop product;
--   * เช่าต่อ carries it to the new bill with its name and unit (rental_carry_forwards.product_id may be empty);
--   * typed-in sale lines are unchanged (handed over at issue, nothing to return).
-- Open bills (CONFIRMED / ACTIVE) with typed-in rental lines are recalculated once at the end:
-- those lines go back to "with the customer". Closed and voided bills are not touched.
-- ============================================================================

ALTER TABLE public.rental_carry_forwards ALTER COLUMN product_id DROP NOT NULL;

-- Copy of the live _line_recalculate (20261119154921): a typed-in rental line is held until it comes back.
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
    -- รายการนอกร้าน: no stock and no delivery; once the bill is issued it counts as handed over
    -- (what came in from an earlier bill by เช่าต่อ is carried in, not handed over again).
    -- A rental one is with the customer until it is checked back (owner 2026-11-25).
    IF v_line.product_id IS NULL THEN
        v_delivered := CASE WHEN v_bill_status IN ('CONFIRMED', 'ACTIVE', 'CLOSED')
                            THEN greatest(v_line.ordered_qty - v_line.cancelled_qty - v_carried_in, 0) ELSE 0 END;
    END IF;

    IF v_line.line_mode = 'RENTAL' THEN
        -- obligation_held_here = delivered + carried_in − resolved − carried_forward (CHECK ≥ 0)
        v_held := v_delivered + v_carried_in - (v_returned + v_lost + v_line.approved_disposition_qty) - v_carried_fwd;
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

-- รายการนอกร้าน: records p_qty of a typed-in rental line as back in normal condition (no stock to move).
-- Uses p_return_id, or opens a return with p_note. Returns the return used.
CREATE OR REPLACE FUNCTION public._custom_line_mark_back(p_line_id uuid, p_qty numeric, p_return_id uuid, p_note text,
    p_correlation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_line   public.bill_lines%ROWTYPE;
    v_return uuid := p_return_id;
BEGIN
    SELECT * INTO v_line FROM public.bill_lines WHERE id = p_line_id;
    IF NOT FOUND OR v_line.product_id IS NOT NULL OR v_line.line_mode <> 'RENTAL' THEN
        RAISE EXCEPTION 'NOT_A_CUSTOM_RENTAL_LINE' USING ERRCODE = '23514';
    END IF;
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RETURN v_return;
    END IF;
    IF v_return IS NULL THEN
        INSERT INTO public.returns (return_no, bill_id, returned_at, received_by, note, correlation_id, created_by)
        VALUES (public._next_document_no('RETURN'), v_line.bill_id, now(), auth.uid(), p_note, p_correlation_id, auth.uid())
        RETURNING id INTO v_return;
    END IF;
    INSERT INTO public.return_lines (return_id, bill_line_id, quantity, condition, to_stock_state, created_by)
    VALUES (v_return, p_line_id, p_qty, 'NORMAL', 'AVAILABLE', auth.uid());
    PERFORM public._line_recalculate(p_line_id);
    RETURN v_return;
END;
$function$;
REVOKE ALL ON FUNCTION public._custom_line_mark_back(uuid, numeric, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;


-- Copy of the live return_receive (baseline): a typed-in rental line is checked back with no stock move.
CREATE OR REPLACE FUNCTION public.return_receive(
    p_bill_id          uuid,
    p_lines            jsonb,
    p_idempotency_key  text,
    p_returned_at      timestamptz DEFAULT NULL,
    p_note             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem      record;
    v_item      record;
    v_line      public.bill_lines%ROWTYPE;
    v_product   public.products%ROWTYPE;
    v_return    public.returns%ROWTYPE;
    v_rl_id     uuid;
    v_unit      uuid;
    v_state     text;
    v_first_out timestamptz;
    v_at        timestamptz := COALESCE(p_returned_at, now());
    v_corr      uuid := gen_random_uuid();
    v_credit    numeric(14,2);
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('return_receive', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 'l', p_lines, 'at', p_returned_at)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    IF v_at > now() + interval '5 minutes' THEN
        RAISE EXCEPTION 'RETURNED_AT_IN_FUTURE' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.bills WHERE id = p_bill_id AND status IN ('CONFIRMED', 'ACTIVE') FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_OPEN' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.returns (return_no, bill_id, returned_at, received_by, note, correlation_id, created_by)
    VALUES (public._next_document_no('RETURN'), p_bill_id, v_at, auth.uid(), p_note, v_corr, auth.uid())
    RETURNING * INTO v_return;

    FOR v_item IN
        SELECT x.* FROM jsonb_to_recordset(p_lines) AS x(bill_line_id uuid, quantity numeric, condition text,
                                                          to_stock_state text, unit_ids uuid[])
          LEFT JOIN public.bill_lines l ON l.id = x.bill_line_id
         ORDER BY l.product_id NULLS FIRST, l.line_no
    LOOP
        SELECT * INTO v_line FROM public.bill_lines WHERE id = v_item.bill_line_id AND bill_id = p_bill_id FOR UPDATE;
        IF NOT FOUND OR v_line.line_mode <> 'RENTAL' THEN
            RAISE EXCEPTION 'NOT_A_RENTAL_LINE_OF_BILL' USING ERRCODE = '23514';
        END IF;
        PERFORM public._line_recalculate(v_line.id);
        SELECT * INTO v_line FROM public.bill_lines WHERE id = v_item.bill_line_id;
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 OR v_item.quantity > v_line.obligation_held_here THEN
            RAISE EXCEPTION 'RETURN_EXCEEDS_HELD: line %, held %', v_line.line_no, v_line.obligation_held_here
                USING ERRCODE = '23514';
        END IF;
        IF v_item.condition IS NULL THEN
            RAISE EXCEPTION 'CONDITION_REQUIRED' USING ERRCODE = '22023';
        END IF;
        SELECT min(d.delivered_at) INTO v_first_out
          FROM public.delivery_lines dl JOIN public.deliveries d ON d.id = dl.delivery_id
         WHERE dl.bill_line_id = v_line.id;
        IF v_first_out IS NOT NULL AND v_line.carried_in_qty = 0 AND v_at < v_first_out THEN
            RAISE EXCEPTION 'RETURN_BEFORE_DELIVERY' USING ERRCODE = '23514';
        END IF;
        v_state := COALESCE(v_item.to_stock_state, CASE WHEN v_item.condition = 'NORMAL' THEN 'AVAILABLE' ELSE 'INSPECTION' END);
        SELECT * INTO v_product FROM public.products WHERE id = v_line.product_id;

        IF v_product.item_type = 'SERIALIZED' THEN
            IF COALESCE(cardinality(v_item.unit_ids), 0) <> v_item.quantity
               OR (SELECT count(DISTINCT u) FROM unnest(v_item.unit_ids) u) <> v_item.quantity THEN
                RAISE EXCEPTION 'UNITS_REQUIRED: serialized product needs one unit per piece' USING ERRCODE = '22023';
            END IF;
            FOREACH v_unit IN ARRAY v_item.unit_ids LOOP
                IF public._unit_holder_line(v_unit) IS DISTINCT FROM v_line.id THEN
                    RAISE EXCEPTION 'UNIT_NOT_HELD_BY_LINE: %', v_unit USING ERRCODE = '23514';
                END IF;
                INSERT INTO public.return_lines (return_id, bill_line_id, product_unit_id, quantity, condition,
                                                 to_stock_state, created_by)
                VALUES (v_return.id, v_line.id, v_unit, 1, v_item.condition, v_state, auth.uid())
                RETURNING id INTO v_rl_id;
                PERFORM public._unit_transition(v_unit, v_line.product_id, ARRAY['RENTED_OUT'],
                    CASE v_state WHEN 'AVAILABLE' THEN 'IN_STOCK' ELSE v_state END);
                UPDATE public.product_units SET condition = v_item.condition WHERE id = v_unit;
                PERFORM public._stock_move(v_line.product_id, 'RENTED_OUT', v_state, 1, 'RETURN', 'RETURN_LINE',
                                           v_rl_id, v_unit, NULL, v_corr);
                IF v_item.condition <> 'NORMAL' THEN
                    INSERT INTO public.incident_cases (bill_id, bill_line_id, return_line_id, product_unit_id,
                                                       incident_type, quantity, created_by)
                    VALUES (p_bill_id, v_line.id, v_rl_id, v_unit, 'DAMAGE', 1, auth.uid());
                END IF;
            END LOOP;
        ELSE
            IF v_item.unit_ids IS NOT NULL AND cardinality(v_item.unit_ids) > 0 THEN
                RAISE EXCEPTION 'UNITS_NOT_ALLOWED_FOR_QUANTITY_PRODUCT' USING ERRCODE = '22023';
            END IF;
            INSERT INTO public.return_lines (return_id, bill_line_id, quantity, condition, to_stock_state, created_by)
            VALUES (v_return.id, v_line.id, v_item.quantity, v_item.condition, v_state, auth.uid())
            RETURNING id INTO v_rl_id;
            -- รายการนอกร้าน (owner 2026-11-25): checked back, nothing goes into stock
            IF v_line.product_id IS NOT NULL THEN
                PERFORM public._stock_move(v_line.product_id, 'RENTED_OUT', v_state, v_item.quantity, 'RETURN', 'RETURN_LINE',
                                           v_rl_id, NULL, NULL, v_corr);
            END IF;
            IF v_item.condition <> 'NORMAL' THEN
                INSERT INTO public.incident_cases (bill_id, bill_line_id, return_line_id, incident_type, quantity, created_by)
                VALUES (p_bill_id, v_line.id, v_rl_id, 'DAMAGE', v_item.quantity, auth.uid());
            END IF;
        END IF;
        PERFORM public._line_recalculate(v_line.id);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.return_lines WHERE return_id = v_return.id) THEN
        RAISE EXCEPTION 'RETURN_EMPTY' USING ERRCODE = '22023';
    END IF;
    v_credit := public._early_return_credit(v_return.id);
    PERFORM public._bill_settle(p_bill_id);
    PERFORM public._audit('RETURN_RECEIVE', 'BILL', p_bill_id, NULL,
                          jsonb_build_object('return_id', v_return.id, 'return_no', v_return.return_no, 'lines', p_lines),
                          NULL, v_corr);
    RETURN public._idempotency_finish(v_idem.key_id,
        jsonb_build_object('return_id', v_return.id, 'return_no', v_return.return_no,
                           'early_return_credit', v_credit,
                           'suggested_refund', (SELECT greatest(-balance_due, 0) FROM public.bills WHERE id = p_bill_id)));
END;
$$;

-- Copy of the live lost_record (baseline): a lost typed-in rental line moves no stock.
CREATE OR REPLACE FUNCTION public.lost_record(
    p_missing_case_id    uuid,
    p_quantity           numeric,
    p_lost_charge_basis  text,
    p_reason             text,
    p_pin_token          uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_missing public.incident_cases%ROWTYPE;
    v_line    public.bill_lines%ROWTYPE;
    v_lost    public.incident_cases%ROWTYPE;
    v_reason  text := public._require_reason(p_reason);
    v_corr    uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM public._require_pin(p_pin_token, 'LOST_RECORD');
    SELECT * INTO v_missing FROM public.incident_cases WHERE id = p_missing_case_id FOR UPDATE;
    IF NOT FOUND OR v_missing.incident_type <> 'MISSING' OR v_missing.status NOT IN ('OPEN', 'UNDER_INSPECTION', 'ASSESSED') THEN
        RAISE EXCEPTION 'NOT_AN_OPEN_MISSING_CASE' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.bills WHERE id = v_missing.bill_id FOR UPDATE;
    PERFORM public._line_recalculate(v_missing.bill_line_id);
    SELECT * INTO v_line FROM public.bill_lines WHERE id = v_missing.bill_line_id FOR UPDATE;
    IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > v_missing.quantity OR p_quantity > v_line.obligation_held_here THEN
        RAISE EXCEPTION 'LOST_QUANTITY_INVALID' USING ERRCODE = '23514';
    END IF;
    IF v_missing.product_unit_id IS NOT NULL
       AND public._unit_holder_line(v_missing.product_unit_id) IS DISTINCT FROM v_line.id THEN
        RAISE EXCEPTION 'UNIT_NOT_HELD_BY_LINE' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.incident_cases (bill_id, bill_line_id, product_unit_id, incident_type, quantity, status,
                                       lost_charge_basis, missing_case_id, confirmed_by, confirmed_at, reason, created_by)
    VALUES (v_missing.bill_id, v_line.id, v_missing.product_unit_id, 'LOST', p_quantity, 'CONFIRMED',
            p_lost_charge_basis, v_missing.id, auth.uid(), now(), v_reason, auth.uid())
    RETURNING * INTO v_lost;
    UPDATE public.incident_cases SET status = 'RESOLVED' WHERE id = v_missing.id;

    IF v_missing.product_unit_id IS NOT NULL THEN
        PERFORM public._unit_transition(v_missing.product_unit_id, v_line.product_id, ARRAY['RENTED_OUT'], 'LOST');
    END IF;
    IF v_line.product_id IS NOT NULL THEN
        PERFORM public._stock_move(v_line.product_id, 'RENTED_OUT', 'LOST', p_quantity, 'LOST', 'INCIDENT', v_lost.id,
                                   v_missing.product_unit_id, v_reason, v_corr);
    END IF;
    PERFORM public._bill_settle(v_missing.bill_id);
    PERFORM public._audit('LOST_RECORD', 'INCIDENT', v_lost.id, to_jsonb(v_missing), to_jsonb(v_lost), v_reason, v_corr,
                          true, NULL, p_quantity);
    RETURN to_jsonb(v_lost);
END;
$$;

-- Copy of the live _bill_line_take_back (20261117090000) plus typed-in rental lines still held.
CREATE OR REPLACE FUNCTION public._bill_line_take_back(p_line_id uuid, p_return_id uuid, p_correlation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_line    public.bill_lines%ROWTYPE;
    v_product public.products%ROWTYPE;
    v_return  uuid := p_return_id;
    v_rl_id   uuid;
BEGIN
    PERFORM public._line_recalculate(p_line_id);
    SELECT * INTO v_line FROM public.bill_lines WHERE id = p_line_id FOR UPDATE;
    IF v_line.carried_in_qty > 0 OR v_line.carried_forward_qty > 0 THEN
        RAISE EXCEPTION 'LINE_HAS_CONTINUATION: line %', v_line.line_no USING ERRCODE = '23514';
    END IF;

    IF v_line.product_id IS NOT NULL THEN
        SELECT * INTO v_product FROM public.products WHERE id = v_line.product_id;
        IF v_line.allocated_qty > 0 THEN
            PERFORM public._stock_move(v_line.product_id, 'RESERVED', 'AVAILABLE', v_line.allocated_qty, 'RELEASE',
                                       'BILL_LINE', v_line.id, NULL, 'removed from bill', p_correlation_id);
        END IF;
        IF v_line.line_mode = 'RENTAL' AND v_line.obligation_held_here > 0 THEN
            IF v_product.item_type = 'SERIALIZED' THEN
                RAISE EXCEPTION 'LINE_HAS_UNITS: line %', v_line.line_no USING ERRCODE = '23514';
            END IF;
            IF v_return IS NULL THEN
                INSERT INTO public.returns (return_no, bill_id, returned_at, received_by, note, correlation_id, created_by)
                VALUES (public._next_document_no('RETURN'), v_line.bill_id, now(), auth.uid(),
                        'แก้ไขบิล: เอาสินค้าออกจากบิล', p_correlation_id, auth.uid())
                RETURNING id INTO v_return;
            END IF;
            INSERT INTO public.return_lines (return_id, bill_line_id, quantity, condition, to_stock_state, created_by)
            VALUES (v_return, v_line.id, v_line.obligation_held_here, 'NORMAL', 'AVAILABLE', auth.uid())
            RETURNING id INTO v_rl_id;
            PERFORM public._stock_move(v_line.product_id, 'RENTED_OUT', 'AVAILABLE', v_line.obligation_held_here, 'RETURN',
                                       'RETURN_LINE', v_rl_id, NULL, 'removed from bill', p_correlation_id);
        ELSIF v_line.line_mode = 'SALE' AND v_line.delivered_qty > 0 THEN
            IF v_product.item_type = 'SERIALIZED' THEN
                RAISE EXCEPTION 'LINE_HAS_UNITS: line %', v_line.line_no USING ERRCODE = '23514';
            END IF;
            PERFORM public._stock_move(v_line.product_id, 'SOLD', 'AVAILABLE', v_line.delivered_qty, 'RETURN',
                                       'BILL_LINE', v_line.id, NULL, 'removed from bill', p_correlation_id);
        END IF;
    ELSIF v_line.line_mode = 'RENTAL' AND v_line.obligation_held_here > 0 THEN
        -- รายการนอกร้าน still with the customer: counted as back (no stock)
        v_return := public._custom_line_mark_back(v_line.id, v_line.obligation_held_here, v_return,
                                                  'แก้ไขบิล: เอาสินค้าออกจากบิล', p_correlation_id);
    END IF;

    UPDATE public.bill_lines
       SET allocated_qty = 0, backorder_qty = 0, cancelled_qty = ordered_qty - delivered_qty,
           removed_at = now(), removed_by = auth.uid()
     WHERE id = p_line_id;
    PERFORM public._line_recalculate(p_line_id);
    RETURN v_return;
END;
$function$;

-- Copy of the live bill_revise (20261117090000) plus re-written typed-in rental lines.
CREATE OR REPLACE FUNCTION public.bill_revise(p_bill_id uuid, p_data jsonb, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem      record;
    v_bill      public.bills%ROWTYPE;
    v_before    public.bills%ROWTYPE;
    v_line      public.bill_lines%ROWTYPE;
    v_item      jsonb;
    v_found     boolean;
    v_corr      uuid := gen_random_uuid();
    v_return_id uuid;
    v_delivery  uuid;
    v_no        integer;
    v_new_id    uuid;
    v_qty       numeric;
    v_price     numeric;
    v_periods   numeric;
    v_start     timestamptz;
    v_end       timestamptz;
    v_list      numeric;
    v_out       numeric;
    v_give      numeric;
    v_take      numeric;
    v_avail     numeric;
    v_alloc     numeric;
    v_dl_id     uuid;
    v_disc      numeric;
    v_fees      numeric;
    v_other     numeric;
    v_backorder boolean := (public._policy('allow_backorder', 'false'::jsonb))::text::boolean;
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('bill_revise', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 'd', p_data)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    IF p_data IS NULL OR jsonb_typeof(p_data -> 'lines') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'INVALID_REVISION' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_REVISABLE' USING ERRCODE = '23514';
    END IF;
    v_before := v_bill;
    -- open the confirmed bill for this transaction only
    PERFORM set_config('app.bill_revise', 'on', true);

    -- every line_id sent must be a live line of this bill
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_data -> 'lines') x
                WHERE x ->> 'line_id' IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.bill_lines l
                                   WHERE l.id = (x ->> 'line_id')::uuid AND l.bill_id = p_bill_id AND l.removed_at IS NULL)) THEN
        RAISE EXCEPTION 'LINE_NOT_IN_BILL' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(max(line_no), 0) INTO v_no FROM public.bill_lines WHERE bill_id = p_bill_id;

    -- 1. lines already on the bill
    FOR v_line IN SELECT * FROM public.bill_lines WHERE bill_id = p_bill_id AND removed_at IS NULL
                   ORDER BY product_id NULLS FIRST, line_no FOR UPDATE LOOP
        SELECT x INTO v_item FROM jsonb_array_elements(p_data -> 'lines') x
         WHERE (x ->> 'line_id')::uuid = v_line.id LIMIT 1;
        v_found := FOUND;
        IF NOT v_found THEN
            v_return_id := public._bill_line_take_back(v_line.id, v_return_id, v_corr);
            CONTINUE;
        END IF;

        PERFORM public._line_recalculate(v_line.id);
        SELECT * INTO v_line FROM public.bill_lines WHERE id = v_line.id;
        v_qty := COALESCE((v_item ->> 'ordered_qty')::numeric, v_line.ordered_qty);
        v_price := COALESCE((v_item ->> 'unit_price')::numeric, v_line.unit_price);
        v_periods := CASE WHEN v_line.line_mode = 'RENTAL' THEN COALESCE((v_item ->> 'period_count')::numeric, v_line.period_count) END;
        v_start := CASE WHEN v_line.line_mode = 'RENTAL' THEN COALESCE((v_item ->> 'rental_start_at')::timestamptz, v_line.rental_start_at) END;
        v_end := CASE WHEN v_line.line_mode = 'RENTAL' THEN COALESCE((v_item ->> 'rental_end_at')::timestamptz, v_line.rental_end_at) END;
        IF v_qty <= 0 OR v_price < 0 OR (v_line.line_mode = 'RENTAL' AND (v_periods <= 0 OR v_end <= v_start)) THEN
            RAISE EXCEPTION 'INVALID_LINE: line %', v_line.line_no USING ERRCODE = '22023';
        END IF;

        IF v_qty < v_line.delivered_qty + v_line.carried_in_qty + v_line.cancelled_qty THEN
            -- Fewer than are already out: take the line back and write it again, handing over what stays out.
            v_out := CASE WHEN v_line.line_mode = 'RENTAL' THEN v_line.obligation_held_here ELSE v_line.delivered_qty END;
            v_return_id := public._bill_line_take_back(v_line.id, v_return_id, v_corr);
            v_no := v_no + 1;
            v_new_id := public._bill_line_write(p_bill_id, v_no, jsonb_build_object(
                'product_id', v_line.product_id, 'line_mode', v_line.line_mode, 'ordered_qty', v_qty, 'unit_price', v_price,
                'rental_calculation_type', v_line.rental_calculation_type, 'period_count', v_periods,
                'rental_start_at', v_start, 'rental_end_at', v_end,
                'product_name', v_line.product_name, 'unit_name', v_line.unit_name, 'allow_inactive', true), v_corr);
            SELECT * INTO v_line FROM public.bill_lines WHERE id = v_new_id;
            -- รายการนอกร้าน: no delivery; what had already come back stays back
            IF v_line.product_id IS NULL AND v_line.line_mode = 'RENTAL' AND v_qty > v_out THEN
                v_return_id := public._custom_line_mark_back(v_new_id, v_qty - v_out, v_return_id,
                                                             'แก้ไขบิล: เอาสินค้าออกจากบิล', v_corr);
            END IF;
            v_give := least(v_qty, v_out, v_line.allocated_qty);
            IF v_give > 0 THEN
                IF v_delivery IS NULL THEN
                    INSERT INTO public.deliveries (delivery_no, bill_id, delivered_at, delivered_by, note, correlation_id, created_by)
                    VALUES (public._next_document_no('DELIVERY'), p_bill_id, now(), auth.uid(),
                            'แก้ไขบิล: จำนวนใหม่ของที่ลูกค้าถืออยู่', v_corr, auth.uid())
                    RETURNING id INTO v_delivery;
                END IF;
                INSERT INTO public.delivery_lines (delivery_id, bill_line_id, quantity, created_by)
                VALUES (v_delivery, v_new_id, v_give, auth.uid()) RETURNING id INTO v_dl_id;
                PERFORM public._stock_move(v_line.product_id, 'RESERVED',
                    CASE v_line.line_mode WHEN 'SALE' THEN 'SOLD' ELSE 'RENTED_OUT' END, v_give,
                    CASE v_line.line_mode WHEN 'SALE' THEN 'DELIVER_SALE' ELSE 'DELIVER_RENTAL' END,
                    'DELIVERY_LINE', v_dl_id, NULL, NULL, v_corr);
                UPDATE public.bill_lines SET allocated_qty = allocated_qty - v_give WHERE id = v_new_id;
                PERFORM public._line_recalculate(v_new_id);
            END IF;
            CONTINUE;
        END IF;

        -- stock change of the quantity, written in the same UPDATE as the quantity (the line's qty CHECKs)
        v_alloc := 0;
        v_give := 0;
        IF v_line.product_id IS NOT NULL AND v_qty > v_line.ordered_qty THEN
            -- more: reserve the extra
            SELECT quantity INTO v_avail FROM public.stock_balances
             WHERE product_id = v_line.product_id AND stock_state = 'AVAILABLE' FOR UPDATE;
            v_alloc := least(COALESCE(v_avail, 0), v_qty - v_line.ordered_qty);
            IF v_alloc < v_qty - v_line.ordered_qty AND NOT v_backorder THEN
                RAISE EXCEPTION 'INSUFFICIENT_STOCK: line %, available %, ordered %', v_line.line_no, COALESCE(v_avail, 0),
                    v_qty - v_line.ordered_qty USING ERRCODE = '23514';
            END IF;
            IF v_alloc > 0 THEN
                PERFORM public._stock_move(v_line.product_id, 'AVAILABLE', 'RESERVED', v_alloc, 'RESERVE', 'BILL_LINE',
                                           v_line.id, NULL, 'more on แก้ไขบิล', v_corr);
            END IF;
            v_give := v_qty - v_line.ordered_qty - v_alloc;          -- added to backorder
        ELSIF v_line.product_id IS NOT NULL AND v_qty < v_line.ordered_qty THEN
            -- fewer (not below what is out): drop backorder first, then release reserved stock
            v_take := v_line.ordered_qty - v_qty;
            v_give := -least(v_line.backorder_qty, v_take);          -- taken off backorder
            v_take := v_take + v_give;
            v_alloc := -least(v_line.allocated_qty, v_take);         -- taken off reserved
            IF v_alloc < 0 THEN
                PERFORM public._stock_move(v_line.product_id, 'RESERVED', 'AVAILABLE', -v_alloc, 'RELEASE', 'BILL_LINE',
                                           v_line.id, NULL, 'fewer on แก้ไขบิล', v_corr);
            END IF;
        END IF;

        v_list := CASE WHEN v_line.product_id IS NULL THEN v_price ELSE public._list_price(v_line.product_id, v_line.line_mode, true) END;
        UPDATE public.bill_lines
           SET ordered_qty = v_qty, unit_price = v_price, price_overridden = v_price IS DISTINCT FROM v_list,
               period_count = v_periods, rental_start_at = v_start, rental_end_at = v_end,
               allocated_qty = allocated_qty + v_alloc, backorder_qty = backorder_qty + v_give
         WHERE id = v_line.id;
        PERFORM public._line_recalculate(v_line.id);
    END LOOP;

    -- 2. added lines
    FOR v_item IN SELECT x FROM jsonb_array_elements(p_data -> 'lines') x WHERE x ->> 'line_id' IS NULL LOOP
        v_no := v_no + 1;
        PERFORM public._bill_line_write(p_bill_id, v_no, v_item, v_corr);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND removed_at IS NULL) THEN
        RAISE EXCEPTION 'BILL_EMPTY: use ยกเลิกบิล to drop every line' USING ERRCODE = '23514';
    END IF;

    -- 3. the bill's own discount and fees
    v_disc := (p_data ->> 'bill_discount_amount')::numeric;
    IF v_disc IS NOT NULL THEN
        IF v_disc < 0 THEN
            RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE = '22023';
        END IF;
        IF v_disc IS DISTINCT FROM v_bill.bill_discount_amount THEN
            UPDATE public.bills
               SET bill_discount_type = CASE WHEN v_disc > 0 THEN 'FIXED' END, bill_discount_value = v_disc
             WHERE id = p_bill_id;
        END IF;
    END IF;
    v_fees := (p_data ->> 'fees_total')::numeric;
    IF v_fees IS NOT NULL THEN
        v_other := v_bill.installation_fee + v_bill.service_fee;
        IF v_fees < v_other THEN
            RAISE EXCEPTION 'INVALID_FEES' USING ERRCODE = '22023';
        END IF;
        UPDATE public.bills SET delivery_fee = v_fees - v_other WHERE id = p_bill_id AND delivery_fee IS DISTINCT FROM v_fees - v_other;
    END IF;

    -- 4. price the bill again; revenue follows (old entries reversed, new ones posted)
    PERFORM public._bill_reprice(p_bill_id);
    PERFORM public._ledger_reverse_source('BILL_CONFIRM', p_bill_id, v_corr);
    PERFORM public._bill_post_revenue(p_bill_id, v_corr);
    PERFORM public._bill_settle(p_bill_id);

    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    PERFORM public._audit('BILL_REVISE', 'BILL', p_bill_id,
                          jsonb_build_object('grand_total', v_before.grand_total, 'balance_due', v_before.balance_due),
                          jsonb_build_object('grand_total', v_bill.grand_total, 'balance_due', v_bill.balance_due, 'data', p_data),
                          NULL, v_corr, true, abs(v_bill.grand_total - v_before.grand_total));
    RETURN public._idempotency_finish(v_idem.key_id, jsonb_build_object('bill', to_jsonb(v_bill)));
END;
$$;

-- Copy of the live create_rental_continuation (20261116090000): a typed-in rental line can be continued too.
CREATE OR REPLACE FUNCTION public.create_rental_continuation(p_parent_bill_id uuid, p_items jsonb, p_reason text,
    p_idempotency_key text, p_start_mode text DEFAULT NULL::text, p_pin_token uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_idem record;
    v_parent public.bills%ROWTYPE;
    v_child public.bills%ROWTYPE;
    v_item record;
    v_from public.bill_lines%ROWTYPE;
    v_to_id uuid;
    v_cf_id uuid;
    v_unit uuid;
    v_price numeric;
    v_list numeric;
    v_override boolean := false;
    v_start timestamptz;
    v_late boolean := false;
    v_all_late boolean := true;
    v_no integer := 0;
    v_reason text := public._require_reason(p_reason);
    v_corr uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('create_rental_continuation', p_idempotency_key,
        md5(jsonb_build_object('p', p_parent_bill_id, 'i', p_items, 'm', p_start_mode)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'ITEMS_REQUIRED' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_parent FROM public.bills WHERE id = p_parent_bill_id FOR UPDATE;
    IF NOT FOUND OR v_parent.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'PARENT_BILL_NOT_ACTIVE' USING ERRCODE = '23514';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(from_line_id uuid) LOOP
        SELECT * INTO v_from FROM public.bill_lines WHERE id = v_item.from_line_id AND bill_id = v_parent.id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'LINE_NOT_IN_PARENT' USING ERRCODE = '23514';
        END IF;
        IF now() > v_from.rental_end_at THEN v_late := true; ELSE v_all_late := false; END IF;
    END LOOP;
    IF v_late AND p_start_mode IS NULL THEN
        RAISE EXCEPTION 'START_MODE_REQUIRED: after the planned end, choose FROM_PREVIOUS_END or FROM_APPROVAL' USING ERRCODE = '22023';
    END IF;
    IF p_start_mode IS NOT NULL AND (NOT v_late OR p_start_mode NOT IN ('FROM_PREVIOUS_END', 'FROM_APPROVAL')) THEN
        RAISE EXCEPTION 'START_MODE_NOT_APPLICABLE' USING ERRCODE = '22023';
    END IF;
    IF p_start_mode = 'FROM_APPROVAL' AND NOT v_all_late THEN
        RAISE EXCEPTION 'MIXED_DUE_LINES: continue lines that are not yet due separately' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.bills (status, customer_id, parent_bill_id, original_bill_id, continuation_start_mode, continuation_reason, created_by, guest_name)
    VALUES ('DRAFT', v_parent.customer_id, v_parent.id, COALESCE(v_parent.original_bill_id, v_parent.id), p_start_mode,
            CASE WHEN p_start_mode IS NOT NULL THEN v_reason END, auth.uid(), v_parent.guest_name)
    RETURNING * INTO v_child;
    FOR v_item IN SELECT x.* FROM jsonb_to_recordset(p_items) AS x(
            from_line_id uuid, quantity numeric, unit_ids uuid[], unit_price numeric, rental_calculation_type text,
            period_type text, period_count numeric, rental_start_at timestamptz, rental_end_at timestamptz)
        ORDER BY x.from_line_id LOOP
        SELECT * INTO v_from FROM public.bill_lines WHERE id = v_item.from_line_id FOR UPDATE;
        PERFORM public._line_recalculate(v_from.id);
        SELECT * INTO v_from FROM public.bill_lines WHERE id = v_item.from_line_id;
        IF v_from.line_mode <> 'RENTAL' OR v_item.quantity IS NULL OR v_item.quantity <= 0 OR v_item.quantity > v_from.obligation_held_here THEN
            RAISE EXCEPTION 'CONTINUATION_QTY_EXCEEDS_HELD: line %, held %', v_from.line_no, v_from.obligation_held_here USING ERRCODE = '23514';
        END IF;
        v_start := CASE WHEN p_start_mode = 'FROM_APPROVAL' THEN now() ELSE v_item.rental_start_at END;
        IF v_start IS NULL OR v_item.rental_end_at IS NULL OR v_item.rental_end_at <= v_start THEN
            RAISE EXCEPTION 'CONTINUATION_PERIOD_REQUIRED' USING ERRCODE = '22023';
        END IF;
        IF COALESCE(p_start_mode, '') <> 'FROM_APPROVAL' THEN
            IF v_item.rental_calculation_type = 'PER_DAY' AND public._local_date(v_start) <> public._local_date(v_from.rental_end_at) + 1 THEN
                RAISE EXCEPTION 'DAILY_CONTINUATION_MUST_START_NEXT_DAY' USING ERRCODE = '22023';
            END IF;
            IF v_start < v_from.rental_end_at THEN
                RAISE EXCEPTION 'CONTINUATION_OVERLAPS_PREVIOUS_ROUND' USING ERRCODE = '22023';
            END IF;
        END IF;
        -- The goods are already with the customer: a product suspended later can still be continued.
        v_list := CASE WHEN v_from.product_id IS NULL THEN v_from.unit_price
                       ELSE public._list_price(v_from.product_id, 'RENTAL', true) END;
        v_price := COALESCE(v_item.unit_price, v_list);
        v_override := v_override OR v_price IS DISTINCT FROM v_list;
        v_no := v_no + 1;
        INSERT INTO public.bill_lines (bill_id, line_no, product_id, line_mode, ordered_qty, unit_price, price_overridden,
                                       rental_calculation_type, period_type, period_count, rental_start_at, rental_end_at,
                                       rental_status, product_name, unit_name, created_by)
        VALUES (v_child.id, v_no, v_from.product_id, 'RENTAL', v_item.quantity, v_price, v_price IS DISTINCT FROM v_list,
                COALESCE(v_item.rental_calculation_type, v_from.rental_calculation_type), v_item.period_type, v_item.period_count,
                v_start, v_item.rental_end_at, 'SCHEDULED',
                CASE WHEN v_from.product_id IS NULL THEN v_from.product_name END,
                CASE WHEN v_from.product_id IS NULL THEN v_from.unit_name END, auth.uid())
        RETURNING id INTO v_to_id;
        INSERT INTO public.rental_carry_forwards (from_bill_id, from_line_id, to_bill_id, to_line_id, product_id, quantity,
                                                  reason, correlation_id, created_by)
        VALUES (v_parent.id, v_from.id, v_child.id, v_to_id, v_from.product_id, v_item.quantity, v_reason, v_corr, auth.uid())
        RETURNING id INTO v_cf_id;
        IF EXISTS (SELECT 1 FROM public.products WHERE id = v_from.product_id AND item_type = 'SERIALIZED') THEN
            IF COALESCE(cardinality(v_item.unit_ids), 0) <> v_item.quantity
               OR (SELECT count(DISTINCT u) FROM unnest(v_item.unit_ids) u) <> v_item.quantity THEN
                RAISE EXCEPTION 'UNITS_REQUIRED: serialized product needs one unit per piece' USING ERRCODE = '22023';
            END IF;
            FOREACH v_unit IN ARRAY v_item.unit_ids LOOP
                IF public._unit_holder_line(v_unit) IS DISTINCT FROM v_from.id THEN
                    RAISE EXCEPTION 'UNIT_NOT_HELD_BY_LINE: %', v_unit USING ERRCODE = '23514';
                END IF;
                INSERT INTO public.rental_carry_forward_units (carry_forward_id, product_unit_id, created_by)
                VALUES (v_cf_id, v_unit, auth.uid());
            END LOOP;
        END IF;
        PERFORM public._line_recalculate(v_from.id);
    END LOOP;
    IF v_override THEN
        PERFORM public._require_pin(p_pin_token, 'PRICE_OVERRIDE');
    END IF;
    PERFORM public._bill_compute_totals(v_child.id);
    UPDATE public.bills SET status = 'CONFIRMED', bill_no = public._next_document_no('BILL'), confirmed_at = now(), confirmed_by = auth.uid()
     WHERE id = v_child.id;
    PERFORM public._bill_post_revenue(v_child.id, v_corr);
    PERFORM public._bill_settle(v_child.id);
    PERFORM public._bill_settle(v_parent.id);
    SELECT * INTO v_child FROM public.bills WHERE id = v_child.id;
    PERFORM public._audit('RENTAL_CONTINUATION_CREATE', 'BILL', v_child.id, jsonb_build_object('parent_bill_id', v_parent.id),
                          to_jsonb(v_child), v_reason, v_corr, v_override, v_child.grand_total);
    RETURN public._idempotency_finish(v_idem.key_id, jsonb_build_object('child_bill', to_jsonb(v_child)));
END;
$function$;

-- Copy of the live _carry_forward_consistency (baseline): both lines typed-in (no product) also match.
CREATE OR REPLACE FUNCTION public._carry_forward_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.bills b WHERE b.id = NEW.to_bill_id AND b.parent_bill_id = NEW.from_bill_id) THEN
        RAISE EXCEPTION 'CARRY_FORWARD_NOT_CHILD_OF_PARENT' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bill_lines l
                   WHERE l.id = NEW.from_line_id AND l.bill_id = NEW.from_bill_id
                     AND l.line_mode = 'RENTAL' AND l.product_id IS NOT DISTINCT FROM NEW.product_id)
       OR NOT EXISTS (SELECT 1 FROM public.bill_lines l
                   WHERE l.id = NEW.to_line_id AND l.bill_id = NEW.to_bill_id
                     AND l.line_mode = 'RENTAL' AND l.product_id IS NOT DISTINCT FROM NEW.product_id) THEN
        RAISE EXCEPTION 'CARRY_FORWARD_LINE_MISMATCH' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- Open bills: typed-in rental lines are with the customer again until they are checked back.
DO $$
DECLARE
    v_line record;
    v_bill uuid;
BEGIN
    FOR v_line IN
        SELECT l.id FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
         WHERE l.product_id IS NULL AND l.line_mode = 'RENTAL' AND l.removed_at IS NULL
           AND b.status IN ('CONFIRMED', 'ACTIVE')
    LOOP
        PERFORM public._line_recalculate(v_line.id);
    END LOOP;
    FOR v_bill IN
        SELECT DISTINCT l.bill_id FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
         WHERE l.product_id IS NULL AND l.line_mode = 'RENTAL' AND b.status IN ('CONFIRMED', 'ACTIVE')
    LOOP
        PERFORM public._bill_recalculate(v_bill);
    END LOOP;
END;
$$;
