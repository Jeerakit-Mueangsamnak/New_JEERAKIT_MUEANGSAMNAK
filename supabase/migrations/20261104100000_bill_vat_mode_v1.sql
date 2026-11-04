-- ============================================================================
-- Bill VAT mode v1 (2026-11-04) — LOCAL MIGRATION, NOT APPLIED TO CLOUD.
-- The POS payment page now has two buttons: "รวม VAT" (INCLUSIVE) and "ไม่รวม VAT" (EXCLUSIVE).
-- The chosen way of pricing VAT is stored on the bill (bills.vat_mode); the VAT RATE still comes
-- only from Settings (store_settings.vat_rate). A bill without vat_mode (old bills, quotation
-- conversions) falls back to store_settings.vat_mode, so nothing existing is priced differently.
-- Functions below are the 20261007094216 versions with the vat_mode additions only.
-- ============================================================================

ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS vat_mode text;
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_vat_mode_check;
ALTER TABLE public.bills ADD CONSTRAINT bills_vat_mode_check
    CHECK (vat_mode IS NULL OR vat_mode IN ('INCLUSIVE', 'EXCLUSIVE'));

-- Existing bills keep the way they were priced (from their snapshot).
UPDATE public.bills
   SET vat_mode = pricing_snapshot ->> 'vat_mode'
 WHERE vat_enabled
   AND vat_mode IS NULL
   AND pricing_snapshot ->> 'vat_mode' IN ('INCLUSIVE', 'EXCLUSIVE');

CREATE OR REPLACE FUNCTION public._bills_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF OLD.bill_no IS NOT NULL AND NEW.bill_no IS DISTINCT FROM OLD.bill_no THEN
        RAISE EXCEPTION 'BILL_NO_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    IF (NEW.parent_bill_id, NEW.original_bill_id, NEW.created_at, NEW.created_by)
       IS DISTINCT FROM (OLD.parent_bill_id, OLD.original_bill_id, OLD.created_at, OLD.created_by) THEN
        RAISE EXCEPTION 'BILL_LINEAGE_IMMUTABLE' USING ERRCODE = '42501';
    END IF;

    IF OLD.status <> 'DRAFT' THEN
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
$$;

-- A continuation bill (เช่าต่อ) carries the parent bill's VAT choice, including its pricing mode.
CREATE OR REPLACE FUNCTION public._bill_inherit_vat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.parent_bill_id IS NOT NULL THEN
        SELECT b.vat_enabled, b.vat_mode INTO NEW.vat_enabled, NEW.vat_mode
          FROM public.bills b WHERE b.id = NEW.parent_bill_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._bill_compute_totals(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill      public.bills%ROWTYPE;
    v_settings  public.store_settings;
    v_mode      text;
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
    IF v_bill.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'BILL_NOT_DRAFT' USING ERRCODE = '23514';
    END IF;
    v_settings := public._store_settings();
    -- The bill's own choice (POS button) wins; old bills fall back to the shop's setting.
    v_mode := COALESCE(v_bill.vat_mode, v_settings.vat_mode);

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
         WHERE i.bill_id = p_bill_id
      ) x
     WHERE l.id = x.id;

    SELECT COALESCE(sum(extended_amount) FILTER (WHERE line_mode = 'SALE'), 0),
           COALESCE(sum(extended_amount) FILTER (WHERE line_mode = 'RENTAL'), 0)
      INTO v_sale, v_rental
      FROM public.bill_lines WHERE bill_id = p_bill_id;

    v_sub := v_sale + v_rental;
    v_disc := CASE v_bill.bill_discount_type
        WHEN 'FIXED' THEN least(v_bill.bill_discount_value, v_sub)
        WHEN 'PERCENT' THEN round(v_sub * v_bill.bill_discount_value / 100, 2)
        ELSE 0 END;
    v_net := v_sub - v_disc + v_bill.delivery_fee + v_bill.installation_fee + v_bill.service_fee;

    -- VAT ON/OFF and INCLUSIVE/EXCLUSIVE are the bill's own choice (POS); the shop only sets the rate.
    IF v_bill.vat_enabled AND (v_settings.vat_rate IS NULL OR v_settings.vat_rate <= 0 OR v_mode IS NULL) THEN
        RAISE EXCEPTION 'VAT_SETUP_REQUIRED: the OWNER must set the VAT rate and the bill must choose รวม/ไม่รวม VAT'
            USING ERRCODE = '22023';
    END IF;
    IF v_bill.vat_enabled THEN
        IF v_mode = 'INCLUSIVE' THEN
            v_vat := round(v_net * v_settings.vat_rate / (100 + v_settings.vat_rate), 2);
            v_taxable := v_net - v_vat;
            v_grand := v_net;
        ELSE
            v_vat := round(v_net * v_settings.vat_rate / 100, 2);
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
           grand_total = v_grand,
           pricing_snapshot = jsonb_build_object(
               'vat_enabled', v_bill.vat_enabled,
               'vat_rate', CASE WHEN v_bill.vat_enabled THEN v_settings.vat_rate END,
               'vat_mode', CASE WHEN v_bill.vat_enabled THEN v_mode END,
               'discount_before_vat', true,
               'fees_taxable', true, 'computed_at', now())
     WHERE id = p_bill_id;
END;
$$;

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
            rental_start_at timestamptz, rental_end_at timestamptz)
    LOOP
        v_no := v_no + 1;
        v_list := public._list_price(v_line.product_id, v_line.line_mode);
        v_price := COALESCE(v_line.unit_price, v_list);
        v_override := v_override OR v_price IS DISTINCT FROM v_list;
        INSERT INTO public.bill_lines (bill_id, line_no, product_id, line_mode, ordered_qty, unit_price,
            price_overridden, line_discount_type, line_discount_value, rental_calculation_type, period_type,
            period_count, rental_start_at, rental_end_at, rental_status, created_by)
        VALUES (v_bill.id, v_no, v_line.product_id, v_line.line_mode, v_line.ordered_qty, v_price,
            v_price IS DISTINCT FROM v_list, v_line.line_discount_type, COALESCE(v_line.line_discount_value, 0),
            v_line.rental_calculation_type, v_line.period_type, v_line.period_count, v_line.rental_start_at,
            v_line.rental_end_at, CASE WHEN v_line.line_mode = 'RENTAL' THEN 'SCHEDULED' END, auth.uid());
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
