-- ============================================================================
-- VAT mode per document v1 (owner 2026-11-04: "ใช้ของใหม่ตอนนี้").
-- Settings keep only the VAT RATE. รวม VAT / ไม่รวม VAT is chosen on each bill (20261104100000)
-- and now on each quotation too, with the same two buttons in POS.
--   1. settings_update: the rate no longer needs a price mode beside it (VAT_SETUP_INCOMPLETE gone).
--      store_settings.vat_mode is kept untouched only as the fallback for documents saved before.
--   2. quotation_save_draft: takes p_data.vat_mode (INCLUSIVE / EXCLUSIVE) and snapshots it.
-- Functions below are the latest versions (20261102110000 / 20261018100000) with these changes only.
-- No data is changed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.settings_update(p_patch jsonb, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old     public.store_settings%ROWTYPE;
    v_new     public.store_settings%ROWTYPE;
    v_reason  text := public._require_reason(p_reason);
    -- vat_enabled is no longer a shop setting; vat_mode is accepted only for old clients (not used for new documents).
    v_allowed text[] := ARRAY['company_name', 'tax_id', 'address', 'phone', 'logo_url', 'timezone',
                              'vat_rate', 'vat_mode', 'doc_number_formats', 'policies'];
    -- Policy keys a non-OWNER may still write from the menu that owns them.
    v_menu_pol jsonb := '{"category_defaults": "products", "finance_income_items": "finance"}'::jsonb;
    v_fmt     jsonb;
    v_pol     jsonb;
    v_key     text;
BEGIN
    IF NOT public.is_active_member() THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;
    -- Shop-wide settings are OWNER-only (owner 2026-11-02). A USER may still write a menu-owned
    -- policy key from that menu: category_defaults (สินค้า › ตั้งค่าเสริม: รายการ, default pricing
    -- type / unit) and finance_income_items (การเงิน: quick income list) — nothing else.
    IF NOT public.is_owner() THEN
        IF (COALESCE(p_patch, '{}'::jsonb) - 'policies') <> '{}'::jsonb
           OR jsonb_typeof(COALESCE(p_patch -> 'policies', '{}'::jsonb)) <> 'object'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_patch -> 'policies', '{}'::jsonb)) k
                       WHERE NOT (v_menu_pol ? k) OR NOT public.has_menu(v_menu_pol ->> k)) THEN
            RAISE EXCEPTION 'FORBIDDEN: shop settings are OWNER only' USING ERRCODE = '42501';
        END IF;
    END IF;
    -- Document numbers: PREFIX-DDMMBBBB-RUNNING; only known types, A-Z/0-9 prefix, 3-10 digits.
    FOR v_key, v_fmt IN SELECT * FROM jsonb_each(COALESCE(p_patch -> 'doc_number_formats', '{}'::jsonb)) LOOP
        IF public._doc_default_prefix(v_key) IS NULL
           OR jsonb_typeof(v_fmt) <> 'object'
           OR COALESCE(v_fmt ->> 'prefix', '') !~ '^[A-Z0-9]{1,10}$'
           OR jsonb_typeof(v_fmt -> 'digits') IS DISTINCT FROM 'number'
           OR (v_fmt ->> 'digits')::numeric NOT IN (3, 4, 5, 6, 7, 8, 9, 10) THEN
            RAISE EXCEPTION 'INVALID_DOC_NUMBER_FORMAT: %', v_key USING ERRCODE = '22023';
        END IF;
    END LOOP;

    SELECT * INTO v_old FROM public.store_settings WHERE singleton FOR UPDATE;
    v_new := jsonb_populate_record(v_old, p_patch - 'doc_number_formats' - 'policies');
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_new.timezone) THEN
        RAISE EXCEPTION 'INVALID_TIMEZONE: %', v_new.timezone USING ERRCODE = '22023';
    END IF;
    IF v_new.vat_enabled AND v_new.vat_rate IS NULL THEN
        RAISE EXCEPTION 'VAT_SETUP_REQUIRED: set the VAT rate before switching VAT on'
            USING ERRCODE = '22023';
    END IF;
    v_pol := v_old.policies || COALESCE(p_patch -> 'policies', '{}'::jsonb);
    IF v_pol -> 'discount_limit_enabled' = 'true'::jsonb
       AND (jsonb_typeof(v_pol -> 'discount_limit_percent') IS DISTINCT FROM 'number'
            OR (v_pol ->> 'discount_limit_percent')::numeric NOT BETWEEN 0 AND 100) THEN
        RAISE EXCEPTION 'DISCOUNT_LIMIT_PERCENT_REQUIRED: 0-100 when the discount limit is on' USING ERRCODE = '22023';
    END IF;
    IF NOT (COALESCE(v_pol -> 'auto_lock_options_seconds', '[]'::jsonb) @> COALESCE(v_pol -> 'auto_lock_default_seconds', 'null'::jsonb)) THEN
        RAISE EXCEPTION 'AUTO_LOCK_DEFAULT_NOT_IN_OPTIONS' USING ERRCODE = '22023';
    END IF;
    IF v_new.vat_rate IS NOT NULL AND v_new.vat_rate <= 0 THEN
        RAISE EXCEPTION 'INVALID_VAT_RATE' USING ERRCODE = '22023';
    END IF;
    FOR v_key IN SELECT unnest(ARRAY['business_profile', 'payment_receiving']) LOOP
        IF v_pol ? v_key AND jsonb_typeof(v_pol -> v_key) <> 'object' THEN
            RAISE EXCEPTION 'INVALID_POLICY: %', v_key USING ERRCODE = '22023';
        END IF;
    END LOOP;
    FOR v_key IN SELECT unnest(ARRAY['allow_overpayment', 'allow_backorder', 'reservation_auto_release', 'discount_limit_enabled']) LOOP
        IF v_pol ? v_key AND jsonb_typeof(v_pol -> v_key) <> 'boolean' THEN
            RAISE EXCEPTION 'INVALID_POLICY: %', v_key USING ERRCODE = '22023';
        END IF;
    END LOOP;
    IF v_pol ? 'default_reorder_point'
       AND (jsonb_typeof(v_pol -> 'default_reorder_point') <> 'number' OR (v_pol ->> 'default_reorder_point')::numeric < 0) THEN
        RAISE EXCEPTION 'INVALID_POLICY: default_reorder_point' USING ERRCODE = '22023';
    END IF;
    -- Auto-lock: the OWNER picks which of the app's times users may choose (0 = never).
    IF jsonb_typeof(COALESCE(v_pol -> 'auto_lock_options_seconds', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(COALESCE(v_pol -> 'auto_lock_options_seconds', '[]'::jsonb)) = 0
       OR NOT ('[30, 60, 120, 180, 240, 300, 600, 0]'::jsonb @> (v_pol -> 'auto_lock_options_seconds')) THEN
        RAISE EXCEPTION 'INVALID_POLICY: auto_lock_options_seconds' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(COALESCE(v_pol -> 'notifications', '{}'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'INVALID_POLICY: notifications' USING ERRCODE = '22023';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(COALESCE(v_pol -> 'notifications', '{}'::jsonb)) LOOP
        IF (v_pol -> 'notifications' -> v_key) ? 'daysBefore'
           AND (jsonb_typeof(v_pol -> 'notifications' -> v_key -> 'daysBefore') <> 'number'
                OR (v_pol -> 'notifications' -> v_key ->> 'daysBefore')::numeric < 0) THEN
            RAISE EXCEPTION 'INVALID_POLICY: notifications.%', v_key USING ERRCODE = '22023';
        END IF;
    END LOOP;

    UPDATE public.store_settings
       SET company_name = v_new.company_name, tax_id = v_new.tax_id, address = v_new.address,
           phone = v_new.phone, logo_url = v_new.logo_url, timezone = v_new.timezone,
           vat_enabled = v_new.vat_enabled, vat_rate = v_new.vat_rate, vat_mode = v_new.vat_mode,
           doc_number_formats = v_old.doc_number_formats || COALESCE(p_patch -> 'doc_number_formats', '{}'::jsonb),
           policies = v_old.policies || COALESCE(p_patch -> 'policies', '{}'::jsonb),
           updated_at = now(), updated_by = auth.uid()
     WHERE id = v_old.id
    RETURNING * INTO v_new;

    PERFORM public._audit('SETTINGS_UPDATE', 'STORE_SETTINGS', v_old.id, to_jsonb(v_old), to_jsonb(v_new), v_reason, NULL);
    RETURN to_jsonb(v_new);
END;
$$;

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
    v_mode     text;
    v_doc_date date := COALESCE((p_data ->> 'document_date')::date, public._local_date(now()));
    v_override boolean := false;
    v_reason   text;
    v_revised  boolean := false;
BEGIN
    PERFORM public._require_menu('quotations');
    v_settings := public._store_settings();
    IF p_data ? 'vat_mode' AND jsonb_typeof(p_data -> 'vat_mode') <> 'null'
       AND COALESCE(p_data ->> 'vat_mode', '') NOT IN ('INCLUSIVE', 'EXCLUSIVE') THEN
        RAISE EXCEPTION 'INVALID_VAT_MODE' USING ERRCODE = '22023';
    END IF;
    -- รวม / ไม่รวม VAT is this quotation's own button (owner 2026-11-04); the shop only sets the rate.
    -- A caller that sends no mode keeps the shop's old price mode.
    v_mode := CASE WHEN v_vat_on THEN COALESCE(p_data ->> 'vat_mode', v_settings.vat_mode) END;
    IF v_vat_on AND (COALESCE(v_settings.vat_rate, 0) <= 0 OR v_mode IS NULL) THEN
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
        v_vat := CASE v_mode
            WHEN 'INCLUSIVE' THEN round((v_sub + v_q.delivery_fee) * v_settings.vat_rate / (100 + v_settings.vat_rate), 2)
            ELSE round((v_sub + v_q.delivery_fee) * v_settings.vat_rate / 100, 2) END;
    END IF;
    UPDATE public.quotations
       SET subtotal = v_sub, discount_total = v_disc, vat_amount = v_vat,
           grand_total = CASE WHEN v_vat_on AND v_mode = 'INCLUSIVE' THEN v_sub + v_q.delivery_fee
                              ELSE v_sub + v_q.delivery_fee + v_vat END,
           pricing_snapshot = jsonb_build_object('vat_enabled', v_vat_on,
               'vat_rate', CASE WHEN v_vat_on THEN v_settings.vat_rate END,
               'vat_mode', v_mode)
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

