-- Quotations v1 (owner decisions 2026-10-18)
-- 1. VAT is chosen per quotation in POS (like a bill); rate + mode come from the shop settings.
--    The old store-wide vat_enabled flag is no longer read here.
-- 2. The document date picked in POS is stored as quotations.document_date (not in the future).
-- 3. A quotation that is not CONVERTED / REJECTED can be edited: it keeps its number and goes back to
--    DRAFT inside the save, then quotation_send puts it to SENT again (an accepted one must be accepted again).
-- 4. Quotations have no expiry: valid_until is no longer written and EXPIRED is no longer a target status.

ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS document_date date;
UPDATE public.quotations SET document_date = public._local_date(created_at) WHERE document_date IS NULL;
ALTER TABLE public.quotations ALTER COLUMN document_date SET DEFAULT public._local_date(now());
ALTER TABLE public.quotations ALTER COLUMN document_date SET NOT NULL;

CREATE OR REPLACE FUNCTION public.quotation_save_draft(p_quotation_id uuid, p_data jsonb, p_pin_token uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_q        public.quotations%ROWTYPE;
    v_item     record;
    v_price    numeric;
    v_gross    numeric(14,2);
    v_no       integer := 0;
    v_settings public.store_settings;
    v_sub      numeric(14,2);
    v_disc     numeric(14,2);
    v_vat      numeric(14,2) := 0;
    v_vat_on   boolean := COALESCE((p_data ->> 'vat_enabled')::boolean, false);
    v_doc_date date := COALESCE((p_data ->> 'document_date')::date, public._local_date(now()));
    v_override boolean := false;
    v_reason   text;
    v_revised  boolean := false;
BEGIN
    PERFORM public._require_menu('quotations');
    v_settings := public._store_settings();
    IF v_vat_on AND (COALESCE(v_settings.vat_rate, 0) <= 0 OR v_settings.vat_mode IS NULL) THEN
        RAISE EXCEPTION 'VAT_SETUP_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF v_doc_date > public._local_date(now()) THEN
        RAISE EXCEPTION 'DOCUMENT_DATE_IN_FUTURE' USING ERRCODE = '22023';
    END IF;

    IF p_quotation_id IS NULL THEN
        INSERT INTO public.quotations (customer_id, note, site_name, delivery_fee, deposit_amount, document_date, created_by)
        VALUES ((p_data ->> 'customer_id')::uuid, p_data ->> 'note',
                p_data ->> 'site_name', COALESCE((p_data ->> 'delivery_fee')::numeric, 0),
                COALESCE((p_data ->> 'deposit_amount')::numeric, 0), v_doc_date, auth.uid())
        RETURNING * INTO v_q;
    ELSE
        SELECT * INTO v_q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
        IF NOT FOUND OR v_q.status NOT IN ('DRAFT', 'SENT', 'ACCEPTED') THEN
            RAISE EXCEPTION 'QUOTATION_NOT_EDITABLE' USING ERRCODE = '23514';
        END IF;
        v_revised := v_q.status <> 'DRAFT';
        UPDATE public.quotations
           SET status = 'DRAFT',
               customer_id = (p_data ->> 'customer_id')::uuid,
               valid_until = NULL,
               note = p_data ->> 'note', site_name = p_data ->> 'site_name',
               delivery_fee = COALESCE((p_data ->> 'delivery_fee')::numeric, 0),
               deposit_amount = COALESCE((p_data ->> 'deposit_amount')::numeric, 0),
               document_date = v_doc_date,
               updated_by = auth.uid()
         WHERE id = v_q.id
        RETURNING * INTO v_q;
        DELETE FROM public.quotation_items WHERE quotation_id = v_q.id;
    END IF;

    FOR v_item IN
        SELECT * FROM jsonb_to_recordset(COALESCE(p_data -> 'items', '[]'::jsonb)) AS x(
            product_id uuid, line_mode text, quantity numeric, unit_price numeric, rental_calculation_type text,
            period_count numeric, rental_start_at timestamptz, rental_end_at timestamptz, discount_amount numeric)
    LOOP
        v_no := v_no + 1;
        v_price := public._check_price(v_item.product_id, v_item.line_mode, v_item.unit_price);
        v_override := v_override OR v_price IS DISTINCT FROM public._list_price(v_item.product_id, v_item.line_mode);
        v_gross := round(v_price * v_item.quantity
                         * CASE WHEN v_item.line_mode = 'RENTAL' THEN COALESCE(v_item.period_count, 0) ELSE 1 END, 2);
        INSERT INTO public.quotation_items (quotation_id, line_no, product_id, line_mode, quantity, unit_price,
            rental_calculation_type, period_count, rental_start_at, rental_end_at, discount_amount, line_total, created_by)
        VALUES (v_q.id, v_no, v_item.product_id, v_item.line_mode, v_item.quantity, v_price,
            v_item.rental_calculation_type, v_item.period_count, v_item.rental_start_at, v_item.rental_end_at,
            least(COALESCE(v_item.discount_amount, 0), v_gross), v_gross - least(COALESCE(v_item.discount_amount, 0), v_gross),
            auth.uid());
    END LOOP;

    SELECT COALESCE(sum(line_total), 0), COALESCE(sum(discount_amount), 0) INTO v_sub, v_disc
      FROM public.quotation_items WHERE quotation_id = v_q.id;
    -- Delivery fee is part of the quoted amount, like on the bill (VAT on goods + fee).
    IF v_vat_on THEN
        v_vat := CASE v_settings.vat_mode
            WHEN 'INCLUSIVE' THEN round((v_sub + v_q.delivery_fee) * v_settings.vat_rate / (100 + v_settings.vat_rate), 2)
            ELSE round((v_sub + v_q.delivery_fee) * v_settings.vat_rate / 100, 2) END;
    END IF;
    UPDATE public.quotations
       SET subtotal = v_sub, discount_total = v_disc, vat_amount = v_vat,
           grand_total = CASE WHEN v_vat_on AND v_settings.vat_mode = 'INCLUSIVE' THEN v_sub + v_q.delivery_fee
                              ELSE v_sub + v_q.delivery_fee + v_vat END,
           pricing_snapshot = jsonb_build_object('vat_enabled', v_vat_on,
               'vat_rate', CASE WHEN v_vat_on THEN v_settings.vat_rate END,
               'vat_mode', CASE WHEN v_vat_on THEN v_settings.vat_mode END)
     WHERE id = v_q.id
    RETURNING * INTO v_q;

    v_override := v_override OR EXISTS (SELECT 1 FROM public.quotation_items
                                         WHERE quotation_id = v_q.id
                                           AND public._discount_over_limit(discount_amount, line_total + discount_amount));
    IF v_override THEN
        PERFORM public._require_pin(p_pin_token, 'PRICE_OVERRIDE');
        v_reason := public._require_reason(p_data ->> 'override_reason');
    END IF;
    PERFORM public._audit(CASE WHEN v_revised THEN 'QUOTATION_REVISE' ELSE 'QUOTATION_SAVE_DRAFT' END,
                          'QUOTATION', v_q.id, NULL, to_jsonb(v_q), v_reason, NULL, v_override);
    RETURN to_jsonb(v_q);
END;
$function$;

-- No expiry: EXPIRED is no longer a target status (existing rows keep their value).
CREATE OR REPLACE FUNCTION public.quotation_set_status(p_quotation_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_q    public.quotations%ROWTYPE;
    v_r    uuid;
    v_corr uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('quotations');
    SELECT * INTO v_q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'QUOTATION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT ((v_q.status = 'SENT' AND p_status IN ('ACCEPTED', 'REJECTED'))
         OR (v_q.status = 'ACCEPTED' AND p_status = 'REJECTED')
         OR (v_q.status = 'DRAFT' AND p_status = 'REJECTED')) THEN
        RAISE EXCEPTION 'QUOTATION_STATUS_TRANSITION: % -> %', v_q.status, p_status USING ERRCODE = '23514';
    END IF;
    IF p_status = 'REJECTED' AND v_q.status = 'DRAFT' THEN
        -- quotation_no is required once a quotation leaves DRAFT.
        UPDATE public.quotations SET quotation_no = COALESCE(quotation_no, public._next_document_no('QUOTATION'))
         WHERE id = p_quotation_id;
    END IF;
    IF p_status = 'REJECTED' THEN
        FOR v_r IN SELECT id FROM public.reservations WHERE quotation_id = p_quotation_id AND status = 'ACTIVE' LOOP
            PERFORM public._reservation_release(v_r, 'CANCELLED', COALESCE(p_reason, 'quotation rejected'), v_corr);
        END LOOP;
    END IF;
    UPDATE public.quotations SET status = p_status, updated_by = auth.uid() WHERE id = p_quotation_id RETURNING * INTO v_q;
    PERFORM public._audit('QUOTATION_STATUS', 'QUOTATION', p_quotation_id, NULL, jsonb_build_object('status', p_status),
                          p_reason, v_corr);
    RETURN to_jsonb(v_q);
END;
$function$;
