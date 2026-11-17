-- ============================================================================
-- Guest name on a bill (owner 2026-11-16, POS): the cashier may type a customer name that is NOT saved as a
-- customer. The name lives on the bill only (bills.guest_name), is frozen into customer_snapshot when the
-- bill is confirmed (so bills, receipts, documents and the money statement show it), and lets a rental bill
-- be confirmed without a customer record. A bill with a customer record never carries a guest name.
-- Credit bills still need a customer record.
-- ============================================================================

ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS guest_name text;
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_guest_name_check;
ALTER TABLE public.bills ADD CONSTRAINT bills_guest_name_check
    CHECK (guest_name IS NULL OR (customer_id IS NULL AND char_length(btrim(guest_name)) BETWEEN 1 AND 200));

-- The customer part of a bill's snapshot: the saved customer, else the typed guest name.
CREATE OR REPLACE FUNCTION public._bill_customer_snapshot(p_customer_id uuid, p_guest_name text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT CASE
           WHEN p_customer_id IS NOT NULL THEN public._customer_snapshot(p_customer_id)
           WHEN NULLIF(btrim(p_guest_name), '') IS NOT NULL THEN jsonb_build_object('name', btrim(p_guest_name), 'guest', true)
         END
$$;
REVOKE ALL ON FUNCTION public._bill_customer_snapshot(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._bill_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.customer_snapshot := CASE WHEN NEW.status <> 'DRAFT' THEN public._bill_customer_snapshot(NEW.customer_id, NEW.guest_name) END;
        RETURN NEW;
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status <> 'DRAFT' THEN
        NEW.customer_snapshot := public._bill_customer_snapshot(NEW.customer_id, NEW.guest_name);
        UPDATE public.bill_lines l
           SET product_sku = p.sku, product_name = p.name, unit_name = u.name
          FROM public.products p LEFT JOIN public.units u ON u.id = p.unit_id
         WHERE l.bill_id = NEW.id AND p.id = l.product_id;
    ELSIF OLD.status = 'DRAFT' THEN
        NEW.customer_snapshot := NULL;
    ELSIF NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot THEN
        RAISE EXCEPTION 'BILL_SNAPSHOT_IMMUTABLE' USING ERRCODE = '42501';
    ELSIF NEW.guest_name IS DISTINCT FROM OLD.guest_name THEN
        RAISE EXCEPTION 'BILL_SNAPSHOT_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

-- Draft save: same as 20261111150000, plus guest_name (only when no customer is chosen).
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
                                'deposit_amount', 'deposit_note', 'lines', 'override_reason', 'guest_name'];
    v_reason    text;
    v_vat_on    boolean;
    v_vat_mode  text;
    v_guest     text;
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
    -- A typed customer name (no customer record); dropped when a saved customer is chosen.
    v_guest := CASE WHEN p_data ->> 'customer_id' IS NULL THEN NULLIF(btrim(p_data ->> 'guest_name'), '') END;
    IF char_length(v_guest) > 200 THEN
        RAISE EXCEPTION 'GUEST_NAME_TOO_LONG' USING ERRCODE = '22023';
    END IF;

    IF p_bill_id IS NULL THEN
        INSERT INTO public.bills (status, customer_id, quotation_id, vat_enabled, vat_mode, note, bill_discount_type, bill_discount_value,
            delivery_fee, installation_fee, service_fee, is_credit_bill, due_date, deposit_amount, deposit_note, created_by, guest_name)
        VALUES ('DRAFT', (p_data ->> 'customer_id')::uuid, (p_data ->> 'quotation_id')::uuid,
            v_vat_on, v_vat_mode,
            p_data ->> 'note', p_data ->> 'bill_discount_type', COALESCE((p_data ->> 'bill_discount_value')::numeric, 0),
            COALESCE((p_data ->> 'delivery_fee')::numeric, 0), COALESCE((p_data ->> 'installation_fee')::numeric, 0),
            COALESCE((p_data ->> 'service_fee')::numeric, 0), COALESCE((p_data ->> 'is_credit_bill')::boolean, false),
            (p_data ->> 'due_date')::date, COALESCE((p_data ->> 'deposit_amount')::numeric, 0), p_data ->> 'deposit_note',
            auth.uid(), v_guest)
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
               deposit_note = p_data ->> 'deposit_note',
               guest_name = v_guest
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

-- Confirm: same as 20261111150000, except a rental bill may go without a customer record when it has a guest name.
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
    ELSIF (v_has_rental AND v_bill.guest_name IS NULL) OR v_bill.is_credit_bill THEN
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

-- เช่าต่อ: same as 20261109100000, plus the parent's guest name goes to the new bill.
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
        v_list := public._list_price(v_from.product_id, 'RENTAL', true);
        v_price := COALESCE(v_item.unit_price, v_list);
        v_override := v_override OR v_price IS DISTINCT FROM v_list;
        v_no := v_no + 1;
        INSERT INTO public.bill_lines (bill_id, line_no, product_id, line_mode, ordered_qty, unit_price, price_overridden,
                                       rental_calculation_type, period_type, period_count, rental_start_at, rental_end_at,
                                       rental_status, created_by)
        VALUES (v_child.id, v_no, v_from.product_id, 'RENTAL', v_item.quantity, v_price, v_price IS DISTINCT FROM v_list,
                COALESCE(v_item.rental_calculation_type, v_from.rental_calculation_type), v_item.period_type, v_item.period_count,
                v_start, v_item.rental_end_at, 'SCHEDULED', auth.uid())
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
