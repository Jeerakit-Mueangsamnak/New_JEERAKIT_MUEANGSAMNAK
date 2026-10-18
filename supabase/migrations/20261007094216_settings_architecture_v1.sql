-- ============================================================================
-- Settings Architecture Rebuild v1 (2026-10-07) — LOCAL MIGRATION, NOT APPLIED.
-- Apply after supabase/baseline/00_baseline.sql. Changes:
--   1. VAT ON/OFF per bill: bills.vat_enabled (POS choice), snapshotted with the shop's
--      rate + mode by _bill_compute_totals; store_settings.vat_enabled is no longer written
--      by settings_update (quotation_save_draft still reads it — unchanged on purpose).
--   2. Document numbers PREFIX-DDMMBBBB-RUNNING, daily reset, one formatter + preview RPC.
--   3. Shop settings OWNER only: settings_update (except menu-owned policy keys) and the
--      'settings' menu becomes owner-only; new policy keys are validated.
-- Nothing in policies.app_config is copied or deleted (the app reads it as a fallback).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. VAT per bill
-- ----------------------------------------------------------------------------
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS vat_enabled boolean NOT NULL DEFAULT false;

-- Existing bills keep the VAT state they were priced with (from their snapshot).
UPDATE public.bills
   SET vat_enabled = true
 WHERE (pricing_snapshot ->> 'vat_enabled')::boolean IS TRUE AND NOT vat_enabled;

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
        IF (NEW.customer_id, NEW.quotation_id, NEW.vat_enabled,
            NEW.pricing_snapshot, NEW.bill_discount_type, NEW.bill_discount_value, NEW.delivery_fee,
            NEW.installation_fee, NEW.service_fee, NEW.sale_subtotal, NEW.rental_subtotal,
            NEW.bill_discount_amount, NEW.taxable_amount, NEW.vat_amount, NEW.grand_total,
            NEW.continuation_start_mode, NEW.continuation_reason, NEW.confirmed_at, NEW.confirmed_by)
           IS DISTINCT FROM
           (OLD.customer_id, OLD.quotation_id, OLD.vat_enabled,
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

-- A continuation bill (เช่าต่อ) carries the parent bill's VAT choice.
CREATE OR REPLACE FUNCTION public._bill_inherit_vat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.parent_bill_id IS NOT NULL THEN
        SELECT b.vat_enabled INTO NEW.vat_enabled FROM public.bills b WHERE b.id = NEW.parent_bill_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bills_inherit_vat ON public.bills;
CREATE TRIGGER trg_bills_inherit_vat BEFORE INSERT ON public.bills
    FOR EACH ROW EXECUTE FUNCTION public._bill_inherit_vat();

CREATE OR REPLACE FUNCTION public._bill_compute_totals(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill      public.bills%ROWTYPE;
    v_settings  public.store_settings;
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

    -- VAT ON/OFF is the bill's own choice (POS); the shop only sets rate + price mode.
    IF v_bill.vat_enabled AND (v_settings.vat_rate IS NULL OR v_settings.vat_rate <= 0 OR v_settings.vat_mode IS NULL) THEN
        RAISE EXCEPTION 'VAT_SETUP_REQUIRED: the OWNER must set the VAT rate and price mode first'
            USING ERRCODE = '22023';
    END IF;
    IF v_bill.vat_enabled THEN
        IF v_settings.vat_mode = 'INCLUSIVE' THEN
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
               'vat_mode', CASE WHEN v_bill.vat_enabled THEN v_settings.vat_mode END,
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
    v_allowed   text[] := ARRAY['customer_id', 'quotation_id', 'vat_enabled', 'note', 'bill_discount_type', 'bill_discount_value',
                                'delivery_fee', 'installation_fee', 'service_fee', 'is_credit_bill', 'due_date',
                                'deposit_amount', 'deposit_note', 'lines', 'override_reason'];
    v_reason    text;
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;
    IF p_data ? 'vat_enabled' AND jsonb_typeof(p_data -> 'vat_enabled') <> 'boolean' THEN
        RAISE EXCEPTION 'INVALID_VAT_ENABLED' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((p_data ->> 'deposit_amount')::numeric, 0) < 0 THEN
        RAISE EXCEPTION 'INVALID_DEPOSIT' USING ERRCODE = '22023';
    END IF;
    v_override := false;

    IF p_bill_id IS NULL THEN
        INSERT INTO public.bills (status, customer_id, quotation_id, vat_enabled, note, bill_discount_type, bill_discount_value,
            delivery_fee, installation_fee, service_fee, is_credit_bill, due_date, deposit_amount, deposit_note, created_by)
        VALUES ('DRAFT', (p_data ->> 'customer_id')::uuid, (p_data ->> 'quotation_id')::uuid,
            COALESCE((p_data ->> 'vat_enabled')::boolean, false),
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
               vat_enabled = COALESCE((p_data ->> 'vat_enabled')::boolean, false),
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

-- ----------------------------------------------------------------------------
-- 2. Document numbers: PREFIX-DDMMBBBB-RUNNING (owner rule 2026-10-07)
--    DD/MM = local day/month in the shop timezone, BBBB = Buddhist year (CE + 543),
--    running number restarts every local day, zero-padded to the type's digits (3-10,
--    default 3). One formatter (_format_document_no) serves numbering AND the Settings preview.
--    Old sequence rows (period YYYY / YYYYMM / ALL) stay untouched; daily rows use YYYYMMDD.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._doc_default_prefix(p_doc_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_doc_type
        WHEN 'QUOTATION' THEN 'QT' WHEN 'RESERVATION' THEN 'RS' WHEN 'BILL' THEN 'BL'
        WHEN 'RECEIPT' THEN 'RCP' WHEN 'REFUND' THEN 'RF'
        WHEN 'CREDIT_NOTE' THEN 'CN' WHEN 'APPOINTMENT' THEN 'AP' WHEN 'STOCK_ADJUSTMENT' THEN 'SA'
        WHEN 'INVENTORY_COUNT' THEN 'IC' WHEN 'DELIVERY' THEN 'DL'
        WHEN 'RETURN' THEN 'RT' WHEN 'EXPENSE' THEN 'EX' WHEN 'OTHER_INCOME' THEN 'OI' END;
$$;

CREATE OR REPLACE FUNCTION public._format_document_no(p_prefix text, p_local_date date, p_no bigint, p_digits integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    -- A running number longer than the digits is printed in full, never cut.
    SELECT p_prefix || '-' || to_char(p_local_date, 'DDMM')
           || lpad((extract(year FROM p_local_date)::integer + 543)::text, 4, '0') || '-'
           || CASE WHEN length(p_no::text) >= p_digits THEN p_no::text ELSE lpad(p_no::text, p_digits, '0') END;
$$;

-- Prefix + digits of a type from store_settings.doc_number_formats (defaults: server prefix, 3).
CREATE OR REPLACE FUNCTION public._doc_format(p_doc_type text, OUT o_prefix text, OUT o_digits integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_fmt jsonb;
BEGIN
    o_prefix := public._doc_default_prefix(p_doc_type);
    IF o_prefix IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_DOC_TYPE: %', p_doc_type USING ERRCODE = '22023';
    END IF;
    v_fmt := COALESCE((SELECT s.doc_number_formats -> p_doc_type FROM public.store_settings s WHERE s.singleton), '{}'::jsonb);
    o_prefix := COALESCE(NULLIF(v_fmt ->> 'prefix', ''), o_prefix);
    o_digits := least(10, greatest(3, COALESCE((v_fmt ->> 'digits')::integer, 3)));
END;
$$;

-- Next number at a given moment (tests pass their own time; the app always uses now()).
CREATE OR REPLACE FUNCTION public._next_document_no_at(p_doc_type text, p_at timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_prefix  text;
    v_digits  integer;
    v_day     date;
    v_period  text;
    v_no      bigint;
BEGIN
    SELECT f.o_prefix, f.o_digits INTO v_prefix, v_digits FROM public._doc_format(p_doc_type) f;
    v_day := (p_at AT TIME ZONE COALESCE((SELECT s.timezone FROM public.store_settings s WHERE s.singleton), 'Asia/Bangkok'))::date;
    v_period := to_char(v_day, 'YYYYMMDD');

    INSERT INTO public.document_sequences (doc_type, period_key, prefix, last_no)
    VALUES (p_doc_type, v_period, v_prefix, 0)
    ON CONFLICT (doc_type, period_key) DO NOTHING;

    -- The row lock serialises concurrent callers: each gets its own number, never reused.
    UPDATE public.document_sequences
       SET last_no = last_no + 1, updated_at = now()
     WHERE doc_type = p_doc_type AND period_key = v_period
    RETURNING last_no INTO v_no;

    RETURN public._format_document_no(v_prefix, v_day, v_no, v_digits);
END;
$$;

CREATE OR REPLACE FUNCTION public._next_document_no(p_doc_type text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public._next_document_no_at(p_doc_type, now());
$$;

-- Settings preview: the number the next document of this type would get today with this
-- prefix / digits, from the same formatter. Reads only; nothing is consumed. OWNER only.
CREATE OR REPLACE FUNCTION public.document_number_preview(p_doc_type text, p_prefix text DEFAULT NULL,
                                                          p_digits integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_prefix  text;
    v_digits  integer;
    v_day     date;
    v_last    bigint;
BEGIN
    PERFORM public._require_owner();
    SELECT f.o_prefix, f.o_digits INTO v_prefix, v_digits FROM public._doc_format(p_doc_type) f;
    IF p_prefix IS NOT NULL THEN
        IF p_prefix !~ '^[A-Z0-9]{1,10}$' THEN
            RAISE EXCEPTION 'INVALID_DOC_NUMBER_FORMAT: %', p_doc_type USING ERRCODE = '22023';
        END IF;
        v_prefix := p_prefix;
    END IF;
    IF p_digits IS NOT NULL THEN
        IF p_digits NOT BETWEEN 3 AND 10 THEN
            RAISE EXCEPTION 'INVALID_DOC_NUMBER_FORMAT: %', p_doc_type USING ERRCODE = '22023';
        END IF;
        v_digits := p_digits;
    END IF;
    v_day := public._local_date(now());
    SELECT d.last_no INTO v_last FROM public.document_sequences d
     WHERE d.doc_type = p_doc_type AND d.period_key = to_char(v_day, 'YYYYMMDD');
    RETURN public._format_document_no(v_prefix, v_day, COALESCE(v_last, 0) + 1, v_digits);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Shop settings OWNER only + validation of the v1 policy keys
-- ----------------------------------------------------------------------------
UPDATE public.menu_catalog SET owner_only = true WHERE code = 'settings';

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
    -- Shop settings are OWNER only. A USER may only write a menu-owned policy key with that menu.
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

-- ----------------------------------------------------------------------------
-- Grants (internal "_" helpers stay private, as in the baseline)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._doc_default_prefix(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._format_document_no(text, date, bigint, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._doc_format(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._next_document_no_at(text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._next_document_no(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._bill_inherit_vat() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.document_number_preview(text, text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.document_number_preview(text, text, integer) TO authenticated;
