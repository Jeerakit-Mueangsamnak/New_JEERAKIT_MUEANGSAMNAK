-- รายการนอกร้าน (owner 2026-11-11): a bill line typed in at the counter — name, quantity, unit, price,
-- rounds — with no shop product and no stock. It is priced and counted as revenue like any line
-- (sale or rental), counts as handed over when the bill is issued, and never waits for a return.
--   bill_lines.product_id may be NULL; such a line keeps its own product_name / unit_name.
--   bill_save_draft takes product_name / unit_name for those lines (price required, no list price).
--   bill_confirm skips product checks and stock allocation for them.
--   _line_recalculate: delivered = ordered once issued, nothing held, return status RETURNED.
--   bill_void: a typed-in sale line does not block voiding (nothing physical went out of stock).

ALTER TABLE public.bill_lines ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.bill_lines DROP CONSTRAINT IF EXISTS bill_lines_custom_name_check;
ALTER TABLE public.bill_lines ADD CONSTRAINT bill_lines_custom_name_check
    CHECK (product_id IS NOT NULL OR NULLIF(btrim(product_name), '') IS NOT NULL);

CREATE OR REPLACE FUNCTION public._line_product_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    -- A line typed in at the counter has no shop product: it keeps the name and unit it was given.
    IF NEW.product_id IS NULL THEN
        NEW.product_sku := NULL;
        NEW.product_name := NULLIF(left(btrim(NEW.product_name), 200), '');
        NEW.unit_name := NULLIF(left(btrim(NEW.unit_name), 50), '');
        RETURN NEW;
    END IF;
    SELECT p.sku, p.name, u.name INTO NEW.product_sku, NEW.product_name, NEW.unit_name
      FROM public.products p LEFT JOIN public.units u ON u.id = p.unit_id
     WHERE p.id = NEW.product_id;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bill_save_draft(p_bill_id uuid, p_data jsonb, p_pin_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill      public.bills%ROWTYPE;
    v_line      record;
    v_no        integer := 0;
    v_price     numeric;
    v_list      numeric;
    v_override  boolean;
    v_allowed   text[] := ARRAY['customer_id', 'quotation_id', 'vat_enabled', 'vat_mode', 'note', 'bill_discount_type', 'bill_discount_value',
                                'delivery_fee', 'installation_fee', 'service_fee', 'is_credit_bill', 'due_date',
                                'deposit_amount', 'deposit_note', 'lines', 'override_reason'];
    v_reason    text;
    v_vat_on    boolean;
    v_vat_mode  text;
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;
    IF p_data ? 'vat_enabled' AND jsonb_typeof(p_data -> 'vat_enabled') <> 'boolean' THEN
        RAISE EXCEPTION 'INVALID_VAT_ENABLED' USING ERRCODE = '22023';
    END IF;
    IF p_data ? 'vat_mode' AND jsonb_typeof(p_data -> 'vat_mode') <> 'null'
       AND COALESCE(p_data ->> 'vat_mode', '') NOT IN ('INCLUSIVE', 'EXCLUSIVE') THEN
        RAISE EXCEPTION 'INVALID_VAT_MODE' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((p_data ->> 'deposit_amount')::numeric, 0) < 0 THEN
        RAISE EXCEPTION 'INVALID_DEPOSIT' USING ERRCODE = '22023';
    END IF;
    v_override := false;
    v_vat_on := COALESCE((p_data ->> 'vat_enabled')::boolean, false);
    -- The pricing mode only means something while VAT is on for this bill.
    v_vat_mode := CASE WHEN v_vat_on THEN p_data ->> 'vat_mode' END;

    IF p_bill_id IS NULL THEN
        INSERT INTO public.bills (status, customer_id, quotation_id, vat_enabled, vat_mode, note, bill_discount_type, bill_discount_value,
            delivery_fee, installation_fee, service_fee, is_credit_bill, due_date, deposit_amount, deposit_note, created_by)
        VALUES ('DRAFT', (p_data ->> 'customer_id')::uuid, (p_data ->> 'quotation_id')::uuid,
            v_vat_on, v_vat_mode,
            p_data ->> 'note', p_data ->> 'bill_discount_type', COALESCE((p_data ->> 'bill_discount_value')::numeric, 0),
            COALESCE((p_data ->> 'delivery_fee')::numeric, 0), COALESCE((p_data ->> 'installation_fee')::numeric, 0),
            COALESCE((p_data ->> 'service_fee')::numeric, 0), COALESCE((p_data ->> 'is_credit_bill')::boolean, false),
            (p_data ->> 'due_date')::date, COALESCE((p_data ->> 'deposit_amount')::numeric, 0), p_data ->> 'deposit_note',
            auth.uid())
        RETURNING * INTO v_bill;
    ELSE
        SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
        IF NOT FOUND OR v_bill.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'BILL_NOT_DRAFT' USING ERRCODE = '23514';
        END IF;
        UPDATE public.bills
           SET customer_id = (p_data ->> 'customer_id')::uuid, quotation_id = (p_data ->> 'quotation_id')::uuid,
               vat_enabled = v_vat_on,
               vat_mode = v_vat_mode,
               note = p_data ->> 'note', bill_discount_type = p_data ->> 'bill_discount_type',
               bill_discount_value = COALESCE((p_data ->> 'bill_discount_value')::numeric, 0),
               delivery_fee = COALESCE((p_data ->> 'delivery_fee')::numeric, 0),
               installation_fee = COALESCE((p_data ->> 'installation_fee')::numeric, 0),
               service_fee = COALESCE((p_data ->> 'service_fee')::numeric, 0),
               is_credit_bill = COALESCE((p_data ->> 'is_credit_bill')::boolean, false),
               due_date = (p_data ->> 'due_date')::date,
               deposit_amount = COALESCE((p_data ->> 'deposit_amount')::numeric, 0),
               deposit_note = p_data ->> 'deposit_note'
         WHERE id = p_bill_id;
        DELETE FROM public.bill_lines WHERE bill_id = p_bill_id;
    END IF;

    FOR v_line IN
        SELECT * FROM jsonb_to_recordset(COALESCE(p_data -> 'lines', '[]'::jsonb)) AS x(
            product_id uuid, line_mode text, ordered_qty numeric, unit_price numeric, line_discount_type text,
            line_discount_value numeric, rental_calculation_type text, period_type text, period_count numeric,
            rental_start_at timestamptz, rental_end_at timestamptz,
            product_name text, unit_name text)
    LOOP
        v_no := v_no + 1;
        IF v_line.product_id IS NULL THEN
            -- รายการนอกร้าน (owner 2026-11-11): typed name + price, no shop product, no stock
            IF NULLIF(btrim(v_line.product_name), '') IS NULL THEN
                RAISE EXCEPTION 'CUSTOM_LINE_NAME_REQUIRED' USING ERRCODE = '22023';
            END IF;
            IF v_line.unit_price IS NULL OR v_line.unit_price < 0 THEN
                RAISE EXCEPTION 'CUSTOM_LINE_PRICE_REQUIRED' USING ERRCODE = '22023';
            END IF;
            v_list := v_line.unit_price;
        ELSE
            v_list := public._list_price(v_line.product_id, v_line.line_mode);
        END IF;
        v_price := COALESCE(v_line.unit_price, v_list);
        v_override := v_override OR v_price IS DISTINCT FROM v_list;
        INSERT INTO public.bill_lines (bill_id, line_no, product_id, line_mode, ordered_qty, unit_price,
            price_overridden, line_discount_type, line_discount_value, rental_calculation_type, period_type,
            period_count, rental_start_at, rental_end_at, rental_status, product_name, unit_name, created_by)
        VALUES (v_bill.id, v_no, v_line.product_id, v_line.line_mode, v_line.ordered_qty, v_price,
            v_price IS DISTINCT FROM v_list, v_line.line_discount_type, COALESCE(v_line.line_discount_value, 0),
            v_line.rental_calculation_type, v_line.period_type, v_line.period_count, v_line.rental_start_at,
            v_line.rental_end_at, CASE WHEN v_line.line_mode = 'RENTAL' THEN 'SCHEDULED' END,
            CASE WHEN v_line.product_id IS NULL THEN v_line.product_name END,
            CASE WHEN v_line.product_id IS NULL THEN v_line.unit_name END, auth.uid());
    END LOOP;

    PERFORM public._bill_compute_totals(v_bill.id);
    SELECT * INTO v_bill FROM public.bills WHERE id = v_bill.id;
    v_override := v_override
        OR EXISTS (SELECT 1 FROM public.bill_lines
                    WHERE bill_id = v_bill.id AND public._discount_over_limit(line_discount_amount, base_amount))
        OR public._discount_over_limit(v_bill.bill_discount_amount, v_bill.sale_subtotal + v_bill.rental_subtotal);
    -- Price override / discount over the owner's limit = risky (Master §4.4): PIN + reason, once per draft.
    IF v_override THEN
        PERFORM public._require_pin(p_pin_token, 'PRICE_OVERRIDE');
        v_reason := public._require_reason(p_data ->> 'override_reason');
    END IF;
    PERFORM public._audit('BILL_DRAFT_SAVE', 'BILL', v_bill.id, NULL, to_jsonb(v_bill), v_reason, NULL, v_override,
                          v_bill.grand_total);
    RETURN to_jsonb(v_bill) || jsonb_build_object('lines',
        (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_no) FROM public.bill_lines l WHERE l.bill_id = v_bill.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.bill_confirm(p_bill_id uuid, p_idempotency_key text, p_tenders jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem        record;
    v_bill        public.bills%ROWTYPE;
    v_line        public.bill_lines%ROWTYPE;
    v_product     public.products%ROWTYPE;
    v_customer    public.customers%ROWTYPE;
    v_has_rental  boolean;
    v_avail       numeric;
    v_alloc       numeric;
    v_backorder   boolean := (public._policy('allow_backorder', 'false'::jsonb))::text::boolean;
    v_outstanding numeric;
    v_res         record;
    v_receipt     jsonb;
    v_corr        uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('bill_confirm', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 't', p_tenders)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'BILL_NOT_DRAFT' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id) THEN
        RAISE EXCEPTION 'BILL_EMPTY' USING ERRCODE = '23514';
    END IF;
    v_has_rental := EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND line_mode = 'RENTAL');
    IF v_bill.customer_id IS NOT NULL THEN
        SELECT * INTO v_customer FROM public.customers WHERE id = v_bill.customer_id FOR SHARE;
        IF NOT v_customer.active THEN
            RAISE EXCEPTION 'CUSTOMER_INACTIVE' USING ERRCODE = '23514';
        END IF;
    ELSIF v_has_rental OR v_bill.is_credit_bill THEN
        RAISE EXCEPTION 'CUSTOMER_REQUIRED' USING ERRCODE = '23514';
    END IF;
    -- รายการนอกร้าน (product_id NULL) has no product to check and takes no stock.
    FOR v_line IN SELECT * FROM public.bill_lines WHERE bill_id = p_bill_id AND product_id IS NOT NULL ORDER BY line_no LOOP
        SELECT * INTO v_product FROM public.products WHERE id = v_line.product_id FOR SHARE;
        IF NOT v_product.active THEN
            RAISE EXCEPTION 'PRODUCT_INACTIVE: %', v_product.sku USING ERRCODE = '23514';
        END IF;
        IF (v_line.line_mode = 'SALE' AND NOT v_product.can_sell) OR (v_line.line_mode = 'RENTAL' AND NOT v_product.can_rent) THEN
            RAISE EXCEPTION 'PRODUCT_CAPABILITY: % cannot %', v_product.sku, v_line.line_mode USING ERRCODE = '23514';
        END IF;
    END LOOP;
    PERFORM public._bill_compute_totals(p_bill_id);
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    IF v_bill.is_credit_bill THEN
        IF NOT v_customer.credit_enabled OR v_customer.account_status <> 'NORMAL' THEN
            RAISE EXCEPTION 'CREDIT_NOT_ALLOWED' USING ERRCODE = '23514';
        END IF;
        SELECT COALESCE(sum(balance_due), 0) INTO v_outstanding
          FROM public.bills WHERE customer_id = v_bill.customer_id AND status IN ('CONFIRMED', 'ACTIVE');
        IF v_outstanding + v_bill.grand_total > v_customer.credit_limit THEN
            RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED' USING ERRCODE = '23514';
        END IF;
    END IF;
    UPDATE public.bills
       SET status = 'CONFIRMED', bill_no = public._next_document_no('BILL'), confirmed_at = now(),
           confirmed_by = auth.uid(),
           -- The deposit is owed until money for it is taken (owner 2026-11-11)
           deposit_unpaid = deposit_amount,
           due_date = COALESCE(due_date, CASE WHEN is_credit_bill
                                              THEN public._local_date(now()) + v_customer.payment_terms_days END)
     WHERE id = p_bill_id;
    IF v_bill.quotation_id IS NOT NULL THEN
        PERFORM 1 FROM public.quotations WHERE id = v_bill.quotation_id AND status IN ('SENT', 'ACCEPTED') FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'QUOTATION_NOT_CONVERTIBLE' USING ERRCODE = '23514';
        END IF;
        FOR v_res IN SELECT * FROM public.reservations WHERE quotation_id = v_bill.quotation_id AND status = 'ACTIVE'
                      ORDER BY product_id FOR UPDATE LOOP
            PERFORM public._stock_move(v_res.product_id, 'RESERVED', 'AVAILABLE', v_res.quantity, 'RELEASE',
                                       'RESERVATION', v_res.id, NULL, 'converted to bill', v_corr);
            UPDATE public.reservations
               SET status = 'CONVERTED', converted_bill_id = p_bill_id, released_at = now(), released_by = auth.uid(),
                   release_reason = 'converted to bill'
             WHERE id = v_res.id;
        END LOOP;
        UPDATE public.quotations SET status = 'CONVERTED', converted_bill_id = p_bill_id, updated_by = auth.uid()
         WHERE id = v_bill.quotation_id;
    END IF;
    FOR v_line IN SELECT * FROM public.bill_lines WHERE bill_id = p_bill_id AND product_id IS NOT NULL ORDER BY product_id, line_no LOOP
        SELECT quantity INTO v_avail FROM public.stock_balances
         WHERE product_id = v_line.product_id AND stock_state = 'AVAILABLE' FOR UPDATE;
        v_alloc := least(COALESCE(v_avail, 0), v_line.ordered_qty);
        IF v_alloc < v_line.ordered_qty AND NOT v_backorder THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: line %, available %, ordered %', v_line.line_no, COALESCE(v_avail, 0),
                v_line.ordered_qty USING ERRCODE = '23514';
        END IF;
        IF v_alloc > 0 THEN
            PERFORM public._stock_move(v_line.product_id, 'AVAILABLE', 'RESERVED', v_alloc, 'RESERVE', 'BILL_LINE',
                                       v_line.id, NULL, NULL, v_corr);
        END IF;
        UPDATE public.bill_lines SET allocated_qty = v_alloc, backorder_qty = v_line.ordered_qty - v_alloc
         WHERE id = v_line.id;
    END LOOP;
    PERFORM public._bill_post_revenue(p_bill_id, v_corr);
    PERFORM public._bill_recalculate(p_bill_id);
    IF COALESCE(CASE WHEN jsonb_typeof(p_tenders) = 'array' THEN jsonb_array_length(p_tenders) END, 0) > 0 THEN
        v_receipt := public._payment_take(p_bill_id, p_tenders, v_idem.key_id, v_corr, NULL);
    END IF;
    PERFORM public._bill_settle(p_bill_id);
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    PERFORM public._audit('BILL_CONFIRM', 'BILL', p_bill_id, NULL, to_jsonb(v_bill), NULL, v_corr);
    RETURN public._idempotency_finish(v_idem.key_id,
        jsonb_build_object('bill', to_jsonb(v_bill), 'receipt', v_receipt));
END;
$$;

CREATE OR REPLACE FUNCTION public._line_recalculate(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.bill_void(p_bill_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill   public.bills%ROWTYPE;
    v_reason text;
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
    v_reason := public._bill_void_check(v_bill, p_reason);
    PERFORM public._bill_recalculate(p_bill_id);

    IF EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND line_mode = 'RENTAL' AND obligation_held_here > 0) THEN
        RAISE EXCEPTION 'ITEMS_STILL_WITH_CUSTOMER: receive the return first' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND line_mode = 'SALE' AND delivered_qty > 0
                 AND product_id IS NOT NULL) THEN
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
