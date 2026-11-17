-- ============================================================================
-- แก้ไขบิล on a confirmed bill (owner 2026-11-17, choice ก): add, remove and change goods, quantities, rounds,
-- dates, prices, discount and shipping — stock and money follow by themselves in the same step:
--   * remove a line   → reserved stock released; goods with the customer come back to AVAILABLE (a return is
--                        recorded for rental goods); sold goods back to AVAILABLE; the line stays as history
--                        (removed_at) and no longer counts in the bill total or revenue.
--   * more quantity   → the extra is reserved (backorder only when the shop allows it).
--   * less quantity   → backorder / reserved released first; when it goes below what is already with the customer
--                        the line is taken back and written again with the new quantity, handed over at once.
--   * price / rounds / dates / discount / shipping → the bill is priced again.
-- The bill total, VAT and the revenue ledger are recomputed (old revenue reversed, new revenue posted); payments stay
-- as they are, so a lower total shows as money to give back (the usual refund) and a higher one as money owed.
-- Bills and lines stay locked after confirm for every other path: only this function opens them (app.bill_revise,
-- transaction-local). Lines with เช่าต่อ links or serial-numbered goods with the customer must use รับคืน first.
-- ============================================================================

ALTER TABLE public.bill_lines ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE public.bill_lines ADD COLUMN IF NOT EXISTS removed_by uuid;

-- True only inside bill_revise (set_config(..., true) = this transaction only; clients cannot set it).
CREATE OR REPLACE FUNCTION public._bill_revising()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT COALESCE(current_setting('app.bill_revise', true), '') = 'on'
$$;
REVOKE ALL ON FUNCTION public._bill_revising() FROM PUBLIC, anon, authenticated;

-- Line guard: as before, except bill_revise may add lines and change terms of a confirmed bill.
CREATE OR REPLACE FUNCTION public._bill_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
    v_status text;
BEGIN
    SELECT b.status INTO v_status FROM public.bills b
     WHERE b.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.bill_id ELSE NEW.bill_id END;

    IF TG_OP IN ('INSERT', 'DELETE') THEN
        IF v_status <> 'DRAFT' AND NOT (TG_OP = 'INSERT' AND public._bill_revising()) THEN
            RAISE EXCEPTION 'BILL_LINES_LOCKED: bill is %', v_status USING ERRCODE = '42501';
        END IF;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF (NEW.bill_id, NEW.product_id, NEW.line_mode, NEW.created_at, NEW.created_by)
       IS DISTINCT FROM (OLD.bill_id, OLD.product_id, OLD.line_mode, OLD.created_at, OLD.created_by) THEN
        RAISE EXCEPTION 'BILL_LINE_IDENTITY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    IF v_status <> 'DRAFT' AND NOT public._bill_revising() AND
       (NEW.line_no, NEW.ordered_qty, NEW.unit_price, NEW.price_overridden, NEW.line_discount_type,
        NEW.line_discount_value, NEW.base_amount, NEW.line_discount_amount, NEW.extended_amount,
        NEW.rental_calculation_type, NEW.period_type, NEW.period_count, NEW.rental_start_at, NEW.rental_end_at,
        NEW.removed_at, NEW.removed_by)
       IS DISTINCT FROM
       (OLD.line_no, OLD.ordered_qty, OLD.unit_price, OLD.price_overridden, OLD.line_discount_type,
        OLD.line_discount_value, OLD.base_amount, OLD.line_discount_amount, OLD.extended_amount,
        OLD.rental_calculation_type, OLD.period_type, OLD.period_count, OLD.rental_start_at, OLD.rental_end_at,
        OLD.removed_at, OLD.removed_by) THEN
        RAISE EXCEPTION 'BILL_LINE_TERMS_IMMUTABLE_AFTER_CONFIRM' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

-- Bill guard: as before, except bill_revise may change the money terms of a confirmed bill.
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
        OR (OLD.status = 'ACTIVE' AND NEW.status IN ('CLOSED', 'VOID'))) THEN
        RAISE EXCEPTION 'BILL_STATUS_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

-- Revenue of a bill: as before, without removed lines.
CREATE OR REPLACE FUNCTION public._bill_post_revenue(p_bill_id uuid, p_correlation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_bill  public.bills%ROWTYPE;
    v_line  public.bill_lines%ROWTYPE;
BEGIN
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    FOR v_line IN SELECT * FROM public.bill_lines WHERE bill_id = p_bill_id AND removed_at IS NULL ORDER BY line_no LOOP
        PERFORM public._ledger('REVENUE', v_line.line_mode, v_line.extended_amount, 1::smallint,
                               p_bill_id, v_line.id, 'BILL_CONFIRM', p_bill_id, p_correlation_id);
    END LOOP;
    PERFORM public._ledger('REVENUE', 'DISCOUNT', v_bill.bill_discount_amount, (-1)::smallint,
                           p_bill_id, NULL, 'BILL_CONFIRM', p_bill_id, p_correlation_id);
    PERFORM public._ledger('REVENUE', 'DELIVERY_FEE', v_bill.delivery_fee, 1::smallint,
                           p_bill_id, NULL, 'BILL_CONFIRM', p_bill_id, p_correlation_id);
    PERFORM public._ledger('REVENUE', 'INSTALLATION_FEE', v_bill.installation_fee, 1::smallint,
                           p_bill_id, NULL, 'BILL_CONFIRM', p_bill_id, p_correlation_id);
    PERFORM public._ledger('REVENUE', 'SERVICE_FEE', v_bill.service_fee, 1::smallint,
                           p_bill_id, NULL, 'BILL_CONFIRM', p_bill_id, p_correlation_id);
    IF v_bill.vat_amount > 0 THEN
        PERFORM public._ledger('VAT', NULL, v_bill.vat_amount, 1::smallint,
                               p_bill_id, NULL, 'BILL_CONFIRM', p_bill_id, p_correlation_id);
        IF v_bill.pricing_snapshot ->> 'vat_mode' = 'INCLUSIVE' THEN
            PERFORM public._ledger('REVENUE', 'VAT_INCLUDED', v_bill.vat_amount, (-1)::smallint,
                                   p_bill_id, NULL, 'BILL_CONFIRM', p_bill_id, p_correlation_id);
        END IF;
    END IF;
END;
$function$;

-- Prices a confirmed bill again (same sums as _bill_compute_totals, live lines only, VAT as on its confirm day).
CREATE OR REPLACE FUNCTION public._bill_reprice(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_bill      public.bills%ROWTYPE;
    v_settings  public.store_settings;
    v_mode      text;
    v_rate      numeric;
    v_sale      numeric(14,2);
    v_rental    numeric(14,2);
    v_sub       numeric(14,2);
    v_disc      numeric(14,2);
    v_net       numeric(14,2);
    v_vat       numeric(14,2) := 0;
    v_taxable   numeric(14,2);
    v_grand     numeric(14,2);
BEGIN
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    v_settings := public._store_settings();
    v_mode := COALESCE(v_bill.pricing_snapshot ->> 'vat_mode', v_bill.vat_mode, v_settings.vat_mode);
    v_rate := COALESCE((v_bill.pricing_snapshot ->> 'vat_rate')::numeric, v_settings.vat_rate);

    UPDATE public.bill_lines l
       SET base_amount = x.base,
           line_discount_amount = x.disc,
           extended_amount = x.base - x.disc
      FROM (
        SELECT i.id,
               round(i.unit_price * i.ordered_qty * CASE WHEN i.line_mode = 'RENTAL' THEN i.period_count ELSE 1 END, 2) AS base,
               CASE i.line_discount_type
                   WHEN 'FIXED' THEN least(i.line_discount_value,
                        round(i.unit_price * i.ordered_qty * CASE WHEN i.line_mode = 'RENTAL' THEN i.period_count ELSE 1 END, 2))
                   WHEN 'PERCENT' THEN round(round(i.unit_price * i.ordered_qty
                        * CASE WHEN i.line_mode = 'RENTAL' THEN i.period_count ELSE 1 END, 2) * i.line_discount_value / 100, 2)
                   ELSE 0 END AS disc
          FROM public.bill_lines i
         WHERE i.bill_id = p_bill_id AND i.removed_at IS NULL
      ) x
     WHERE l.id = x.id;

    SELECT COALESCE(sum(extended_amount) FILTER (WHERE line_mode = 'SALE'), 0),
           COALESCE(sum(extended_amount) FILTER (WHERE line_mode = 'RENTAL'), 0)
      INTO v_sale, v_rental
      FROM public.bill_lines WHERE bill_id = p_bill_id AND removed_at IS NULL;

    v_sub := v_sale + v_rental;
    v_disc := CASE v_bill.bill_discount_type
        WHEN 'FIXED' THEN least(v_bill.bill_discount_value, v_sub)
        WHEN 'PERCENT' THEN round(v_sub * v_bill.bill_discount_value / 100, 2)
        ELSE 0 END;
    v_net := v_sub - v_disc + v_bill.delivery_fee + v_bill.installation_fee + v_bill.service_fee;

    IF v_bill.vat_enabled AND (v_rate IS NULL OR v_rate <= 0 OR v_mode IS NULL) THEN
        RAISE EXCEPTION 'VAT_SETUP_REQUIRED: the OWNER must set the VAT rate and the bill must choose รวม/ไม่รวม VAT'
            USING ERRCODE = '22023';
    END IF;
    IF v_bill.vat_enabled THEN
        IF v_mode = 'INCLUSIVE' THEN
            v_vat := round(v_net * v_rate / (100 + v_rate), 2);
            v_taxable := v_net - v_vat;
            v_grand := v_net;
        ELSE
            v_vat := round(v_net * v_rate / 100, 2);
            v_taxable := v_net;
            v_grand := v_net + v_vat;
        END IF;
    ELSE
        v_taxable := v_net;
        v_grand := v_net;
    END IF;

    UPDATE public.bills
       SET sale_subtotal = v_sale,
           rental_subtotal = v_rental,
           bill_discount_amount = v_disc,
           taxable_amount = v_taxable,
           vat_amount = v_vat,
           grand_total = v_grand
     WHERE id = p_bill_id;
END;
$function$;
REVOKE ALL ON FUNCTION public._bill_reprice(uuid) FROM PUBLIC, anon, authenticated;

-- Takes a line off a confirmed bill: stock back, the line kept as history (removed). Returns the return used.
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
    END IF;

    UPDATE public.bill_lines
       SET allocated_qty = 0, backorder_qty = 0, cancelled_qty = ordered_qty - delivered_qty,
           removed_at = now(), removed_by = auth.uid()
     WHERE id = p_line_id;
    PERFORM public._line_recalculate(p_line_id);
    RETURN v_return;
END;
$function$;
REVOKE ALL ON FUNCTION public._bill_line_take_back(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Writes a new line on a confirmed bill and reserves its stock (used for added goods and re-written lines).
CREATE OR REPLACE FUNCTION public._bill_line_write(p_bill_id uuid, p_line_no integer, p_item jsonb, p_correlation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_mode      text := p_item ->> 'line_mode';
    v_product   uuid := (p_item ->> 'product_id')::uuid;
    v_qty       numeric := (p_item ->> 'ordered_qty')::numeric;
    v_price     numeric := (p_item ->> 'unit_price')::numeric;
    v_periods   numeric := (p_item ->> 'period_count')::numeric;
    v_start     timestamptz := (p_item ->> 'rental_start_at')::timestamptz;
    v_end       timestamptz := (p_item ->> 'rental_end_at')::timestamptz;
    v_list      numeric;
    v_id        uuid;
    v_avail     numeric;
    v_alloc     numeric;
    v_backorder boolean := (public._policy('allow_backorder', 'false'::jsonb))::text::boolean;
BEGIN
    IF v_mode NOT IN ('SALE', 'RENTAL') OR v_qty IS NULL OR v_qty <= 0 OR (v_price IS NOT NULL AND v_price < 0)
       OR (v_mode = 'RENTAL' AND (v_periods IS NULL OR v_periods <= 0 OR v_start IS NULL OR v_end IS NULL OR v_end <= v_start)) THEN
        RAISE EXCEPTION 'INVALID_LINE' USING ERRCODE = '22023';
    END IF;
    IF v_product IS NULL THEN
        IF NULLIF(btrim(p_item ->> 'product_name'), '') IS NULL THEN
            RAISE EXCEPTION 'CUSTOM_LINE_NAME_REQUIRED' USING ERRCODE = '22023';
        END IF;
        IF v_price IS NULL THEN
            RAISE EXCEPTION 'CUSTOM_LINE_PRICE_REQUIRED' USING ERRCODE = '22023';
        END IF;
        v_list := v_price;
    ELSE
        -- refuses a product that cannot be sold / rented, and a suspended one unless the line is only re-written
        v_list := public._list_price(v_product, v_mode, COALESCE((p_item ->> 'allow_inactive')::boolean, false));
    END IF;
    v_price := COALESCE(v_price, v_list);

    INSERT INTO public.bill_lines (bill_id, line_no, product_id, line_mode, ordered_qty, unit_price, price_overridden,
        line_discount_value, rental_calculation_type, period_count, rental_start_at, rental_end_at, rental_status,
        product_name, unit_name, created_by)
    VALUES (p_bill_id, p_line_no, v_product, v_mode, v_qty, v_price, v_price IS DISTINCT FROM v_list, 0,
        CASE WHEN v_mode = 'RENTAL' THEN COALESCE(p_item ->> 'rental_calculation_type', 'PER_PERIOD') END,
        CASE WHEN v_mode = 'RENTAL' THEN v_periods END,
        CASE WHEN v_mode = 'RENTAL' THEN v_start END,
        CASE WHEN v_mode = 'RENTAL' THEN v_end END,
        CASE WHEN v_mode = 'RENTAL' THEN 'SCHEDULED' END,
        CASE WHEN v_product IS NULL THEN p_item ->> 'product_name' END,
        CASE WHEN v_product IS NULL THEN p_item ->> 'unit_name' END,
        auth.uid())
    RETURNING id INTO v_id;

    IF v_product IS NOT NULL THEN
        SELECT quantity INTO v_avail FROM public.stock_balances
         WHERE product_id = v_product AND stock_state = 'AVAILABLE' FOR UPDATE;
        v_alloc := least(COALESCE(v_avail, 0), v_qty);
        IF v_alloc < v_qty AND NOT v_backorder THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: line %, available %, ordered %', p_line_no, COALESCE(v_avail, 0), v_qty
                USING ERRCODE = '23514';
        END IF;
        IF v_alloc > 0 THEN
            PERFORM public._stock_move(v_product, 'AVAILABLE', 'RESERVED', v_alloc, 'RESERVE', 'BILL_LINE',
                                       v_id, NULL, 'added on แก้ไขบิล', p_correlation_id);
        END IF;
        UPDATE public.bill_lines SET allocated_qty = v_alloc, backorder_qty = v_qty - v_alloc WHERE id = v_id;
    END IF;
    PERFORM public._line_recalculate(v_id);
    RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public._bill_line_write(uuid, integer, jsonb, uuid) FROM PUBLIC, anon, authenticated;

/*
 * bill_revise(bill, data, key). data = {
 *   bill_discount_amount?: number,   -- the bill's own discount in baht (line discounts are kept)
 *   fees_total?: number,             -- delivery + installation + service (installation / service are kept)
 *   lines: [                         -- every line that stays or is added; a live line not listed = removed
 *     { line_id, ordered_qty?, unit_price?, period_count?, rental_start_at?, rental_end_at? }   -- missing = unchanged
 *     { product_id | product_name+unit_name, line_mode, ordered_qty, unit_price?, rental_calculation_type?,
 *       period_count?, rental_start_at?, rental_end_at? }                                        -- added
 *   ] }
 */
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
REVOKE ALL ON FUNCTION public.bill_revise(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_revise(uuid, jsonb, text) TO authenticated;
