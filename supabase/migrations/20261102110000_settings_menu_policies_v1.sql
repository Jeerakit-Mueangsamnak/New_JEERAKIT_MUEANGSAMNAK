-- Owner 2026-11-02: ตั้งค่าระบบ stays OWNER-only, but staff keep the two menu-owned lists they use
-- in their own menus: category_defaults (สินค้า › ตั้งค่าเสริม › รายการ / ตารางประกอบข้อมูล) and
-- finance_income_items (การเงิน › รายรับด่วน). 20261031120000 blocked those too.
-- Same settings_update as 20261031120000 except the OWNER check below. No data is changed.
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
    -- vat_enabled is no longer a shop setting (per bill at the POS); quotations keep the stored value.
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
    IF v_new.vat_enabled AND (v_new.vat_rate IS NULL OR v_new.vat_mode IS NULL) THEN
        RAISE EXCEPTION 'VAT_SETUP_REQUIRED: set the VAT rate and price mode before switching VAT on'
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
    IF (v_new.vat_rate IS NULL) <> (v_new.vat_mode IS NULL) THEN
        RAISE EXCEPTION 'VAT_SETUP_INCOMPLETE: set both the VAT rate and the price mode' USING ERRCODE = '22023';
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
