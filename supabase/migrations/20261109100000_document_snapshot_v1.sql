-- Document snapshot v1 (owner 2026-11-09: "work by international standard").
-- 1. An issued document never changes when master data changes later:
--    bill_lines / quotation_items keep the product code, name and unit at the time of the document;
--    bills / quotations keep the customer's name, code, phones, address and tax id.
--    - quotation lines: taken when a line is saved; the customer is refreshed while the quotation is still
--      open and frozen once it is CONVERTED or REJECTED.
--    - bills: a draft shows live data; on confirm the customer and every line are taken once and then
--      locked (BILL_SNAPSHOT_IMMUTABLE).
--    Existing documents are filled from today's master data (the best record there is).
-- 2. A rental that is already with the customer can be continued (เช่าต่อ) even if the product was
--    suspended afterwards: suspending stops new work only. _list_price gains p_allow_inactive; only
--    create_rental_continuation passes true.

-- ----------------------------------------------------------------------------
-- 1a. Columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.bill_lines      ADD COLUMN IF NOT EXISTS product_sku text, ADD COLUMN IF NOT EXISTS product_name text, ADD COLUMN IF NOT EXISTS unit_name text;
ALTER TABLE public.quotation_items ADD COLUMN IF NOT EXISTS product_sku text, ADD COLUMN IF NOT EXISTS product_name text, ADD COLUMN IF NOT EXISTS unit_name text;
ALTER TABLE public.bills           ADD COLUMN IF NOT EXISTS customer_snapshot jsonb;
ALTER TABLE public.quotations      ADD COLUMN IF NOT EXISTS customer_snapshot jsonb;

-- ----------------------------------------------------------------------------
-- 1b. Snapshot helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._customer_snapshot(p_customer_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
           'name', c.name, 'customer_code', c.customer_code, 'phone', c.phone,
           'phone2', nullif(btrim(c.contact_details ->> 'phone2'), ''), 'address', c.address, 'tax_id', c.tax_id))
    FROM public.customers c WHERE c.id = p_customer_id
$$;

-- BEFORE INSERT on bill_lines / quotation_items: the product as it is now.
CREATE OR REPLACE FUNCTION public._line_product_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    SELECT p.sku, p.name, u.name INTO NEW.product_sku, NEW.product_name, NEW.unit_name
      FROM public.products p LEFT JOIN public.units u ON u.id = p.unit_id
     WHERE p.id = NEW.product_id;
    RETURN NEW;
END;
$function$;

-- BEFORE UPDATE on bill_lines: the product columns of a confirmed bill never change.
CREATE OR REPLACE FUNCTION public._bill_line_snapshot_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    IF (NEW.product_sku, NEW.product_name, NEW.unit_name) IS DISTINCT FROM (OLD.product_sku, OLD.product_name, OLD.unit_name)
       AND EXISTS (SELECT 1 FROM public.bills b WHERE b.id = NEW.bill_id AND b.status <> 'DRAFT') THEN
        RAISE EXCEPTION 'BILL_SNAPSHOT_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

-- BEFORE INSERT / UPDATE on bills: a draft has no snapshot (live); leaving DRAFT takes the customer and
-- every line once (the bill row is still DRAFT here, so the line guards allow it); afterwards it is locked.
CREATE OR REPLACE FUNCTION public._bill_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.customer_snapshot := CASE WHEN NEW.status <> 'DRAFT' THEN public._customer_snapshot(NEW.customer_id) END;
        RETURN NEW;
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status <> 'DRAFT' THEN
        NEW.customer_snapshot := public._customer_snapshot(NEW.customer_id);
        UPDATE public.bill_lines l
           SET product_sku = p.sku, product_name = p.name, unit_name = u.name
          FROM public.products p LEFT JOIN public.units u ON u.id = p.unit_id
         WHERE l.bill_id = NEW.id AND p.id = l.product_id;
    ELSIF OLD.status = 'DRAFT' THEN
        NEW.customer_snapshot := NULL;
    ELSIF NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot THEN
        RAISE EXCEPTION 'BILL_SNAPSHOT_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

-- BEFORE INSERT / UPDATE on quotations: refreshed while open, frozen once CONVERTED / REJECTED.
CREATE OR REPLACE FUNCTION public._quotation_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    IF TG_OP = 'INSERT' OR OLD.status NOT IN ('CONVERTED', 'REJECTED') THEN
        NEW.customer_snapshot := public._customer_snapshot(NEW.customer_id);
    ELSIF NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot THEN
        RAISE EXCEPTION 'QUOTATION_SNAPSHOT_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public._customer_snapshot(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1c. Fill existing documents from today's master data (timestamps and guards untouched)
-- ----------------------------------------------------------------------------
ALTER TABLE public.bills           DISABLE TRIGGER trg_bills_updated_at;
ALTER TABLE public.bill_lines      DISABLE TRIGGER trg_bill_lines_updated_at;
ALTER TABLE public.quotations      DISABLE TRIGGER trg_quotations_updated_at;
ALTER TABLE public.quotation_items DISABLE TRIGGER trg_quotation_items_guard;

UPDATE public.bills SET customer_snapshot = public._customer_snapshot(customer_id)
 WHERE status <> 'DRAFT' AND customer_id IS NOT NULL AND customer_snapshot IS NULL;
UPDATE public.bill_lines l SET product_sku = p.sku, product_name = p.name, unit_name = u.name
  FROM public.products p LEFT JOIN public.units u ON u.id = p.unit_id
 WHERE p.id = l.product_id AND l.product_name IS NULL;
UPDATE public.quotations SET customer_snapshot = public._customer_snapshot(customer_id)
 WHERE customer_id IS NOT NULL AND customer_snapshot IS NULL;
UPDATE public.quotation_items i SET product_sku = p.sku, product_name = p.name, unit_name = u.name
  FROM public.products p LEFT JOIN public.units u ON u.id = p.unit_id
 WHERE p.id = i.product_id AND i.product_name IS NULL;

ALTER TABLE public.bills           ENABLE TRIGGER trg_bills_updated_at;
ALTER TABLE public.bill_lines      ENABLE TRIGGER trg_bill_lines_updated_at;
ALTER TABLE public.quotations      ENABLE TRIGGER trg_quotations_updated_at;
ALTER TABLE public.quotation_items ENABLE TRIGGER trg_quotation_items_guard;

-- ----------------------------------------------------------------------------
-- 1d. Triggers (created after the fill, so the fill is not blocked by its own locks)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_bill_lines_product_snapshot ON public.bill_lines;
CREATE TRIGGER trg_bill_lines_product_snapshot BEFORE INSERT ON public.bill_lines
    FOR EACH ROW EXECUTE FUNCTION public._line_product_snapshot();
DROP TRIGGER IF EXISTS trg_quotation_items_product_snapshot ON public.quotation_items;
CREATE TRIGGER trg_quotation_items_product_snapshot BEFORE INSERT ON public.quotation_items
    FOR EACH ROW EXECUTE FUNCTION public._line_product_snapshot();
DROP TRIGGER IF EXISTS trg_bill_lines_snapshot_guard ON public.bill_lines;
CREATE TRIGGER trg_bill_lines_snapshot_guard BEFORE UPDATE ON public.bill_lines
    FOR EACH ROW EXECUTE FUNCTION public._bill_line_snapshot_guard();
DROP TRIGGER IF EXISTS trg_bills_snapshot ON public.bills;
CREATE TRIGGER trg_bills_snapshot BEFORE INSERT OR UPDATE ON public.bills
    FOR EACH ROW EXECUTE FUNCTION public._bill_snapshot();
DROP TRIGGER IF EXISTS trg_quotations_snapshot ON public.quotations;
CREATE TRIGGER trg_quotations_snapshot BEFORE INSERT OR UPDATE ON public.quotations
    FOR EACH ROW EXECUTE FUNCTION public._quotation_snapshot();

-- ----------------------------------------------------------------------------
-- 2. Continuing a rental of a product suspended afterwards
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._list_price(p_product_id uuid, p_mode text, p_allow_inactive boolean)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_product public.products%ROWTYPE;
BEGIN
    SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
    IF NOT FOUND OR (NOT v_product.active AND NOT p_allow_inactive) THEN
        RAISE EXCEPTION 'PRODUCT_INACTIVE_OR_MISSING: %', p_product_id USING ERRCODE = '23514';
    END IF;
    IF p_mode = 'SALE' AND NOT v_product.can_sell THEN
        RAISE EXCEPTION 'PRODUCT_CANNOT_SELL: %', v_product.sku USING ERRCODE = '23514';
    END IF;
    IF p_mode = 'RENTAL' AND NOT v_product.can_rent THEN
        RAISE EXCEPTION 'PRODUCT_CANNOT_RENT: %', v_product.sku USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN p_mode = 'SALE' THEN v_product.sale_price
                WHEN NOT v_product.is_rent_chargeable THEN 0
                ELSE v_product.rental_price END;
END;
$function$;

-- The 2-argument form (new work: drafts, quotations, price checks) still refuses a suspended product.
CREATE OR REPLACE FUNCTION public._list_price(p_product_id uuid, p_mode text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT public._list_price(p_product_id, p_mode, false)
$$;

REVOKE ALL ON FUNCTION public._list_price(uuid, text, boolean) FROM PUBLIC, anon, authenticated;

-- Body = live definition; the only change is _list_price(..., true) for the line being continued.
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
    INSERT INTO public.bills (status, customer_id, parent_bill_id, original_bill_id, continuation_start_mode, continuation_reason, created_by)
    VALUES ('DRAFT', v_parent.customer_id, v_parent.id, COALESCE(v_parent.original_bill_id, v_parent.id), p_start_mode,
            CASE WHEN p_start_mode IS NOT NULL THEN v_reason END, auth.uid())
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
