-- Every ACTIVE member may use everything (owner decision 2026-10-26, Master §4.2).
--   * every menu, shop settings included — no per-person menu grants any more;
--   * every risky action (refund, void, price change, stock adjust, expense, write-off) — no
--     per-person action grants any more;
--   * shop settings, LINE settings, driver links, data checks: any ACTIVE member.
-- Stays with the OWNER (Master §4.1/§4.2, unchanged): approving a new sign-up (PENDING → ACTIVE),
-- suspending, roles, resetting another member's PIN, and reading the audit log
-- (owner_set_member_* / owner_reset_member_pin / audit_logs policy / profiles policy).
-- user_menu_access and member_action_grants stay as history; nothing reads them for access now.
-- Non-destructive: no table or row is deleted; functions keep their grants.

UPDATE public.menu_catalog SET owner_only = false WHERE code = 'settings';

CREATE OR REPLACE FUNCTION public.has_menu(p_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.status = 'ACTIVE'
          AND (
              p.role = 'OWNER'
              OR EXISTS (SELECT 1 FROM public.menu_catalog m WHERE m.code = p_code AND NOT m.owner_only)
          )
    );
$$;

CREATE OR REPLACE FUNCTION public._require_action(p_code text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.is_active_member() THEN
        RAISE EXCEPTION 'FORBIDDEN: active member required' USING ERRCODE = '42501';
    END IF;
END;
$$;

-- Names of the shop's members for screens every member now uses (e.g. Settings › LINE staff).
-- Only id / name / username: e-mail, role and status stay readable by the OWNER only.
CREATE OR REPLACE FUNCTION public.member_directory()
RETURNS TABLE (id uuid, display_name text, username text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.id, p.display_name, p.username
      FROM public.profiles p
     WHERE public.is_active_member()
     ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.member_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_directory() TO authenticated;

-- settings_update: was OWNER only (latest definition: 20261007094216_settings_architecture_v1.sql); now any ACTIVE member.
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
    IF NOT public.is_active_member() THEN
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

-- document_number_preview: was OWNER only (latest definition: 20261007094216_settings_architecture_v1.sql); now any ACTIVE member.
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
    PERFORM public._require_active_member();
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

-- line_channel_clear: was OWNER only (latest definition: 20261008160000_line_operations_v1.sql); now any ACTIVE member.
CREATE OR REPLACE FUNCTION public.line_channel_clear(p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason text := public._require_reason(p_reason);
    v_count  integer;
BEGIN
    PERFORM public._require_active_member();
    IF to_regnamespace('vault') IS NULL THEN
        RAISE EXCEPTION 'LINE_VAULT_UNAVAILABLE' USING ERRCODE = '55000';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('public.line_channel_vault'));
    -- Clear = delete the Vault rows, so no ciphertext of an old credential is left behind
    -- (vault.update_secret with '' is not a documented "clear"). The audit row keeps the who/why.
    WITH gone AS (
        DELETE FROM vault.secrets WHERE name IN ('line_channel_secret', 'line_channel_access_token')
        RETURNING name
    )
    SELECT count(*) INTO v_count FROM gone;
    PERFORM public._audit('LINE_CHANNEL_CLEAR', 'LINE_CHANNEL', NULL, NULL,
                          jsonb_build_object('cleared', true, 'removed', v_count),
                          v_reason, NULL, false, NULL, NULL, 'LINE');
    RETURN public.line_channel_status();
END;
$$;

-- line_channel_set: was OWNER only (latest definition: 20261008160000_line_operations_v1.sql); now any ACTIVE member.
CREATE OR REPLACE FUNCTION public.line_channel_set(p_channel_secret text, p_access_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    PERFORM public._require_active_member();
    IF to_regnamespace('vault') IS NULL THEN
        RAISE EXCEPTION 'LINE_VAULT_UNAVAILABLE' USING ERRCODE = '55000';
    END IF;
    IF p_channel_secret IS NOT NULL AND p_channel_secret !~ '^[0-9a-f]{32}$' THEN
        RAISE EXCEPTION 'LINE_CHANNEL_SECRET_FORMAT' USING ERRCODE = '22023';
    END IF;
    IF p_access_token IS NOT NULL AND (length(p_access_token) NOT BETWEEN 20 AND 1024 OR p_access_token ~ '\s') THEN
        RAISE EXCEPTION 'LINE_ACCESS_TOKEN_FORMAT' USING ERRCODE = '22023';
    END IF;
    IF p_channel_secret IS NULL AND p_access_token IS NULL THEN
        RAISE EXCEPTION 'LINE_CREDENTIALS_REQUIRED' USING ERRCODE = '22023';
    END IF;
    -- One writer at a time: two saves at once must not both try to create the same name.
    PERFORM pg_advisory_xact_lock(hashtext('public.line_channel_vault'));
    IF p_channel_secret IS NOT NULL THEN
        SELECT id INTO v_id FROM vault.secrets WHERE name = 'line_channel_secret';
        IF v_id IS NULL THEN
            PERFORM vault.create_secret(p_channel_secret, 'line_channel_secret', 'LINE OA channel secret');
        ELSE
            PERFORM vault.update_secret(v_id, p_channel_secret);
        END IF;
    END IF;
    IF p_access_token IS NOT NULL THEN
        v_id := NULL;
        SELECT id INTO v_id FROM vault.secrets WHERE name = 'line_channel_access_token';
        IF v_id IS NULL THEN
            PERFORM vault.create_secret(p_access_token, 'line_channel_access_token', 'LINE OA channel access token');
        ELSE
            PERFORM vault.update_secret(v_id, p_access_token);
        END IF;
    END IF;
    PERFORM public._audit('LINE_CHANNEL_UPDATE', 'LINE_CHANNEL', NULL, NULL,
                          jsonb_build_object('secret_changed', p_channel_secret IS NOT NULL,
                                             'token_changed', p_access_token IS NOT NULL),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN public.line_channel_status();
END;
$$;

-- line_channel_status: was OWNER only (latest definition: 20261008160000_line_operations_v1.sql); now any ACTIVE member.
CREATE OR REPLACE FUNCTION public.line_channel_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret boolean := false;
    v_token  boolean := false;
BEGIN
    PERFORM public._require_active_member();
    IF to_regnamespace('vault') IS NOT NULL THEN
        SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'line_channel_secret'),
               EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'line_channel_access_token')
          INTO v_secret, v_token;
    END IF;
    RETURN jsonb_build_object('vault', to_regnamespace('vault') IS NOT NULL,
                              'secret_configured', v_secret, 'token_configured', v_token);
END;
$$;

-- line_invite_create: was OWNER only (latest definition: 20261022090000_line_full_v1.sql); now any ACTIVE member.
CREATE OR REPLACE FUNCTION public.line_invite_create(p_kind text, p_target text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ttl      integer := public._line_option_int('linkInviteTtlHours', 72, 1, 720);
    v_exp      timestamptz := now() + make_interval(hours => v_ttl);
    v_profile  uuid;
    v_customer uuid;
    v_driver   text;
    v_code     text;
    v_id       uuid;
    v_try      integer := 0;
BEGIN
    IF p_kind = 'STAFF' THEN
        PERFORM public._require_active_member();
        v_profile := p_target::uuid;
        IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_profile AND p.status = 'ACTIVE') THEN
            RAISE EXCEPTION 'MEMBER_NOT_ACTIVE' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.profile_id = v_profile AND x.status = 'LINKED') THEN
            RAISE EXCEPTION 'LINE_MEMBER_ALREADY_LINKED' USING ERRCODE = '22023';
        END IF;
    ELSIF p_kind = 'DRIVER' THEN
        PERFORM public._require_active_member();
        v_driver := p_target;
        IF NOT public._line_driver_active(v_driver) THEN
            RAISE EXCEPTION 'DRIVER_NOT_ACTIVE' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.driver_code = v_driver AND x.status = 'LINKED') THEN
            RAISE EXCEPTION 'LINE_DRIVER_ALREADY_LINKED' USING ERRCODE = '22023';
        END IF;
    ELSIF p_kind = 'CUSTOMER' THEN
        PERFORM public._require_menu('customers', 'bills', 'appointments', 'line');
        v_customer := p_target::uuid;
        IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_customer AND c.active) THEN
            RAISE EXCEPTION 'CUSTOMER_INACTIVE' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.customer_id = v_customer AND x.status = 'LINKED') THEN
            RAISE EXCEPTION 'LINE_CUSTOMER_ALREADY_LINKED' USING ERRCODE = '22023';
        END IF;
    ELSE
        RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = '22023';
    END IF;

    UPDATE public.line_link_codes SET revoked_at = now()
     WHERE used_at IS NULL AND revoked_at IS NULL
       AND ((v_profile IS NOT NULL AND profile_id = v_profile)
            OR (v_customer IS NOT NULL AND customer_id = v_customer)
            OR (v_driver IS NOT NULL AND driver_code = v_driver));
    LOOP
        v_try := v_try + 1;
        SELECT 'LINK-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b.r, i) % 32) + 1, 1), '' ORDER BY i)
          INTO v_code
          FROM (SELECT extensions.gen_random_bytes(10) AS r) b, generate_series(0, 9) AS i;
        BEGIN
            INSERT INTO public.line_link_codes (purpose, profile_id, customer_id, driver_code, code_hash, expires_at, created_by, via)
            VALUES (p_kind, v_profile, v_customer, v_driver, public._line_code_hash(v_code), v_exp, auth.uid(), 'INVITE')
            RETURNING id INTO v_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF v_try >= 5 THEN
                RAISE EXCEPTION 'LINE_CODE_BUSY: try again' USING ERRCODE = '40001';
            END IF;
        END;
    END LOOP;
    PERFORM public._audit('LINE_INVITE_CREATE', 'LINE_LINK_CODE', v_id, NULL,
                          jsonb_build_object('kind', p_kind, 'target', p_target, 'expires_at', v_exp),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('code', v_code, 'expires_at', v_exp);
END;
$$;

-- line_link_code_create_driver: was OWNER only (latest definition: 20261010090000_dispatch_driver_line_v1.sql); now any ACTIVE member.
CREATE OR REPLACE FUNCTION public.line_link_code_create_driver(p_driver_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ttl   integer := public._line_option_int('linkCodeTtlMinutes', 10, 2, 60);
    v_code  text;
    v_id    uuid;
    v_exp   timestamptz := now() + make_interval(mins => v_ttl);
    v_try   integer := 0;
BEGIN
    PERFORM public._require_active_member();
    IF NOT public._line_driver_active(p_driver_code) THEN
        RAISE EXCEPTION 'DRIVER_NOT_ACTIVE' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.driver_code = p_driver_code AND c.status = 'LINKED') THEN
        RAISE EXCEPTION 'LINE_DRIVER_ALREADY_LINKED' USING ERRCODE = '23505';
    END IF;
    UPDATE public.line_link_codes SET revoked_at = now()
     WHERE used_at IS NULL AND revoked_at IS NULL AND driver_code = p_driver_code;
    LOOP
        v_try := v_try + 1;
        SELECT 'LINK-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b.r, i) % 32) + 1, 1), '' ORDER BY i)
          INTO v_code
          FROM (SELECT extensions.gen_random_bytes(10) AS r) b, generate_series(0, 9) AS i;
        BEGIN
            INSERT INTO public.line_link_codes (purpose, driver_code, code_hash, expires_at, created_by)
            VALUES ('DRIVER', p_driver_code, public._line_code_hash(v_code), v_exp, auth.uid())
            RETURNING id INTO v_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF v_try >= 5 THEN
                RAISE EXCEPTION 'LINE_CODE_BUSY: try again' USING ERRCODE = '40001';
            END IF;
        END;
    END LOOP;
    PERFORM public._audit('LINE_LINK_CODE', 'LINE_LINK_CODE', v_id, NULL, jsonb_build_object('driver_code', p_driver_code),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('code_id', v_id, 'code', v_code, 'expires_at', v_exp);
END;
$$;

-- line_task_cancel: was OWNER only (latest definition: 20261008160000_line_operations_v1.sql); now any ACTIVE member.
CREATE OR REPLACE FUNCTION public.line_task_cancel(p_task_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_t      public.line_tasks%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_active_member();
    SELECT * INTO v_t FROM public.line_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_TASK_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_t.status IN ('DONE', 'CANCELLED') THEN
        RAISE EXCEPTION 'LINE_TASK_CLOSED' USING ERRCODE = '22023';
    END IF;
    UPDATE public.line_tasks
       SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason, updated_at = now()
     WHERE id = p_task_id;
    UPDATE public.line_deliveries SET status = 'CANCELLED', last_error_code = 'TASK_CANCELLED', updated_at = now()
     WHERE task_id = p_task_id AND status IN ('PENDING', 'FAILED');
    PERFORM public._audit('LINE_TASK_CANCEL', 'LINE_TASK', p_task_id, jsonb_build_object('status', v_t.status),
                          jsonb_build_object('status', 'CANCELLED'), v_reason, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('task_id', p_task_id, 'status', 'CANCELLED');
END;
$$;

-- line_task_create: was OWNER only (latest definition: 20261008160000_line_operations_v1.sql); now any ACTIVE member.
CREATE OR REPLACE FUNCTION public.line_task_create(
    p_task_id          uuid,
    p_assignee_id      uuid,
    p_title            text,
    p_detail           text,
    p_bill_id          uuid,
    p_appointment_id   uuid,
    p_messages         jsonb,
    p_idempotency_key  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_contact uuid;
    v_task    uuid;
    v_key     text;
    v_dup     uuid;
BEGIN
    PERFORM public._require_active_member();
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    v_key := 'T:' || auth.uid() || ':' || p_idempotency_key;
    SELECT task_id INTO v_dup FROM public.line_deliveries WHERE dedupe_key = v_key;
    IF v_dup IS NOT NULL THEN
        RETURN jsonb_build_object('task_id', v_dup, 'duplicate', true);
    END IF;
    IF NOT public._line_messages_valid(p_messages) OR p_task_id IS NULL
       OR position(p_task_id::text IN p_messages::text) = 0 THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.line_tasks WHERE id = p_task_id) THEN
        RAISE EXCEPTION 'DUPLICATE: task id' USING ERRCODE = '23505';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_assignee_id AND p.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'MEMBER_NOT_ACTIVE' USING ERRCODE = '22023';
    END IF;
    SELECT id INTO v_contact FROM public.line_contacts
     WHERE profile_id = p_assignee_id AND status = 'LINKED' AND followed;
    IF v_contact IS NULL THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.line_tasks (id, title, detail, assignee_id, bill_id, appointment_id, created_by)
    VALUES (p_task_id, btrim(p_title), NULLIF(btrim(COALESCE(p_detail, '')), ''), p_assignee_id, p_bill_id, p_appointment_id, auth.uid())
    RETURNING id INTO v_task;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, task_id, template_key, messages, dedupe_key, requested_by)
    VALUES (v_contact, 'TASK', v_task, v_task, 'TASK_NEW', p_messages, v_key, auth.uid());
    PERFORM public._audit('LINE_TASK_CREATE', 'LINE_TASK', v_task, NULL,
                          jsonb_build_object('assignee_id', p_assignee_id, 'bill_id', p_bill_id, 'appointment_id', p_appointment_id),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('task_id', v_task, 'duplicate', false);
END;
$$;

-- reconcile_bill: was OWNER only (latest definition: 00_baseline.sql); now any ACTIVE member.
CREATE OR REPLACE FUNCTION public.reconcile_bill(p_bill_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_before jsonb;
    v_after  jsonb;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_active_member() THEN
        RAISE EXCEPTION 'FORBIDDEN: OWNER only' USING ERRCODE = '42501';
    END IF;
    SELECT to_jsonb(b) INTO v_before FROM public.bills b WHERE id = p_bill_id FOR UPDATE;
    PERFORM public._bill_settle(p_bill_id);
    SELECT to_jsonb(b) INTO v_after FROM public.bills b WHERE id = p_bill_id;
    IF v_before IS DISTINCT FROM v_after THEN
        PERFORM public._audit('BILL_RECONCILE', 'BILL', p_bill_id, v_before, v_after, 'reconcile', NULL);
    END IF;
    RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$$;

-- reconcile_stock_balances: was OWNER only (latest definition: 00_baseline.sql); now any ACTIVE member.
CREATE OR REPLACE FUNCTION public.reconcile_stock_balances()
RETURNS TABLE (product_id uuid, stock_state text, cached numeric, ledger numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_active_member() THEN
        RAISE EXCEPTION 'FORBIDDEN: OWNER only' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT COALESCE(b.product_id, m.product_id), COALESCE(b.stock_state, m.stock_state),
           COALESCE(b.quantity, 0)::numeric, COALESCE(m.total, 0)::numeric
      FROM public.stock_balances b
      FULL JOIN (SELECT sm.product_id, sm.stock_state, sum(sm.quantity_delta) AS total
                   FROM public.stock_movements sm GROUP BY sm.product_id, sm.stock_state) m
        ON m.product_id = b.product_id AND m.stock_state = b.stock_state
     WHERE COALESCE(b.quantity, 0) <> COALESCE(m.total, 0);
END;
$$;

-- rental_overdue_scan: was OWNER only (latest definition: 20261019090000_personal_settings_v1.sql); now any ACTIVE member.
CREATE OR REPLACE FUNCTION public.rental_overdue_scan()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_m     record;
    v_n     jsonb;
    v_row   record;
    v_today date := public._local_date(now());
    v_count integer := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_active_member() THEN
        RAISE EXCEPTION 'FORBIDDEN: system job' USING ERRCODE = '42501';
    END IF;

    UPDATE public.bill_lines l
       SET rental_status = 'OVERDUE'
      FROM public.bills b
     WHERE b.id = l.bill_id AND l.line_mode = 'RENTAL' AND l.obligation_held_here > 0
       AND l.rental_end_at < now() AND b.status = 'ACTIVE'
       AND l.rental_status IS DISTINCT FROM 'OVERDUE';

    FOR v_m IN SELECT p.id, p.notification_prefs FROM public.profiles p WHERE p.status = 'ACTIVE' LOOP
        v_n := COALESCE(v_m.notification_prefs, '{}'::jsonb);

        IF public._member_has_menu(v_m.id, 'bills') THEN
            IF COALESCE((v_n -> 'overdueReturnReminder' ->> 'enabled')::boolean, true) THEN
                FOR v_row IN
                    SELECT l.id, l.bill_id, b.bill_no, l.rental_end_at
                      FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
                     WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND l.rental_end_at < now()
                       AND b.status = 'ACTIVE'
                LOOP
                    PERFORM public._notify('RENTAL_OVERDUE:' || v_row.id, 'RENTAL_OVERDUE', 'WARNING', v_m.id, NULL,
                                           'BILL', v_row.bill_id, 'เลยกำหนดคืน: ' || v_row.bill_no,
                                           'ครบกำหนดคืน ' || to_char(v_row.rental_end_at, 'YYYY-MM-DD HH24:MI')
                                           || ' — แจ้งเตือนเท่านั้น ไม่มีค่าปรับ');
                    v_count := v_count + 1;
                END LOOP;
            END IF;

            IF COALESCE((v_n -> 'returnReminder' ->> 'enabled')::boolean, true) THEN
                FOR v_row IN
                    SELECT l.id, l.bill_id, b.bill_no, l.rental_end_at
                      FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
                     WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND l.rental_end_at >= now()
                       AND public._local_date(l.rental_end_at) - v_today
                           <= COALESCE((v_n -> 'returnReminder' ->> 'daysBefore')::integer, 1)
                       AND b.status = 'ACTIVE'
                LOOP
                    PERFORM public._notify('RENTAL_DUE_SOON:' || v_row.id, 'RENTAL_DUE_SOON', 'INFO', v_m.id, NULL,
                                           'BILL', v_row.bill_id, 'ใกล้ถึงวันคืน: ' || v_row.bill_no,
                                           'ครบกำหนดคืน ' || to_char(v_row.rental_end_at, 'YYYY-MM-DD HH24:MI'));
                    v_count := v_count + 1;
                END LOOP;
            END IF;

            IF COALESCE((v_n -> 'deliveryReminder' ->> 'enabled')::boolean, true) THEN
                FOR v_row IN
                    SELECT l.id, l.bill_id, b.bill_no, l.rental_start_at
                      FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
                     WHERE l.rental_start_at IS NOT NULL AND l.delivered_qty + l.cancelled_qty < l.ordered_qty
                       AND public._local_date(l.rental_start_at) - v_today
                           <= COALESCE((v_n -> 'deliveryReminder' ->> 'daysBefore')::integer, 1)
                       AND b.status IN ('CONFIRMED', 'ACTIVE')
                LOOP
                    PERFORM public._notify('DELIVERY_DUE:' || v_row.id, 'DELIVERY_DUE', 'INFO', v_m.id, NULL,
                                           'BILL', v_row.bill_id, 'ถึงวันส่งของ: ' || v_row.bill_no,
                                           'กำหนดส่ง ' || to_char(v_row.rental_start_at, 'YYYY-MM-DD HH24:MI'));
                    v_count := v_count + 1;
                END LOOP;
            END IF;
        END IF;

        -- money owed per bill; repeats daily once the due date has passed
        IF public._member_has_menu(v_m.id, 'finance')
           AND COALESCE((v_n -> 'paymentReminder' ->> 'enabled')::boolean, true) THEN
            FOR v_row IN
                SELECT b.id AS bill_id, b.bill_no, b.balance_due, b.due_date
                  FROM public.bills b
                 WHERE b.status IN ('CONFIRMED', 'ACTIVE', 'CLOSED') AND b.balance_due > 0 AND b.due_date IS NOT NULL
                   AND b.due_date - v_today <= COALESCE((v_n -> 'paymentReminder' ->> 'daysBefore')::integer, 1)
            LOOP
                PERFORM public._notify('PAYMENT_DUE:' || v_row.bill_id || ':' || v_today, 'PAYMENT_DUE',
                                       CASE WHEN v_row.due_date < v_today THEN 'WARNING' ELSE 'INFO' END, v_m.id, NULL,
                                       'BILL', v_row.bill_id, 'ยอดค้างชำระ: ' || v_row.bill_no,
                                       'ค้าง ' || v_row.balance_due || ' บาท ครบกำหนด ' || v_row.due_date);
                v_count := v_count + 1;
            END LOOP;
        END IF;

        IF public._member_has_menu(v_m.id, 'products')
           AND COALESCE((v_n -> 'lowStockReminder' ->> 'enabled')::boolean, true) THEN
            FOR v_row IN
                SELECT p.id, p.sku, p.name, p.reorder_point,
                       COALESCE((SELECT sum(sb.quantity) FROM public.stock_balances sb
                                  WHERE sb.product_id = p.id AND sb.stock_state = 'AVAILABLE'), 0) AS available
                  FROM public.products p
                 WHERE p.active AND p.reorder_point > 0
            LOOP
                CONTINUE WHEN v_row.available > v_row.reorder_point;
                PERFORM public._notify('LOW_STOCK:' || v_row.id || ':' || v_today, 'LOW_STOCK', 'WARNING', v_m.id, NULL,
                                       'PRODUCT', v_row.id, 'สินค้าใกล้หมด: ' || v_row.sku || ' ' || v_row.name,
                                       'คงเหลือ ' || v_row.available || ' (จุดเตือน ' || v_row.reorder_point || ')');
                v_count := v_count + 1;
            END LOOP;
        END IF;

        IF public._member_has_menu(v_m.id, 'appointments')
           AND COALESCE((v_n -> 'appointmentReminder' ->> 'enabled')::boolean, true) THEN
            FOR v_row IN
                SELECT a.id, a.title, a.start_datetime
                  FROM public.appointments a
                 WHERE a.status IN ('DRAFT', 'SCHEDULED', 'CONFIRMED', 'RESCHEDULED')
                   AND a.start_datetime >= now()
                   AND public._local_date(a.start_datetime) - v_today
                       <= COALESCE((v_n -> 'appointmentReminder' ->> 'daysBefore')::integer, 3)
            LOOP
                PERFORM public._notify('APPOINTMENT_DUE:' || v_row.id, 'APPOINTMENT_DUE', 'INFO', v_m.id, NULL,
                                       'APPOINTMENT', v_row.id, 'ใกล้ถึงนัดหมาย: ' || v_row.title,
                                       'นัดหมาย ' || to_char(v_row.start_datetime, 'YYYY-MM-DD HH24:MI'));
                v_count := v_count + 1;
            END LOOP;
        END IF;
    END LOOP;
    RETURN v_count;
END;
$$;

-- line_contact_unlink: was OWNER only (latest definition: 20261010090000_dispatch_driver_line_v1.sql); now any ACTIVE member.
CREATE OR REPLACE FUNCTION public.line_contact_unlink(p_contact_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c       public.line_contacts%ROWTYPE;
    v_reason  text;
BEGIN
    PERFORM public._require_active_member();
    SELECT * INTO v_c FROM public.line_contacts WHERE id = p_contact_id FOR UPDATE;
    IF NOT FOUND OR v_c.status <> 'LINKED' THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = 'P0002';
    END IF;
    IF v_c.profile_id = auth.uid() THEN
        v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
    ELSIF public.is_active_member() OR (v_c.customer_id IS NOT NULL AND public.has_menu('line')) THEN
        v_reason := public._require_reason(p_reason);
    ELSE
        RAISE EXCEPTION 'FORBIDDEN: cannot unlink another member''s LINE' USING ERRCODE = '42501';
    END IF;
    UPDATE public.line_contacts
       SET status = 'UNLINKED', profile_id = NULL, customer_id = NULL, driver_code = NULL,
           unlinked_at = now(), unlinked_by = auth.uid(), unlink_reason = v_reason, updated_at = now()
     WHERE id = p_contact_id;
    -- Nothing still queued may reach a person who is no longer linked.
    UPDATE public.line_deliveries SET status = 'CANCELLED', last_error_code = 'UNLINKED', updated_at = now()
     WHERE contact_id = p_contact_id AND status IN ('PENDING', 'FAILED');
    PERFORM public._audit('LINE_UNLINK', CASE WHEN v_c.profile_id IS NOT NULL THEN 'PROFILE'
                                              WHEN v_c.customer_id IS NOT NULL THEN 'CUSTOMER' ELSE 'LINE_CONTACT' END,
                          COALESCE(v_c.profile_id, v_c.customer_id, v_c.id),
                          jsonb_build_object('contact_id', v_c.id, 'driver_code', v_c.driver_code), jsonb_build_object('status', 'UNLINKED'),
                          v_reason, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('contact_id', p_contact_id, 'status', 'UNLINKED');
END;
$$;
