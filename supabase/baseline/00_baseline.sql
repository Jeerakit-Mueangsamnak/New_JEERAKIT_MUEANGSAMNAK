-- ============================================================================
-- POS ขาย + เช่า — Consolidated Supabase Baseline (business schema)
-- File:    supabase/baseline/00_baseline.sql
-- Rules:   docs/PROJECT_RULES_MASTER_CURRENT.md v4.2.0 (Master Rules win over legacy code)
-- Design:  docs/SUPABASE_BASELINE_SCHEMA_DESIGN.md (section V42 wins over older sections)
-- Status:  NOT APPLIED to Supabase Cloud. Tested only on a throwaway local database
--          with supabase/tests/run_local.sh.
--
-- Prerequisite: supabase/auth-only/01_auth_profiles.sql is already applied
--          (public.profiles, signup trigger, is_active_member(), is_owner(),
--          set_updated_at(), _forbid_delete()). This file never recreates them.
-- Target:  a Supabase Postgres database (auth schema, roles anon / authenticated /
--          service_role, pgcrypto in schema extensions).
-- Run as:  postgres, in ONE transaction, e.g.
--            psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/baseline/00_baseline.sql
--
-- Security model (Master v4.2 §4, §28):
--   * Every table: UUID PK, RLS enabled, FKs ON DELETE RESTRICT, no CASCADE anywhere.
--   * Client role `authenticated` gets SELECT only (plus UPDATE of its own profile
--     name columns, from the auth file). Every write goes through a SECURITY DEFINER RPC
--     that checks: ACTIVE member + menu access + row locks + idempotency (money/stock)
--     + audit, in one transaction.
--   * Menu access (user_menu_access) replaces per-action permission codes: OWNER has
--     every menu by role, a USER only the menus an OWNER granted; nothing is automatic.
--   * Free-style operation (Master §4.4): no approval workflow. Risky actions need a
--     single-use PIN confirmation from verify_pin(), consumed server-side inside the
--     same transaction. PIN values are never stored (bcrypt hash only) nor logged.
--   * Ledger / history tables are append-only, enforced by trigger.
--
-- Error convention: RAISE EXCEPTION '<CODE>[: detail]' with
--   42501 = forbidden, 22023 = invalid input, P0002 = not found, 23514 = rule violated,
--   40001 = idempotency conflict / in progress.
-- ============================================================================

SET check_function_bodies = true;

-- ----------------------------------------------------------------------------
-- 0.1 Extensions
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
-- btree_gist: uuid "=" inside the EXCLUDE constraint on charges (overdue period overlap).
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
-- pgcrypto: bcrypt hashes for PINs (crypt / gen_salt). Supabase ships it in schema extensions.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 0.2 Default privileges: nothing created below is reachable by client roles
--     unless granted explicitly in section 27.
-- ----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 0.3 Generic trigger functions
-- ----------------------------------------------------------------------------

-- Append-only ledgers / history (Master §2.2, §29): no UPDATE, no DELETE, ever.
CREATE FUNCTION public._forbid_update_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$;

-- _forbid_delete() (no hard delete, Master §3.3) and set_updated_at() come from
-- supabase/auth-only/01_auth_profiles.sql.

-- ============================================================================
-- 1. IDENTITY / MENU ACCESS / PIN / CONTROL
-- ============================================================================

-- 1.1 profiles — lives in supabase/auth-only/01_auth_profiles.sql (applied first).

-- 1.2 menu_catalog — SoT of the app menus that can be granted (Master §4.2).
CREATE TABLE public.menu_catalog (
    code        text PRIMARY KEY,
    label_th    text NOT NULL,
    owner_only  boolean NOT NULL DEFAULT false,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT menu_catalog_code_check CHECK (code ~ '^[a-z_]+$'),
    CONSTRAINT menu_catalog_label_check CHECK (btrim(label_th) <> '')
);

-- 1.3 user_menu_access — menus an OWNER granted to a USER (no automatic grants).
--     Written only by owner_set_member_menus.
CREATE TABLE public.user_menu_access (
    user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    menu_code   text NOT NULL REFERENCES public.menu_catalog (code) ON DELETE RESTRICT,
    granted_by  uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    granted_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, menu_code),
    CONSTRAINT user_menu_access_not_self CHECK (granted_by <> user_id)
);
CREATE INDEX user_menu_access_menu_idx ON public.user_menu_access (menu_code);

-- 1.3b user_pins — 1 user = 1 PIN, bound to the account (Master §4.3). bcrypt hash only;
--      no client policy or grant, so no client can ever read it.
CREATE TABLE public.user_pins (
    user_id          uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE RESTRICT,
    pin_hash         text,                              -- NULL after a reset until the user sets a new PIN
    failed_attempts  integer NOT NULL DEFAULT 0,       -- misses since the last correct PIN
    locked_until     timestamptz,
    blocked_at       timestamptz,                       -- miss 10: USER needs an OWNER reset, OWNER re-signs in
    auto_lock_seconds integer,                          -- NULL = store default; 0 = never auto-lock
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_pins_attempts_check CHECK (failed_attempts >= 0),
    CONSTRAINT user_pins_auto_lock_check CHECK (auto_lock_seconds IS NULL OR auto_lock_seconds >= 0)
);

-- 1.3c pin_confirmations — single-use, short-lived proof that the current user just
--      entered the right PIN (verify_pin). A risky RPC consumes one inside its own
--      transaction, so a rolled-back action does not spend it. No client access.
CREATE TABLE public.pin_confirmations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    action      text NOT NULL,                      -- the one risky action this PIN entry authorises
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    used_for    text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pin_confirmations_used_check CHECK ((used_at IS NULL) = (used_for IS NULL))
);
CREATE INDEX pin_confirmations_user_idx ON public.pin_confirmations (user_id, expires_at);

-- 1.4 audit_logs — SoT, append-only, polymorphic (no FK on entity, Master §3.3 / §29).
CREATE TABLE public.audit_logs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,  -- NULL = system / service_role
    action          text NOT NULL,
    entity_type     text NOT NULL,
    entity_id       uuid,
    before_data     jsonb,
    after_data      jsonb,
    reason          text,
    device          text,
    pin_verified    boolean NOT NULL DEFAULT false,
    amount          numeric(14,2),
    quantity        numeric(12,3),
    channel         text,
    result          text NOT NULL DEFAULT 'SUCCESS',
    correlation_id  uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_logs_result_check CHECK (result IN ('SUCCESS', 'FAILED'))
);
CREATE INDEX audit_logs_entity_idx ON public.audit_logs (entity_type, entity_id, created_at);
CREATE INDEX audit_logs_actor_idx ON public.audit_logs (actor_id, created_at);
CREATE INDEX audit_logs_correlation_idx ON public.audit_logs (correlation_id);
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs (created_at);

-- 1.5 idempotency_keys — SoT of double-submit protection (Master §2.12, §28.4).
CREATE TABLE public.idempotency_keys (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action           text NOT NULL,
    idempotency_key  text NOT NULL,
    request_hash     text NOT NULL,
    actor_id         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    status           text NOT NULL DEFAULT 'IN_PROGRESS',
    response         jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    completed_at     timestamptz,
    CONSTRAINT idempotency_keys_status_check CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
    CONSTRAINT idempotency_keys_key_check CHECK (length(idempotency_key) BETWEEN 8 AND 200),
    CONSTRAINT idempotency_keys_uniq UNIQUE (actor_id, action, idempotency_key)
);
CREATE INDEX idempotency_keys_created_at_idx ON public.idempotency_keys (created_at);

-- 1.6 document_sequences — SoT of document numbers (Master §3.2). Never decremented.
CREATE TABLE public.document_sequences (
    doc_type    text NOT NULL,
    period_key  text NOT NULL,
    prefix      text NOT NULL,
    last_no     bigint NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (doc_type, period_key),
    CONSTRAINT document_sequences_type_check CHECK (doc_type IN (
        'QUOTATION', 'RESERVATION', 'BILL', 'RECEIPT', 'REFUND', 'CREDIT_NOTE',
        'APPOINTMENT', 'STOCK_ADJUSTMENT', 'INVENTORY_COUNT', 'DELIVERY',
        'RETURN', 'EXPENSE', 'OTHER_INCOME')),
    CONSTRAINT document_sequences_last_no_check CHECK (last_no >= 0)
);

CREATE FUNCTION public._document_sequences_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.last_no < OLD.last_no OR NEW.doc_type <> OLD.doc_type OR NEW.period_key <> OLD.period_key THEN
        RAISE EXCEPTION 'DOCUMENT_SEQUENCE_NO_RECYCLE' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- 1.7 store_settings — SoT of shop policy values (Master §37). Exactly one row.
CREATE TABLE public.store_settings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    singleton           boolean NOT NULL DEFAULT true UNIQUE,
    company_name        text,
    tax_id              text,
    address             text,
    phone               text,
    logo_url            text,
    timezone            text NOT NULL DEFAULT 'Asia/Bangkok',
    vat_enabled         boolean NOT NULL DEFAULT false,
    vat_rate            numeric(5,2),                   -- set by the OWNER before VAT is switched on
    vat_mode            text,                           -- INCLUSIVE / EXCLUSIVE, set by the OWNER
    doc_number_formats  jsonb NOT NULL DEFAULT '{}'::jsonb,
    policies            jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    updated_by          uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT store_settings_singleton_check CHECK (singleton),
    CONSTRAINT store_settings_vat_rate_check CHECK (vat_rate >= 0 AND vat_rate <= 100),
    CONSTRAINT store_settings_vat_mode_check CHECK (vat_mode IN ('INCLUSIVE', 'EXCLUSIVE')),
    -- One VAT switch for POS + Settings: ON only after the shop's tax setup is filled in.
    CONSTRAINT store_settings_vat_on_check CHECK (NOT vat_enabled OR (vat_rate IS NOT NULL AND vat_mode IS NOT NULL)),
    CONSTRAINT store_settings_formats_check CHECK (jsonb_typeof(doc_number_formats) = 'object'),
    CONSTRAINT store_settings_policies_check CHECK (jsonb_typeof(policies) = 'object')
);

-- ----------------------------------------------------------------------------
-- 1.9 Membership / menu / PIN helpers (search_path '').
--     is_active_member() and is_owner() come from the auth file. SECURITY DEFINER so RLS
--     on profiles cannot recurse. has_menu returns false, never raises (used in RLS).
-- ----------------------------------------------------------------------------

-- OWNER holds every menu by role; an ACTIVE USER only granted, non-owner-only menus.
CREATE FUNCTION public.has_menu(p_code text)
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
              OR EXISTS (
                  SELECT 1 FROM public.user_menu_access a
                    JOIN public.menu_catalog m ON m.code = a.menu_code
                   WHERE a.user_id = p.id AND a.menu_code = p_code AND NOT m.owner_only
              )
          )
    );
$$;

-- Fail-closed RPC gate: passes when the caller holds ANY of the listed menus.
-- An unknown menu code is a programming error, not "no access".
CREATE FUNCTION public._require_menu(VARIADIC p_codes text[])
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_code text;
BEGIN
    FOREACH v_code IN ARRAY p_codes LOOP
        IF NOT EXISTS (SELECT 1 FROM public.menu_catalog m WHERE m.code = v_code) THEN
            RAISE EXCEPTION 'UNKNOWN_MENU_CODE: %', v_code USING ERRCODE = 'XX000';
        END IF;
    END LOOP;
    IF auth.uid() IS NULL OR NOT public.is_active_member() THEN
        RAISE EXCEPTION 'FORBIDDEN: active member required' USING ERRCODE = '42501';
    END IF;
    FOREACH v_code IN ARRAY p_codes LOOP
        IF public.has_menu(v_code) THEN
            RETURN;
        END IF;
    END LOOP;
    RAISE EXCEPTION 'FORBIDDEN: menu % required', array_to_string(p_codes, ' or ') USING ERRCODE = '42501';
END;
$$;

-- Spends one PIN confirmation of the caller (Master §4.3–§4.4). Called inside the risky
-- RPC's own transaction: if the action fails, the confirmation is not spent either.
CREATE FUNCTION public._require_pin(p_token uuid, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_token IS NULL THEN
        RAISE EXCEPTION 'PIN_REQUIRED: %', p_action USING ERRCODE = '42501';
    END IF;
    UPDATE public.pin_confirmations
       SET used_at = now(), used_for = p_action
     WHERE id = p_token AND user_id = auth.uid() AND action = p_action AND used_at IS NULL AND expires_at > now();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PIN_CONFIRMATION_INVALID: verify the PIN again' USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE FUNCTION public._require_active_member()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_member() THEN
        RAISE EXCEPTION 'FORBIDDEN: active member required' USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE FUNCTION public._require_owner()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'FORBIDDEN: OWNER only' USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE FUNCTION public._require_reason(p_reason text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
    END IF;
    RETURN btrim(p_reason);
END;
$$;

-- Audit writer: actor always from auth.uid(), never from a parameter. Never receives a PIN.
CREATE FUNCTION public._audit(
    p_action          text,
    p_entity_type     text,
    p_entity_id       uuid,
    p_before          jsonb,
    p_after           jsonb,
    p_reason          text,
    p_correlation_id  uuid,
    p_pin_verified    boolean DEFAULT false,
    p_amount          numeric DEFAULT NULL,
    p_quantity        numeric DEFAULT NULL,
    p_channel         text DEFAULT NULL,
    p_result          text DEFAULT 'SUCCESS'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, reason,
                                   pin_verified, amount, quantity, channel, result, correlation_id)
    VALUES (auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason,
            COALESCE(p_pin_verified, false), p_amount, p_quantity, p_channel, COALESCE(p_result, 'SUCCESS'),
            COALESCE(p_correlation_id, gen_random_uuid()));
END;
$$;

-- Idempotency: keys are scoped per actor (actor_id, action, key), so one user can
-- never replay or block another user's request. A concurrent request from the same
-- actor with the same key blocks on the unique index until the first transaction
-- ends, then sees COMPLETED (replay) or nothing (retry).
CREATE FUNCTION public._idempotency_begin(
    p_action        text,
    p_key           text,
    p_request_hash  text,
    OUT key_id      uuid,
    OUT replay      jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row   public.idempotency_keys%ROWTYPE;
    v_actor uuid := auth.uid();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: active member required' USING ERRCODE = '42501';
    END IF;
    IF p_key IS NULL OR length(p_key) < 8 THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.idempotency_keys (actor_id, action, idempotency_key, request_hash)
    VALUES (v_actor, p_action, p_key, p_request_hash)
    ON CONFLICT (actor_id, action, idempotency_key) DO NOTHING
    RETURNING id INTO key_id;

    IF key_id IS NOT NULL THEN
        replay := NULL;
        RETURN;
    END IF;

    SELECT * INTO v_row
      FROM public.idempotency_keys
     WHERE actor_id = v_actor AND action = p_action AND idempotency_key = p_key;

    IF v_row.request_hash <> p_request_hash THEN
        RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: key reused with a different request' USING ERRCODE = '40001';
    END IF;
    IF v_row.status <> 'COMPLETED' THEN
        RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS' USING ERRCODE = '40001';
    END IF;

    key_id := v_row.id;
    replay := COALESCE(v_row.response, '{}'::jsonb) || jsonb_build_object('idempotent_replay', true);
END;
$$;

CREATE FUNCTION public._idempotency_finish(p_key_id uuid, p_response jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.idempotency_keys
       SET status = 'COMPLETED', response = p_response, completed_at = now()
     WHERE id = p_key_id;
    RETURN p_response;
END;
$$;

CREATE FUNCTION public._store_settings()
RETURNS public.store_settings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT * FROM public.store_settings WHERE singleton;
$$;

-- Policy lookup with a typed default (Master §37 values live in store_settings.policies).
CREATE FUNCTION public._policy(p_key text, p_default jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((SELECT s.policies -> p_key FROM public.store_settings s WHERE s.singleton), p_default);
$$;

-- Document numbers: lock the sequence row, never recycle, gaps allowed on rollback.
CREATE FUNCTION public._next_document_no(p_doc_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_settings  public.store_settings;
    v_fmt       jsonb;
    v_prefix    text;
    v_reset     text;
    v_digits    integer;
    v_period    text;
    v_no        bigint;
    v_local     timestamp;
BEGIN
    v_settings := public._store_settings();
    v_fmt := COALESCE(v_settings.doc_number_formats -> p_doc_type, '{}'::jsonb);
    v_prefix := COALESCE(v_fmt ->> 'prefix', CASE p_doc_type
        WHEN 'QUOTATION' THEN 'QT' WHEN 'RESERVATION' THEN 'RS' WHEN 'BILL' THEN 'BL'
        WHEN 'RECEIPT' THEN 'RCP' WHEN 'REFUND' THEN 'RF'
        WHEN 'CREDIT_NOTE' THEN 'CN' WHEN 'APPOINTMENT' THEN 'AP' WHEN 'STOCK_ADJUSTMENT' THEN 'SA'
        WHEN 'INVENTORY_COUNT' THEN 'IC' WHEN 'DELIVERY' THEN 'DL'
        WHEN 'RETURN' THEN 'RT' WHEN 'EXPENSE' THEN 'EX' WHEN 'OTHER_INCOME' THEN 'OI' END);
    IF v_prefix IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_DOC_TYPE: %', p_doc_type USING ERRCODE = '22023';
    END IF;
    v_reset := COALESCE(v_fmt ->> 'reset', 'YEARLY');
    v_digits := COALESCE((v_fmt ->> 'digits')::integer, 6);
    v_local := now() AT TIME ZONE COALESCE(v_settings.timezone, 'Asia/Bangkok');
    v_period := CASE v_reset
        WHEN 'MONTHLY' THEN to_char(v_local, 'YYYYMM')
        WHEN 'NEVER' THEN 'ALL'
        ELSE to_char(v_local, 'YYYY') END;

    INSERT INTO public.document_sequences (doc_type, period_key, prefix, last_no)
    VALUES (p_doc_type, v_period, v_prefix, 0)
    ON CONFLICT (doc_type, period_key) DO NOTHING;

    UPDATE public.document_sequences
       SET last_no = last_no + 1, updated_at = now()
     WHERE doc_type = p_doc_type AND period_key = v_period
    RETURNING last_no INTO v_no;

    RETURN v_prefix || '-' || CASE WHEN v_period = 'ALL' THEN '' ELSE v_period || '-' END
           || lpad(v_no::text, v_digits, '0');
END;
$$;

-- Local calendar date in the shop timezone (Master §16, §17.4).
CREATE FUNCTION public._local_date(p_ts timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (p_ts AT TIME ZONE COALESCE(
        (SELECT s.timezone FROM public.store_settings s WHERE s.singleton), 'Asia/Bangkok'))::date;
$$;

-- 1.10 Signup trigger and profile triggers live in the auth file.

-- Grants can only be written by an ACTIVE OWNER, for a USER, and never for owner-only menus.
CREATE FUNCTION public._user_menu_access_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p
                   WHERE p.id = NEW.granted_by AND p.role = 'OWNER' AND p.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'GRANT_REQUIRES_OWNER' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.role = 'USER') THEN
        RAISE EXCEPTION 'GRANT_TARGET_MUST_BE_USER' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.menu_catalog m WHERE m.code = NEW.menu_code AND m.owner_only) THEN
        RAISE EXCEPTION 'MENU_OWNER_ONLY: %', NEW.menu_code USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_menu_access_guard
    BEFORE INSERT OR UPDATE ON public.user_menu_access
    FOR EACH ROW EXECUTE FUNCTION public._user_menu_access_guard();

CREATE TRIGGER trg_menu_catalog_no_delete BEFORE DELETE ON public.menu_catalog
    FOR EACH ROW EXECUTE FUNCTION public._forbid_delete();
CREATE TRIGGER trg_user_pins_updated_at BEFORE UPDATE ON public.user_pins
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public._forbid_update_delete();
CREATE TRIGGER trg_document_sequences_guard BEFORE UPDATE ON public.document_sequences
    FOR EACH ROW EXECUTE FUNCTION public._document_sequences_guard();
CREATE TRIGGER trg_document_sequences_no_delete BEFORE DELETE ON public.document_sequences
    FOR EACH ROW EXECUTE FUNCTION public._forbid_delete();
CREATE TRIGGER trg_store_settings_no_delete BEFORE DELETE ON public.store_settings
    FOR EACH ROW EXECUTE FUNCTION public._forbid_delete();

-- ============================================================================
-- 2. MASTER DATA (Master §5, §7)
-- ============================================================================

-- 2.1 customers — SoT. No hard delete (active = false). Balances are derived (view).
CREATE TABLE public.customers (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_code       text UNIQUE,
    name                text NOT NULL,
    phone               text NOT NULL,
    address             text NOT NULL,
    customer_type       text,
    tax_id              text,
    email               text,
    contact_person      text,
    billing_address     text,
    delivery_address    text,
    tags                text[] NOT NULL DEFAULT '{}',
    credit_note         text,
    risk_note           text,
    contact_details     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- structured address parts, LINE, 2nd phone, ID card no.
    document_reference  text,
    note                text,
    credit_enabled      boolean NOT NULL DEFAULT false,
    credit_limit        numeric(14,2) NOT NULL DEFAULT 0,
    payment_terms_days  integer NOT NULL DEFAULT 0,
    account_status      text NOT NULL DEFAULT 'NORMAL',
    active              boolean NOT NULL DEFAULT true,
    last_activity_at    timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    updated_by          uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT customers_name_check CHECK (btrim(name) <> ''),
    CONSTRAINT customers_phone_check CHECK (btrim(phone) <> ''),
    CONSTRAINT customers_address_check CHECK (btrim(address) <> ''),
    CONSTRAINT customers_type_check CHECK (customer_type IS NULL OR customer_type IN ('INDIVIDUAL', 'COMPANY')),
    CONSTRAINT customers_credit_limit_check CHECK (credit_limit >= 0),
    CONSTRAINT customers_terms_check CHECK (payment_terms_days >= 0),
    CONSTRAINT customers_account_status_check CHECK (account_status IN ('NORMAL', 'CREDIT_BLOCKED'))
);
CREATE INDEX customers_name_idx ON public.customers (lower(name));
CREATE INDEX customers_phone_idx ON public.customers (phone);
CREATE INDEX customers_active_idx ON public.customers (active);

-- 2.2 product_categories — SoT.
CREATE TABLE public.product_categories (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT product_categories_name_check CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX product_categories_name_uidx ON public.product_categories (lower(name));

-- 2.2b units — pick-list of units of measure (Master §7: หน่วยนับเป็นรายการให้เลือก).
CREATE TABLE public.units (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    active      boolean NOT NULL DEFAULT true,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT units_name_check CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX units_name_uidx ON public.units (lower(name));

-- 2.3 products — SoT. No stock quantity column (Master §7, §11.2: stock_balances).
--     No cost column (product_costs). Extra fields per owner decision 2026-10-04:
--     accessory flag, tracked-but-not-rent-charged flag, must-return flag, default
--     damage / loss fee (pre-filled, editable before confirm). No image, no qty-per-set.
CREATE TABLE public.products (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku               text NOT NULL,
    name              text NOT NULL,
    category_id       uuid REFERENCES public.product_categories (id) ON DELETE RESTRICT,
    item_type         text NOT NULL DEFAULT 'QUANTITY',
    unit_id           uuid NOT NULL REFERENCES public.units (id) ON DELETE RESTRICT,
    calculation_type  text NOT NULL DEFAULT 'PER_UNIT',
    sale_price        numeric(14,2),
    rental_price      numeric(14,2),
    reorder_point     numeric(12,3) NOT NULL DEFAULT 0,
    can_sell          boolean NOT NULL DEFAULT false,
    can_rent          boolean NOT NULL DEFAULT false,
    is_accessory        boolean NOT NULL DEFAULT false,
    is_rent_chargeable  boolean NOT NULL DEFAULT true,
    requires_return     boolean NOT NULL DEFAULT true,
    default_damage_fee  numeric(14,2) NOT NULL DEFAULT 0,
    default_loss_fee    numeric(14,2) NOT NULL DEFAULT 0,
    active            boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    updated_by        uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT products_fees_check CHECK (default_damage_fee >= 0 AND default_loss_fee >= 0),
    CONSTRAINT products_sku_check CHECK (btrim(sku) <> ''),
    CONSTRAINT products_name_check CHECK (btrim(name) <> ''),
    CONSTRAINT products_item_type_check CHECK (item_type IN ('QUANTITY', 'SERIALIZED')),
    CONSTRAINT products_calc_type_check CHECK (calculation_type IN ('PER_UNIT', 'PER_DAY', 'PER_PERIOD')),
    CONSTRAINT products_sale_price_check CHECK (sale_price IS NULL OR sale_price >= 0),
    CONSTRAINT products_rental_price_check CHECK (rental_price IS NULL OR rental_price >= 0),
    CONSTRAINT products_reorder_check CHECK (reorder_point >= 0),
    CONSTRAINT products_capability_price_check CHECK (
        (NOT can_sell OR sale_price IS NOT NULL) AND (NOT can_rent OR rental_price IS NOT NULL))
);
CREATE UNIQUE INDEX products_sku_uidx ON public.products (sku);
CREATE INDEX products_active_category_idx ON public.products (active, category_id);
CREATE INDEX products_name_idx ON public.products (lower(name));

-- 2.4 product_costs — SoT of cost (menu "products").
CREATE TABLE public.product_costs (
    product_id  uuid PRIMARY KEY REFERENCES public.products (id) ON DELETE RESTRICT,
    cost_price  numeric(14,2) NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT product_costs_cost_check CHECK (cost_price >= 0)
);

-- 2.5 product_units — SoT of serialized rental units (Master §7.1).
--     unit_state is the unit's own custody state; quantity balances stay in stock_balances.
CREATE TABLE public.product_units (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
    serial_no   text NOT NULL,
    unit_state  text NOT NULL DEFAULT 'IN_STOCK',
    condition   text NOT NULL DEFAULT 'NORMAL',
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT product_units_serial_check CHECK (btrim(serial_no) <> ''),
    CONSTRAINT product_units_state_check CHECK (unit_state IN (
        'IN_STOCK', 'RENTED_OUT', 'SOLD', 'INSPECTION', 'REPAIR', 'DAMAGED', 'LOST', 'WRITTEN_OFF', 'INACTIVE')),
    CONSTRAINT product_units_condition_check CHECK (condition IN (
        'NORMAL', 'MINOR_DAMAGE', 'REPAIRABLE', 'MAJOR_DAMAGE', 'TOTAL_LOSS', 'LOST')),
    CONSTRAINT product_units_serial_uniq UNIQUE (product_id, serial_no)
);
CREATE INDEX product_units_state_idx ON public.product_units (product_id, unit_state);

CREATE FUNCTION public._product_units_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = NEW.product_id AND p.item_type = 'SERIALIZED') THEN
        RAISE EXCEPTION 'PRODUCT_NOT_SERIALIZED' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.product_id <> OLD.product_id OR NEW.serial_no <> OLD.serial_no) THEN
        RAISE EXCEPTION 'UNIT_IDENTITY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. CUSTOMER DOCUMENTS (Master §6) — contracts, ID copies, house registration.
--    Bound to the customer, never to a bill. Contracts are code templates filled with
--    the customer data snapshot; signatures are compact SVG/JSON; ID images live in
--    Supabase Storage and only their path is stored here.
-- ============================================================================

CREATE TABLE public.customer_documents (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id       uuid NOT NULL REFERENCES public.customers (id) ON DELETE RESTRICT,
    doc_type          text NOT NULL,
    template_code     text,
    template_version  text,
    data_snapshot     jsonb,
    signature_svg     text,
    signature_json    jsonb,
    storage_path      text,
    note              text,
    status            text NOT NULL DEFAULT 'ACTIVE',
    status_reason     text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    updated_by        uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT customer_documents_type_check CHECK (doc_type IN ('RENTAL_CONTRACT', 'ID_CARD', 'HOUSE_REGISTRATION', 'OTHER')),
    CONSTRAINT customer_documents_status_check CHECK (status IN ('ACTIVE', 'INACTIVE')),
    -- A contract must be re-printable with the same content (Master §6.3).
    CONSTRAINT customer_documents_contract_check CHECK (doc_type <> 'RENTAL_CONTRACT'
        OR (template_code IS NOT NULL AND template_version IS NOT NULL AND data_snapshot IS NOT NULL)),
    CONSTRAINT customer_documents_image_check CHECK (doc_type NOT IN ('ID_CARD', 'HOUSE_REGISTRATION')
        OR storage_path IS NOT NULL),
    CONSTRAINT customer_documents_path_check CHECK (storage_path IS NULL
        OR (btrim(storage_path) <> '' AND storage_path !~ '^/' AND storage_path !~ '\.\.')),
    CONSTRAINT customer_documents_inactive_check CHECK (status = 'ACTIVE' OR status_reason IS NOT NULL)
);
CREATE INDEX customer_documents_customer_idx ON public.customer_documents (customer_id, doc_type);

-- ============================================================================
-- 4. COMMERCIAL: QUOTATION / BILL / RESERVATION (Master §8, §10)
-- ============================================================================

CREATE TABLE public.quotations (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_no       text UNIQUE,
    customer_id        uuid REFERENCES public.customers (id) ON DELETE RESTRICT,
    status             text NOT NULL DEFAULT 'DRAFT',
    valid_until        timestamptz,
    subtotal           numeric(14,2) NOT NULL DEFAULT 0,
    discount_total     numeric(14,2) NOT NULL DEFAULT 0,
    vat_amount         numeric(14,2) NOT NULL DEFAULT 0,
    grand_total        numeric(14,2) NOT NULL DEFAULT 0,
    pricing_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
    converted_bill_id  uuid,  -- FK added after bills
    note               text,
    site_name          text,                                   -- job site shown on the quotation
    delivery_fee       numeric(14,2) NOT NULL DEFAULT 0,       -- carried into the bill on conversion
    deposit_amount     numeric(14,2) NOT NULL DEFAULT 0,       -- proposed deposit (the bill keeps the real one)
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    updated_by         uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT quotations_status_check CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'REJECTED', 'CONVERTED')),
    CONSTRAINT quotations_converted_check CHECK ((status = 'CONVERTED') = (converted_bill_id IS NOT NULL)),
    CONSTRAINT quotations_no_check CHECK (status = 'DRAFT' OR quotation_no IS NOT NULL),
    CONSTRAINT quotations_amounts_check CHECK (subtotal >= 0 AND discount_total >= 0 AND vat_amount >= 0 AND grand_total >= 0
        AND delivery_fee >= 0 AND deposit_amount >= 0)
);
CREATE INDEX quotations_customer_idx ON public.quotations (customer_id);
CREATE INDEX quotations_status_idx ON public.quotations (status, valid_until);

CREATE TABLE public.quotation_items (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_id             uuid NOT NULL REFERENCES public.quotations (id) ON DELETE RESTRICT,
    line_no                  integer NOT NULL,
    product_id               uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
    line_mode                text NOT NULL,
    quantity                 numeric(12,3) NOT NULL,
    unit_price               numeric(14,2) NOT NULL,
    rental_calculation_type  text,
    period_count             numeric(12,3),
    rental_start_at          timestamptz,
    rental_end_at            timestamptz,
    discount_amount          numeric(14,2) NOT NULL DEFAULT 0,
    line_total               numeric(14,2) NOT NULL DEFAULT 0,
    created_at               timestamptz NOT NULL DEFAULT now(),
    created_by               uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT quotation_items_line_uniq UNIQUE (quotation_id, line_no),
    CONSTRAINT quotation_items_mode_check CHECK (line_mode IN ('SALE', 'RENTAL')),
    CONSTRAINT quotation_items_qty_check CHECK (quantity > 0),
    CONSTRAINT quotation_items_price_check CHECK (unit_price >= 0 AND discount_amount >= 0 AND line_total >= 0),
    CONSTRAINT quotation_items_rental_check CHECK (
        line_mode = 'SALE'
        OR (rental_calculation_type IN ('PER_DAY', 'PER_PERIOD') AND period_count > 0
            AND rental_start_at IS NOT NULL AND rental_end_at > rental_start_at))
);
CREATE INDEX quotation_items_quotation_idx ON public.quotation_items (quotation_id);

-- 4.3 bills — head of the bill (neutral: SALE + RENTAL lines). Money/status columns
--     marked DRV are caches written only by public._bill_recalculate().
CREATE TABLE public.bills (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_no                     text UNIQUE,
    status                      text NOT NULL DEFAULT 'DRAFT',
    customer_id                 uuid REFERENCES public.customers (id) ON DELETE RESTRICT,
    quotation_id                uuid REFERENCES public.quotations (id) ON DELETE RESTRICT,
    parent_bill_id              uuid REFERENCES public.bills (id) ON DELETE RESTRICT,
    original_bill_id            uuid REFERENCES public.bills (id) ON DELETE RESTRICT,
    continuation_start_mode     text,
    continuation_reason         text,
    pricing_snapshot            jsonb NOT NULL DEFAULT '{}'::jsonb,
    bill_discount_type          text,
    bill_discount_value         numeric(14,2) NOT NULL DEFAULT 0,
    delivery_fee                numeric(14,2) NOT NULL DEFAULT 0,
    installation_fee            numeric(14,2) NOT NULL DEFAULT 0,
    service_fee                 numeric(14,2) NOT NULL DEFAULT 0,
    -- Deposit of this rental bill (Master §18): information only, never revenue, never
    -- part of grand_total, never deducted or refunded by the system.
    deposit_amount              numeric(14,2) NOT NULL DEFAULT 0,
    deposit_note                text,
    -- DRV ↓
    sale_subtotal               numeric(14,2) NOT NULL DEFAULT 0,
    rental_subtotal             numeric(14,2) NOT NULL DEFAULT 0,
    bill_discount_amount        numeric(14,2) NOT NULL DEFAULT 0,
    taxable_amount              numeric(14,2) NOT NULL DEFAULT 0,
    vat_amount                  numeric(14,2) NOT NULL DEFAULT 0,
    grand_total                 numeric(14,2) NOT NULL DEFAULT 0,
    paid_amount                 numeric(14,2) NOT NULL DEFAULT 0,
    refunded_amount             numeric(14,2) NOT NULL DEFAULT 0,
    adjustment_net              numeric(14,2) NOT NULL DEFAULT 0,
    charge_total                numeric(14,2) NOT NULL DEFAULT 0,
    write_off_total             numeric(14,2) NOT NULL DEFAULT 0,
    balance_due                 numeric(14,2) NOT NULL DEFAULT 0,
    payment_status              text NOT NULL DEFAULT 'UNPAID',
    -- DRV ↑
    is_credit_bill              boolean NOT NULL DEFAULT false,
    due_date                    date,
    confirmed_at                timestamptz,
    confirmed_by                uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    closed_at                   timestamptz,
    cancelled_at                timestamptz,
    cancelled_by                uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    cancel_reason               text,
    voided_at                   timestamptz,
    voided_by                   uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    void_reason                 text,
    note                        text,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    created_by                  uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bills_status_check CHECK (status IN ('DRAFT', 'CONFIRMED', 'ACTIVE', 'CLOSED', 'CANCELLED', 'VOID')),
    CONSTRAINT bills_payment_status_check CHECK (payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')),
    CONSTRAINT bills_no_check CHECK (status IN ('DRAFT', 'CANCELLED') OR bill_no IS NOT NULL),
    CONSTRAINT bills_lineage_pair_check CHECK ((parent_bill_id IS NULL) = (original_bill_id IS NULL)),
    CONSTRAINT bills_lineage_self_check CHECK (parent_bill_id IS NULL OR (parent_bill_id <> id AND original_bill_id <> id)),
    -- FROM_APPROVAL = starts when the continuation is recorded (no approval step in v4.2).
    CONSTRAINT bills_continuation_check CHECK (
        continuation_start_mode IS NULL
        OR (continuation_start_mode IN ('FROM_PREVIOUS_END', 'FROM_APPROVAL') AND parent_bill_id IS NOT NULL
            AND continuation_reason IS NOT NULL)),
    CONSTRAINT bills_deposit_check CHECK (deposit_amount >= 0),
    CONSTRAINT bills_discount_type_check CHECK (bill_discount_type IS NULL OR bill_discount_type IN ('FIXED', 'PERCENT')),
    CONSTRAINT bills_discount_value_check CHECK (bill_discount_value >= 0
        AND (bill_discount_type IS DISTINCT FROM 'PERCENT' OR bill_discount_value <= 100)),
    CONSTRAINT bills_fees_check CHECK (delivery_fee >= 0 AND installation_fee >= 0 AND service_fee >= 0),
    CONSTRAINT bills_amounts_check CHECK (sale_subtotal >= 0 AND rental_subtotal >= 0 AND bill_discount_amount >= 0
        AND taxable_amount >= 0 AND vat_amount >= 0 AND grand_total >= 0 AND paid_amount >= 0
        AND refunded_amount >= 0 AND charge_total >= 0 AND write_off_total >= 0),
    CONSTRAINT bills_cancel_check CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)),
    CONSTRAINT bills_void_check CHECK ((status = 'VOID') = (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX bills_customer_idx ON public.bills (customer_id, status);
CREATE INDEX bills_parent_idx ON public.bills (parent_bill_id);
CREATE INDEX bills_original_idx ON public.bills (original_bill_id);
CREATE INDEX bills_status_idx ON public.bills (status, payment_status);
CREATE INDEX bills_created_at_idx ON public.bills (created_at);

ALTER TABLE public.quotations
    ADD CONSTRAINT quotations_converted_bill_fk FOREIGN KEY (converted_bill_id)
    REFERENCES public.bills (id) ON DELETE RESTRICT;

-- 4.4 bill_lines — SoT for what was ordered; quantity/obligation columns are DRV
--     (written by _line_recalculate from deliveries / returns / carry forwards).
CREATE TABLE public.bill_lines (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id                   uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    line_no                   integer NOT NULL,
    product_id                uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
    line_mode                 text NOT NULL,
    ordered_qty               numeric(12,3) NOT NULL,
    unit_price                numeric(14,2) NOT NULL,
    price_overridden          boolean NOT NULL DEFAULT false,
    line_discount_type        text,
    line_discount_value       numeric(14,2) NOT NULL DEFAULT 0,
    base_amount               numeric(14,2) NOT NULL DEFAULT 0,  -- DRV
    line_discount_amount      numeric(14,2) NOT NULL DEFAULT 0,  -- DRV
    extended_amount           numeric(14,2) NOT NULL DEFAULT 0,  -- DRV
    rental_calculation_type   text,
    period_type               text,
    period_count              numeric(12,3),
    rental_start_at           timestamptz,
    rental_end_at             timestamptz,
    -- DRV quantities (Master §11.3, §14.1)
    allocated_qty             numeric(12,3) NOT NULL DEFAULT 0,
    backorder_qty             numeric(12,3) NOT NULL DEFAULT 0,
    cancelled_qty             numeric(12,3) NOT NULL DEFAULT 0,
    delivered_qty             numeric(12,3) NOT NULL DEFAULT 0,
    carried_in_qty            numeric(12,3) NOT NULL DEFAULT 0,
    physical_returned_qty     numeric(12,3) NOT NULL DEFAULT 0,
    approved_lost_qty         numeric(12,3) NOT NULL DEFAULT 0,
    approved_disposition_qty  numeric(12,3) NOT NULL DEFAULT 0,
    carried_forward_qty       numeric(12,3) NOT NULL DEFAULT 0,
    obligation_held_here      numeric(12,3) NOT NULL DEFAULT 0,
    return_status             text NOT NULL DEFAULT 'NOT_RETURNED',
    rental_status             text,
    fulfillment_status        text NOT NULL DEFAULT 'PENDING',
    actual_return_at          timestamptz,
    overdue_reviewed_at       timestamptz,
    overdue_reviewed_by       uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    created_at                timestamptz NOT NULL DEFAULT now(),
    created_by                uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bill_lines_line_uniq UNIQUE (bill_id, line_no),
    CONSTRAINT bill_lines_mode_check CHECK (line_mode IN ('SALE', 'RENTAL')),
    CONSTRAINT bill_lines_qty_check CHECK (ordered_qty > 0),
    CONSTRAINT bill_lines_price_check CHECK (unit_price >= 0),
    CONSTRAINT bill_lines_discount_type_check CHECK (line_discount_type IS NULL OR line_discount_type IN ('FIXED', 'PERCENT')),
    CONSTRAINT bill_lines_discount_value_check CHECK (line_discount_value >= 0
        AND (line_discount_type IS DISTINCT FROM 'PERCENT' OR line_discount_value <= 100)),
    CONSTRAINT bill_lines_amounts_check CHECK (base_amount >= 0 AND line_discount_amount >= 0 AND extended_amount >= 0),
    CONSTRAINT bill_lines_rental_check CHECK (
        (line_mode = 'SALE' AND rental_calculation_type IS NULL AND period_count IS NULL
            AND rental_start_at IS NULL AND rental_end_at IS NULL AND rental_status IS NULL)
        OR (line_mode = 'RENTAL' AND rental_calculation_type IN ('PER_DAY', 'PER_PERIOD') AND period_count > 0
            AND rental_start_at IS NOT NULL AND rental_end_at > rental_start_at AND rental_status IS NOT NULL)),
    CONSTRAINT bill_lines_derived_qty_check CHECK (allocated_qty >= 0 AND backorder_qty >= 0 AND cancelled_qty >= 0
        AND delivered_qty >= 0 AND carried_in_qty >= 0 AND physical_returned_qty >= 0 AND approved_lost_qty >= 0
        AND approved_disposition_qty >= 0 AND carried_forward_qty >= 0),
    CONSTRAINT bill_lines_obligation_check CHECK (obligation_held_here >= 0),
    CONSTRAINT bill_lines_fulfil_bounds_check CHECK (delivered_qty + cancelled_qty <= ordered_qty
        AND allocated_qty + backorder_qty + delivered_qty + cancelled_qty <= ordered_qty),
    CONSTRAINT bill_lines_return_status_check CHECK (return_status IN ('NOT_RETURNED', 'PARTIALLY_RETURNED', 'RETURNED')),
    CONSTRAINT bill_lines_rental_status_check CHECK (rental_status IS NULL OR rental_status IN (
        'SCHEDULED', 'ACTIVE', 'OVERDUE', 'RETURNED', 'RESOLVED', 'CLOSED')),
    CONSTRAINT bill_lines_fulfillment_check CHECK (fulfillment_status IN (
        'PENDING', 'RESERVED', 'BACKORDER', 'PARTIALLY_DELIVERED', 'DELIVERED', 'RENTED_OUT', 'CANCELLED'))
);
CREATE INDEX bill_lines_bill_idx ON public.bill_lines (bill_id);
CREATE INDEX bill_lines_product_idx ON public.bill_lines (product_id);
CREATE INDEX bill_lines_rental_status_idx ON public.bill_lines (line_mode, rental_status);
CREATE INDEX bill_lines_open_rental_end_idx ON public.bill_lines (rental_end_at) WHERE obligation_held_here > 0;

-- 4.5 reservations — quotation holds (Master §10). Bill checkout allocates stock
--     on the bill line itself (allocated_qty) instead of a reservation row.
CREATE TABLE public.reservations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_no    text NOT NULL UNIQUE,
    quotation_id      uuid NOT NULL REFERENCES public.quotations (id) ON DELETE RESTRICT,
    product_id        uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
    reservation_type  text NOT NULL,
    quantity          numeric(12,3) NOT NULL,
    status            text NOT NULL DEFAULT 'ACTIVE',
    expires_at        timestamptz,                    -- optional; release is manual until the owner sets a policy
    released_at       timestamptz,
    released_by       uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    release_reason    text,
    converted_bill_id uuid REFERENCES public.bills (id) ON DELETE RESTRICT,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT reservations_type_check CHECK (reservation_type IN ('SALE', 'RENTAL')),
    CONSTRAINT reservations_qty_check CHECK (quantity > 0),
    CONSTRAINT reservations_status_check CHECK (status IN ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'CONVERTED')),
    CONSTRAINT reservations_released_check CHECK (status IN ('PENDING', 'ACTIVE') OR released_at IS NOT NULL),
    CONSTRAINT reservations_converted_check CHECK ((status = 'CONVERTED') = (converted_bill_id IS NOT NULL))
);
CREATE INDEX reservations_expiry_idx ON public.reservations (status, expires_at);
CREATE INDEX reservations_product_idx ON public.reservations (product_id, status);
CREATE INDEX reservations_quotation_idx ON public.reservations (quotation_id);

-- 4.6 bill_adjustments — credit/debit after confirm (Master §19.2), append-only.
CREATE TABLE public.bill_adjustments (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id                 uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    bill_line_id            uuid REFERENCES public.bill_lines (id) ON DELETE RESTRICT,
    adjustment_type         text NOT NULL,
    amount                  numeric(14,2) NOT NULL,
    before_data             jsonb,
    after_data              jsonb,
    reason                  text NOT NULL,
    reverses_adjustment_id  uuid UNIQUE REFERENCES public.bill_adjustments (id) ON DELETE RESTRICT,
    correlation_id          uuid NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    created_by              uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    source                  text NOT NULL DEFAULT 'MANUAL',
    return_id               uuid,                   -- FK added after public.returns
    CONSTRAINT bill_adjustments_type_check CHECK (adjustment_type IN ('CREDIT', 'DEBIT')),
    CONSTRAINT bill_adjustments_source_check CHECK (source IN ('MANUAL', 'EARLY_RETURN')),
    CONSTRAINT bill_adjustments_early_return_check CHECK ((source = 'EARLY_RETURN') = (return_id IS NOT NULL)),
    CONSTRAINT bill_adjustments_amount_check CHECK (amount > 0),
    CONSTRAINT bill_adjustments_reason_check CHECK (btrim(reason) <> '')
);
CREATE INDEX bill_adjustments_bill_idx ON public.bill_adjustments (bill_id);

-- ============================================================================
-- 5. OPERATIONS: APPOINTMENTS (Master §26) — before deliveries (FK)
-- ============================================================================

CREATE TABLE public.appointments (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_no           text NOT NULL UNIQUE,
    appointment_type         text NOT NULL,
    customer_id              uuid REFERENCES public.customers (id) ON DELETE RESTRICT,
    bill_id                  uuid REFERENCES public.bills (id) ON DELETE RESTRICT,
    related_entity_type      text,
    related_entity_id        uuid,
    title                    text NOT NULL,
    description              text,
    start_datetime           timestamptz NOT NULL,
    end_datetime             timestamptz NOT NULL,
    location                 text,
    contact_name             text,
    contact_phone            text,
    assigned_user_id         uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    priority                 text NOT NULL DEFAULT 'NORMAL',
    status                   text NOT NULL DEFAULT 'SCHEDULED',
    reminder_before_minutes  integer,
    work_order               jsonb NOT NULL DEFAULT '{}'::jsonb,   -- on-site checklist: items + steps (app work order)
    cancel_reason            text,
    cancelled_by             uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    cancelled_at             timestamptz,
    created_at               timestamptz NOT NULL DEFAULT now(),
    created_by               uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT appointments_type_check CHECK (appointment_type IN (
        'PICKUP', 'DELIVERY', 'RETURN', 'INSTALLATION', 'PAYMENT', 'FOLLOW_UP', 'INSPECTION', 'REPAIR', 'GENERAL')),
    CONSTRAINT appointments_title_check CHECK (btrim(title) <> ''),
    CONSTRAINT appointments_time_check CHECK (end_datetime >= start_datetime),
    CONSTRAINT appointments_priority_check CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    CONSTRAINT appointments_status_check CHECK (status IN (
        'DRAFT', 'SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED')),
    CONSTRAINT appointments_reminder_check CHECK (reminder_before_minutes IS NULL OR reminder_before_minutes >= 0),
    CONSTRAINT appointments_cancel_check CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE INDEX appointments_start_idx ON public.appointments (start_datetime);
CREATE INDEX appointments_assigned_idx ON public.appointments (assigned_user_id, start_datetime);
CREATE INDEX appointments_customer_idx ON public.appointments (customer_id);
CREATE INDEX appointments_bill_idx ON public.appointments (bill_id);

CREATE TABLE public.appointment_history (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id           uuid NOT NULL REFERENCES public.appointments (id) ON DELETE RESTRICT,
    change_type              text NOT NULL,
    original_start_datetime  timestamptz,
    new_start_datetime       timestamptz,
    before_data              jsonb,
    after_data               jsonb,
    reason                   text,
    created_at               timestamptz NOT NULL DEFAULT now(),
    created_by               uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT appointment_history_type_check CHECK (change_type IN ('CREATE', 'UPDATE', 'RESCHEDULE', 'STATUS', 'ASSIGN'))
);
CREATE INDEX appointment_history_appointment_idx ON public.appointment_history (appointment_id, created_at);

-- ============================================================================
-- 6. FULFILLMENT / RETURN / CONTINUATION (Master §12, §14, §17)
-- ============================================================================

CREATE TABLE public.deliveries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_no     text NOT NULL UNIQUE,
    bill_id         uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    delivered_at    timestamptz NOT NULL,
    delivered_by    uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    appointment_id  uuid REFERENCES public.appointments (id) ON DELETE RESTRICT,
    note            text,
    correlation_id  uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT
);
CREATE INDEX deliveries_bill_idx ON public.deliveries (bill_id);

CREATE TABLE public.delivery_lines (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id      uuid NOT NULL REFERENCES public.deliveries (id) ON DELETE RESTRICT,
    bill_line_id     uuid NOT NULL REFERENCES public.bill_lines (id) ON DELETE RESTRICT,
    product_unit_id  uuid REFERENCES public.product_units (id) ON DELETE RESTRICT,
    quantity         numeric(12,3) NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT delivery_lines_qty_check CHECK (quantity > 0),
    CONSTRAINT delivery_lines_unit_qty_check CHECK (product_unit_id IS NULL OR quantity = 1)
);
CREATE INDEX delivery_lines_line_idx ON public.delivery_lines (bill_line_id);
CREATE INDEX delivery_lines_unit_idx ON public.delivery_lines (product_unit_id);
CREATE INDEX delivery_lines_delivery_idx ON public.delivery_lines (delivery_id);

CREATE TABLE public.returns (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_no       text NOT NULL UNIQUE,
    bill_id         uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    returned_at     timestamptz NOT NULL,
    received_by     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    note            text,
    correlation_id  uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT
);
CREATE INDEX returns_bill_idx ON public.returns (bill_id);
ALTER TABLE public.bill_adjustments ADD CONSTRAINT bill_adjustments_return_fk
    FOREIGN KEY (return_id) REFERENCES public.returns (id) ON DELETE RESTRICT;

CREATE TABLE public.return_lines (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id        uuid NOT NULL REFERENCES public.returns (id) ON DELETE RESTRICT,
    bill_line_id     uuid NOT NULL REFERENCES public.bill_lines (id) ON DELETE RESTRICT,
    product_unit_id  uuid REFERENCES public.product_units (id) ON DELETE RESTRICT,
    quantity         numeric(12,3) NOT NULL,
    condition        text NOT NULL,
    to_stock_state   text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT return_lines_qty_check CHECK (quantity > 0),
    CONSTRAINT return_lines_unit_qty_check CHECK (product_unit_id IS NULL OR quantity = 1),
    -- Lost ≠ Returned (Master §14.4): LOST never appears on a return line.
    CONSTRAINT return_lines_condition_check CHECK (condition IN (
        'NORMAL', 'MINOR_DAMAGE', 'REPAIRABLE', 'MAJOR_DAMAGE', 'TOTAL_LOSS')),
    CONSTRAINT return_lines_state_check CHECK (to_stock_state IN ('AVAILABLE', 'INSPECTION', 'REPAIR', 'DAMAGED')),
    -- Damaged goods never go straight to AVAILABLE (Master §11.2, §14.3).
    CONSTRAINT return_lines_damage_state_check CHECK (condition = 'NORMAL' OR to_stock_state <> 'AVAILABLE')
);
CREATE INDEX return_lines_line_idx ON public.return_lines (bill_line_id);
CREATE INDEX return_lines_unit_idx ON public.return_lines (product_unit_id);
CREATE INDEX return_lines_return_idx ON public.return_lines (return_id);

-- 6.5 continuation carry forward (Master §17.3) — recorded by the user, no approval step.
CREATE TABLE public.rental_carry_forwards (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_bill_id         uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    from_line_id         uuid NOT NULL REFERENCES public.bill_lines (id) ON DELETE RESTRICT,
    to_bill_id           uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    to_line_id           uuid NOT NULL REFERENCES public.bill_lines (id) ON DELETE RESTRICT,
    product_id           uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
    quantity             numeric(12,3) NOT NULL,
    reason               text NOT NULL,
    correlation_id       uuid NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    created_by           uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT rental_carry_forwards_qty_check CHECK (quantity > 0),
    CONSTRAINT rental_carry_forwards_bills_check CHECK (from_bill_id <> to_bill_id AND from_line_id <> to_line_id),
    CONSTRAINT rental_carry_forwards_reason_check CHECK (btrim(reason) <> '')
);
CREATE INDEX rental_carry_forwards_from_line_idx ON public.rental_carry_forwards (from_line_id);
CREATE INDEX rental_carry_forwards_to_line_idx ON public.rental_carry_forwards (to_line_id);
CREATE INDEX rental_carry_forwards_from_bill_idx ON public.rental_carry_forwards (from_bill_id);
CREATE INDEX rental_carry_forwards_to_bill_idx ON public.rental_carry_forwards (to_bill_id);

CREATE TABLE public.rental_carry_forward_units (
    carry_forward_id  uuid NOT NULL REFERENCES public.rental_carry_forwards (id) ON DELETE RESTRICT,
    product_unit_id   uuid NOT NULL REFERENCES public.product_units (id) ON DELETE RESTRICT,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    PRIMARY KEY (carry_forward_id, product_unit_id)
);
CREATE INDEX rental_carry_forward_units_unit_idx ON public.rental_carry_forward_units (product_unit_id);

CREATE TABLE public.rental_carry_forward_reversals (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    carry_forward_id  uuid NOT NULL UNIQUE REFERENCES public.rental_carry_forwards (id) ON DELETE RESTRICT,
    reason            text NOT NULL,
    correlation_id    uuid NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT rental_carry_forward_reversals_reason_check CHECK (btrim(reason) <> '')
);

-- 6.6 incident_cases — Damage / Missing / Lost (Master §14.3–14.4).
CREATE TABLE public.incident_cases (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id            uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    bill_line_id       uuid NOT NULL REFERENCES public.bill_lines (id) ON DELETE RESTRICT,
    return_line_id     uuid REFERENCES public.return_lines (id) ON DELETE RESTRICT,
    product_unit_id    uuid REFERENCES public.product_units (id) ON DELETE RESTRICT,
    incident_type      text NOT NULL,
    quantity           numeric(12,3) NOT NULL,
    status             text NOT NULL DEFAULT 'OPEN',
    assessment         jsonb,
    lost_charge_basis  text,
    missing_case_id    uuid REFERENCES public.incident_cases (id) ON DELETE RESTRICT,
    confirmed_by       uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    confirmed_at       timestamptz,
    reason             text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT incident_cases_type_check CHECK (incident_type IN ('DAMAGE', 'MISSING', 'LOST')),
    CONSTRAINT incident_cases_qty_check CHECK (quantity > 0 AND (product_unit_id IS NULL OR quantity = 1)),
    CONSTRAINT incident_cases_status_check CHECK (status IN (
        'OPEN', 'UNDER_INSPECTION', 'ASSESSED', 'CONFIRMED', 'REJECTED', 'FOUND', 'RESOLVED')),
    -- LOST must come from a MISSING case (Master §14.4).
    CONSTRAINT incident_cases_lost_check CHECK ((incident_type = 'LOST') = (missing_case_id IS NOT NULL)),
    CONSTRAINT incident_cases_confirmed_check CHECK (status <> 'CONFIRMED' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE INDEX incident_cases_bill_idx ON public.incident_cases (bill_id, status);
CREATE INDEX incident_cases_line_idx ON public.incident_cases (bill_line_id);

-- ============================================================================
-- 7. FINANCE (Master §13, §19–§22, §24: no cash sessions, CASH is just a channel)
-- ============================================================================

CREATE TABLE public.charges (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id               uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    bill_line_id          uuid REFERENCES public.bill_lines (id) ON DELETE RESTRICT,
    incident_case_id      uuid REFERENCES public.incident_cases (id) ON DELETE RESTRICT,
    charge_type           text NOT NULL,
    amount                numeric(14,2) NOT NULL,
    -- Default from the product (default_damage_fee / default_loss_fee × quantity) when
    -- the charge comes from an incident; a different amount needs a PIN (Master §14.3).
    suggested_amount      numeric(14,2),
    basis                 jsonb,
    covered_period_start  timestamptz,
    covered_period_end    timestamptz,
    status                text NOT NULL DEFAULT 'PENDING',
    confirmed_by          uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    confirmed_at          timestamptz,
    cancelled_by          uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    cancelled_at          timestamptz,
    cancel_reason         text,
    reason                text NOT NULL,
    correlation_id        uuid NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    created_by            uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT charges_type_check CHECK (charge_type IN ('DAMAGE', 'LOST', 'SERVICE', 'OTHER')),
    CONSTRAINT charges_amount_check CHECK (amount > 0),
    CONSTRAINT charges_suggested_check CHECK (suggested_amount IS NULL OR suggested_amount >= 0),
    CONSTRAINT charges_status_check CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'REVERSED')),
    CONSTRAINT charges_confirm_check CHECK (status NOT IN ('CONFIRMED', 'REVERSED') OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
    CONSTRAINT charges_reason_check CHECK (btrim(reason) <> '')
    -- No late fee exists (owner 2026-10-04): overdue = notice + phone call; more days = continuation bill.
);
CREATE INDEX charges_bill_idx ON public.charges (bill_id, status);
CREATE INDEX charges_incident_idx ON public.charges (incident_case_id);

CREATE TABLE public.write_offs (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id           uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    incident_case_id  uuid REFERENCES public.incident_cases (id) ON DELETE RESTRICT,
    charge_id         uuid REFERENCES public.charges (id) ON DELETE RESTRICT,
    amount            numeric(14,2) NOT NULL,
    reason            text NOT NULL,
    correlation_id    uuid NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT write_offs_amount_check CHECK (amount > 0),
    CONSTRAINT write_offs_reason_check CHECK (btrim(reason) <> '')
);
CREATE INDEX write_offs_bill_idx ON public.write_offs (bill_id);

CREATE TABLE public.payment_receipts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_no          text NOT NULL UNIQUE,
    bill_id             uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    total_amount        numeric(14,2) NOT NULL,
    received_at         timestamptz NOT NULL DEFAULT now(),
    received_by         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    idempotency_key_id  uuid NOT NULL UNIQUE REFERENCES public.idempotency_keys (id) ON DELETE RESTRICT,
    correlation_id      uuid NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT payment_receipts_total_check CHECK (total_amount > 0)
);
CREATE INDEX payment_receipts_bill_idx ON public.payment_receipts (bill_id);
CREATE INDEX payment_receipts_received_idx ON public.payment_receipts (received_at);

-- One row per tender per receive (Master §13). Never deleted, amount never changes.
CREATE TABLE public.payments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id   uuid NOT NULL REFERENCES public.payment_receipts (id) ON DELETE RESTRICT,
    bill_id      uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    method       text NOT NULL,
    amount       numeric(14,2) NOT NULL,
    reference    text,
    status       text NOT NULL DEFAULT 'COMPLETED',
    voided_at    timestamptz,
    voided_by    uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    void_reason  text,
    received_at  timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT payments_method_check CHECK (method IN ('CASH', 'TRANSFER', 'CARD', 'QR', 'OTHER')),
    CONSTRAINT payments_amount_check CHECK (amount > 0),
    CONSTRAINT payments_status_check CHECK (status IN ('PENDING', 'COMPLETED', 'VOIDED', 'REVERSED', 'REFUNDED')),
    CONSTRAINT payments_void_check CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX payments_bill_idx ON public.payments (bill_id, status);
CREATE INDEX payments_receipt_idx ON public.payments (receipt_id);

CREATE FUNCTION public._payments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF (NEW.receipt_id, NEW.bill_id, NEW.method, NEW.amount, NEW.reference, NEW.received_at, NEW.created_at, NEW.created_by)
       IS DISTINCT FROM
       (OLD.receipt_id, OLD.bill_id, OLD.method, OLD.amount, OLD.reference, OLD.received_at, OLD.created_at, OLD.created_by) THEN
        RAISE EXCEPTION 'PAYMENT_IMMUTABLE: only status may change' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'PENDING' AND NEW.status IN ('COMPLETED', 'VOIDED'))
        OR (OLD.status = 'COMPLETED' AND NEW.status IN ('VOIDED', 'REVERSED'))) THEN
        RAISE EXCEPTION 'PAYMENT_STATUS_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- Refund = money actually paid back, in one step with a PIN (Master §20, free-style).
CREATE TABLE public.refunds (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_no       text NOT NULL UNIQUE,
    bill_id         uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    payment_id      uuid NOT NULL REFERENCES public.payments (id) ON DELETE RESTRICT,  -- every refund traces to its payment
    amount          numeric(14,2) NOT NULL,
    method          text NOT NULL,
    status          text NOT NULL DEFAULT 'PAID',
    reason          text NOT NULL,
    paid_at         timestamptz NOT NULL DEFAULT now(),
    paid_by         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    correlation_id  uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT refunds_amount_check CHECK (amount > 0),
    CONSTRAINT refunds_method_check CHECK (method IN ('CASH', 'TRANSFER', 'CARD', 'QR', 'OTHER')),
    CONSTRAINT refunds_status_check CHECK (status IN ('PAID', 'REVERSED')),
    CONSTRAINT refunds_reason_check CHECK (btrim(reason) <> '')
);
CREATE INDEX refunds_bill_idx ON public.refunds (bill_id, status);
CREATE INDEX refunds_payment_idx ON public.refunds (payment_id);

-- Revenue / refund / expense / write-off ledger (Master §22). Deposit never appears here.
CREATE TABLE public.finance_ledger_entries (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_type         text NOT NULL,
    revenue_class      text,
    amount             numeric(14,2) NOT NULL,
    direction          smallint NOT NULL,
    bill_id            uuid REFERENCES public.bills (id) ON DELETE RESTRICT,
    bill_line_id       uuid REFERENCES public.bill_lines (id) ON DELETE RESTRICT,
    source_type        text NOT NULL,
    source_id          uuid NOT NULL,
    reverses_entry_id  uuid UNIQUE REFERENCES public.finance_ledger_entries (id) ON DELETE RESTRICT,
    occurred_at        timestamptz NOT NULL DEFAULT now(),
    correlation_id     uuid NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT finance_ledger_type_check CHECK (entry_type IN ('REVENUE', 'VAT', 'REFUND', 'EXPENSE', 'WRITE_OFF', 'REVERSAL')),
    CONSTRAINT finance_ledger_class_check CHECK (revenue_class IS NULL OR revenue_class IN (
        'SALE', 'RENTAL', 'DELIVERY_FEE', 'INSTALLATION_FEE', 'SERVICE_FEE', 'DISCOUNT', 'VAT_INCLUDED',
        'DAMAGE', 'LOST', 'ADDITIONAL', 'ADJUSTMENT', 'OTHER')),
    CONSTRAINT finance_ledger_amount_check CHECK (amount > 0),
    CONSTRAINT finance_ledger_direction_check CHECK (direction IN (1, -1)),
    CONSTRAINT finance_ledger_reversal_check CHECK ((entry_type = 'REVERSAL') = (reverses_entry_id IS NOT NULL)),
    CONSTRAINT finance_ledger_source_check CHECK (source_type IN (
        'BILL_CONFIRM', 'CHARGE', 'ADJUSTMENT', 'REFUND', 'EXPENSE', 'WRITE_OFF', 'OTHER_INCOME', 'REVERSAL'))
);
CREATE INDEX finance_ledger_occurred_idx ON public.finance_ledger_entries (occurred_at);
CREATE INDEX finance_ledger_bill_idx ON public.finance_ledger_entries (bill_id);
CREATE INDEX finance_ledger_source_idx ON public.finance_ledger_entries (source_type, source_id);

-- Expenses take effect when recorded (PIN, no approval step — Master §4.4, §22).
CREATE TABLE public.expense_entries (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_no   text NOT NULL UNIQUE,
    category     text NOT NULL,
    amount       numeric(14,2) NOT NULL,
    paid_method  text NOT NULL,
    status       text NOT NULL DEFAULT 'RECORDED',
    voided_by    uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    voided_at    timestamptz,
    void_reason  text,
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT expense_entries_category_check CHECK (category IN (
        'PURCHASE', 'REPAIR', 'SHIPPING', 'LABOR', 'FUEL', 'EQUIPMENT', 'GENERAL')),
    CONSTRAINT expense_entries_amount_check CHECK (amount > 0),
    CONSTRAINT expense_entries_method_check CHECK (paid_method IN ('CASH', 'TRANSFER', 'CARD', 'QR', 'OTHER')),
    CONSTRAINT expense_entries_status_check CHECK (status IN ('RECORDED', 'VOIDED')),
    CONSTRAINT expense_entries_void_check CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX expense_entries_status_idx ON public.expense_entries (status, created_at);

-- Other income not tied to a bill (Master §22). Selling goods must use a sale bill instead.
CREATE TABLE public.other_income_entries (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    income_no    text NOT NULL UNIQUE,
    category     text NOT NULL,
    amount       numeric(14,2) NOT NULL,
    channel      text NOT NULL,
    status       text NOT NULL DEFAULT 'RECORDED',
    note         text,
    voided_by    uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    voided_at    timestamptz,
    void_reason  text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT other_income_category_check CHECK (btrim(category) <> ''),
    CONSTRAINT other_income_amount_check CHECK (amount > 0),
    CONSTRAINT other_income_channel_check CHECK (channel IN ('CASH', 'TRANSFER', 'CARD', 'QR', 'OTHER')),
    CONSTRAINT other_income_status_check CHECK (status IN ('RECORDED', 'VOIDED')),
    CONSTRAINT other_income_void_check CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX other_income_entries_created_idx ON public.other_income_entries (status, created_at);

-- ============================================================================
-- 8. STOCK (Master §11)
-- ============================================================================

-- Every quantity change is a movement row; a state transfer is two rows
-- (−from_state, +to_state) with the same correlation_id.
CREATE TABLE public.stock_movements (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id            uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
    product_unit_id       uuid REFERENCES public.product_units (id) ON DELETE RESTRICT,
    stock_state           text NOT NULL,
    quantity_delta        numeric(12,3) NOT NULL,
    movement_type         text NOT NULL,
    source_type           text NOT NULL,
    source_id             uuid NOT NULL,
    reason                text,
    reverses_movement_id  uuid UNIQUE REFERENCES public.stock_movements (id) ON DELETE RESTRICT,
    correlation_id        uuid NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    created_by            uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,  -- NULL = system job
    CONSTRAINT stock_movements_state_check CHECK (stock_state IN (
        'AVAILABLE', 'RESERVED', 'RENTED_OUT', 'DELIVERY_PENDING', 'RETURN_PENDING', 'INSPECTION',
        'REPAIR', 'DAMAGED', 'LOST', 'INACTIVE', 'SOLD', 'WRITTEN_OFF')),
    CONSTRAINT stock_movements_delta_check CHECK (quantity_delta <> 0),
    CONSTRAINT stock_movements_type_check CHECK (movement_type IN (
        'INITIAL', 'RECEIVE', 'RESERVE', 'RELEASE', 'DELIVER_SALE', 'DELIVER_RENTAL', 'RETURN', 'INSPECT',
        'REPAIR', 'DAMAGE', 'LOST', 'WRITE_OFF', 'ADJUSTMENT', 'COUNT_ADJUSTMENT', 'CONVERT_OUT', 'CONVERT_IN',
        'REVERSAL')),
    CONSTRAINT stock_movements_source_check CHECK (source_type IN (
        'PRODUCT', 'PRODUCT_UNIT', 'BILL_LINE', 'DELIVERY_LINE', 'RETURN_LINE', 'RESERVATION',
        'STOCK_COUNT', 'ADJUSTMENT', 'CONVERSION', 'INCIDENT')),
    CONSTRAINT stock_movements_adjust_reason_check CHECK (
        movement_type NOT IN ('ADJUSTMENT', 'COUNT_ADJUSTMENT', 'WRITE_OFF', 'CONVERT_OUT', 'CONVERT_IN')
        OR (reason IS NOT NULL AND btrim(reason) <> ''))
);
CREATE INDEX stock_movements_product_state_idx ON public.stock_movements (product_id, stock_state);
CREATE INDEX stock_movements_source_idx ON public.stock_movements (source_type, source_id);
CREATE INDEX stock_movements_correlation_idx ON public.stock_movements (correlation_id);
CREATE INDEX stock_movements_created_at_idx ON public.stock_movements (created_at);

-- DRV but enforced: locked FOR UPDATE by every movement; CHECK ≥ 0 stops oversell.
CREATE TABLE public.stock_balances (
    product_id   uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
    stock_state  text NOT NULL,
    quantity     numeric(12,3) NOT NULL DEFAULT 0,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, stock_state),
    CONSTRAINT stock_balances_state_check CHECK (stock_state IN (
        'AVAILABLE', 'RESERVED', 'RENTED_OUT', 'DELIVERY_PENDING', 'RETURN_PENDING', 'INSPECTION',
        'REPAIR', 'DAMAGED', 'LOST', 'INACTIVE', 'SOLD', 'WRITTEN_OFF')),
    CONSTRAINT stock_balances_quantity_check CHECK (quantity >= 0)
);

CREATE TABLE public.stock_counts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    count_no     text NOT NULL UNIQUE,
    status       text NOT NULL DEFAULT 'OPEN',
    snapshot_at   timestamptz NOT NULL DEFAULT now(),
    confirmed_by  uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    confirmed_at  timestamptz,
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT stock_counts_status_check CHECK (status IN ('OPEN', 'COUNTED', 'CONFIRMED', 'CANCELLED')),
    CONSTRAINT stock_counts_confirmed_check CHECK ((status = 'CONFIRMED') = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE TABLE public.stock_count_lines (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_count_id          uuid NOT NULL REFERENCES public.stock_counts (id) ON DELETE RESTRICT,
    product_id              uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
    stock_state             text NOT NULL DEFAULT 'AVAILABLE',
    snapshot_qty            numeric(12,3) NOT NULL,
    counted_qty             numeric(12,3),
    discrepancy             numeric(12,3) GENERATED ALWAYS AS (counted_qty - snapshot_qty) STORED,
    reason                  text,
    adjustment_correlation  uuid,
    created_at              timestamptz NOT NULL DEFAULT now(),
    created_by              uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stock_count_lines_uniq UNIQUE (stock_count_id, product_id, stock_state),
    CONSTRAINT stock_count_lines_qty_check CHECK (snapshot_qty >= 0 AND (counted_qty IS NULL OR counted_qty >= 0))
);

-- ============================================================================
-- 9. NOTIFICATIONS / DOCUMENT REFERENCES (Master §25, §27)
-- ============================================================================

CREATE TABLE public.notifications (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_key             text NOT NULL,
    event_type            text NOT NULL,
    severity              text NOT NULL DEFAULT 'INFO',
    recipient_user_id     uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    recipient_menu        text REFERENCES public.menu_catalog (code) ON DELETE RESTRICT,
    entity_type           text NOT NULL,
    entity_id             uuid NOT NULL,
    title                 text NOT NULL,
    body                  text NOT NULL,
    status                text NOT NULL DEFAULT 'UNREAD',
    read_at               timestamptz,
    handled_at            timestamptz,
    handled_by            uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    expires_at            timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notifications_severity_check CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    CONSTRAINT notifications_status_check CHECK (status IN ('UNREAD', 'READ', 'HANDLED', 'DISMISSED', 'EXPIRED')),
    CONSTRAINT notifications_recipient_check CHECK (recipient_user_id IS NOT NULL OR recipient_menu IS NOT NULL)
);
CREATE UNIQUE INDEX notifications_event_uidx ON public.notifications (event_key, recipient_user_id, recipient_menu) NULLS NOT DISTINCT;
CREATE INDEX notifications_user_idx ON public.notifications (recipient_user_id, status);
CREATE INDEX notifications_menu_idx ON public.notifications (recipient_menu, status);
CREATE INDEX notifications_entity_idx ON public.notifications (entity_type, entity_id);

CREATE TABLE public.document_references (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_type       text NOT NULL,
    entity_type         text NOT NULL,
    entity_id           uuid NOT NULL,
    document_no         text,
    action              text NOT NULL,
    format              text NOT NULL,
    copy_number         integer NOT NULL DEFAULT 1,
    data_snapshot_hash  text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT document_references_action_check CHECK (action IN ('PRINT', 'SAVE_PDF', 'SHARE', 'EMAIL')),
    CONSTRAINT document_references_format_check CHECK (format IN ('A4', '80MM', 'PDF')),
    CONSTRAINT document_references_copy_check CHECK (copy_number > 0)
);
CREATE INDEX document_references_entity_idx ON public.document_references (entity_type, entity_id);

-- ============================================================================
-- 10. GUARD TRIGGERS (history protection, cross-row consistency)
-- ============================================================================

-- 10.1 bills: number and commercial terms frozen after confirm; status machine.
CREATE FUNCTION public._bills_guard()
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
        IF (NEW.customer_id, NEW.quotation_id,
            NEW.pricing_snapshot, NEW.bill_discount_type, NEW.bill_discount_value, NEW.delivery_fee,
            NEW.installation_fee, NEW.service_fee, NEW.sale_subtotal, NEW.rental_subtotal,
            NEW.bill_discount_amount, NEW.taxable_amount, NEW.vat_amount, NEW.grand_total,
            NEW.continuation_start_mode, NEW.continuation_reason, NEW.confirmed_at, NEW.confirmed_by)
           IS DISTINCT FROM
           (OLD.customer_id, OLD.quotation_id,
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

-- 10.2 bills: lineage consistency (Master §17.2). Bills are not bound to contracts (§6).
CREATE FUNCTION public._bills_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_parent public.bills%ROWTYPE;
BEGIN
    IF NEW.parent_bill_id IS NOT NULL THEN
        SELECT * INTO v_parent FROM public.bills WHERE id = NEW.parent_bill_id;
        IF NEW.original_bill_id IS DISTINCT FROM COALESCE(v_parent.original_bill_id, v_parent.id) THEN
            RAISE EXCEPTION 'ORIGINAL_BILL_MISMATCH' USING ERRCODE = '23514';
        END IF;
        IF NEW.customer_id IS DISTINCT FROM v_parent.customer_id THEN
            RAISE EXCEPTION 'CONTINUATION_CUSTOMER_MISMATCH' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 10.3 bill_lines: lines are added/removed only while the bill is DRAFT; ordered
--      terms are frozen afterwards (Master §8.3, §17.1, §19.3).
CREATE FUNCTION public._bill_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT b.status INTO v_status FROM public.bills b
     WHERE b.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.bill_id ELSE NEW.bill_id END;

    IF TG_OP IN ('INSERT', 'DELETE') THEN
        IF v_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'BILL_LINES_LOCKED: bill is %', v_status USING ERRCODE = '42501';
        END IF;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF (NEW.bill_id, NEW.product_id, NEW.line_mode, NEW.created_at, NEW.created_by)
       IS DISTINCT FROM (OLD.bill_id, OLD.product_id, OLD.line_mode, OLD.created_at, OLD.created_by) THEN
        RAISE EXCEPTION 'BILL_LINE_IDENTITY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    IF v_status <> 'DRAFT' AND
       (NEW.line_no, NEW.ordered_qty, NEW.unit_price, NEW.price_overridden, NEW.line_discount_type,
        NEW.line_discount_value, NEW.base_amount, NEW.line_discount_amount, NEW.extended_amount,
        NEW.rental_calculation_type, NEW.period_type, NEW.period_count, NEW.rental_start_at, NEW.rental_end_at)
       IS DISTINCT FROM
       (OLD.line_no, OLD.ordered_qty, OLD.unit_price, OLD.price_overridden, OLD.line_discount_type,
        OLD.line_discount_value, OLD.base_amount, OLD.line_discount_amount, OLD.extended_amount,
        OLD.rental_calculation_type, OLD.period_type, OLD.period_count, OLD.rental_start_at, OLD.rental_end_at) THEN
        RAISE EXCEPTION 'BILL_LINE_TERMS_IMMUTABLE_AFTER_CONFIRM' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- 10.4 quotation_items only change while the quotation is DRAFT.
CREATE FUNCTION public._quotation_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.quotations q
                   WHERE q.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.quotation_id ELSE NEW.quotation_id END
                     AND q.status = 'DRAFT') THEN
        RAISE EXCEPTION 'QUOTATION_ITEMS_LOCKED' USING ERRCODE = '42501';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- 10.5 carry forward: parent/child bills, lines, product must match (Master §17.3).
CREATE FUNCTION public._carry_forward_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.bills b WHERE b.id = NEW.to_bill_id AND b.parent_bill_id = NEW.from_bill_id) THEN
        RAISE EXCEPTION 'CARRY_FORWARD_NOT_CHILD_OF_PARENT' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bill_lines l
                   WHERE l.id = NEW.from_line_id AND l.bill_id = NEW.from_bill_id
                     AND l.line_mode = 'RENTAL' AND l.product_id = NEW.product_id)
       OR NOT EXISTS (SELECT 1 FROM public.bill_lines l
                   WHERE l.id = NEW.to_line_id AND l.bill_id = NEW.to_bill_id
                     AND l.line_mode = 'RENTAL' AND l.product_id = NEW.product_id) THEN
        RAISE EXCEPTION 'CARRY_FORWARD_LINE_MISMATCH' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- 10.7 delivery / return / incident lines must belong to the same bill as their header.
CREATE FUNCTION public._line_belongs_to_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_header_bill uuid;
    v_line_bill   uuid;
BEGIN
    SELECT l.bill_id INTO v_line_bill FROM public.bill_lines l WHERE l.id = NEW.bill_line_id;
    -- Read header columns through jsonb: one function serves four tables with different columns.
    IF TG_TABLE_NAME = 'delivery_lines' THEN
        SELECT d.bill_id INTO v_header_bill FROM public.deliveries d
         WHERE d.id = (to_jsonb(NEW) ->> 'delivery_id')::uuid;
    ELSIF TG_TABLE_NAME = 'return_lines' THEN
        SELECT r.bill_id INTO v_header_bill FROM public.returns r
         WHERE r.id = (to_jsonb(NEW) ->> 'return_id')::uuid;
    ELSE
        v_header_bill := (to_jsonb(NEW) ->> 'bill_id')::uuid;
    END IF;
    IF v_header_bill IS DISTINCT FROM v_line_bill THEN
        RAISE EXCEPTION 'LINE_NOT_IN_BILL' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- 10.8 attach triggers ---------------------------------------------------------
CREATE TRIGGER trg_bills_guard BEFORE UPDATE ON public.bills
    FOR EACH ROW EXECUTE FUNCTION public._bills_guard();
CREATE TRIGGER trg_bills_consistency BEFORE INSERT OR UPDATE OF customer_id, parent_bill_id, original_bill_id
    ON public.bills
    FOR EACH ROW EXECUTE FUNCTION public._bills_consistency();
CREATE TRIGGER trg_bill_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.bill_lines
    FOR EACH ROW EXECUTE FUNCTION public._bill_lines_guard();
CREATE TRIGGER trg_quotation_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quotation_items
    FOR EACH ROW EXECUTE FUNCTION public._quotation_items_guard();
CREATE TRIGGER trg_carry_forward_consistency BEFORE INSERT ON public.rental_carry_forwards
    FOR EACH ROW EXECUTE FUNCTION public._carry_forward_consistency();
CREATE TRIGGER trg_delivery_lines_bill BEFORE INSERT ON public.delivery_lines
    FOR EACH ROW EXECUTE FUNCTION public._line_belongs_to_header();
CREATE TRIGGER trg_return_lines_bill BEFORE INSERT ON public.return_lines
    FOR EACH ROW EXECUTE FUNCTION public._line_belongs_to_header();
CREATE TRIGGER trg_incident_cases_bill BEFORE INSERT ON public.incident_cases
    FOR EACH ROW EXECUTE FUNCTION public._line_belongs_to_header();
CREATE TRIGGER trg_charges_line_bill BEFORE INSERT ON public.charges
    FOR EACH ROW WHEN (NEW.bill_line_id IS NOT NULL) EXECUTE FUNCTION public._line_belongs_to_header();
CREATE TRIGGER trg_payments_guard BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public._payments_guard();
CREATE TRIGGER trg_product_units_guard BEFORE INSERT OR UPDATE ON public.product_units
    FOR EACH ROW EXECUTE FUNCTION public._product_units_guard();

-- Append-only tables.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'bill_adjustments', 'deliveries', 'delivery_lines', 'returns',
        'return_lines', 'rental_carry_forwards', 'rental_carry_forward_units',
        'rental_carry_forward_reversals', 'write_offs', 'payment_receipts',
        'finance_ledger_entries', 'stock_movements', 'appointment_history',
        'document_references']
    LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._forbid_update_delete()',
            'trg_' || t || '_append_only', t);
    END LOOP;

    -- Entities with history: no hard delete.
    FOREACH t IN ARRAY ARRAY[
        'customers', 'customer_documents', 'units', 'product_categories', 'products', 'product_costs',
        'product_units', 'quotations', 'bills', 'reservations', 'appointments',
        'incident_cases', 'charges', 'payments', 'refunds', 'user_menu_access',
        'expense_entries', 'other_income_entries', 'stock_balances', 'stock_counts', 'stock_count_lines']
    LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._forbid_delete()',
            'trg_' || t || '_no_delete', t);
    END LOOP;

    FOREACH t IN ARRAY ARRAY[
        'customers', 'customer_documents', 'units', 'product_categories', 'products', 'product_units',
        'quotations', 'bills', 'bill_lines', 'appointments', 'incident_cases', 'stock_count_lines']
    LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
            'trg_' || t || '_updated_at', t);
    END LOOP;
END $$;

-- ============================================================================
-- 11. ENGINE (internal SECURITY DEFINER helpers — never granted to clients)
-- ============================================================================

-- 11.1 Stock movement with locked balances (Master §11.2, §28.4).
--      A transfer writes −from and +to with one correlation id; the conditional
--      UPDATE locks the balance row, so concurrent checkouts cannot oversell.
CREATE FUNCTION public._stock_move(
    p_product_id      uuid,
    p_from_state      text,
    p_to_state        text,
    p_qty             numeric,
    p_movement_type   text,
    p_source_type     text,
    p_source_id       uuid,
    p_unit_id         uuid,
    p_reason          text,
    p_correlation_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023';
    END IF;
    IF p_from_state IS NULL AND p_to_state IS NULL THEN
        RAISE EXCEPTION 'STOCK_MOVE_NEEDS_STATE' USING ERRCODE = '22023';
    END IF;

    IF p_from_state IS NOT NULL THEN
        UPDATE public.stock_balances
           SET quantity = quantity - p_qty, updated_at = now()
         WHERE product_id = p_product_id AND stock_state = p_from_state AND quantity >= p_qty;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % has less than % in %', p_product_id, p_qty, p_from_state
                USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.stock_movements (product_id, product_unit_id, stock_state, quantity_delta, movement_type,
                                            source_type, source_id, reason, correlation_id, created_by)
        VALUES (p_product_id, p_unit_id, p_from_state, -p_qty, p_movement_type,
                p_source_type, p_source_id, p_reason, p_correlation_id, auth.uid());
    END IF;

    IF p_to_state IS NOT NULL THEN
        INSERT INTO public.stock_balances AS sb (product_id, stock_state, quantity)
        VALUES (p_product_id, p_to_state, p_qty)
        ON CONFLICT (product_id, stock_state)
        DO UPDATE SET quantity = sb.quantity + EXCLUDED.quantity, updated_at = now();
        INSERT INTO public.stock_movements (product_id, product_unit_id, stock_state, quantity_delta, movement_type,
                                            source_type, source_id, reason, correlation_id, created_by)
        VALUES (p_product_id, p_unit_id, p_to_state, p_qty, p_movement_type,
                p_source_type, p_source_id, p_reason, p_correlation_id, auth.uid());
    END IF;
END;
$$;

-- 11.2 Serialized unit custody state.
CREATE FUNCTION public._unit_transition(p_unit_id uuid, p_product_id uuid, p_expected text[], p_new_state text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_unit public.product_units%ROWTYPE;
BEGIN
    SELECT * INTO v_unit FROM public.product_units WHERE id = p_unit_id FOR UPDATE;
    IF NOT FOUND OR v_unit.product_id <> p_product_id THEN
        RAISE EXCEPTION 'UNIT_NOT_FOUND_FOR_PRODUCT: %', p_unit_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_unit.active OR NOT (v_unit.unit_state = ANY (p_expected)) THEN
        RAISE EXCEPTION 'UNIT_STATE_INVALID: unit % is %', v_unit.serial_no, v_unit.unit_state USING ERRCODE = '23514';
    END IF;
    UPDATE public.product_units SET unit_state = p_new_state WHERE id = p_unit_id;
END;
$$;

-- 11.3 Which bill line currently holds a serialized unit (NULL = not with a customer).
CREATE FUNCTION public._unit_holder_line(p_unit_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH ev AS (
        SELECT dl.created_at AS at, 1 AS seq, dl.bill_line_id AS holder
          FROM public.delivery_lines dl
          JOIN public.bill_lines l ON l.id = dl.bill_line_id AND l.line_mode = 'RENTAL'
         WHERE dl.product_unit_id = p_unit_id
        UNION ALL
        SELECT cf.created_at, 2, cf.to_line_id
          FROM public.rental_carry_forward_units u
          JOIN public.rental_carry_forwards cf ON cf.id = u.carry_forward_id
         WHERE u.product_unit_id = p_unit_id
        UNION ALL
        SELECT rv.created_at, 3, cf.from_line_id
          FROM public.rental_carry_forward_units u
          JOIN public.rental_carry_forwards cf ON cf.id = u.carry_forward_id
          JOIN public.rental_carry_forward_reversals rv ON rv.carry_forward_id = cf.id
         WHERE u.product_unit_id = p_unit_id
        UNION ALL
        SELECT rl.created_at, 4, NULL::uuid
          FROM public.return_lines rl
         WHERE rl.product_unit_id = p_unit_id
        UNION ALL
        SELECT ic.confirmed_at, 5, NULL::uuid
          FROM public.incident_cases ic
         WHERE ic.product_unit_id = p_unit_id AND ic.incident_type = 'LOST' AND ic.status IN ('CONFIRMED', 'RESOLVED')
    )
    SELECT holder FROM ev ORDER BY at DESC, seq DESC LIMIT 1;
$$;

-- 11.4 Draft pricing (Master §8.4): line base → line discount → bill discount → fees → VAT.
CREATE FUNCTION public._bill_compute_totals(p_bill_id uuid)
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

    IF v_settings.vat_enabled AND v_settings.vat_rate > 0 THEN
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
               'vat_enabled', v_settings.vat_enabled, 'vat_rate', v_settings.vat_rate,
               'vat_mode', v_settings.vat_mode, 'discount_before_vat', true,
               'fees_taxable', true, 'computed_at', now())
     WHERE id = p_bill_id;
END;
$$;

-- 11.5 Line obligation formulas (Master §14.1) + derived statuses (Master §9).
CREATE FUNCTION public._line_recalculate(p_line_id uuid)
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

    IF v_line.line_mode = 'RENTAL' THEN
        -- obligation_held_here = delivered + carried_in − resolved − carried_forward (CHECK ≥ 0)
        v_held := v_delivered + v_carried_in - (v_returned + v_lost + v_line.approved_disposition_qty) - v_carried_fwd;
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

-- 11.6 Bill money/status cache from the transaction records (Master §13, §21.1).
CREATE FUNCTION public._bill_recalculate(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill       public.bills%ROWTYPE;
    v_line_id    uuid;
    v_paid       numeric(14,2);
    v_refunded   numeric(14,2);
    v_adj        numeric(14,2);
    v_charges    numeric(14,2);
    v_write_off  numeric(14,2);
    v_due        numeric(14,2);
    v_balance    numeric(14,2);
    v_status     text;
BEGIN
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    FOR v_line_id IN SELECT id FROM public.bill_lines WHERE bill_id = p_bill_id ORDER BY line_no LOOP
        PERFORM public._line_recalculate(v_line_id);
    END LOOP;

    SELECT COALESCE(sum(amount), 0) INTO v_paid
      FROM public.payments WHERE bill_id = p_bill_id AND status IN ('COMPLETED', 'REFUNDED');
    SELECT COALESCE(sum(amount), 0) INTO v_refunded
      FROM public.refunds WHERE bill_id = p_bill_id AND status = 'PAID';
    SELECT COALESCE(sum(CASE adjustment_type WHEN 'DEBIT' THEN amount ELSE -amount END), 0) INTO v_adj
      FROM public.bill_adjustments WHERE bill_id = p_bill_id;
    SELECT COALESCE(sum(amount), 0) INTO v_charges
      FROM public.charges WHERE bill_id = p_bill_id AND status = 'CONFIRMED';
    SELECT COALESCE(sum(amount), 0) INTO v_write_off FROM public.write_offs WHERE bill_id = p_bill_id;

    v_due := v_bill.grand_total + v_charges + v_adj;
    v_balance := v_due - (v_paid - v_refunded) - v_write_off;
    v_status := CASE
        WHEN v_refunded > 0 AND v_paid - v_refunded <= 0 THEN 'REFUNDED'
        WHEN v_refunded > 0 THEN 'PARTIALLY_REFUNDED'
        WHEN v_balance <= 0 AND (v_paid > 0 OR v_due <= 0) THEN 'PAID'
        WHEN v_paid = 0 THEN 'UNPAID'
        ELSE 'PARTIALLY_PAID' END;

    UPDATE public.bills
       SET paid_amount = v_paid,
           refunded_amount = v_refunded,
           adjustment_net = v_adj,
           charge_total = v_charges,
           write_off_total = v_write_off,
           balance_due = v_balance,
           payment_status = v_status,
           status = CASE
               WHEN status = 'CONFIRMED' AND (v_paid > 0 OR EXISTS (
                        SELECT 1 FROM public.bill_lines l
                         WHERE l.bill_id = p_bill_id AND (l.delivered_qty > 0 OR l.carried_in_qty > 0)))
               THEN 'ACTIVE' ELSE status END
     WHERE id = p_bill_id;
END;
$$;

-- 11.7 Close when financial ∧ merchandise ∧ exception resolved (Master §21.2).
--      Deposit is not a condition (settled at the counter — Master §18, §21.2).
CREATE FUNCTION public._bill_try_close(p_bill_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill public.bills%ROWTYPE;
BEGIN
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF v_bill.status <> 'ACTIVE' THEN
        RETURN false;
    END IF;

    -- merchandise_resolved
    IF EXISTS (
        SELECT 1 FROM public.bill_lines l
         WHERE l.bill_id = p_bill_id
           AND ((l.line_mode = 'RENTAL' AND (l.obligation_held_here > 0
                    OR (l.delivered_qty + l.carried_in_qty = 0 AND l.cancelled_qty < l.ordered_qty)))
             OR (l.line_mode = 'SALE' AND l.delivered_qty + l.cancelled_qty < l.ordered_qty))) THEN
        RETURN false;
    END IF;

    -- financial_resolved
    IF v_bill.balance_due <> 0
       OR EXISTS (SELECT 1 FROM public.payments p WHERE p.bill_id = p_bill_id AND p.status = 'PENDING') THEN
        RETURN false;
    END IF;

    -- exception_resolved
    IF EXISTS (SELECT 1 FROM public.incident_cases i
                WHERE i.bill_id = p_bill_id AND i.status NOT IN ('RESOLVED', 'REJECTED', 'FOUND'))
       OR EXISTS (SELECT 1 FROM public.charges c WHERE c.bill_id = p_bill_id AND c.status = 'PENDING')
       OR EXISTS (
            SELECT 1 FROM public.bill_lines l
             WHERE l.bill_id = p_bill_id AND l.line_mode = 'RENTAL' AND l.overdue_reviewed_at IS NULL
               AND (l.actual_return_at > l.rental_end_at
                    OR EXISTS (
                        SELECT 1 FROM public.rental_carry_forwards cf
                          JOIN public.bills child ON child.id = cf.to_bill_id
                         WHERE cf.from_line_id = l.id
                           AND child.continuation_start_mode = 'FROM_APPROVAL'
                           AND cf.created_at > l.rental_end_at
                           AND NOT EXISTS (SELECT 1 FROM public.rental_carry_forward_reversals r
                                            WHERE r.carry_forward_id = cf.id)))) THEN
        RETURN false;
    END IF;

    UPDATE public.bills SET status = 'CLOSED', closed_at = now() WHERE id = p_bill_id;
    UPDATE public.bill_lines SET rental_status = 'CLOSED' WHERE bill_id = p_bill_id AND line_mode = 'RENTAL';
    PERFORM public._audit('BILL_CLOSE', 'BILL', p_bill_id, NULL, jsonb_build_object('status', 'CLOSED'),
                          'auto close: financial, merchandise and exceptions resolved', NULL);
    RETURN true;
END;
$$;

CREATE FUNCTION public._bill_settle(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._bill_recalculate(p_bill_id);
    PERFORM public._bill_try_close(p_bill_id);
END;
$$;

-- 11.8 Finance ledger writers.
CREATE FUNCTION public._ledger(
    p_entry_type      text,
    p_class           text,
    p_amount          numeric,
    p_direction       smallint,
    p_bill_id         uuid,
    p_line_id         uuid,
    p_source_type     text,
    p_source_id       uuid,
    p_correlation_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_amount IS NULL OR p_amount = 0 THEN
        RETURN;
    END IF;
    INSERT INTO public.finance_ledger_entries (entry_type, revenue_class, amount, direction, bill_id, bill_line_id,
                                               source_type, source_id, correlation_id, created_by)
    VALUES (p_entry_type, p_class, abs(p_amount),
            (CASE WHEN p_amount < 0 THEN -p_direction ELSE p_direction END)::smallint,
            p_bill_id, p_line_id, p_source_type, p_source_id, p_correlation_id, auth.uid());
END;
$$;

CREATE FUNCTION public._ledger_reverse_source(p_source_type text, p_source_id uuid, p_correlation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.finance_ledger_entries (entry_type, revenue_class, amount, direction, bill_id, bill_line_id,
                                               source_type, source_id, reverses_entry_id, correlation_id, created_by)
    SELECT 'REVERSAL', e.revenue_class, e.amount, (-e.direction)::smallint, e.bill_id, e.bill_line_id,
           'REVERSAL', e.id, e.id, p_correlation_id, auth.uid()
      FROM public.finance_ledger_entries e
     WHERE e.source_type = p_source_type AND e.source_id = p_source_id
       AND NOT EXISTS (SELECT 1 FROM public.finance_ledger_entries r WHERE r.reverses_entry_id = e.id);
END;
$$;

-- Revenue recognised at confirm, split by mode (Master §8.5, §22). REVENUE + VAT rows sum to grand_total.
CREATE FUNCTION public._bill_post_revenue(p_bill_id uuid, p_correlation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill  public.bills%ROWTYPE;
    v_line  public.bill_lines%ROWTYPE;
BEGIN
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    FOR v_line IN SELECT * FROM public.bill_lines WHERE bill_id = p_bill_id ORDER BY line_no LOOP
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
$$;

-- 11.9 / 11.10 (cash sessions, contract deposits) removed in v4.2 — Master §18, §24.

-- 11.11 In-app notification (pointer, never business state — Master §27).
CREATE FUNCTION public._notify(
    p_event_key       text,
    p_event_type      text,
    p_severity        text,
    p_recipient_user  uuid,
    p_recipient_menu  text,
    p_entity_type     text,
    p_entity_id       uuid,
    p_title           text,
    p_body            text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.notifications (event_key, event_type, severity, recipient_user_id, recipient_menu,
                                      entity_type, entity_id, title, body)
    VALUES (p_event_key, p_event_type, p_severity, p_recipient_user, p_recipient_menu,
            p_entity_type, p_entity_id, p_title, p_body)
    ON CONFLICT DO NOTHING;
END;
$$;

-- ============================================================================
-- 12. RPC — MEMBERS (reused from 20261002000001 + advisory lock)
--     All RPCs: SECURITY DEFINER, search_path '', menu check first, actor = auth.uid().
-- ============================================================================

CREATE FUNCTION public.owner_set_member_status(p_user_id uuid, p_status text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target public.profiles%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_owner();
    IF p_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
        RAISE EXCEPTION 'INVALID_STATUS: %', p_status USING ERRCODE = '22023';
    END IF;
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'CANNOT_CHANGE_SELF' USING ERRCODE = '42501';
    END IF;

    -- Serialises every owner-count decision (also when no OWNER row exists yet).
    PERFORM pg_advisory_xact_lock(hashtext('pos.owner_membership'));

    SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_target.role = 'OWNER' AND p_status = 'SUSPENDED' AND NOT EXISTS (
        SELECT 1 FROM public.profiles
         WHERE role = 'OWNER' AND status = 'ACTIVE' AND id <> p_user_id) THEN
        RAISE EXCEPTION 'LAST_OWNER' USING ERRCODE = '42501';
    END IF;

    UPDATE public.profiles
       SET status = p_status, status_changed_at = now(), status_changed_by = auth.uid()
     WHERE id = p_user_id;

    PERFORM public._audit(CASE WHEN p_status = 'ACTIVE' THEN 'MEMBER_APPROVE' ELSE 'MEMBER_SUSPEND' END,
                          'MEMBER', p_user_id, jsonb_build_object('status', v_target.status),
                          jsonb_build_object('status', p_status), v_reason, NULL);
    RETURN jsonb_build_object('user_id', p_user_id, 'status', p_status);
END;
$$;

CREATE FUNCTION public.owner_set_member_role(p_user_id uuid, p_role text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target public.profiles%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_owner();
    IF p_role NOT IN ('OWNER', 'USER') THEN
        RAISE EXCEPTION 'INVALID_ROLE: %', p_role USING ERRCODE = '22023';
    END IF;
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'CANNOT_CHANGE_SELF' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('pos.owner_membership'));

    SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_target.role = p_role THEN
        RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role);
    END IF;
    IF p_role = 'OWNER' AND v_target.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'MEMBER_NOT_ACTIVE' USING ERRCODE = '42501';
    END IF;
    IF v_target.role = 'OWNER' AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE role = 'OWNER' AND status = 'ACTIVE' AND id <> p_user_id) THEN
        RAISE EXCEPTION 'LAST_OWNER' USING ERRCODE = '42501';
    END IF;

    -- An OWNER needs no menu grants; a demoted OWNER starts with none (no automatic grants).
    IF p_role = 'OWNER' THEN
        DELETE FROM public.user_menu_access WHERE user_id = p_user_id;
    END IF;
    UPDATE public.profiles SET role = p_role WHERE id = p_user_id;

    PERFORM public._audit('MEMBER_ROLE_CHANGE', 'MEMBER', p_user_id, jsonb_build_object('role', v_target.role),
                          jsonb_build_object('role', p_role), v_reason, NULL);
    RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role);
END;
$$;

-- Replaces the full menu set of a USER (Master §4.2). Only path that writes user_menu_access.
CREATE FUNCTION public.owner_set_member_menus(p_user_id uuid, p_menus text[], p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target  public.profiles%ROWTYPE;
    v_reason  text := public._require_reason(p_reason);
    v_codes   text[];
    v_bad     text[];
    v_before  text[];
BEGIN
    PERFORM public._require_owner();

    SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_target.role = 'OWNER' THEN
        RAISE EXCEPTION 'OWNER_HAS_ALL_MENUS' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(array_agg(DISTINCT c ORDER BY c), ARRAY[]::text[]) INTO v_codes
      FROM unnest(COALESCE(p_menus, ARRAY[]::text[])) AS c WHERE c IS NOT NULL;
    SELECT array_agg(c) INTO v_bad
      FROM unnest(v_codes) AS c
     WHERE NOT EXISTS (SELECT 1 FROM public.menu_catalog m WHERE m.code = c AND NOT m.owner_only);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'UNKNOWN_OR_OWNER_ONLY_MENU: %', array_to_string(v_bad, ', ') USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(array_agg(menu_code ORDER BY menu_code), ARRAY[]::text[]) INTO v_before
      FROM public.user_menu_access WHERE user_id = p_user_id;

    DELETE FROM public.user_menu_access WHERE user_id = p_user_id AND NOT (menu_code = ANY (v_codes));
    INSERT INTO public.user_menu_access (user_id, menu_code, granted_by)
    SELECT p_user_id, c, auth.uid() FROM unnest(v_codes) AS c
    ON CONFLICT (user_id, menu_code) DO NOTHING;

    PERFORM public._audit('MEMBER_MENUS_CHANGE', 'MEMBER', p_user_id,
                          jsonb_build_object('menus', to_jsonb(v_before)),
                          jsonb_build_object('menus', to_jsonb(v_codes)), v_reason, NULL);
    RETURN jsonb_build_object('user_id', p_user_id, 'menus', to_jsonb(v_codes));
END;
$$;

-- One-time OWNER bootstrap: service_role / SQL editor only (no auth.uid()).
-- The advisory lock closes the race where two calls both see "no OWNER yet".
CREATE FUNCTION public.bootstrap_owner(p_username text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: bootstrap_owner is for service_role only' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('pos.owner_membership'));
    IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'OWNER') THEN
        RAISE EXCEPTION 'OWNER_ALREADY_EXISTS' USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_user_id FROM public.profiles WHERE username = lower(btrim(p_username)) FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM public.user_menu_access WHERE user_id = v_user_id;
    UPDATE public.profiles
       SET role = 'OWNER', status = 'ACTIVE', status_changed_at = now(), status_changed_by = NULL
     WHERE id = v_user_id;

    PERFORM public._audit('OWNER_BOOTSTRAP', 'MEMBER', v_user_id, NULL,
                          jsonb_build_object('role', 'OWNER', 'status', 'ACTIVE'), 'Initial OWNER bootstrap', NULL);
    RETURN v_user_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- PIN (Master §4.3): 1 user = 1 PIN, bound to the account, checked by the database.
-- verify_pin never raises on a wrong PIN, so the failure counter survives. Waits grow with
-- each miss like iOS: store_settings.policies.pin_fail_delays_seconds[n-1] for miss n
-- (misses 1-3 no wait, 4 = 1 min, 5 = 5 min, 6 = 15 min, 7 = 1 h, 8 = 3 h, 9 = 8 h).
-- The miss after the last wait (miss 10) blocks the PIN: a USER needs an OWNER reset
-- (owner_reset_member_pin), an OWNER signs in again with the password (owner_recover_pin).
-- The account itself stays usable for login. A correct PIN resets the counter.
-- Risky action (owner decision 2026-10-04 ก): the user fills the whole form, presses confirm,
-- enters the PIN; verify_pin(pin, 'ACTION', <action>) returns a token bound to that one action
-- which the action RPC called right after spends. The 30 s life only covers the network hop.
-- ----------------------------------------------------------------------------

-- First PIN needs nothing; changing an existing PIN needs a confirmation of the current one.
CREATE FUNCTION public.set_pin(p_new_pin text, p_pin_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_exists boolean;
BEGIN
    PERFORM public._require_active_member();
    IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{6}$' THEN
        RAISE EXCEPTION 'PIN_FORMAT: 6 digits required' USING ERRCODE = '22023';
    END IF;
    SELECT EXISTS (SELECT 1 FROM public.user_pins WHERE user_id = auth.uid() AND pin_hash IS NOT NULL FOR UPDATE)
      INTO v_exists;
    IF v_exists THEN
        PERFORM public._require_pin(p_pin_token, 'PIN_CHANGE');
        UPDATE public.user_pins
           SET pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')),
               failed_attempts = 0, locked_until = NULL, blocked_at = NULL, updated_at = now()
         WHERE user_id = auth.uid();
    ELSE
        INSERT INTO public.user_pins (user_id, pin_hash)
        VALUES (auth.uid(), extensions.crypt(p_new_pin, extensions.gen_salt('bf')))
        ON CONFLICT (user_id) DO UPDATE
           SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_until = NULL, blocked_at = NULL,
               updated_at = now();
    END IF;
    PERFORM public._audit(CASE WHEN v_exists THEN 'PIN_CHANGE' ELSE 'PIN_SET' END, 'MEMBER', auth.uid(),
                          NULL, NULL, NULL, NULL, v_exists);
    RETURN jsonb_build_object('pin_set', true);
END;
$$;

-- p_purpose UNLOCK: app unlock only. ACTION: also returns a single-use pin_token bound to
-- p_action that the risky RPC called right after consumes.
CREATE FUNCTION public.verify_pin(p_pin text, p_purpose text DEFAULT 'UNLOCK', p_action text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pin       public.user_pins%ROWTYPE;
    v_steps     jsonb := public._policy('pin_fail_delays_seconds',
                                        '[0, 0, 0, 60, 300, 900, 3600, 10800, 28800]'::jsonb);
    v_n         integer;
    v_secs      integer;
    v_until     timestamptz;
    v_token     uuid;
BEGIN
    PERFORM public._require_active_member();
    IF p_purpose IS NULL OR p_purpose NOT IN ('UNLOCK', 'ACTION') THEN
        RAISE EXCEPTION 'INVALID_PURPOSE' USING ERRCODE = '22023';
    END IF;
    IF p_purpose = 'ACTION' AND (p_action IS NULL OR p_action !~ '^[A-Z_]+$') THEN
        RAISE EXCEPTION 'ACTION_REQUIRED: name the risky action this PIN confirms' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_pin FROM public.user_pins WHERE user_id = auth.uid() FOR UPDATE;
    IF NOT FOUND OR v_pin.pin_hash IS NULL THEN
        RAISE EXCEPTION 'PIN_NOT_SET' USING ERRCODE = 'P0002';
    END IF;
    IF v_pin.blocked_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'blocked', true, 'failed_attempts', v_pin.failed_attempts,
                                  'recovery', CASE WHEN public.is_owner() THEN 'REAUTHENTICATE' ELSE 'OWNER_RESET' END);
    END IF;
    IF v_pin.locked_until IS NOT NULL AND v_pin.locked_until > now() THEN
        RETURN jsonb_build_object('ok', false, 'locked_until', v_pin.locked_until,
                                  'failed_attempts', v_pin.failed_attempts);
    END IF;

    IF p_pin IS NOT NULL AND v_pin.pin_hash = extensions.crypt(p_pin, v_pin.pin_hash) THEN
        UPDATE public.user_pins SET failed_attempts = 0, locked_until = NULL
         WHERE user_id = v_pin.user_id;
        IF p_purpose = 'ACTION' THEN
            INSERT INTO public.pin_confirmations (user_id, action, expires_at)
            VALUES (v_pin.user_id, p_action, now() + interval '30 seconds')
            RETURNING id INTO v_token;
        END IF;
        RETURN jsonb_build_object('ok', true, 'pin_token', v_token);
    END IF;

    v_n := v_pin.failed_attempts + 1;
    IF v_n > jsonb_array_length(v_steps) THEN
        UPDATE public.user_pins SET failed_attempts = v_n, locked_until = NULL, blocked_at = now()
         WHERE user_id = v_pin.user_id;
        PERFORM public._audit('PIN_BLOCKED', 'MEMBER', v_pin.user_id, NULL,
                              jsonb_build_object('purpose', p_purpose, 'failed_attempts', v_n),
                              NULL, NULL, false, NULL, NULL, NULL, 'FAILED');
        RETURN jsonb_build_object('ok', false, 'blocked', true, 'failed_attempts', v_n,
                                  'recovery', CASE WHEN public.is_owner() THEN 'REAUTHENTICATE' ELSE 'OWNER_RESET' END);
    END IF;
    v_secs := COALESCE((v_steps ->> (v_n - 1))::integer, 0);
    v_until := CASE WHEN v_secs > 0 THEN now() + make_interval(secs => v_secs) END;
    UPDATE public.user_pins SET failed_attempts = v_n, locked_until = v_until WHERE user_id = v_pin.user_id;
    PERFORM public._audit(CASE WHEN v_secs > 0 THEN 'PIN_LOCKED' ELSE 'PIN_VERIFY_FAILED' END, 'MEMBER',
                          v_pin.user_id, NULL,
                          jsonb_build_object('purpose', p_purpose, 'failed_attempts', v_n, 'wait_seconds', v_secs),
                          NULL, NULL, false, NULL, NULL, NULL, 'FAILED');
    RETURN jsonb_build_object('ok', false, 'failed_attempts', v_n, 'locked_until', v_until);
END;
$$;

-- App auto-lock (Master §4.3): the session stays signed in; after the chosen idle time the
-- app locks and only this user's PIN (verify_pin UNLOCK) opens it again. The app reads the
-- effective time here; the idle timer itself runs in the app.
CREATE FUNCTION public.my_pin_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pin  public.user_pins%ROWTYPE;
BEGIN
    PERFORM public._require_active_member();
    SELECT * INTO v_pin FROM public.user_pins WHERE user_id = auth.uid();
    RETURN jsonb_build_object(
        'pin_set', FOUND AND v_pin.pin_hash IS NOT NULL,
        'blocked', COALESCE(v_pin.blocked_at IS NOT NULL, false),
        'failed_attempts', COALESCE(v_pin.failed_attempts, 0),
        'locked_until', CASE WHEN v_pin.locked_until > now() THEN v_pin.locked_until END,
        'auto_lock_seconds', COALESCE(v_pin.auto_lock_seconds,
            (public._policy('auto_lock_default_seconds', '300'::jsonb))::text::integer),
        'auto_lock_options_seconds', public._policy('auto_lock_options_seconds', '[]'::jsonb));
END;
$$;

-- Each user picks their own idle time from policies.auto_lock_options_seconds (NULL = store default).
CREATE FUNCTION public.set_auto_lock(p_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_active_member();
    IF p_seconds IS NOT NULL AND NOT (public._policy('auto_lock_options_seconds', '[]'::jsonb) @> to_jsonb(p_seconds)) THEN
        RAISE EXCEPTION 'AUTO_LOCK_OPTION_INVALID' USING ERRCODE = '22023';
    END IF;
    UPDATE public.user_pins SET auto_lock_seconds = p_seconds WHERE user_id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PIN_NOT_SET' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._audit('AUTO_LOCK_SET', 'MEMBER', auth.uid(), NULL,
                          jsonb_build_object('auto_lock_seconds', p_seconds), NULL, NULL);
    RETURN public.my_pin_status();
END;
$$;

-- Forgotten PIN: an OWNER clears it; the member then sets a new one with set_pin.
CREATE FUNCTION public.owner_reset_member_pin(p_user_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_owner();
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'CANNOT_CHANGE_SELF' USING ERRCODE = '42501';
    END IF;
    -- Keeps the row (auto-lock choice, history); only the hash and the miss state are cleared.
    UPDATE public.user_pins
       SET pin_hash = NULL, failed_attempts = 0, locked_until = NULL, blocked_at = NULL, updated_at = now()
     WHERE user_id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PIN_NOT_SET' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._audit('PIN_RESET', 'MEMBER', p_user_id, NULL,
                          jsonb_build_object('method', 'OWNER_RESET', 'reset_by', auth.uid(), 'account', p_user_id),
                          v_reason, NULL);
    RETURN jsonb_build_object('user_id', p_user_id, 'pin_reset', true);
END;
$$;

-- OWNER forgot the PIN ("ลืม PIN", owner 2026-10-04): nobody ranks above the OWNER, so the
-- OWNER proves it is them the usual way — e-mail link / code, or the account password — and
-- then sets a new PIN here. Only the PIN changes; no other data is reset. The access token
-- must come from that fresh sign-in in the last 5 minutes (JWT amr).
CREATE FUNCTION public.owner_recover_pin(p_new_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_auth_at timestamptz;
BEGIN
    PERFORM public._require_owner();
    IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{6}$' THEN
        RAISE EXCEPTION 'PIN_FORMAT: 6 digits required' USING ERRCODE = '22023';
    END IF;
    SELECT max(to_timestamp((a ->> 'timestamp')::double precision)) INTO v_auth_at
      FROM jsonb_array_elements(COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr', '[]'::jsonb)) a
     WHERE a ->> 'method' IN ('password', 'otp', 'magiclink', 'recovery');
    IF v_auth_at IS NULL OR v_auth_at < now() - interval '5 minutes' THEN
        RAISE EXCEPTION 'REAUTH_REQUIRED: confirm by e-mail link / code or password first' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.user_pins (user_id, pin_hash)
    VALUES (auth.uid(), extensions.crypt(p_new_pin, extensions.gen_salt('bf')))
    ON CONFLICT (user_id) DO UPDATE
       SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_until = NULL, blocked_at = NULL,
           updated_at = now();
    PERFORM public._audit('PIN_RESET', 'MEMBER', auth.uid(), NULL,
                          jsonb_build_object('method', 'SELF_REAUTH', 'reset_by', auth.uid(),
                                             'account', auth.uid(), 'reauthenticated_at', v_auth_at,
                                             'reauth_methods', (SELECT jsonb_agg(DISTINCT a ->> 'method')
                                               FROM jsonb_array_elements(COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr', '[]'::jsonb)) a)),
                          'owner forgot PIN', NULL);
    RETURN jsonb_build_object('pin_set', true);
END;
$$;

-- ============================================================================
-- 13. RPC — SETTINGS / MASTER DATA
-- ============================================================================

CREATE FUNCTION public.settings_update(p_patch jsonb, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old     public.store_settings%ROWTYPE;
    v_new     public.store_settings%ROWTYPE;
    v_reason  text := public._require_reason(p_reason);
    v_allowed text[] := ARRAY['company_name', 'tax_id', 'address', 'phone', 'logo_url', 'timezone',
                              'vat_enabled', 'vat_rate', 'vat_mode', 'doc_number_formats', 'policies'];
    v_pol     jsonb;
    v_key     text;
BEGIN
    PERFORM public._require_menu('settings');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;

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

CREATE FUNCTION public.customer_create(p_data jsonb, p_confirm_duplicate boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_new     public.customers%ROWTYPE;
    v_dups    jsonb;
    v_allowed text[] := ARRAY['customer_code', 'name', 'phone', 'address', 'customer_type', 'tax_id', 'email',
                              'contact_person', 'billing_address', 'delivery_address', 'tags', 'credit_note',
                              'risk_note', 'document_reference', 'note', 'credit_enabled', 'credit_limit',
                              'payment_terms_days', 'contact_details'];
BEGIN
    PERFORM public._require_menu('customers', 'pos', 'bills');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;
    v_new := jsonb_populate_record(NULL::public.customers, p_data);

    -- Master §5: possible duplicate by phone digits or name → caller must confirm.
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone)) INTO v_dups
      FROM public.customers c
     WHERE c.active
       AND (regexp_replace(c.phone, '\D', '', 'g') = regexp_replace(COALESCE(v_new.phone, ''), '\D', '', 'g')
            OR lower(btrim(c.name)) = lower(btrim(COALESCE(v_new.name, ''))));
    IF v_dups IS NOT NULL AND NOT COALESCE(p_confirm_duplicate, false) THEN
        RAISE EXCEPTION 'DUPLICATE_CUSTOMER' USING ERRCODE = '23505', DETAIL = v_dups::text;
    END IF;

    INSERT INTO public.customers (customer_code, name, phone, address, customer_type, tax_id, email, contact_person,
        billing_address, delivery_address, tags, credit_note, risk_note, document_reference, note,
        credit_enabled, credit_limit, payment_terms_days, contact_details, created_by)
    VALUES (v_new.customer_code, v_new.name, v_new.phone, v_new.address, v_new.customer_type, v_new.tax_id,
        v_new.email, v_new.contact_person, v_new.billing_address, v_new.delivery_address,
        COALESCE(v_new.tags, '{}'), v_new.credit_note, v_new.risk_note, v_new.document_reference, v_new.note,
        COALESCE(v_new.credit_enabled, false), COALESCE(v_new.credit_limit, 0), COALESCE(v_new.payment_terms_days, 0),
        COALESCE(v_new.contact_details, '{}'::jsonb), auth.uid())
    RETURNING * INTO v_new;

    PERFORM public._audit('CUSTOMER_CREATE', 'CUSTOMER', v_new.id, NULL, to_jsonb(v_new), NULL, NULL);
    RETURN to_jsonb(v_new);
END;
$$;

CREATE FUNCTION public.customer_update(p_customer_id uuid, p_data jsonb, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old     public.customers%ROWTYPE;
    v_new     public.customers%ROWTYPE;
    v_allowed text[] := ARRAY['customer_code', 'name', 'phone', 'address', 'customer_type', 'tax_id', 'email',
                              'contact_person', 'billing_address', 'delivery_address', 'tags', 'credit_note',
                              'risk_note', 'document_reference', 'note', 'credit_enabled', 'credit_limit',
                              'payment_terms_days', 'account_status', 'contact_details'];
BEGIN
    PERFORM public._require_menu('customers', 'pos', 'bills');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_old FROM public.customers WHERE id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_new := jsonb_populate_record(v_old, p_data);
    -- Credit terms are a risky change (Master §4.4 credit override): reason required.
    IF (v_new.credit_enabled, v_new.credit_limit, v_new.payment_terms_days, v_new.account_status)
       IS DISTINCT FROM (v_old.credit_enabled, v_old.credit_limit, v_old.payment_terms_days, v_old.account_status) THEN
        PERFORM public._require_reason(p_reason);
    END IF;

    UPDATE public.customers
       SET customer_code = v_new.customer_code, name = v_new.name, phone = v_new.phone, address = v_new.address,
           customer_type = v_new.customer_type, tax_id = v_new.tax_id, email = v_new.email,
           contact_person = v_new.contact_person, billing_address = v_new.billing_address,
           delivery_address = v_new.delivery_address, tags = v_new.tags, credit_note = v_new.credit_note,
           risk_note = v_new.risk_note, document_reference = v_new.document_reference, note = v_new.note,
           credit_enabled = v_new.credit_enabled, credit_limit = v_new.credit_limit,
           payment_terms_days = v_new.payment_terms_days, account_status = v_new.account_status,
           contact_details = COALESCE(v_new.contact_details, '{}'::jsonb),
           updated_by = auth.uid()
     WHERE id = p_customer_id
    RETURNING * INTO v_new;

    PERFORM public._audit('CUSTOMER_UPDATE', 'CUSTOMER', p_customer_id, to_jsonb(v_old), to_jsonb(v_new), p_reason, NULL);
    RETURN to_jsonb(v_new);
END;
$$;

CREATE FUNCTION public.customer_set_active(p_customer_id uuid, p_active boolean, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason text := public._require_reason(p_reason);
    v_old    boolean;
BEGIN
    PERFORM public._require_menu('customers', 'pos', 'bills');
    SELECT active INTO v_old FROM public.customers WHERE id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.customers SET active = p_active, updated_by = auth.uid() WHERE id = p_customer_id;
    PERFORM public._audit('CUSTOMER_SET_ACTIVE', 'CUSTOMER', p_customer_id, jsonb_build_object('active', v_old),
                          jsonb_build_object('active', p_active), v_reason, NULL);
    RETURN jsonb_build_object('customer_id', p_customer_id, 'active', p_active);
END;
$$;

CREATE FUNCTION public.product_category_save(p_category_id uuid, p_name text, p_active boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row public.product_categories%ROWTYPE;
BEGIN
    PERFORM public._require_menu('products');
    IF p_category_id IS NULL THEN
        INSERT INTO public.product_categories (name, active, created_by)
        VALUES (btrim(p_name), COALESCE(p_active, true), auth.uid()) RETURNING * INTO v_row;
    ELSE
        UPDATE public.product_categories SET name = btrim(p_name), active = COALESCE(p_active, active)
         WHERE id = p_category_id RETURNING * INTO v_row;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'CATEGORY_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
    END IF;
    PERFORM public._audit('PRODUCT_CATEGORY_SAVE', 'PRODUCT_CATEGORY', v_row.id, NULL, to_jsonb(v_row), NULL, NULL);
    RETURN to_jsonb(v_row);
END;
$$;

CREATE FUNCTION public.unit_save(p_unit_id uuid, p_name text, p_active boolean DEFAULT true, p_sort_order integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old public.units%ROWTYPE;
    v_row public.units%ROWTYPE;
BEGIN
    PERFORM public._require_menu('products');
    IF p_unit_id IS NULL THEN
        INSERT INTO public.units (name, active, sort_order, created_by)
        VALUES (btrim(p_name), COALESCE(p_active, true), COALESCE(p_sort_order, 0), auth.uid()) RETURNING * INTO v_row;
    ELSE
        SELECT * INTO v_old FROM public.units WHERE id = p_unit_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'UNIT_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
        UPDATE public.units SET name = btrim(p_name), active = COALESCE(p_active, active),
                                sort_order = COALESCE(p_sort_order, sort_order)
         WHERE id = p_unit_id RETURNING * INTO v_row;
    END IF;
    PERFORM public._audit('UNIT_SAVE', 'UNIT', v_row.id, to_jsonb(v_old), to_jsonb(v_row), NULL, NULL);
    RETURN to_jsonb(v_row);
END;
$$;

-- New product: duplicate check → product → initial stock movement → audit (Master §7).
CREATE FUNCTION public.product_create(
    p_data               jsonb,
    p_cost_price         numeric DEFAULT NULL,
    p_initial_qty        numeric DEFAULT 0,
    p_confirm_duplicate  boolean DEFAULT false,
    p_pin_token          uuid DEFAULT NULL       -- opening stock is stock receiving: PIN (Master §4.4)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_new     public.products%ROWTYPE;
    v_corr    uuid := gen_random_uuid();
    v_allowed text[] := ARRAY['sku', 'name', 'category_id', 'item_type', 'unit_id', 'calculation_type', 'sale_price',
                              'rental_price', 'reorder_point', 'can_sell', 'can_rent', 'is_accessory',
                              'is_rent_chargeable', 'requires_return', 'default_damage_fee', 'default_loss_fee'];
BEGIN
    PERFORM public._require_menu('products');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;
    v_new := jsonb_populate_record(NULL::public.products, p_data);
    IF COALESCE(p_initial_qty, 0) < 0 THEN
        RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_initial_qty, 0) > 0 AND COALESCE(v_new.item_type, 'QUANTITY') = 'SERIALIZED' THEN
        RAISE EXCEPTION 'SERIALIZED_STOCK_VIA_UNITS: use product_unit_register' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.units u WHERE u.id = v_new.unit_id AND u.active) THEN
        RAISE EXCEPTION 'UNIT_REQUIRED: pick an active unit' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.products p WHERE lower(btrim(p.name)) = lower(btrim(v_new.name)))
       AND NOT COALESCE(p_confirm_duplicate, false) THEN
        RAISE EXCEPTION 'DUPLICATE_PRODUCT_NAME' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.products (sku, name, category_id, item_type, unit_id, calculation_type, sale_price, rental_price,
                                 reorder_point, can_sell, can_rent, is_accessory, is_rent_chargeable, requires_return,
                                 default_damage_fee, default_loss_fee, created_by)
    VALUES (btrim(v_new.sku), btrim(v_new.name), v_new.category_id, COALESCE(v_new.item_type, 'QUANTITY'), v_new.unit_id,
            COALESCE(v_new.calculation_type, 'PER_UNIT'), v_new.sale_price, v_new.rental_price,
            COALESCE(v_new.reorder_point, 0), COALESCE(v_new.can_sell, false), COALESCE(v_new.can_rent, false),
            COALESCE(v_new.is_accessory, false), COALESCE(v_new.is_rent_chargeable, true),
            COALESCE(v_new.requires_return, true), COALESCE(v_new.default_damage_fee, 0),
            COALESCE(v_new.default_loss_fee, 0), auth.uid())
    RETURNING * INTO v_new;

    IF p_cost_price IS NOT NULL THEN
        INSERT INTO public.product_costs (product_id, cost_price, updated_by) VALUES (v_new.id, p_cost_price, auth.uid());
    END IF;
    IF COALESCE(p_initial_qty, 0) > 0 THEN
        PERFORM public._require_pin(p_pin_token, 'STOCK_RECEIVE');
        PERFORM public._stock_move(v_new.id, NULL, 'AVAILABLE', p_initial_qty, 'INITIAL', 'PRODUCT', v_new.id,
                                   NULL, 'initial stock', v_corr);
    END IF;

    PERFORM public._audit('PRODUCT_CREATE', 'PRODUCT', v_new.id, NULL,
                          to_jsonb(v_new) || jsonb_build_object('initial_qty', p_initial_qty, 'cost_set', p_cost_price IS NOT NULL),
                          NULL, v_corr, false, NULL, NULLIF(p_initial_qty, 0));
    RETURN to_jsonb(v_new);
END;
$$;

-- Non-price fields only; prices (PIN), cost and stock have their own RPCs.
CREATE FUNCTION public.product_update(p_product_id uuid, p_data jsonb, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old     public.products%ROWTYPE;
    v_new     public.products%ROWTYPE;
    v_allowed text[] := ARRAY['sku', 'name', 'category_id', 'item_type', 'unit_id', 'calculation_type',
                              'reorder_point', 'can_sell', 'can_rent', 'is_accessory', 'is_rent_chargeable',
                              'requires_return', 'default_damage_fee', 'default_loss_fee'];
BEGIN
    PERFORM public._require_menu('products');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS: prices use product_set_price, cost uses product_set_cost' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_old FROM public.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_new := jsonb_populate_record(v_old, p_data);
    IF v_new.item_type <> v_old.item_type AND EXISTS (SELECT 1 FROM public.stock_movements WHERE product_id = p_product_id) THEN
        RAISE EXCEPTION 'ITEM_TYPE_LOCKED: product has stock history' USING ERRCODE = '23514';
    END IF;
    IF v_new.unit_id IS DISTINCT FROM v_old.unit_id
       AND NOT EXISTS (SELECT 1 FROM public.units u WHERE u.id = v_new.unit_id AND u.active) THEN
        RAISE EXCEPTION 'UNIT_REQUIRED: pick an active unit' USING ERRCODE = '22023';
    END IF;

    UPDATE public.products
       SET sku = btrim(v_new.sku), name = btrim(v_new.name), category_id = v_new.category_id,
           item_type = v_new.item_type, unit_id = v_new.unit_id, calculation_type = v_new.calculation_type,
           reorder_point = v_new.reorder_point, can_sell = v_new.can_sell, can_rent = v_new.can_rent,
           is_accessory = v_new.is_accessory, is_rent_chargeable = v_new.is_rent_chargeable,
           requires_return = v_new.requires_return, default_damage_fee = v_new.default_damage_fee,
           default_loss_fee = v_new.default_loss_fee,
           updated_by = auth.uid()
     WHERE id = p_product_id
    RETURNING * INTO v_new;

    PERFORM public._audit('PRODUCT_UPDATE', 'PRODUCT', p_product_id, to_jsonb(v_old), to_jsonb(v_new), p_reason, NULL);
    RETURN to_jsonb(v_new);
END;
$$;

CREATE FUNCTION public.product_set_price(
    p_product_id    uuid,
    p_sale_price    numeric,
    p_rental_price  numeric,
    p_reason        text,
    p_pin_token     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old    public.products%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_menu('products');
    PERFORM public._require_pin(p_pin_token, 'PRODUCT_PRICE_CHANGE');
    SELECT * INTO v_old FROM public.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.products SET sale_price = p_sale_price, rental_price = p_rental_price, updated_by = auth.uid()
     WHERE id = p_product_id;
    PERFORM public._audit('PRODUCT_PRICE_CHANGE', 'PRODUCT', p_product_id,
                          jsonb_build_object('sale_price', v_old.sale_price, 'rental_price', v_old.rental_price),
                          jsonb_build_object('sale_price', p_sale_price, 'rental_price', p_rental_price), v_reason, NULL,
                          true);
    RETURN jsonb_build_object('product_id', p_product_id, 'sale_price', p_sale_price, 'rental_price', p_rental_price);
END;
$$;

CREATE FUNCTION public.product_set_cost(p_product_id uuid, p_cost_price numeric, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old    numeric;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_menu('products');
    PERFORM 1 FROM public.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    SELECT cost_price INTO v_old FROM public.product_costs WHERE product_id = p_product_id;
    INSERT INTO public.product_costs AS pc (product_id, cost_price, updated_by)
    VALUES (p_product_id, p_cost_price, auth.uid())
    ON CONFLICT (product_id) DO UPDATE SET cost_price = EXCLUDED.cost_price, updated_by = EXCLUDED.updated_by,
                                           updated_at = now();
    PERFORM public._audit('PRODUCT_COST_CHANGE', 'PRODUCT', p_product_id, jsonb_build_object('cost_price', v_old),
                          jsonb_build_object('cost_price', p_cost_price), v_reason, NULL);
    RETURN jsonb_build_object('product_id', p_product_id, 'cost_price', p_cost_price);
END;
$$;

CREATE FUNCTION public.product_set_active(p_product_id uuid, p_active boolean, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old    boolean;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_menu('products');
    SELECT active INTO v_old FROM public.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.products SET active = p_active, updated_by = auth.uid() WHERE id = p_product_id;
    PERFORM public._audit('PRODUCT_SET_ACTIVE', 'PRODUCT', p_product_id, jsonb_build_object('active', v_old),
                          jsonb_build_object('active', p_active), v_reason, NULL);
    RETURN jsonb_build_object('product_id', p_product_id, 'active', p_active);
END;
$$;

-- Registering a serialized unit receives one piece into stock (menu "products").
CREATE FUNCTION public.product_unit_register(p_product_id uuid, p_serial_no text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_unit   public.product_units%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('products');
    PERFORM 1 FROM public.products WHERE id = p_product_id AND item_type = 'SERIALIZED' AND active FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_SERIALIZED_OR_INACTIVE' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.product_units (product_id, serial_no, created_by)
    VALUES (p_product_id, btrim(p_serial_no), auth.uid()) RETURNING * INTO v_unit;
    PERFORM public._stock_move(p_product_id, NULL, 'AVAILABLE', 1, 'RECEIVE', 'PRODUCT_UNIT', v_unit.id,
                               v_unit.id, v_reason, v_corr);
    PERFORM public._audit('PRODUCT_UNIT_REGISTER', 'PRODUCT_UNIT', v_unit.id, NULL, to_jsonb(v_unit), v_reason, v_corr);
    RETURN to_jsonb(v_unit);
END;
$$;

-- ============================================================================
-- 14. RPC — CUSTOMER DOCUMENTS (Master §6): bound to the customer, never to a bill.
-- ============================================================================

CREATE FUNCTION public.customer_document_save(p_document_id uuid, p_customer_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old     public.customer_documents%ROWTYPE;
    v_new     public.customer_documents%ROWTYPE;
    v_allowed text[] := ARRAY['doc_type', 'template_code', 'template_version', 'data_snapshot', 'signature_svg',
                              'signature_json', 'storage_path', 'note'];
BEGIN
    PERFORM public._require_menu('documents', 'customers');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;
    IF p_document_id IS NULL THEN
        PERFORM 1 FROM public.customers WHERE id = p_customer_id AND active FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'CUSTOMER_NOT_FOUND_OR_INACTIVE' USING ERRCODE = 'P0002';
        END IF;
        v_new := jsonb_populate_record(NULL::public.customer_documents, p_data);
        INSERT INTO public.customer_documents (customer_id, doc_type, template_code, template_version, data_snapshot,
                                               signature_svg, signature_json, storage_path, note, created_by)
        VALUES (p_customer_id, v_new.doc_type, v_new.template_code, v_new.template_version, v_new.data_snapshot,
                v_new.signature_svg, v_new.signature_json, v_new.storage_path, v_new.note, auth.uid())
        RETURNING * INTO v_new;
    ELSE
        SELECT * INTO v_old FROM public.customer_documents WHERE id = p_document_id FOR UPDATE;
        IF NOT FOUND OR v_old.customer_id <> p_customer_id THEN
            RAISE EXCEPTION 'DOCUMENT_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
        -- A signed contract keeps its content; only notes / added signature may change.
        IF v_old.doc_type = 'RENTAL_CONTRACT' AND (p_data ?| ARRAY['doc_type', 'template_code', 'template_version', 'data_snapshot']) THEN
            RAISE EXCEPTION 'CONTRACT_CONTENT_IMMUTABLE: create a new document instead' USING ERRCODE = '42501';
        END IF;
        v_new := jsonb_populate_record(v_old, p_data);
        UPDATE public.customer_documents
           SET doc_type = v_new.doc_type, template_code = v_new.template_code, template_version = v_new.template_version,
               data_snapshot = v_new.data_snapshot, signature_svg = v_new.signature_svg,
               signature_json = v_new.signature_json, storage_path = v_new.storage_path, note = v_new.note,
               updated_by = auth.uid()
         WHERE id = p_document_id
        RETURNING * INTO v_new;
    END IF;
    PERFORM public._audit('CUSTOMER_DOCUMENT_SAVE', 'CUSTOMER_DOCUMENT', v_new.id,
                          to_jsonb(v_old) - 'signature_svg' - 'signature_json',
                          to_jsonb(v_new) - 'signature_svg' - 'signature_json', NULL, NULL);
    RETURN to_jsonb(v_new);
END;
$$;

-- No hard delete (Master §6.3): documents are retired with a status and a reason.
CREATE FUNCTION public.customer_document_set_status(p_document_id uuid, p_status text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old    public.customer_documents%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_menu('documents', 'customers');
    IF p_status NOT IN ('ACTIVE', 'INACTIVE') THEN
        RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_old FROM public.customer_documents WHERE id = p_document_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DOCUMENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.customer_documents SET status = p_status, status_reason = v_reason, updated_by = auth.uid()
     WHERE id = p_document_id;
    PERFORM public._audit('CUSTOMER_DOCUMENT_STATUS', 'CUSTOMER_DOCUMENT', p_document_id,
                          jsonb_build_object('status', v_old.status), jsonb_build_object('status', p_status), v_reason, NULL);
    RETURN jsonb_build_object('document_id', p_document_id, 'status', p_status);
END;
$$;

-- ============================================================================
-- 15. RPC — QUOTATION / RESERVATION (Master §10)
-- ============================================================================

-- List price for a mode. A RENTAL of a product that is tracked but not rent-charged
-- (accessories, Master §7) always lists at 0.
CREATE FUNCTION public._list_price(p_product_id uuid, p_mode text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_product public.products%ROWTYPE;
BEGIN
    SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
    IF NOT FOUND OR NOT v_product.active THEN
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
$$;

-- Effective unit price: the list price unless the caller overrides it. Whether that is
-- an override (PIN, Master §4.4) is decided by the caller comparing with _list_price.
CREATE FUNCTION public._check_price(p_product_id uuid, p_mode text, p_unit_price numeric)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_list numeric := public._list_price(p_product_id, p_mode);
BEGIN
    RETURN COALESCE(p_unit_price, v_list);
END;
$$;

-- Discount over the owner's limit (owner decision 2026-10-04): only when the switch
-- policies.discount_limit_enabled is on; the percent is the owner's own value, never a default.
-- Works on amounts, so FIXED and PERCENT discounts at line or bill level are judged alike.
CREATE FUNCTION public._discount_over_limit(p_discount numeric, p_base numeric)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limit jsonb := public._policy('discount_limit_percent', 'null'::jsonb);
BEGIN
    IF public._policy('discount_limit_enabled', 'false'::jsonb) IS DISTINCT FROM 'true'::jsonb
       OR COALESCE(p_discount, 0) <= 0 THEN
        RETURN false;
    END IF;
    IF jsonb_typeof(v_limit) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'DISCOUNT_LIMIT_NOT_SET' USING ERRCODE = '22023';
    END IF;
    RETURN COALESCE(p_base, 0) <= 0 OR p_discount * 100 > (v_limit::text)::numeric * p_base;
END;
$$;

CREATE FUNCTION public.quotation_save_draft(p_quotation_id uuid, p_data jsonb, p_pin_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    v_override boolean := false;
    v_reason   text;
BEGIN
    PERFORM public._require_menu('quotations');
    IF p_quotation_id IS NULL THEN
        INSERT INTO public.quotations (customer_id, valid_until, note, site_name, delivery_fee, deposit_amount, created_by)
        VALUES ((p_data ->> 'customer_id')::uuid, (p_data ->> 'valid_until')::timestamptz, p_data ->> 'note',
                p_data ->> 'site_name', COALESCE((p_data ->> 'delivery_fee')::numeric, 0),
                COALESCE((p_data ->> 'deposit_amount')::numeric, 0), auth.uid())
        RETURNING * INTO v_q;
    ELSE
        SELECT * INTO v_q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
        IF NOT FOUND OR v_q.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'QUOTATION_NOT_DRAFT' USING ERRCODE = '23514';
        END IF;
        UPDATE public.quotations
           SET customer_id = (p_data ->> 'customer_id')::uuid,
               valid_until = (p_data ->> 'valid_until')::timestamptz,
               note = p_data ->> 'note', site_name = p_data ->> 'site_name',
               delivery_fee = COALESCE((p_data ->> 'delivery_fee')::numeric, 0),
               deposit_amount = COALESCE((p_data ->> 'deposit_amount')::numeric, 0),
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

    v_settings := public._store_settings();
    SELECT COALESCE(sum(line_total), 0), COALESCE(sum(discount_amount), 0) INTO v_sub, v_disc
      FROM public.quotation_items WHERE quotation_id = v_q.id;
    -- Delivery fee is part of the quoted amount, like on the bill (VAT on goods + fee).
    IF v_settings.vat_enabled AND v_settings.vat_rate > 0 THEN
        v_vat := CASE v_settings.vat_mode
            WHEN 'INCLUSIVE' THEN round((v_sub + v_q.delivery_fee) * v_settings.vat_rate / (100 + v_settings.vat_rate), 2)
            ELSE round((v_sub + v_q.delivery_fee) * v_settings.vat_rate / 100, 2) END;
    END IF;
    UPDATE public.quotations
       SET subtotal = v_sub, discount_total = v_disc, vat_amount = v_vat,
           grand_total = CASE WHEN v_settings.vat_mode = 'INCLUSIVE' THEN v_sub + v_q.delivery_fee
                              ELSE v_sub + v_q.delivery_fee + v_vat END,
           pricing_snapshot = jsonb_build_object('vat_enabled', v_settings.vat_enabled,
               'vat_rate', v_settings.vat_rate, 'vat_mode', v_settings.vat_mode)
     WHERE id = v_q.id
    RETURNING * INTO v_q;

    v_override := v_override OR EXISTS (SELECT 1 FROM public.quotation_items
                                         WHERE quotation_id = v_q.id
                                           AND public._discount_over_limit(discount_amount, line_total + discount_amount));
    IF v_override THEN
        PERFORM public._require_pin(p_pin_token, 'PRICE_OVERRIDE');
        v_reason := public._require_reason(p_data ->> 'override_reason');
    END IF;
    PERFORM public._audit('QUOTATION_SAVE_DRAFT', 'QUOTATION', v_q.id, NULL, to_jsonb(v_q), v_reason, NULL, v_override);
    RETURN to_jsonb(v_q);
END;
$$;

CREATE FUNCTION public.quotation_send(p_quotation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_q public.quotations%ROWTYPE;
BEGIN
    PERFORM public._require_menu('quotations');
    SELECT * INTO v_q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
    IF NOT FOUND OR v_q.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'QUOTATION_NOT_DRAFT' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.quotation_items WHERE quotation_id = p_quotation_id) THEN
        RAISE EXCEPTION 'QUOTATION_EMPTY' USING ERRCODE = '23514';
    END IF;
    UPDATE public.quotations
       SET status = 'SENT', quotation_no = COALESCE(quotation_no, public._next_document_no('QUOTATION')),
           updated_by = auth.uid()
     WHERE id = p_quotation_id
    RETURNING * INTO v_q;
    PERFORM public._audit('QUOTATION_SEND', 'QUOTATION', p_quotation_id, NULL, to_jsonb(v_q), NULL, NULL);
    RETURN to_jsonb(v_q);
END;
$$;

CREATE FUNCTION public._reservation_release(p_reservation_id uuid, p_status text, p_reason text, p_correlation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_r public.reservations%ROWTYPE;
BEGIN
    SELECT * INTO v_r FROM public.reservations WHERE id = p_reservation_id FOR UPDATE;
    IF v_r.status <> 'ACTIVE' THEN
        RETURN;
    END IF;
    PERFORM public._stock_move(v_r.product_id, 'RESERVED', 'AVAILABLE', v_r.quantity, 'RELEASE', 'RESERVATION',
                               v_r.id, NULL, p_reason, p_correlation_id);
    UPDATE public.reservations
       SET status = p_status, released_at = now(), released_by = auth.uid(), release_reason = p_reason
     WHERE id = p_reservation_id;
END;
$$;

CREATE FUNCTION public.quotation_set_status(p_quotation_id uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    IF NOT ((v_q.status = 'SENT' AND p_status IN ('ACCEPTED', 'REJECTED', 'EXPIRED'))
         OR (v_q.status = 'ACCEPTED' AND p_status IN ('REJECTED', 'EXPIRED'))
         OR (v_q.status = 'DRAFT' AND p_status = 'REJECTED')) THEN
        RAISE EXCEPTION 'QUOTATION_STATUS_TRANSITION: % -> %', v_q.status, p_status USING ERRCODE = '23514';
    END IF;
    IF p_status = 'REJECTED' AND v_q.status = 'DRAFT' THEN
        -- quotation_no is required once a quotation leaves DRAFT.
        UPDATE public.quotations SET quotation_no = COALESCE(quotation_no, public._next_document_no('QUOTATION'))
         WHERE id = p_quotation_id;
    END IF;
    IF p_status IN ('REJECTED', 'EXPIRED') THEN
        FOR v_r IN SELECT id FROM public.reservations WHERE quotation_id = p_quotation_id AND status = 'ACTIVE' LOOP
            PERFORM public._reservation_release(v_r, 'CANCELLED', COALESCE(p_reason, 'quotation ' || lower(p_status)), v_corr);
        END LOOP;
    END IF;
    UPDATE public.quotations SET status = p_status, updated_by = auth.uid() WHERE id = p_quotation_id RETURNING * INTO v_q;
    PERFORM public._audit('QUOTATION_STATUS', 'QUOTATION', p_quotation_id, NULL, jsonb_build_object('status', p_status),
                          p_reason, v_corr);
    RETURN to_jsonb(v_q);
END;
$$;

CREATE FUNCTION public.reservation_create(
    p_quotation_id     uuid,
    p_items            jsonb,
    p_expires_at       timestamptz,
    p_idempotency_key  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem  record;
    v_item  record;
    v_res   public.reservations%ROWTYPE;
    v_ids   jsonb := '[]'::jsonb;
    v_corr  uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('quotations');
    SELECT * INTO v_idem FROM public._idempotency_begin('reservation_create', p_idempotency_key,
        md5(jsonb_build_object('q', p_quotation_id, 'i', p_items, 'e', p_expires_at)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    PERFORM 1 FROM public.quotations WHERE id = p_quotation_id AND status IN ('SENT', 'ACCEPTED') FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'QUOTATION_NOT_OPEN' USING ERRCODE = '23514';
    END IF;
    IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
        RAISE EXCEPTION 'RESERVATION_EXPIRY_REQUIRED' USING ERRCODE = '22023';
    END IF;

    FOR v_item IN
        SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity numeric, reservation_type text)
         ORDER BY product_id
    LOOP
        PERFORM public._check_price(v_item.product_id, v_item.reservation_type, NULL);
        INSERT INTO public.reservations (reservation_no, quotation_id, product_id, reservation_type, quantity,
                                         expires_at, created_by)
        VALUES (public._next_document_no('RESERVATION'), p_quotation_id, v_item.product_id, v_item.reservation_type,
                v_item.quantity, p_expires_at, auth.uid())
        RETURNING * INTO v_res;
        PERFORM public._stock_move(v_item.product_id, 'AVAILABLE', 'RESERVED', v_item.quantity, 'RESERVE',
                                   'RESERVATION', v_res.id, NULL, NULL, v_corr);
        v_ids := v_ids || to_jsonb(v_res.id);
    END LOOP;

    PERFORM public._audit('RESERVATION_CREATE', 'QUOTATION', p_quotation_id, NULL, jsonb_build_object('reservations', v_ids),
                          NULL, v_corr);
    RETURN public._idempotency_finish(v_idem.key_id, jsonb_build_object('reservation_ids', v_ids));
END;
$$;

CREATE FUNCTION public.reservation_release(p_reservation_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('quotations');
    IF NOT EXISTS (SELECT 1 FROM public.reservations WHERE id = p_reservation_id AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'RESERVATION_NOT_ACTIVE' USING ERRCODE = '23514';
    END IF;
    PERFORM public._reservation_release(p_reservation_id, 'CANCELLED', v_reason, v_corr);
    PERFORM public._audit('RESERVATION_RELEASE', 'RESERVATION', p_reservation_id, NULL,
                          jsonb_build_object('status', 'CANCELLED'), v_reason, v_corr);
    RETURN jsonb_build_object('reservation_id', p_reservation_id, 'status', 'CANCELLED');
END;
$$;

-- Cron / service_role: release expired reservations (Master §10).
CREATE FUNCTION public.reservations_expire()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_r     uuid;
    v_count integer := 0;
    v_corr  uuid := gen_random_uuid();
BEGIN
    IF auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: system job' USING ERRCODE = '42501';
    END IF;
    -- No auto-release until the owner sets a reservation policy (decision 2026-10-04).
    IF public._policy('reservation_auto_release', 'false'::jsonb) IS DISTINCT FROM 'true'::jsonb THEN
        RETURN 0;
    END IF;
    FOR v_r IN SELECT id FROM public.reservations WHERE status = 'ACTIVE' AND expires_at <= now()
                ORDER BY product_id FOR UPDATE SKIP LOCKED LOOP
        PERFORM public._reservation_release(v_r, 'EXPIRED', 'reservation expired', v_corr);
        v_count := v_count + 1;
    END LOOP;
    IF v_count > 0 THEN
        PERFORM public._audit('RESERVATIONS_EXPIRE', 'RESERVATION', NULL, NULL, jsonb_build_object('count', v_count),
                              'system job', v_corr);
    END IF;
    RETURN v_count;
END;
$$;

-- ============================================================================
-- 16. RPC — BILL (Master §8, §20, §21)
-- ============================================================================

-- Payment core shared by bill_confirm (checkout) and payment_receive (Master §13).
-- Caller holds the bill lock and has checked the menu. CASH is just a channel (Master §24).
CREATE FUNCTION public._payment_receive_core(
    p_bill_id          uuid,
    p_tenders          jsonb,
    p_key_id           uuid,
    p_correlation_id   uuid,
    p_received_on      date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill      public.bills%ROWTYPE;
    v_receipt   public.payment_receipts%ROWTYPE;
    v_tender    record;
    v_total     numeric(14,2) := 0;
    v_payments  jsonb := '[]'::jsonb;
    v_pid       uuid;
    v_received_at timestamptz := CASE
        WHEN p_received_on IS NULL OR p_received_on = public._local_date(now()) THEN now()
        ELSE (p_received_on + time '12:00') AT TIME ZONE COALESCE(
            (SELECT s.timezone FROM public.store_settings s WHERE s.singleton), 'Asia/Bangkok')
    END;
BEGIN
    IF p_received_on > public._local_date(now()) THEN
        RAISE EXCEPTION 'PAYMENT_DATE_IN_FUTURE' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    IF v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_PAYABLE: %', v_bill.status USING ERRCODE = '23514';
    END IF;
    IF COALESCE(CASE WHEN jsonb_typeof(p_tenders) = 'array' THEN jsonb_array_length(p_tenders) END, 0) = 0 THEN
        RAISE EXCEPTION 'TENDERS_REQUIRED' USING ERRCODE = '22023';
    END IF;

    FOR v_tender IN SELECT * FROM jsonb_to_recordset(p_tenders) AS x(method text, amount numeric, reference text) LOOP
        IF v_tender.amount IS NULL OR v_tender.amount <= 0 OR round(v_tender.amount, 2) <> v_tender.amount THEN
            RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
        END IF;
        IF v_tender.method NOT IN ('CASH', 'TRANSFER', 'CARD', 'QR', 'OTHER') THEN
            RAISE EXCEPTION 'INVALID_METHOD: %', v_tender.method USING ERRCODE = '22023';
        END IF;
        v_total := v_total + v_tender.amount;
    END LOOP;

    IF v_total > v_bill.balance_due
       AND NOT (public._policy('allow_overpayment', 'false'::jsonb))::text::boolean THEN
        RAISE EXCEPTION 'OVERPAYMENT: balance due %, received %', v_bill.balance_due, v_total USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.payment_receipts (receipt_no, bill_id, total_amount, received_at, received_by,
                                         idempotency_key_id, correlation_id, created_by)
    VALUES (public._next_document_no('RECEIPT'), p_bill_id, v_total, v_received_at, auth.uid(),
            p_key_id, p_correlation_id, auth.uid())
    RETURNING * INTO v_receipt;

    FOR v_tender IN SELECT * FROM jsonb_to_recordset(p_tenders) AS x(method text, amount numeric, reference text) LOOP
        INSERT INTO public.payments (receipt_id, bill_id, method, amount, reference, status, received_at, created_by)
        VALUES (v_receipt.id, p_bill_id, v_tender.method, v_tender.amount, v_tender.reference, 'COMPLETED',
                v_receipt.received_at, auth.uid())
        RETURNING id INTO v_pid;
        v_payments := v_payments || jsonb_build_object('payment_id', v_pid, 'method', v_tender.method,
                                                       'amount', v_tender.amount);
    END LOOP;

    PERFORM public._audit('PAYMENT_RECEIVE', 'BILL', p_bill_id, NULL,
                          jsonb_build_object('receipt_no', v_receipt.receipt_no, 'total', v_total, 'payments', v_payments),
                          NULL, p_correlation_id, false, v_total, NULL,
                          (SELECT string_agg(DISTINCT x.method, ',') FROM jsonb_to_recordset(p_tenders) AS x(method text)));
    RETURN jsonb_build_object('receipt_id', v_receipt.id, 'receipt_no', v_receipt.receipt_no, 'total_amount', v_total,
                              'payments', v_payments);
END;
$$;

CREATE FUNCTION public.bill_save_draft(p_bill_id uuid, p_data jsonb, p_pin_token uuid DEFAULT NULL)
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
    v_allowed   text[] := ARRAY['customer_id', 'quotation_id', 'note', 'bill_discount_type', 'bill_discount_value',
                                'delivery_fee', 'installation_fee', 'service_fee', 'is_credit_bill', 'due_date',
                                'deposit_amount', 'deposit_note', 'lines', 'override_reason'];
    v_reason    text;
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((p_data ->> 'deposit_amount')::numeric, 0) < 0 THEN
        RAISE EXCEPTION 'INVALID_DEPOSIT' USING ERRCODE = '22023';
    END IF;
    v_override := false;

    IF p_bill_id IS NULL THEN
        INSERT INTO public.bills (status, customer_id, quotation_id, note, bill_discount_type, bill_discount_value,
            delivery_fee, installation_fee, service_fee, is_credit_bill, due_date, deposit_amount, deposit_note, created_by)
        VALUES ('DRAFT', (p_data ->> 'customer_id')::uuid, (p_data ->> 'quotation_id')::uuid,
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

-- Checkout (Master §8.5): validate → lock stock → bill number → allocations →
-- revenue ledger → optional payment → audit, all or nothing.
CREATE FUNCTION public.bill_confirm(
    p_bill_id          uuid,
    p_idempotency_key  text,
    p_tenders          jsonb DEFAULT NULL
)
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

    -- Customer (Master §5): any RENTAL line needs one. No contract is required (Master §6).
    v_has_rental := EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND line_mode = 'RENTAL');
    IF v_bill.customer_id IS NOT NULL THEN
        SELECT * INTO v_customer FROM public.customers WHERE id = v_bill.customer_id FOR SHARE;
        IF NOT v_customer.active THEN
            RAISE EXCEPTION 'CUSTOMER_INACTIVE' USING ERRCODE = '23514';
        END IF;
    ELSIF v_has_rental OR v_bill.is_credit_bill THEN
        RAISE EXCEPTION 'CUSTOMER_REQUIRED' USING ERRCODE = '23514';
    END IF;

    -- Product capability for every line before anything is committed (Master §8.5: no partial commit).
    FOR v_line IN SELECT * FROM public.bill_lines WHERE bill_id = p_bill_id ORDER BY line_no LOOP
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

    -- Credit limit (Master §23).
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
           due_date = COALESCE(due_date, CASE WHEN is_credit_bill
                          THEN public._local_date(now()) + v_customer.payment_terms_days END)
     WHERE id = p_bill_id;

    -- Quotation conversion: its holds are released and re-allocated to this bill.
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

    -- Allocation with locked balances; ordered by product to avoid deadlocks.
    FOR v_line IN SELECT * FROM public.bill_lines WHERE bill_id = p_bill_id ORDER BY product_id, line_no LOOP
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
        v_receipt := public._payment_receive_core(p_bill_id, p_tenders, v_idem.key_id, v_corr);
    END IF;
    PERFORM public._bill_settle(p_bill_id);

    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    PERFORM public._audit('BILL_CONFIRM', 'BILL', p_bill_id, NULL, to_jsonb(v_bill), NULL, v_corr);
    RETURN public._idempotency_finish(v_idem.key_id,
        jsonb_build_object('bill', to_jsonb(v_bill), 'receipt', v_receipt));
END;
$$;

-- Releases stock still allocated to the bill and cancels the undelivered quantity.
CREATE FUNCTION public._bill_release_allocation(p_bill_id uuid, p_correlation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_line public.bill_lines%ROWTYPE;
BEGIN
    FOR v_line IN SELECT * FROM public.bill_lines WHERE bill_id = p_bill_id ORDER BY product_id, line_no FOR UPDATE LOOP
        IF v_line.allocated_qty > 0 THEN
            PERFORM public._stock_move(v_line.product_id, 'RESERVED', 'AVAILABLE', v_line.allocated_qty, 'RELEASE',
                                       'BILL_LINE', v_line.id, NULL, 'bill cancelled/voided', p_correlation_id);
        END IF;
        UPDATE public.bill_lines
           SET allocated_qty = 0, backorder_qty = 0,
               cancelled_qty = ordered_qty - delivered_qty
         WHERE id = v_line.id;
    END LOOP;
END;
$$;

-- Cancel: before any money / delivery (Master §20). Never refunds automatically.
-- A DRAFT cancels freely; cancelling a CONFIRMED bill needs a PIN (Master §4.4).
CREATE FUNCTION public.bill_cancel(p_bill_id uuid, p_reason text, p_pin_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill   public.bills%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_bill.status = 'CONFIRMED' THEN
        PERFORM public._require_pin(p_pin_token, 'BILL_CANCEL');
        IF EXISTS (SELECT 1 FROM public.payments WHERE bill_id = p_bill_id AND status IN ('COMPLETED', 'PENDING'))
           OR EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND (delivered_qty > 0 OR carried_in_qty > 0))
           OR EXISTS (SELECT 1 FROM public.charges WHERE bill_id = p_bill_id AND status = 'CONFIRMED') THEN
            RAISE EXCEPTION 'BILL_HAS_TRANSACTIONS: use bill_void' USING ERRCODE = '23514';
        END IF;
        PERFORM public._bill_release_allocation(p_bill_id, v_corr);
        PERFORM public._ledger_reverse_source('BILL_CONFIRM', p_bill_id, v_corr);
        UPDATE public.charges SET status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(),
                                  cancel_reason = v_reason
         WHERE bill_id = p_bill_id AND status = 'PENDING';
    ELSIF v_bill.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'BILL_NOT_CANCELLABLE: %', v_bill.status USING ERRCODE = '23514';
    END IF;

    UPDATE public.bills SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason
     WHERE id = p_bill_id;
    IF v_bill.status = 'CONFIRMED' THEN
        PERFORM public._bill_recalculate(p_bill_id);
    END IF;
    PERFORM public._audit('BILL_CANCEL', 'BILL', p_bill_id, jsonb_build_object('status', v_bill.status),
                          jsonb_build_object('status', 'CANCELLED'), v_reason, v_corr, v_bill.status = 'CONFIRMED',
                          v_bill.grand_total);
    RETURN jsonb_build_object('bill_id', p_bill_id, 'status', 'CANCELLED');
END;
$$;

-- Void a confirmed/active bill: reverses revenue, charges, allocation. Goods still with
-- the customer must be received back first; money received stays and becomes a
-- refund due (refund_pay) — never refunded automatically (Master §20). PIN required.
CREATE FUNCTION public.bill_void(p_bill_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill   public.bills%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
    v_id     uuid;
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM public._require_pin(p_pin_token, 'BILL_VOID');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_VOIDABLE' USING ERRCODE = '23514';
    END IF;
    PERFORM public._bill_recalculate(p_bill_id);

    IF EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND line_mode = 'RENTAL' AND obligation_held_here > 0) THEN
        RAISE EXCEPTION 'ITEMS_STILL_WITH_CUSTOMER: receive the return first' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND line_mode = 'SALE' AND delivered_qty > 0) THEN
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

-- Correction of wrongly recorded fields of a confirmed bill (Master §19.3) — PIN.
-- Deposit amount / note are information only (Master §18), so they are correctable.
CREATE FUNCTION public.bill_correct(p_bill_id uuid, p_data jsonb, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old    public.bills%ROWTYPE;
    v_new    public.bills%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM public._require_pin(p_pin_token, 'BILL_CORRECT');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k
                WHERE k <> ALL (ARRAY['note', 'due_date', 'deposit_amount', 'deposit_note'])) THEN
        RAISE EXCEPTION 'CORRECTION_FIELD_NOT_ALLOWED: amounts, dates of rental and quantities use adjustment / continuation'
            USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_old FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_old.status = 'DRAFT' THEN
        RAISE EXCEPTION 'BILL_NOT_CORRECTABLE' USING ERRCODE = '23514';
    END IF;
    v_new := jsonb_populate_record(v_old, p_data);
    IF v_new.deposit_amount IS NULL OR v_new.deposit_amount < 0 THEN
        RAISE EXCEPTION 'INVALID_DEPOSIT' USING ERRCODE = '22023';
    END IF;
    UPDATE public.bills SET note = v_new.note, due_date = v_new.due_date, deposit_amount = v_new.deposit_amount,
                            deposit_note = v_new.deposit_note
     WHERE id = p_bill_id RETURNING * INTO v_new;
    PERFORM public._audit('BILL_CORRECT', 'BILL', p_bill_id,
                          jsonb_build_object('note', v_old.note, 'due_date', v_old.due_date,
                                             'deposit_amount', v_old.deposit_amount, 'deposit_note', v_old.deposit_note),
                          jsonb_build_object('note', v_new.note, 'due_date', v_new.due_date,
                                             'deposit_amount', v_new.deposit_amount, 'deposit_note', v_new.deposit_note),
                          v_reason, NULL, true);
    RETURN to_jsonb(v_new);
END;
$$;

-- Credit / debit adjustment after confirm (Master §19.2). A reversal is the opposite
-- type for the same amount, pointing at the original.
CREATE FUNCTION public.bill_adjust(
    p_bill_id                 uuid,
    p_adjustment_type         text,
    p_amount                  numeric,
    p_reason                  text,
    p_idempotency_key         text,
    p_pin_token               uuid,
    p_bill_line_id            uuid DEFAULT NULL,
    p_reverses_adjustment_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem   record;
    v_bill   public.bills%ROWTYPE;
    v_orig   public.bill_adjustments%ROWTYPE;
    v_adj    public.bill_adjustments%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM public._require_pin(p_pin_token, 'BILL_ADJUST');
    SELECT * INTO v_idem FROM public._idempotency_begin('bill_adjust', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 't', p_adjustment_type, 'a', p_amount, 'l', p_bill_line_id,
                               'r', p_reverses_adjustment_id)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_ADJUSTABLE' USING ERRCODE = '23514';
    END IF;
    IF p_adjustment_type NOT IN ('CREDIT', 'DEBIT') OR p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_ADJUSTMENT' USING ERRCODE = '22023';
    END IF;
    IF p_reverses_adjustment_id IS NOT NULL THEN
        SELECT * INTO v_orig FROM public.bill_adjustments WHERE id = p_reverses_adjustment_id AND bill_id = p_bill_id;
        IF NOT FOUND OR v_orig.adjustment_type = p_adjustment_type OR v_orig.amount <> p_amount
           OR v_orig.reverses_adjustment_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVALID_ADJUSTMENT_REVERSAL' USING ERRCODE = '22023';
        END IF;
    ELSIF p_adjustment_type = 'CREDIT' AND p_amount > v_bill.grand_total + v_bill.charge_total + v_bill.adjustment_net THEN
        RAISE EXCEPTION 'CREDIT_EXCEEDS_BILL' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.bill_adjustments (bill_id, bill_line_id, adjustment_type, amount, before_data, after_data, reason,
                                         reverses_adjustment_id, correlation_id, created_by)
    VALUES (p_bill_id, p_bill_line_id, p_adjustment_type, p_amount,
            jsonb_build_object('balance_due', v_bill.balance_due), NULL, v_reason,
            p_reverses_adjustment_id, v_corr, auth.uid())
    RETURNING * INTO v_adj;
    PERFORM public._ledger('REVENUE', 'ADJUSTMENT', p_amount,
                           (CASE WHEN p_adjustment_type = 'DEBIT' THEN 1 ELSE -1 END)::smallint,
                           p_bill_id, p_bill_line_id, 'ADJUSTMENT', v_adj.id, v_corr);
    PERFORM public._bill_settle(p_bill_id);

    PERFORM public._audit('BILL_ADJUST', 'BILL', p_bill_id, jsonb_build_object('balance_due', v_bill.balance_due),
                          to_jsonb(v_adj), v_reason, v_corr, true, p_amount);
    RETURN public._idempotency_finish(v_idem.key_id, to_jsonb(v_adj));
END;
$$;

-- ============================================================================
-- 17. RPC — DELIVERY / RETURN / INCIDENT (Master §11–§14)
-- ============================================================================

CREATE FUNCTION public.delivery_create(
    p_bill_id          uuid,
    p_lines            jsonb,
    p_idempotency_key  text,
    p_delivered_at     timestamptz DEFAULT NULL,
    p_appointment_id   uuid DEFAULT NULL,
    p_note             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem     record;
    v_bill     public.bills%ROWTYPE;
    v_item     record;
    v_line     public.bill_lines%ROWTYPE;
    v_product  public.products%ROWTYPE;
    v_delivery public.deliveries%ROWTYPE;
    v_dl_id    uuid;
    v_unit     uuid;
    v_at       timestamptz := COALESCE(p_delivered_at, now());
    v_corr     uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('delivery_create', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 'l', p_lines, 'at', p_delivered_at)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    IF v_at > now() + interval '5 minutes' THEN
        RAISE EXCEPTION 'DELIVERED_AT_IN_FUTURE' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_DELIVERABLE' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.deliveries (delivery_no, bill_id, delivered_at, delivered_by, appointment_id, note,
                                   correlation_id, created_by)
    VALUES (public._next_document_no('DELIVERY'), p_bill_id, v_at, auth.uid(), p_appointment_id, p_note,
            v_corr, auth.uid())
    RETURNING * INTO v_delivery;

    FOR v_item IN
        SELECT x.* FROM jsonb_to_recordset(p_lines) AS x(bill_line_id uuid, quantity numeric, unit_ids uuid[])
          LEFT JOIN public.bill_lines l ON l.id = x.bill_line_id
         ORDER BY l.product_id NULLS FIRST, l.line_no
    LOOP
        SELECT * INTO v_line FROM public.bill_lines WHERE id = v_item.bill_line_id AND bill_id = p_bill_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'LINE_NOT_IN_BILL' USING ERRCODE = '23514';
        END IF;
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 OR v_item.quantity > v_line.allocated_qty THEN
            RAISE EXCEPTION 'DELIVERY_EXCEEDS_ALLOCATED: line %, allocated %', v_line.line_no, v_line.allocated_qty
                USING ERRCODE = '23514';
        END IF;
        SELECT * INTO v_product FROM public.products WHERE id = v_line.product_id;

        IF v_product.item_type = 'SERIALIZED' THEN
            IF COALESCE(cardinality(v_item.unit_ids), 0) <> v_item.quantity
               OR (SELECT count(DISTINCT u) FROM unnest(v_item.unit_ids) u) <> v_item.quantity THEN
                RAISE EXCEPTION 'UNITS_REQUIRED: serialized product needs one unit per piece' USING ERRCODE = '22023';
            END IF;
            FOREACH v_unit IN ARRAY v_item.unit_ids LOOP
                PERFORM public._unit_transition(v_unit, v_line.product_id, ARRAY['IN_STOCK'],
                    CASE v_line.line_mode WHEN 'SALE' THEN 'SOLD' ELSE 'RENTED_OUT' END);
                INSERT INTO public.delivery_lines (delivery_id, bill_line_id, product_unit_id, quantity, created_by)
                VALUES (v_delivery.id, v_line.id, v_unit, 1, auth.uid()) RETURNING id INTO v_dl_id;
                PERFORM public._stock_move(v_line.product_id, 'RESERVED',
                    CASE v_line.line_mode WHEN 'SALE' THEN 'SOLD' ELSE 'RENTED_OUT' END, 1,
                    CASE v_line.line_mode WHEN 'SALE' THEN 'DELIVER_SALE' ELSE 'DELIVER_RENTAL' END,
                    'DELIVERY_LINE', v_dl_id, v_unit, NULL, v_corr);
            END LOOP;
        ELSE
            IF v_item.unit_ids IS NOT NULL AND cardinality(v_item.unit_ids) > 0 THEN
                RAISE EXCEPTION 'UNITS_NOT_ALLOWED_FOR_QUANTITY_PRODUCT' USING ERRCODE = '22023';
            END IF;
            INSERT INTO public.delivery_lines (delivery_id, bill_line_id, quantity, created_by)
            VALUES (v_delivery.id, v_line.id, v_item.quantity, auth.uid()) RETURNING id INTO v_dl_id;
            PERFORM public._stock_move(v_line.product_id, 'RESERVED',
                CASE v_line.line_mode WHEN 'SALE' THEN 'SOLD' ELSE 'RENTED_OUT' END, v_item.quantity,
                CASE v_line.line_mode WHEN 'SALE' THEN 'DELIVER_SALE' ELSE 'DELIVER_RENTAL' END,
                'DELIVERY_LINE', v_dl_id, NULL, NULL, v_corr);
        END IF;

        UPDATE public.bill_lines SET allocated_qty = allocated_qty - v_item.quantity WHERE id = v_line.id;
        PERFORM public._line_recalculate(v_line.id);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.delivery_lines WHERE delivery_id = v_delivery.id) THEN
        RAISE EXCEPTION 'DELIVERY_EMPTY' USING ERRCODE = '22023';
    END IF;
    PERFORM public._bill_settle(p_bill_id);
    PERFORM public._audit('DELIVERY_CREATE', 'BILL', p_bill_id, NULL,
                          jsonb_build_object('delivery_id', v_delivery.id, 'delivery_no', v_delivery.delivery_no,
                                             'lines', p_lines), NULL, v_corr);
    RETURN public._idempotency_finish(v_idem.key_id,
        jsonb_build_object('delivery_id', v_delivery.id, 'delivery_no', v_delivery.delivery_no));
END;
$$;

-- Allocate stock that arrived to backordered lines (Master §11.3).
CREATE FUNCTION public.bill_allocate_backorder(p_bill_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_line   public.bill_lines%ROWTYPE;
    v_avail  numeric;
    v_alloc  numeric;
    v_total  numeric := 0;
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM 1 FROM public.bills WHERE id = p_bill_id AND status IN ('CONFIRMED', 'ACTIVE') FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_OPEN' USING ERRCODE = '23514';
    END IF;
    FOR v_line IN SELECT * FROM public.bill_lines WHERE bill_id = p_bill_id AND backorder_qty > 0
                  ORDER BY product_id, line_no FOR UPDATE LOOP
        SELECT quantity INTO v_avail FROM public.stock_balances
         WHERE product_id = v_line.product_id AND stock_state = 'AVAILABLE' FOR UPDATE;
        v_alloc := least(COALESCE(v_avail, 0), v_line.backorder_qty);
        IF v_alloc > 0 THEN
            PERFORM public._stock_move(v_line.product_id, 'AVAILABLE', 'RESERVED', v_alloc, 'RESERVE', 'BILL_LINE',
                                       v_line.id, NULL, 'backorder allocation', v_corr);
            UPDATE public.bill_lines SET allocated_qty = allocated_qty + v_alloc, backorder_qty = backorder_qty - v_alloc
             WHERE id = v_line.id;
            PERFORM public._line_recalculate(v_line.id);
            v_total := v_total + v_alloc;
        END IF;
    END LOOP;
    PERFORM public._audit('BACKORDER_ALLOCATE', 'BILL', p_bill_id, NULL, jsonb_build_object('allocated', v_total), NULL, v_corr);
    RETURN jsonb_build_object('bill_id', p_bill_id, 'allocated', v_total);
END;
$$;

-- Partial / multi-round returns (Master §14.2). Damaged goods go to inspection, never AVAILABLE.
-- Grand total of a confirmed bill for another goods subtotal. The bill discount stays the
-- baht amount the customer was given (owner: "ลดแล้วก็ลดไป"), fees stay, VAT from the snapshot.
CREATE FUNCTION public._bill_grand_for_subtotal(p_bill_id uuid, p_subtotal numeric)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill  public.bills%ROWTYPE;
    v_snap  jsonb;
    v_rate  numeric;
    v_disc  numeric(14,2);
    v_net   numeric(14,2);
BEGIN
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    v_snap := COALESCE(v_bill.pricing_snapshot, '{}'::jsonb);
    v_disc := least(v_bill.bill_discount_amount, greatest(p_subtotal, 0));
    v_net := p_subtotal - v_disc + v_bill.delivery_fee + v_bill.installation_fee + v_bill.service_fee;
    v_rate := COALESCE((v_snap ->> 'vat_rate')::numeric, 0);
    IF (v_snap ->> 'vat_enabled')::boolean IS TRUE AND v_rate > 0 AND v_snap ->> 'vat_mode' = 'EXCLUSIVE' THEN
        RETURN v_net + round(v_net * v_rate / 100, 2);
    END IF;
    RETURN v_net;
END;
$$;

-- Early return (Master §15, owner decision 2026-10-04 ข): rent is recalculated on the days
-- actually used, counted like every daily rental (shop timezone, first day = day 1, inclusive).
-- The unused part becomes a CREDIT adjustment linked to the return — a compensating entry,
-- the bill lines keep their original price. Any overpayment then shows as a suggested
-- refund (bill_refund_suggestion); the refund itself is still the user's PIN-confirmed act.
-- Fair to the customer: unused days come off at the full daily price; a discount already given
-- stays given. Only PER_DAY lines: a per-round (PER_PERIOD) price is one round, not days, so
-- its dates are reminders only and an early return changes nothing (owner 2026-10-04).
CREATE FUNCTION public._early_return_credit(p_return_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ret       public.returns%ROWTYPE;
    v_bill      public.bills%ROWTYPE;
    v_r         record;
    v_used      integer;
    v_unused    numeric;
    v_lc        numeric(14,2);
    v_sub_now   numeric(14,2) := 0;
    v_sub_prev  numeric(14,2);
    v_cred_prev numeric(14,2);
    v_credit    numeric(14,2);
    v_detail    jsonb := '[]'::jsonb;
BEGIN
    SELECT * INTO v_ret FROM public.returns WHERE id = p_return_id;
    SELECT * INTO v_bill FROM public.bills WHERE id = v_ret.bill_id;
    FOR v_r IN
        SELECT l.id, l.line_no, l.rental_start_at, l.period_count, l.ordered_qty, l.extended_amount, l.unit_price,
               sum(rl.quantity) AS qty
          FROM public.return_lines rl JOIN public.bill_lines l ON l.id = rl.bill_line_id
         WHERE rl.return_id = p_return_id AND l.line_mode = 'RENTAL' AND l.rental_calculation_type = 'PER_DAY'
         GROUP BY l.id, l.line_no, l.rental_start_at, l.period_count, l.ordered_qty, l.extended_amount, l.unit_price
    LOOP
        v_used := greatest(public._local_date(v_ret.returned_at) - public._local_date(v_r.rental_start_at) + 1, 1);
        v_unused := v_r.period_count - v_used;
        CONTINUE WHEN v_unused <= 0 OR v_r.ordered_qty <= 0 OR v_r.period_count <= 0;
        -- never credit more than the line still holds after earlier early-return credits
        v_lc := least(round(v_r.unit_price * v_r.qty * v_unused, 2),
                      v_r.extended_amount - (SELECT COALESCE(sum((e ->> 'line_credit')::numeric), 0)
                                               FROM public.bill_adjustments a,
                                                    jsonb_array_elements(a.after_data -> 'lines') e
                                              WHERE a.bill_id = v_bill.id AND a.source = 'EARLY_RETURN'
                                                AND e ->> 'bill_line_id' = v_r.id::text));
        CONTINUE WHEN v_lc <= 0;
        v_sub_now := v_sub_now + v_lc;
        v_detail := v_detail || jsonb_build_object('bill_line_id', v_r.id, 'line_no', v_r.line_no,
            'quantity', v_r.qty, 'days_rented', v_r.period_count, 'days_used', v_used, 'line_credit', v_lc);
    END LOOP;
    IF v_sub_now <= 0 THEN
        RETURN 0;
    END IF;
    SELECT COALESCE(sum((after_data ->> 'subtotal_credit')::numeric), 0), COALESCE(sum(amount), 0)
      INTO v_sub_prev, v_cred_prev
      FROM public.bill_adjustments WHERE bill_id = v_bill.id AND source = 'EARLY_RETURN';
    v_credit := v_bill.grand_total
              - public._bill_grand_for_subtotal(v_bill.id, v_bill.sale_subtotal + v_bill.rental_subtotal - v_sub_prev - v_sub_now)
              - v_cred_prev;
    IF v_credit <= 0 THEN
        RETURN 0;
    END IF;
    INSERT INTO public.bill_adjustments (bill_id, adjustment_type, amount, before_data, after_data, reason,
                                         source, return_id, correlation_id, created_by)
    VALUES (v_bill.id, 'CREDIT', v_credit, jsonb_build_object('grand_total', v_bill.grand_total),
            jsonb_build_object('subtotal_credit', v_sub_now, 'lines', v_detail),
            'early return ' || v_ret.return_no, 'EARLY_RETURN', v_ret.id, v_ret.correlation_id, auth.uid());
    PERFORM public._audit('EARLY_RETURN_CREDIT', 'BILL', v_bill.id, NULL,
                          jsonb_build_object('return_id', v_ret.id, 'credit', v_credit, 'lines', v_detail),
                          'early return ' || v_ret.return_no, v_ret.correlation_id, false, v_credit);
    RETURN v_credit;
END;
$$;

CREATE FUNCTION public.return_receive(
    p_bill_id          uuid,
    p_lines            jsonb,
    p_idempotency_key  text,
    p_returned_at      timestamptz DEFAULT NULL,
    p_note             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem      record;
    v_item      record;
    v_line      public.bill_lines%ROWTYPE;
    v_product   public.products%ROWTYPE;
    v_return    public.returns%ROWTYPE;
    v_rl_id     uuid;
    v_unit      uuid;
    v_state     text;
    v_first_out timestamptz;
    v_at        timestamptz := COALESCE(p_returned_at, now());
    v_corr      uuid := gen_random_uuid();
    v_credit    numeric(14,2);
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('return_receive', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 'l', p_lines, 'at', p_returned_at)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    IF v_at > now() + interval '5 minutes' THEN
        RAISE EXCEPTION 'RETURNED_AT_IN_FUTURE' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.bills WHERE id = p_bill_id AND status IN ('CONFIRMED', 'ACTIVE') FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_OPEN' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.returns (return_no, bill_id, returned_at, received_by, note, correlation_id, created_by)
    VALUES (public._next_document_no('RETURN'), p_bill_id, v_at, auth.uid(), p_note, v_corr, auth.uid())
    RETURNING * INTO v_return;

    FOR v_item IN
        SELECT x.* FROM jsonb_to_recordset(p_lines) AS x(bill_line_id uuid, quantity numeric, condition text,
                                                          to_stock_state text, unit_ids uuid[])
          LEFT JOIN public.bill_lines l ON l.id = x.bill_line_id
         ORDER BY l.product_id NULLS FIRST, l.line_no
    LOOP
        SELECT * INTO v_line FROM public.bill_lines WHERE id = v_item.bill_line_id AND bill_id = p_bill_id FOR UPDATE;
        IF NOT FOUND OR v_line.line_mode <> 'RENTAL' THEN
            RAISE EXCEPTION 'NOT_A_RENTAL_LINE_OF_BILL' USING ERRCODE = '23514';
        END IF;
        PERFORM public._line_recalculate(v_line.id);
        SELECT * INTO v_line FROM public.bill_lines WHERE id = v_item.bill_line_id;
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 OR v_item.quantity > v_line.obligation_held_here THEN
            RAISE EXCEPTION 'RETURN_EXCEEDS_HELD: line %, held %', v_line.line_no, v_line.obligation_held_here
                USING ERRCODE = '23514';
        END IF;
        IF v_item.condition IS NULL THEN
            RAISE EXCEPTION 'CONDITION_REQUIRED' USING ERRCODE = '22023';
        END IF;
        SELECT min(d.delivered_at) INTO v_first_out
          FROM public.delivery_lines dl JOIN public.deliveries d ON d.id = dl.delivery_id
         WHERE dl.bill_line_id = v_line.id;
        IF v_first_out IS NOT NULL AND v_line.carried_in_qty = 0 AND v_at < v_first_out THEN
            RAISE EXCEPTION 'RETURN_BEFORE_DELIVERY' USING ERRCODE = '23514';
        END IF;
        v_state := COALESCE(v_item.to_stock_state, CASE WHEN v_item.condition = 'NORMAL' THEN 'AVAILABLE' ELSE 'INSPECTION' END);
        SELECT * INTO v_product FROM public.products WHERE id = v_line.product_id;

        IF v_product.item_type = 'SERIALIZED' THEN
            IF COALESCE(cardinality(v_item.unit_ids), 0) <> v_item.quantity
               OR (SELECT count(DISTINCT u) FROM unnest(v_item.unit_ids) u) <> v_item.quantity THEN
                RAISE EXCEPTION 'UNITS_REQUIRED: serialized product needs one unit per piece' USING ERRCODE = '22023';
            END IF;
            FOREACH v_unit IN ARRAY v_item.unit_ids LOOP
                IF public._unit_holder_line(v_unit) IS DISTINCT FROM v_line.id THEN
                    RAISE EXCEPTION 'UNIT_NOT_HELD_BY_LINE: %', v_unit USING ERRCODE = '23514';
                END IF;
                INSERT INTO public.return_lines (return_id, bill_line_id, product_unit_id, quantity, condition,
                                                 to_stock_state, created_by)
                VALUES (v_return.id, v_line.id, v_unit, 1, v_item.condition, v_state, auth.uid())
                RETURNING id INTO v_rl_id;
                PERFORM public._unit_transition(v_unit, v_line.product_id, ARRAY['RENTED_OUT'],
                    CASE v_state WHEN 'AVAILABLE' THEN 'IN_STOCK' ELSE v_state END);
                UPDATE public.product_units SET condition = v_item.condition WHERE id = v_unit;
                PERFORM public._stock_move(v_line.product_id, 'RENTED_OUT', v_state, 1, 'RETURN', 'RETURN_LINE',
                                           v_rl_id, v_unit, NULL, v_corr);
                IF v_item.condition <> 'NORMAL' THEN
                    INSERT INTO public.incident_cases (bill_id, bill_line_id, return_line_id, product_unit_id,
                                                       incident_type, quantity, created_by)
                    VALUES (p_bill_id, v_line.id, v_rl_id, v_unit, 'DAMAGE', 1, auth.uid());
                END IF;
            END LOOP;
        ELSE
            IF v_item.unit_ids IS NOT NULL AND cardinality(v_item.unit_ids) > 0 THEN
                RAISE EXCEPTION 'UNITS_NOT_ALLOWED_FOR_QUANTITY_PRODUCT' USING ERRCODE = '22023';
            END IF;
            INSERT INTO public.return_lines (return_id, bill_line_id, quantity, condition, to_stock_state, created_by)
            VALUES (v_return.id, v_line.id, v_item.quantity, v_item.condition, v_state, auth.uid())
            RETURNING id INTO v_rl_id;
            PERFORM public._stock_move(v_line.product_id, 'RENTED_OUT', v_state, v_item.quantity, 'RETURN', 'RETURN_LINE',
                                       v_rl_id, NULL, NULL, v_corr);
            IF v_item.condition <> 'NORMAL' THEN
                INSERT INTO public.incident_cases (bill_id, bill_line_id, return_line_id, incident_type, quantity, created_by)
                VALUES (p_bill_id, v_line.id, v_rl_id, 'DAMAGE', v_item.quantity, auth.uid());
            END IF;
        END IF;
        PERFORM public._line_recalculate(v_line.id);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.return_lines WHERE return_id = v_return.id) THEN
        RAISE EXCEPTION 'RETURN_EMPTY' USING ERRCODE = '22023';
    END IF;
    v_credit := public._early_return_credit(v_return.id);
    PERFORM public._bill_settle(p_bill_id);
    PERFORM public._audit('RETURN_RECEIVE', 'BILL', p_bill_id, NULL,
                          jsonb_build_object('return_id', v_return.id, 'return_no', v_return.return_no, 'lines', p_lines),
                          NULL, v_corr);
    RETURN public._idempotency_finish(v_idem.key_id,
        jsonb_build_object('return_id', v_return.id, 'return_no', v_return.return_no,
                           'early_return_credit', v_credit,
                           'suggested_refund', (SELECT greatest(-balance_due, 0) FROM public.bills WHERE id = p_bill_id)));
END;
$$;

-- What the return / refund screen shows: overpayment to suggest and each payment still refundable.
CREATE FUNCTION public.bill_refund_suggestion(p_bill_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill public.bills%ROWTYPE;
BEGIN
    PERFORM public._require_menu('bills', 'finance');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object(
        'bill_id', v_bill.id, 'balance_due', v_bill.balance_due,
        'suggested_refund', greatest(-v_bill.balance_due, 0),
        'payments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('payment_id', p.id, 'method', p.method, 'amount', p.amount,
                       'refundable', p.amount - COALESCE((SELECT sum(r.amount) FROM public.refunds r
                                                          WHERE r.payment_id = p.id AND r.status = 'PAID'), 0))
                   ORDER BY p.created_at)
              FROM public.payments p WHERE p.bill_id = v_bill.id AND p.status = 'COMPLETED'), '[]'::jsonb));
END;
$$;



-- Late return / FROM_APPROVAL gap reviewed by a person (Master §16, §21.2 exception).
CREATE FUNCTION public.overdue_review(p_bill_line_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_line public.bill_lines%ROWTYPE;
    v_note text := public._require_reason(p_note);
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_line FROM public.bill_lines WHERE id = p_bill_line_id AND line_mode = 'RENTAL';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'RENTAL_LINE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- Lock order everywhere: bill, then its lines.
    PERFORM 1 FROM public.bills WHERE id = v_line.bill_id FOR UPDATE;
    UPDATE public.bill_lines SET overdue_reviewed_at = now(), overdue_reviewed_by = auth.uid() WHERE id = p_bill_line_id;
    PERFORM public._bill_settle(v_line.bill_id);
    PERFORM public._audit('OVERDUE_REVIEW', 'BILL_LINE', p_bill_line_id, NULL,
                          jsonb_build_object('reviewed', true), v_note, NULL);
    RETURN jsonb_build_object('bill_line_id', p_bill_line_id, 'reviewed', true);
END;
$$;

CREATE FUNCTION public.incident_open(
    p_bill_line_id  uuid,
    p_type          text,
    p_quantity      numeric,
    p_reason        text,
    p_unit_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_line   public.bill_lines%ROWTYPE;
    v_case   public.incident_cases%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_menu('bills');
    IF p_type NOT IN ('MISSING', 'DAMAGE') THEN
        RAISE EXCEPTION 'INVALID_INCIDENT_TYPE: LOST comes from lost_record' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_line FROM public.bill_lines WHERE id = p_bill_line_id AND line_mode = 'RENTAL';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'RENTAL_LINE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    PERFORM 1 FROM public.bills WHERE id = v_line.bill_id FOR UPDATE;
    PERFORM public._line_recalculate(p_bill_line_id);
    SELECT * INTO v_line FROM public.bill_lines WHERE id = p_bill_line_id;
    IF p_type = 'MISSING' AND (p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > v_line.obligation_held_here) THEN
        RAISE EXCEPTION 'MISSING_EXCEEDS_HELD' USING ERRCODE = '23514';
    END IF;
    IF p_unit_id IS NOT NULL AND p_type = 'MISSING' AND public._unit_holder_line(p_unit_id) IS DISTINCT FROM p_bill_line_id THEN
        RAISE EXCEPTION 'UNIT_NOT_HELD_BY_LINE' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.incident_cases (bill_id, bill_line_id, product_unit_id, incident_type, quantity, reason, created_by)
    VALUES (v_line.bill_id, p_bill_line_id, p_unit_id, p_type, p_quantity, v_reason, auth.uid())
    RETURNING * INTO v_case;
    PERFORM public._audit('INCIDENT_OPEN', 'INCIDENT', v_case.id, NULL, to_jsonb(v_case), v_reason, NULL);
    RETURN to_jsonb(v_case);
END;
$$;

CREATE FUNCTION public.incident_assess(p_case_id uuid, p_assessment jsonb, p_status text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old public.incident_cases%ROWTYPE;
    v_new public.incident_cases%ROWTYPE;
BEGIN
    PERFORM public._require_menu('bills');
    IF p_status NOT IN ('UNDER_INSPECTION', 'ASSESSED') THEN
        RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_old FROM public.incident_cases WHERE id = p_case_id FOR UPDATE;
    IF NOT FOUND OR v_old.status NOT IN ('OPEN', 'UNDER_INSPECTION', 'ASSESSED') THEN
        RAISE EXCEPTION 'INCIDENT_NOT_OPEN' USING ERRCODE = '23514';
    END IF;
    UPDATE public.incident_cases SET assessment = p_assessment, status = p_status, reason = COALESCE(p_note, reason)
     WHERE id = p_case_id RETURNING * INTO v_new;
    PERFORM public._audit('INCIDENT_ASSESS', 'INCIDENT', p_case_id, to_jsonb(v_old), to_jsonb(v_new), p_note, NULL);
    RETURN to_jsonb(v_new);
END;
$$;

-- A missing item turned up: close the case; the item then comes back via return_receive.
CREATE FUNCTION public.incident_mark_found(p_case_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_case   public.incident_cases%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_case FROM public.incident_cases WHERE id = p_case_id FOR UPDATE;
    IF NOT FOUND OR v_case.incident_type <> 'MISSING' OR v_case.status NOT IN ('OPEN', 'UNDER_INSPECTION', 'ASSESSED') THEN
        RAISE EXCEPTION 'NOT_AN_OPEN_MISSING_CASE' USING ERRCODE = '23514';
    END IF;
    UPDATE public.incident_cases SET status = 'FOUND' WHERE id = p_case_id;
    PERFORM public._bill_settle(v_case.bill_id);
    PERFORM public._audit('INCIDENT_FOUND', 'INCIDENT', p_case_id, jsonb_build_object('status', v_case.status),
                          jsonb_build_object('status', 'FOUND'), v_reason, NULL);
    RETURN jsonb_build_object('case_id', p_case_id, 'status', 'FOUND');
END;
$$;

-- MISSING → LOST, recorded with a PIN (Master §14.4, §4.4). Lost never adds stock.
CREATE FUNCTION public.lost_record(
    p_missing_case_id    uuid,
    p_quantity           numeric,
    p_lost_charge_basis  text,
    p_reason             text,
    p_pin_token          uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_missing public.incident_cases%ROWTYPE;
    v_line    public.bill_lines%ROWTYPE;
    v_lost    public.incident_cases%ROWTYPE;
    v_reason  text := public._require_reason(p_reason);
    v_corr    uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM public._require_pin(p_pin_token, 'LOST_RECORD');
    SELECT * INTO v_missing FROM public.incident_cases WHERE id = p_missing_case_id FOR UPDATE;
    IF NOT FOUND OR v_missing.incident_type <> 'MISSING' OR v_missing.status NOT IN ('OPEN', 'UNDER_INSPECTION', 'ASSESSED') THEN
        RAISE EXCEPTION 'NOT_AN_OPEN_MISSING_CASE' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.bills WHERE id = v_missing.bill_id FOR UPDATE;
    PERFORM public._line_recalculate(v_missing.bill_line_id);
    SELECT * INTO v_line FROM public.bill_lines WHERE id = v_missing.bill_line_id FOR UPDATE;
    IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > v_missing.quantity OR p_quantity > v_line.obligation_held_here THEN
        RAISE EXCEPTION 'LOST_QUANTITY_INVALID' USING ERRCODE = '23514';
    END IF;
    IF v_missing.product_unit_id IS NOT NULL
       AND public._unit_holder_line(v_missing.product_unit_id) IS DISTINCT FROM v_line.id THEN
        RAISE EXCEPTION 'UNIT_NOT_HELD_BY_LINE' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.incident_cases (bill_id, bill_line_id, product_unit_id, incident_type, quantity, status,
                                       lost_charge_basis, missing_case_id, confirmed_by, confirmed_at, reason, created_by)
    VALUES (v_missing.bill_id, v_line.id, v_missing.product_unit_id, 'LOST', p_quantity, 'CONFIRMED',
            p_lost_charge_basis, v_missing.id, auth.uid(), now(), v_reason, auth.uid())
    RETURNING * INTO v_lost;
    UPDATE public.incident_cases SET status = 'RESOLVED' WHERE id = v_missing.id;

    IF v_missing.product_unit_id IS NOT NULL THEN
        PERFORM public._unit_transition(v_missing.product_unit_id, v_line.product_id, ARRAY['RENTED_OUT'], 'LOST');
    END IF;
    PERFORM public._stock_move(v_line.product_id, 'RENTED_OUT', 'LOST', p_quantity, 'LOST', 'INCIDENT', v_lost.id,
                               v_missing.product_unit_id, v_reason, v_corr);
    PERFORM public._bill_settle(v_missing.bill_id);
    PERFORM public._audit('LOST_RECORD', 'INCIDENT', v_lost.id, to_jsonb(v_missing), to_jsonb(v_lost), v_reason, v_corr,
                          true, NULL, p_quantity);
    RETURN to_jsonb(v_lost);
END;
$$;

-- Close a damage / lost case once its charge is decided (confirmed, cancelled or written off).
-- Closing a damage / lost case without any confirmed fee while the product has a default fee
-- is a waiver of the suggested amount → PIN (Master §4.4, §14.3).
CREATE FUNCTION public.incident_resolve(p_case_id uuid, p_reason text, p_reject boolean DEFAULT false,
                                        p_pin_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_case      public.incident_cases%ROWTYPE;
    v_reason    text := public._require_reason(p_reason);
    v_status    text := CASE WHEN p_reject THEN 'REJECTED' ELSE 'RESOLVED' END;
    v_suggested numeric;
BEGIN
    PERFORM public._require_menu('bills');
    SELECT * INTO v_case FROM public.incident_cases WHERE id = p_case_id FOR UPDATE;
    IF NOT FOUND OR v_case.status IN ('RESOLVED', 'REJECTED', 'FOUND') THEN
        RAISE EXCEPTION 'INCIDENT_NOT_OPEN' USING ERRCODE = '23514';
    END IF;
    IF NOT p_reject AND v_case.incident_type IN ('DAMAGE', 'LOST')
       AND NOT EXISTS (SELECT 1 FROM public.charges WHERE incident_case_id = p_case_id AND status = 'CONFIRMED') THEN
        SELECT v_case.quantity * CASE WHEN v_case.incident_type = 'DAMAGE' THEN p.default_damage_fee ELSE p.default_loss_fee END
          INTO v_suggested
          FROM public.bill_lines l JOIN public.products p ON p.id = l.product_id
         WHERE l.id = v_case.bill_line_id;
        IF COALESCE(v_suggested, 0) > 0 THEN
            PERFORM public._require_pin(p_pin_token, 'CHARGE_AMOUNT_OVERRIDE');
        END IF;
    END IF;
    IF p_reject AND v_case.incident_type = 'LOST' THEN
        RAISE EXCEPTION 'CONFIRMED_LOST_CANNOT_BE_REJECTED' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.charges WHERE incident_case_id = p_case_id AND status = 'PENDING') THEN
        RAISE EXCEPTION 'INCIDENT_HAS_PENDING_CHARGE' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.bills WHERE id = v_case.bill_id FOR UPDATE;
    UPDATE public.incident_cases SET status = v_status WHERE id = p_case_id;
    PERFORM public._bill_settle(v_case.bill_id);
    PERFORM public._audit('INCIDENT_RESOLVE', 'INCIDENT', p_case_id, jsonb_build_object('status', v_case.status),
                          jsonb_build_object('status', v_status), v_reason, NULL);
    RETURN jsonb_build_object('case_id', p_case_id, 'status', v_status);
END;
$$;

-- ============================================================================
-- 18. RPC — RENTAL CONTINUATION / CARRY FORWARD (Master §17)
-- ============================================================================

-- The user creates the child bill + carry forwards in one transaction, with a reason
-- (no approval step, Master §17.1). After the parent line's rental_end_at the user must
-- choose FROM_PREVIOUS_END or FROM_APPROVAL (= from now) every time (Master §17.4.1).
-- No stock / delivery / return movement; the parent bill is never edited; no contract.
-- p_items: [{from_line_id, quantity, unit_ids?, unit_price?, rental_calculation_type?,
--            period_type?, period_count, rental_start_at, rental_end_at}]
CREATE FUNCTION public.create_rental_continuation(
    p_parent_bill_id   uuid,
    p_items            jsonb,
    p_reason           text,
    p_idempotency_key  text,
    p_start_mode       text DEFAULT NULL,
    p_pin_token        uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem      record;
    v_parent    public.bills%ROWTYPE;
    v_child     public.bills%ROWTYPE;
    v_item      record;
    v_from      public.bill_lines%ROWTYPE;
    v_to_id     uuid;
    v_cf_id     uuid;
    v_unit      uuid;
    v_price     numeric;
    v_list      numeric;
    v_override  boolean := false;
    v_start     timestamptz;
    v_late      boolean := false;
    v_all_late  boolean := true;
    v_no        integer := 0;
    v_reason    text := public._require_reason(p_reason);
    v_corr      uuid := gen_random_uuid();
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

    -- Late? (after any chosen line's planned end)
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(from_line_id uuid) LOOP
        SELECT * INTO v_from FROM public.bill_lines WHERE id = v_item.from_line_id AND bill_id = v_parent.id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'LINE_NOT_IN_PARENT' USING ERRCODE = '23514';
        END IF;
        IF now() > v_from.rental_end_at THEN v_late := true; ELSE v_all_late := false; END IF;
    END LOOP;
    IF v_late AND p_start_mode IS NULL THEN
        RAISE EXCEPTION 'START_MODE_REQUIRED: after the planned end, choose FROM_PREVIOUS_END or FROM_APPROVAL'
            USING ERRCODE = '22023';
    END IF;
    IF p_start_mode IS NOT NULL AND (NOT v_late OR p_start_mode NOT IN ('FROM_PREVIOUS_END', 'FROM_APPROVAL')) THEN
        RAISE EXCEPTION 'START_MODE_NOT_APPLICABLE' USING ERRCODE = '22023';
    END IF;
    IF p_start_mode = 'FROM_APPROVAL' AND NOT v_all_late THEN
        RAISE EXCEPTION 'MIXED_DUE_LINES: continue lines that are not yet due separately' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.bills (status, customer_id, parent_bill_id, original_bill_id, continuation_start_mode,
                              continuation_reason, created_by)
    VALUES ('DRAFT', v_parent.customer_id, v_parent.id, COALESCE(v_parent.original_bill_id, v_parent.id), p_start_mode,
            CASE WHEN p_start_mode IS NOT NULL THEN v_reason END, auth.uid())
    RETURNING * INTO v_child;

    FOR v_item IN
        SELECT x.* FROM jsonb_to_recordset(p_items) AS x(
            from_line_id uuid, quantity numeric, unit_ids uuid[], unit_price numeric, rental_calculation_type text,
            period_type text, period_count numeric, rental_start_at timestamptz, rental_end_at timestamptz)
         ORDER BY x.from_line_id
    LOOP
        SELECT * INTO v_from FROM public.bill_lines WHERE id = v_item.from_line_id FOR UPDATE;
        PERFORM public._line_recalculate(v_from.id);
        SELECT * INTO v_from FROM public.bill_lines WHERE id = v_item.from_line_id;
        IF v_from.line_mode <> 'RENTAL' OR v_item.quantity IS NULL OR v_item.quantity <= 0
           OR v_item.quantity > v_from.obligation_held_here THEN
            RAISE EXCEPTION 'CONTINUATION_QTY_EXCEEDS_HELD: line %, held %', v_from.line_no, v_from.obligation_held_here
                USING ERRCODE = '23514';
        END IF;

        -- Start date never overlaps the previous round (Master §17.4).
        v_start := CASE WHEN p_start_mode = 'FROM_APPROVAL' THEN now() ELSE v_item.rental_start_at END;
        IF v_start IS NULL OR v_item.rental_end_at IS NULL OR v_item.rental_end_at <= v_start THEN
            RAISE EXCEPTION 'CONTINUATION_PERIOD_REQUIRED' USING ERRCODE = '22023';
        END IF;
        IF COALESCE(p_start_mode, '') <> 'FROM_APPROVAL' THEN
            IF v_item.rental_calculation_type = 'PER_DAY'
               AND public._local_date(v_start) <> public._local_date(v_from.rental_end_at) + 1 THEN
                RAISE EXCEPTION 'DAILY_CONTINUATION_MUST_START_NEXT_DAY' USING ERRCODE = '22023';
            END IF;
            IF v_start < v_from.rental_end_at THEN
                RAISE EXCEPTION 'CONTINUATION_OVERLAPS_PREVIOUS_ROUND' USING ERRCODE = '22023';
            END IF;
        END IF;

        v_list := public._list_price(v_from.product_id, 'RENTAL');
        v_price := COALESCE(v_item.unit_price, v_list);
        v_override := v_override OR v_price IS DISTINCT FROM v_list;
        v_no := v_no + 1;
        INSERT INTO public.bill_lines (bill_id, line_no, product_id, line_mode, ordered_qty, unit_price, price_overridden,
                                       rental_calculation_type, period_type, period_count, rental_start_at, rental_end_at,
                                       rental_status, created_by)
        VALUES (v_child.id, v_no, v_from.product_id, 'RENTAL', v_item.quantity, v_price, v_price IS DISTINCT FROM v_list,
                COALESCE(v_item.rental_calculation_type, v_from.rental_calculation_type), v_item.period_type,
                v_item.period_count, v_start, v_item.rental_end_at, 'SCHEDULED', auth.uid())
        RETURNING id INTO v_to_id;

        INSERT INTO public.rental_carry_forwards (from_bill_id, from_line_id, to_bill_id, to_line_id, product_id, quantity,
                                                  reason, correlation_id, created_by)
        VALUES (v_parent.id, v_from.id, v_child.id, v_to_id, v_from.product_id, v_item.quantity,
                v_reason, v_corr, auth.uid())
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
    UPDATE public.bills SET status = 'CONFIRMED', bill_no = public._next_document_no('BILL'), confirmed_at = now(),
                            confirmed_by = auth.uid()
     WHERE id = v_child.id;
    PERFORM public._bill_post_revenue(v_child.id, v_corr);

    PERFORM public._bill_settle(v_child.id);
    PERFORM public._bill_settle(v_parent.id);
    SELECT * INTO v_child FROM public.bills WHERE id = v_child.id;
    PERFORM public._audit('RENTAL_CONTINUATION_CREATE', 'BILL', v_child.id,
                          jsonb_build_object('parent_bill_id', v_parent.id), to_jsonb(v_child), v_reason, v_corr,
                          v_override, v_child.grand_total);
    RETURN public._idempotency_finish(v_idem.key_id, jsonb_build_object('child_bill', to_jsonb(v_child)));
END;
$$;

-- Cancel one carry forward (Master §17.7): only while the quantity is still held by the child. PIN.
CREATE FUNCTION public.reverse_carry_forward(p_carry_forward_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cf     public.rental_carry_forwards%ROWTYPE;
    v_to     public.bill_lines%ROWTYPE;
    v_unit   uuid;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM public._require_pin(p_pin_token, 'CARRY_FORWARD_REVERSE');
    SELECT * INTO v_cf FROM public.rental_carry_forwards WHERE id = p_carry_forward_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CARRY_FORWARD_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- Lock parent then child bill (lineage order) to avoid deadlocks.
    PERFORM 1 FROM public.bills WHERE id = v_cf.from_bill_id FOR UPDATE;
    PERFORM 1 FROM public.bills WHERE id = v_cf.to_bill_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.rental_carry_forward_reversals WHERE carry_forward_id = p_carry_forward_id) THEN
        RAISE EXCEPTION 'ALREADY_REVERSED' USING ERRCODE = '23514';
    END IF;
    PERFORM public._line_recalculate(v_cf.to_line_id);
    SELECT * INTO v_to FROM public.bill_lines WHERE id = v_cf.to_line_id FOR UPDATE;
    IF v_to.obligation_held_here < v_cf.quantity THEN
        RAISE EXCEPTION 'CHILD_NO_LONGER_HOLDS_QUANTITY: reverse its returns / lost / continuation first'
            USING ERRCODE = '23514';
    END IF;
    FOR v_unit IN SELECT product_unit_id FROM public.rental_carry_forward_units WHERE carry_forward_id = p_carry_forward_id LOOP
        IF public._unit_holder_line(v_unit) IS DISTINCT FROM v_cf.to_line_id THEN
            RAISE EXCEPTION 'UNIT_NOT_HELD_BY_CHILD: %', v_unit USING ERRCODE = '23514';
        END IF;
    END LOOP;

    INSERT INTO public.rental_carry_forward_reversals (carry_forward_id, reason, correlation_id, created_by)
    VALUES (p_carry_forward_id, v_reason, v_corr, auth.uid());
    PERFORM public._bill_settle(v_cf.to_bill_id);
    PERFORM public._bill_settle(v_cf.from_bill_id);
    PERFORM public._audit('CARRY_FORWARD_REVERSE', 'CARRY_FORWARD', p_carry_forward_id, to_jsonb(v_cf),
                          jsonb_build_object('reversed', true), v_reason, v_corr, true, NULL, v_cf.quantity);
    RETURN jsonb_build_object('carry_forward_id', p_carry_forward_id, 'reversed', true);
END;
$$;

-- ============================================================================
-- 19. RPC — PAYMENT / REFUND (Master §13, §20)
-- ============================================================================

CREATE FUNCTION public.payment_receive(
    p_bill_id          uuid,
    p_tenders          jsonb,
    p_idempotency_key  text,
    p_received_on      date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem    record;
    v_receipt jsonb;
    v_corr    uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('payment_receive', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 't', p_tenders, 'on', p_received_on)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    PERFORM 1 FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._bill_recalculate(p_bill_id);
    v_receipt := public._payment_receive_core(p_bill_id, p_tenders, v_idem.key_id, v_corr, p_received_on);
    PERFORM public._bill_settle(p_bill_id);
    RETURN public._idempotency_finish(v_idem.key_id, v_receipt || jsonb_build_object('bill',
        (SELECT to_jsonb(b) FROM public.bills b WHERE b.id = p_bill_id)));
END;
$$;

-- Wrong payment → void (status only, amount never edited) then receive again (Master §13).
CREATE FUNCTION public.payment_void(p_payment_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pay      public.payments%ROWTYPE;
    v_bill     public.bills%ROWTYPE;
    v_reason   text := public._require_reason(p_reason);
    v_corr     uuid := gen_random_uuid();
    v_refunds  numeric;
BEGIN
    PERFORM public._require_menu('bills', 'finance');
    PERFORM public._require_pin(p_pin_token, 'PAYMENT_VOID');
    SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = v_pay.bill_id FOR UPDATE;
    SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
    IF v_pay.status <> 'COMPLETED' THEN
        RAISE EXCEPTION 'PAYMENT_NOT_COMPLETED' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.refunds WHERE payment_id = p_payment_id AND status = 'PAID') THEN
        RAISE EXCEPTION 'PAYMENT_HAS_REFUNDS' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_refunds
      FROM public.refunds WHERE bill_id = v_pay.bill_id AND status = 'PAID';
    IF v_bill.paid_amount - v_pay.amount < v_refunds THEN
        RAISE EXCEPTION 'VOID_WOULD_LEAVE_REFUNDS_UNCOVERED' USING ERRCODE = '23514';
    END IF;

    UPDATE public.payments SET status = 'VOIDED', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
     WHERE id = p_payment_id;
    PERFORM public._bill_settle(v_pay.bill_id);
    PERFORM public._audit('PAYMENT_VOID', 'PAYMENT', p_payment_id, to_jsonb(v_pay),
                          jsonb_build_object('status', 'VOIDED'), v_reason, v_corr, true, v_pay.amount, NULL, v_pay.method);
    RETURN jsonb_build_object('payment_id', p_payment_id, 'status', 'VOIDED');
END;
$$;

-- Money actually leaves, in one step: refund number, ledger, audit (Master §20). PIN.
CREATE FUNCTION public.refund_pay(
    p_bill_id          uuid,
    p_amount           numeric,
    p_method           text,
    p_reason           text,
    p_idempotency_key  text,
    p_pin_token        uuid,
    p_payment_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem        record;
    v_bill        public.bills%ROWTYPE;
    v_pay         public.payments%ROWTYPE;
    v_reason      text := public._require_reason(p_reason);
    v_refundable  numeric;
    v_refund      public.refunds%ROWTYPE;
    v_corr        uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('bills', 'finance');
    SELECT * INTO v_idem FROM public._idempotency_begin('refund_pay', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 'a', p_amount, 'm', p_method, 'p', p_payment_id)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    PERFORM public._require_pin(p_pin_token, 'REFUND');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status = 'DRAFT' THEN
        RAISE EXCEPTION 'BILL_NOT_REFUNDABLE' USING ERRCODE = '23514';
    END IF;
    PERFORM public._bill_recalculate(p_bill_id);
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
    END IF;
    v_refundable := v_bill.paid_amount - v_bill.refunded_amount;
    IF p_amount > v_refundable THEN
        RAISE EXCEPTION 'REFUND_EXCEEDS_REFUNDABLE: refundable %', v_refundable USING ERRCODE = '23514';
    END IF;
    IF p_payment_id IS NULL THEN
        RAISE EXCEPTION 'PAYMENT_REQUIRED: a refund must point to the payment it returns' USING ERRCODE = '22023';
    ELSE
        SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id AND bill_id = p_bill_id AND status = 'COMPLETED';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PAYMENT_NOT_REFUNDABLE' USING ERRCODE = '23514';
        END IF;
        IF p_amount > v_pay.amount - (SELECT COALESCE(sum(amount), 0) FROM public.refunds
                                       WHERE payment_id = p_payment_id AND status = 'PAID') THEN
            RAISE EXCEPTION 'REFUND_EXCEEDS_PAYMENT' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF COALESCE(p_method, v_pay.method) IS NULL THEN
        RAISE EXCEPTION 'METHOD_REQUIRED' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.refunds (refund_no, bill_id, payment_id, amount, method, reason, paid_by, correlation_id, created_by)
    VALUES (public._next_document_no('REFUND'), p_bill_id, p_payment_id, p_amount, COALESCE(p_method, v_pay.method),
            v_reason, auth.uid(), v_corr, auth.uid())
    RETURNING * INTO v_refund;
    PERFORM public._ledger('REFUND', NULL, v_refund.amount, (-1)::smallint, p_bill_id, NULL, 'REFUND',
                           v_refund.id, v_corr);
    PERFORM public._bill_settle(p_bill_id);
    PERFORM public._audit('REFUND_PAY', 'REFUND', v_refund.id, jsonb_build_object('paid_amount', v_bill.paid_amount,
                          'refunded_amount', v_bill.refunded_amount), to_jsonb(v_refund), v_reason, v_corr,
                          true, v_refund.amount, NULL, v_refund.method);
    RETURN public._idempotency_finish(v_idem.key_id, to_jsonb(v_refund));
END;
$$;

-- ============================================================================
-- 20. RPC — CHARGES / WRITE-OFF (Master §14, §16, §19)
-- ============================================================================

-- Never created automatically (Master §16): only a person calls this. For DAMAGE / LOST from
-- an incident the suggested amount is the product default fee × quantity; any other
-- amount needs a PIN (Master §14.3).
CREATE FUNCTION public.charge_create(
    p_bill_id           uuid,
    p_charge_type       text,
    p_amount            numeric,
    p_reason            text,
    p_bill_line_id      uuid DEFAULT NULL,
    p_incident_case_id  uuid DEFAULT NULL,
    p_basis             jsonb DEFAULT NULL,
    p_period_start      timestamptz DEFAULT NULL,
    p_period_end        timestamptz DEFAULT NULL,
    p_pin_token         uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason    text := public._require_reason(p_reason);
    v_charge    public.charges%ROWTYPE;
    v_suggested numeric(14,2);
    v_pin       boolean := false;
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM 1 FROM public.bills WHERE id = p_bill_id AND status IN ('CONFIRMED', 'ACTIVE') FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_OPEN' USING ERRCODE = '23514';
    END IF;
    IF p_incident_case_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.incident_cases WHERE id = p_incident_case_id AND bill_id = p_bill_id) THEN
        RAISE EXCEPTION 'INCIDENT_NOT_IN_BILL' USING ERRCODE = '23514';
    END IF;
    IF p_charge_type IN ('DAMAGE', 'LOST') AND p_incident_case_id IS NOT NULL THEN
        SELECT round(i.quantity * CASE WHEN p_charge_type = 'DAMAGE' THEN p.default_damage_fee ELSE p.default_loss_fee END, 2)
          INTO v_suggested
          FROM public.incident_cases i
          JOIN public.bill_lines l ON l.id = i.bill_line_id
          JOIN public.products p ON p.id = l.product_id
         WHERE i.id = p_incident_case_id;
        IF p_amount IS DISTINCT FROM v_suggested THEN
            PERFORM public._require_pin(p_pin_token, 'CHARGE_AMOUNT_OVERRIDE');
            v_pin := true;
        END IF;
    END IF;
    INSERT INTO public.charges (bill_id, bill_line_id, incident_case_id, charge_type, amount, suggested_amount, basis,
                                covered_period_start, covered_period_end, reason, correlation_id, created_by)
    VALUES (p_bill_id, p_bill_line_id, p_incident_case_id, p_charge_type, p_amount, v_suggested, p_basis,
            p_period_start, p_period_end, v_reason, gen_random_uuid(), auth.uid())
    RETURNING * INTO v_charge;
    PERFORM public._bill_settle(p_bill_id);
    PERFORM public._audit('CHARGE_CREATE', 'CHARGE', v_charge.id, jsonb_build_object('suggested_amount', v_suggested),
                          to_jsonb(v_charge), v_reason, v_charge.correlation_id, v_pin, p_amount);
    RETURN to_jsonb(v_charge);
END;
$$;

-- Confirmed charge becomes amount due and revenue (Master §19.1, §22).
CREATE FUNCTION public.charge_confirm(p_charge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_charge public.charges%ROWTYPE;
BEGIN
    SELECT * INTO v_charge FROM public.charges WHERE id = p_charge_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CHARGE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._require_menu('bills');
    PERFORM 1 FROM public.bills WHERE id = v_charge.bill_id FOR UPDATE;
    SELECT * INTO v_charge FROM public.charges WHERE id = p_charge_id FOR UPDATE;
    IF v_charge.status <> 'PENDING' THEN
        RAISE EXCEPTION 'CHARGE_NOT_PENDING' USING ERRCODE = '23514';
    END IF;

    UPDATE public.charges SET status = 'CONFIRMED', confirmed_by = auth.uid(), confirmed_at = now() WHERE id = p_charge_id;
    PERFORM public._ledger('REVENUE', CASE v_charge.charge_type
                               WHEN 'DAMAGE' THEN 'DAMAGE' WHEN 'LOST' THEN 'LOST'
                               WHEN 'SERVICE' THEN 'SERVICE_FEE'
                               ELSE 'OTHER' END,
                           v_charge.amount, 1::smallint, v_charge.bill_id, v_charge.bill_line_id, 'CHARGE', p_charge_id,
                           v_charge.correlation_id);
    PERFORM public._bill_settle(v_charge.bill_id);
    PERFORM public._audit('CHARGE_CONFIRM', 'CHARGE', p_charge_id, jsonb_build_object('status', 'PENDING'),
                          jsonb_build_object('status', 'CONFIRMED', 'amount', v_charge.amount), v_charge.reason,
                          v_charge.correlation_id, false, v_charge.amount);
    RETURN jsonb_build_object('charge_id', p_charge_id, 'status', 'CONFIRMED');
END;
$$;

-- Waiving a damage / lost charge or reversing a confirmed one is risky (Master §4.4): PIN.
CREATE FUNCTION public.charge_cancel(p_charge_id uuid, p_reason text, p_pin_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_charge public.charges%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_status text;
    v_pin    boolean;
BEGIN
    SELECT * INTO v_charge FROM public.charges WHERE id = p_charge_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CHARGE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._require_menu('bills');
    v_pin := v_charge.status = 'CONFIRMED' OR v_charge.charge_type IN ('DAMAGE', 'LOST');
    IF v_pin THEN
        PERFORM public._require_pin(p_pin_token, 'CHARGE_CANCEL');
    END IF;
    PERFORM 1 FROM public.bills WHERE id = v_charge.bill_id FOR UPDATE;
    SELECT * INTO v_charge FROM public.charges WHERE id = p_charge_id FOR UPDATE;
    IF v_charge.status = 'PENDING' THEN
        v_status := 'CANCELLED';
    ELSIF v_charge.status = 'CONFIRMED' THEN
        PERFORM public._ledger_reverse_source('CHARGE', p_charge_id, v_charge.correlation_id);
        v_status := 'REVERSED';
    ELSE
        RAISE EXCEPTION 'CHARGE_NOT_CANCELLABLE' USING ERRCODE = '23514';
    END IF;
    UPDATE public.charges SET status = v_status, cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
     WHERE id = p_charge_id;
    PERFORM public._bill_settle(v_charge.bill_id);
    PERFORM public._audit('CHARGE_CANCEL', 'CHARGE', p_charge_id, jsonb_build_object('status', v_charge.status),
                          jsonb_build_object('status', v_status), v_reason, v_charge.correlation_id, v_pin,
                          v_charge.amount);
    RETURN jsonb_build_object('charge_id', p_charge_id, 'status', v_status);
END;
$$;

-- Shop accepts the loss (Master §14.4): recorded by a person with a PIN, never automatic.
CREATE FUNCTION public.write_off_record(
    p_bill_id           uuid,
    p_amount            numeric,
    p_reason            text,
    p_pin_token         uuid,
    p_incident_case_id  uuid DEFAULT NULL,
    p_charge_id         uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill   public.bills%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_wo     public.write_offs%ROWTYPE;
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('bills', 'finance');
    PERFORM public._require_pin(p_pin_token, 'WRITE_OFF');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_OPEN' USING ERRCODE = '23514';
    END IF;
    PERFORM public._bill_recalculate(p_bill_id);
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_bill.balance_due THEN
        RAISE EXCEPTION 'WRITE_OFF_EXCEEDS_BALANCE' USING ERRCODE = '23514';
    END IF;
    IF p_charge_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.charges WHERE id = p_charge_id AND bill_id = p_bill_id AND status = 'CONFIRMED') THEN
        RAISE EXCEPTION 'CHARGE_NOT_CONFIRMED_ON_BILL' USING ERRCODE = '23514';
    END IF;
    IF p_incident_case_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.incident_cases WHERE id = p_incident_case_id AND bill_id = p_bill_id) THEN
        RAISE EXCEPTION 'INCIDENT_NOT_IN_BILL' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.write_offs (bill_id, incident_case_id, charge_id, amount, reason, correlation_id, created_by)
    VALUES (p_bill_id, p_incident_case_id, p_charge_id, p_amount, v_reason, v_corr, auth.uid())
    RETURNING * INTO v_wo;
    PERFORM public._ledger('WRITE_OFF', NULL, p_amount, (-1)::smallint, p_bill_id, NULL, 'WRITE_OFF', v_wo.id, v_corr);
    PERFORM public._bill_settle(p_bill_id);
    PERFORM public._audit('WRITE_OFF', 'BILL', p_bill_id, jsonb_build_object('balance_due', v_bill.balance_due),
                          to_jsonb(v_wo), v_reason, v_corr, true, p_amount);
    RETURN to_jsonb(v_wo);
END;
$$;

-- 21. (contract-level deposits removed in v4.2 — deposit is a field of the rental bill, Master §18)

-- ============================================================================
-- 22. RPC — STOCK (Master §11)
-- ============================================================================

CREATE FUNCTION public._unit_state_for(p_stock_state text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_stock_state
        WHEN 'AVAILABLE' THEN 'IN_STOCK' WHEN 'INSPECTION' THEN 'INSPECTION' WHEN 'REPAIR' THEN 'REPAIR'
        WHEN 'DAMAGED' THEN 'DAMAGED' WHEN 'LOST' THEN 'LOST' WHEN 'WRITTEN_OFF' THEN 'WRITTEN_OFF'
        WHEN 'INACTIVE' THEN 'INACTIVE' END;
$$;

-- Goods received into AVAILABLE (quantity products; serialized use product_unit_register).
-- Needs PIN + audit (owner decision 2026-10-04, Master §4.4).
CREATE FUNCTION public.stock_receive(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key text,
                                     p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem   record;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
    v_src    uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('products');
    PERFORM public._require_pin(p_pin_token, 'STOCK_RECEIVE');
    SELECT * INTO v_idem FROM public._idempotency_begin('stock_receive', p_idempotency_key,
        md5(jsonb_build_object('p', p_product_id, 'q', p_quantity)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    PERFORM 1 FROM public.products WHERE id = p_product_id AND item_type = 'QUANTITY' AND active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_QUANTITY_OR_INACTIVE' USING ERRCODE = '23514';
    END IF;
    PERFORM public._stock_move(p_product_id, NULL, 'AVAILABLE', p_quantity, 'RECEIVE', 'ADJUSTMENT', v_src, NULL,
                               v_reason, v_corr);
    PERFORM public._audit('STOCK_RECEIVE', 'PRODUCT', p_product_id, NULL, jsonb_build_object('quantity', p_quantity),
                          v_reason, v_corr, true, NULL, p_quantity, NULL, 'SUCCESS');
    RETURN public._idempotency_finish(v_idem.key_id, jsonb_build_object('product_id', p_product_id,
        'quantity', p_quantity, 'correlation_id', v_corr));
END;
$$;

-- Manual adjustment / state change with reason and PIN (Master §11.2, §4.4). Transaction
-- states (RESERVED, RENTED_OUT, SOLD …) are off limits; damaged/lost never jump to AVAILABLE.
CREATE FUNCTION public.stock_adjust(
    p_product_id       uuid,
    p_from_state       text,
    p_to_state         text,
    p_quantity         numeric,
    p_reason           text,
    p_idempotency_key  text,
    p_pin_token        uuid,
    p_unit_id          uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem    record;
    v_reason  text := public._require_reason(p_reason);
    v_product public.products%ROWTYPE;
    v_type    text;
    v_doc_no  text;
    v_allowed text[] := ARRAY['AVAILABLE', 'INSPECTION', 'REPAIR', 'DAMAGED', 'LOST', 'WRITTEN_OFF', 'INACTIVE'];
    v_corr    uuid := gen_random_uuid();
    v_src     uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('products');
    SELECT * INTO v_idem FROM public._idempotency_begin('stock_adjust', p_idempotency_key,
        md5(jsonb_build_object('p', p_product_id, 'f', p_from_state, 't', p_to_state, 'q', p_quantity, 'u', p_unit_id)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    IF (p_from_state IS NOT NULL AND p_from_state <> ALL (v_allowed))
       OR (p_to_state IS NOT NULL AND p_to_state <> ALL (v_allowed))
       OR p_from_state IS NOT DISTINCT FROM p_to_state THEN
        RAISE EXCEPTION 'STATE_NOT_ADJUSTABLE' USING ERRCODE = '22023';
    END IF;
    IF p_from_state IN ('DAMAGED', 'LOST', 'WRITTEN_OFF') AND p_to_state = 'AVAILABLE' THEN
        RAISE EXCEPTION 'DAMAGED_OR_LOST_CANNOT_GO_STRAIGHT_TO_AVAILABLE: go through INSPECTION or REPAIR'
            USING ERRCODE = '23514';
    END IF;
    PERFORM public._require_pin(p_pin_token, 'STOCK_ADJUST');

    SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_product.item_type = 'SERIALIZED' THEN
        IF p_unit_id IS NULL OR p_quantity <> 1 OR p_from_state IS NULL OR p_to_state IS NULL THEN
            RAISE EXCEPTION 'SERIALIZED_ADJUST_NEEDS_ONE_UNIT_AND_BOTH_STATES' USING ERRCODE = '22023';
        END IF;
        PERFORM public._unit_transition(p_unit_id, p_product_id, ARRAY[public._unit_state_for(p_from_state)],
                                        public._unit_state_for(p_to_state));
    ELSIF p_unit_id IS NOT NULL THEN
        RAISE EXCEPTION 'UNITS_NOT_ALLOWED_FOR_QUANTITY_PRODUCT' USING ERRCODE = '22023';
    END IF;

    v_type := CASE
        WHEN p_to_state = 'WRITTEN_OFF' THEN 'WRITE_OFF'
        WHEN p_from_state = 'INSPECTION' AND p_to_state IS NOT NULL THEN 'INSPECT'
        WHEN p_to_state = 'REPAIR' OR p_from_state = 'REPAIR' THEN 'REPAIR'
        WHEN p_to_state = 'DAMAGED' THEN 'DAMAGE'
        ELSE 'ADJUSTMENT' END;
    v_doc_no := public._next_document_no('STOCK_ADJUSTMENT');
    PERFORM public._stock_move(p_product_id, p_from_state, p_to_state, p_quantity, v_type, 'ADJUSTMENT', v_src, p_unit_id,
                               v_doc_no || ': ' || v_reason, v_corr);
    PERFORM public._audit('STOCK_ADJUST', 'PRODUCT', p_product_id, jsonb_build_object('from_state', p_from_state),
                          jsonb_build_object('to_state', p_to_state, 'quantity', p_quantity, 'document_no', v_doc_no,
                                             'unit_id', p_unit_id), v_reason, v_corr, true, NULL, p_quantity);
    RETURN public._idempotency_finish(v_idem.key_id, jsonb_build_object('document_no', v_doc_no, 'correlation_id', v_corr));
END;
$$;

-- Damaged A → product B (Master §11.5): one transaction, both movements share a
-- correlation id, PIN + audit. Quantity products only.
CREATE FUNCTION public.convert_damaged_stock(
    p_from_product_id  uuid,
    p_to_product_id    uuid,
    p_from_quantity    numeric,
    p_to_quantity      numeric,
    p_reason           text,
    p_idempotency_key  text,
    p_pin_token        uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem    record;
    v_reason  text := public._require_reason(p_reason);
    v_doc_no  text;
    v_corr    uuid := gen_random_uuid();
    v_src     uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('products');
    SELECT * INTO v_idem FROM public._idempotency_begin('convert_damaged_stock', p_idempotency_key,
        md5(jsonb_build_object('f', p_from_product_id, 't', p_to_product_id, 'fq', p_from_quantity,
                               'tq', p_to_quantity)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    PERFORM public._require_pin(p_pin_token, 'STOCK_CONVERT');
    IF p_from_product_id = p_to_product_id THEN
        RAISE EXCEPTION 'CONVERT_SAME_PRODUCT' USING ERRCODE = '22023';
    END IF;
    IF p_from_quantity IS NULL OR p_from_quantity <= 0 OR p_to_quantity IS NULL OR p_to_quantity <= 0 THEN
        RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.products
         WHERE id IN (p_from_product_id, p_to_product_id) AND item_type = 'QUANTITY') <> 2 THEN
        RAISE EXCEPTION 'CONVERT_QUANTITY_PRODUCTS_ONLY' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_to_product_id AND active) THEN
        RAISE EXCEPTION 'TARGET_PRODUCT_INACTIVE' USING ERRCODE = '23514';
    END IF;

    v_doc_no := public._next_document_no('STOCK_ADJUSTMENT');
    -- Lock in product order so two conversions cannot deadlock.
    IF p_from_product_id < p_to_product_id THEN
        PERFORM public._stock_move(p_from_product_id, 'DAMAGED', NULL, p_from_quantity, 'CONVERT_OUT', 'CONVERSION',
                                   v_src, NULL, v_doc_no || ': ' || v_reason, v_corr);
        PERFORM public._stock_move(p_to_product_id, NULL, 'AVAILABLE', p_to_quantity, 'CONVERT_IN', 'CONVERSION',
                                   v_src, NULL, v_doc_no || ': ' || v_reason, v_corr);
    ELSE
        PERFORM public._stock_move(p_to_product_id, NULL, 'AVAILABLE', p_to_quantity, 'CONVERT_IN', 'CONVERSION',
                                   v_src, NULL, v_doc_no || ': ' || v_reason, v_corr);
        PERFORM public._stock_move(p_from_product_id, 'DAMAGED', NULL, p_from_quantity, 'CONVERT_OUT', 'CONVERSION',
                                   v_src, NULL, v_doc_no || ': ' || v_reason, v_corr);
    END IF;
    PERFORM public._audit('STOCK_CONVERT', 'PRODUCT', p_from_product_id,
                          jsonb_build_object('from_product_id', p_from_product_id, 'from_quantity', p_from_quantity),
                          jsonb_build_object('to_product_id', p_to_product_id, 'to_quantity', p_to_quantity,
                                             'document_no', v_doc_no), v_reason, v_corr, true, NULL, p_from_quantity);
    RETURN public._idempotency_finish(v_idem.key_id, jsonb_build_object('document_no', v_doc_no, 'correlation_id', v_corr));
END;
$$;

-- Physical count (Master §11.4): snapshot → count → confirm with PIN; adjustment only from discrepancy.
CREATE FUNCTION public.stock_count_open(p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count public.stock_counts%ROWTYPE;
BEGIN
    PERFORM public._require_menu('products');
    INSERT INTO public.stock_counts (count_no, note, created_by)
    VALUES (public._next_document_no('INVENTORY_COUNT'), p_note, auth.uid())
    RETURNING * INTO v_count;
    INSERT INTO public.stock_count_lines (stock_count_id, product_id, stock_state, snapshot_qty, created_by)
    SELECT v_count.id, p.id, 'AVAILABLE', COALESCE(sb.quantity, 0), auth.uid()
      FROM public.products p
      LEFT JOIN public.stock_balances sb ON sb.product_id = p.id AND sb.stock_state = 'AVAILABLE'
     WHERE p.active AND p.item_type = 'QUANTITY';
    PERFORM public._audit('STOCK_COUNT_OPEN', 'STOCK_COUNT', v_count.id, NULL, to_jsonb(v_count), p_note, NULL);
    RETURN to_jsonb(v_count);
END;
$$;

CREATE FUNCTION public.stock_count_record(p_count_id uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_item record;
BEGIN
    PERFORM public._require_menu('products');
    PERFORM 1 FROM public.stock_counts WHERE id = p_count_id AND status IN ('OPEN', 'COUNTED') FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COUNT_NOT_OPEN' USING ERRCODE = '23514';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(product_id uuid, counted_qty numeric, reason text) LOOP
        UPDATE public.stock_count_lines SET counted_qty = v_item.counted_qty, reason = v_item.reason
         WHERE stock_count_id = p_count_id AND product_id = v_item.product_id AND stock_state = 'AVAILABLE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'COUNT_LINE_NOT_FOUND: %', v_item.product_id USING ERRCODE = 'P0002';
        END IF;
    END LOOP;
    UPDATE public.stock_counts
       SET status = CASE WHEN EXISTS (SELECT 1 FROM public.stock_count_lines
                                       WHERE stock_count_id = p_count_id AND counted_qty IS NULL)
                         THEN 'OPEN' ELSE 'COUNTED' END
     WHERE id = p_count_id;
    RETURN jsonb_build_object('stock_count_id', p_count_id);
END;
$$;

CREATE FUNCTION public.stock_count_confirm(p_count_id uuid, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_line public.stock_count_lines%ROWTYPE;
    v_corr uuid := gen_random_uuid();
    v_n    integer := 0;
BEGIN
    PERFORM public._require_menu('products');
    PERFORM public._require_pin(p_pin_token, 'STOCK_COUNT_CONFIRM');
    PERFORM 1 FROM public.stock_counts WHERE id = p_count_id AND status = 'COUNTED' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COUNT_NOT_COUNTED' USING ERRCODE = '23514';
    END IF;
    FOR v_line IN SELECT * FROM public.stock_count_lines
                   WHERE stock_count_id = p_count_id AND discrepancy <> 0 ORDER BY product_id LOOP
        IF v_line.reason IS NULL OR btrim(v_line.reason) = '' THEN
            RAISE EXCEPTION 'DISCREPANCY_REASON_REQUIRED: product %', v_line.product_id USING ERRCODE = '22023';
        END IF;
        IF v_line.discrepancy > 0 THEN
            PERFORM public._stock_move(v_line.product_id, NULL, 'AVAILABLE', v_line.discrepancy, 'COUNT_ADJUSTMENT',
                                       'STOCK_COUNT', v_line.id, NULL, v_line.reason, v_corr);
        ELSE
            PERFORM public._stock_move(v_line.product_id, 'AVAILABLE', NULL, -v_line.discrepancy, 'COUNT_ADJUSTMENT',
                                       'STOCK_COUNT', v_line.id, NULL, v_line.reason, v_corr);
        END IF;
        UPDATE public.stock_count_lines SET adjustment_correlation = v_corr WHERE id = v_line.id;
        v_n := v_n + 1;
    END LOOP;
    UPDATE public.stock_counts SET status = 'CONFIRMED', confirmed_by = auth.uid(), confirmed_at = now() WHERE id = p_count_id;
    PERFORM public._audit('STOCK_COUNT_CONFIRM', 'STOCK_COUNT', p_count_id, NULL, jsonb_build_object('adjusted_lines', v_n),
                          NULL, v_corr, true);
    RETURN jsonb_build_object('stock_count_id', p_count_id, 'adjusted_lines', v_n);
END;
$$;

-- ============================================================================
-- 23. RPC — EXPENSE / OTHER INCOME (Master §22). No cash sessions (Master §24).
-- ============================================================================

-- Recording an expense is risky (Master §4.4): PIN, then it takes effect at once.
CREATE FUNCTION public.expense_create(
    p_category     text,
    p_amount       numeric,
    p_paid_method  text,
    p_note         text,
    p_pin_token    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_e    public.expense_entries%ROWTYPE;
    v_corr uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('finance');
    PERFORM public._require_pin(p_pin_token, 'EXPENSE_CREATE');
    INSERT INTO public.expense_entries (expense_no, category, amount, paid_method, note, created_by)
    VALUES (public._next_document_no('EXPENSE'), p_category, p_amount, p_paid_method, p_note, auth.uid())
    RETURNING * INTO v_e;
    PERFORM public._ledger('EXPENSE', NULL, v_e.amount, (-1)::smallint, NULL, NULL, 'EXPENSE', v_e.id, v_corr);
    PERFORM public._audit('EXPENSE_CREATE', 'EXPENSE', v_e.id, NULL, to_jsonb(v_e), p_note, v_corr,
                          true, v_e.amount, NULL, v_e.paid_method);
    RETURN to_jsonb(v_e);
END;
$$;

CREATE FUNCTION public.expense_void(p_expense_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_e      public.expense_entries%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('finance');
    PERFORM public._require_pin(p_pin_token, 'EXPENSE_VOID');
    SELECT * INTO v_e FROM public.expense_entries WHERE id = p_expense_id FOR UPDATE;
    IF NOT FOUND OR v_e.status <> 'RECORDED' THEN
        RAISE EXCEPTION 'EXPENSE_NOT_VOIDABLE' USING ERRCODE = '23514';
    END IF;
    PERFORM public._ledger_reverse_source('EXPENSE', p_expense_id, v_corr);
    UPDATE public.expense_entries SET status = 'VOIDED', voided_by = auth.uid(), voided_at = now(), void_reason = v_reason
     WHERE id = p_expense_id;
    PERFORM public._audit('EXPENSE_VOID', 'EXPENSE', p_expense_id, jsonb_build_object('status', v_e.status),
                          jsonb_build_object('status', 'VOIDED'), v_reason, v_corr, true, v_e.amount, NULL, v_e.paid_method);
    RETURN jsonb_build_object('expense_id', p_expense_id, 'status', 'VOIDED');
END;
$$;

-- Other income not tied to a bill (Master §22). Not a risky action (no PIN); voiding is.
CREATE FUNCTION public.other_income_create(p_category text, p_amount numeric, p_channel text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_i    public.other_income_entries%ROWTYPE;
    v_corr uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('finance');
    INSERT INTO public.other_income_entries (income_no, category, amount, channel, note, created_by)
    VALUES (public._next_document_no('OTHER_INCOME'), btrim(p_category), p_amount, p_channel, p_note, auth.uid())
    RETURNING * INTO v_i;
    PERFORM public._ledger('REVENUE', 'OTHER', v_i.amount, 1::smallint, NULL, NULL, 'OTHER_INCOME', v_i.id, v_corr);
    PERFORM public._audit('OTHER_INCOME_CREATE', 'OTHER_INCOME', v_i.id, NULL, to_jsonb(v_i), p_note, v_corr,
                          false, v_i.amount, NULL, v_i.channel);
    RETURN to_jsonb(v_i);
END;
$$;

CREATE FUNCTION public.other_income_void(p_income_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_i      public.other_income_entries%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('finance');
    PERFORM public._require_pin(p_pin_token, 'OTHER_INCOME_VOID');
    SELECT * INTO v_i FROM public.other_income_entries WHERE id = p_income_id FOR UPDATE;
    IF NOT FOUND OR v_i.status <> 'RECORDED' THEN
        RAISE EXCEPTION 'OTHER_INCOME_NOT_VOIDABLE' USING ERRCODE = '23514';
    END IF;
    PERFORM public._ledger_reverse_source('OTHER_INCOME', p_income_id, v_corr);
    UPDATE public.other_income_entries SET status = 'VOIDED', voided_by = auth.uid(), voided_at = now(),
                                           void_reason = v_reason
     WHERE id = p_income_id;
    PERFORM public._audit('OTHER_INCOME_VOID', 'OTHER_INCOME', p_income_id, jsonb_build_object('status', v_i.status),
                          jsonb_build_object('status', 'VOIDED'), v_reason, v_corr, true, v_i.amount, NULL, v_i.channel);
    RETURN jsonb_build_object('income_id', p_income_id, 'status', 'VOIDED');
END;
$$;

-- ============================================================================
-- 24. RPC — APPOINTMENT / NOTIFICATION / DOCUMENT (Master §25–§27)
-- ============================================================================

-- Create, or update non-time fields. Time changes go through appointment_reschedule.
-- Returns overlapping appointments of the same assignee as a warning (not a block).
CREATE FUNCTION public.appointment_save(p_appointment_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old       public.appointments%ROWTYPE;
    v_new       public.appointments%ROWTYPE;
    v_conflicts jsonb;
    v_allowed   text[] := ARRAY['appointment_type', 'customer_id', 'bill_id', 'related_entity_type', 'related_entity_id',
                                'title', 'description', 'start_datetime', 'end_datetime', 'location', 'contact_name',
                                'contact_phone', 'assigned_user_id', 'priority', 'reminder_before_minutes', 'status',
                                'work_order'];
BEGIN
    PERFORM public._require_menu('appointments');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;

    IF p_appointment_id IS NULL THEN
        v_new := jsonb_populate_record(NULL::public.appointments, p_data);
        IF COALESCE(v_new.status, 'SCHEDULED') NOT IN ('DRAFT', 'SCHEDULED', 'CONFIRMED') THEN
            RAISE EXCEPTION 'INVALID_INITIAL_STATUS' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.appointments (appointment_no, appointment_type, customer_id, bill_id, related_entity_type,
            related_entity_id, title, description, start_datetime, end_datetime, location, contact_name, contact_phone,
            assigned_user_id, priority, status, reminder_before_minutes, work_order, created_by)
        VALUES (public._next_document_no('APPOINTMENT'), v_new.appointment_type, v_new.customer_id, v_new.bill_id,
            v_new.related_entity_type, v_new.related_entity_id, v_new.title, v_new.description, v_new.start_datetime,
            v_new.end_datetime, v_new.location, v_new.contact_name, v_new.contact_phone, v_new.assigned_user_id,
            COALESCE(v_new.priority, 'NORMAL'), COALESCE(v_new.status, 'SCHEDULED'), v_new.reminder_before_minutes,
            COALESCE(v_new.work_order, '{}'::jsonb), auth.uid())
        RETURNING * INTO v_new;
        INSERT INTO public.appointment_history (appointment_id, change_type, new_start_datetime, after_data, created_by)
        VALUES (v_new.id, 'CREATE', v_new.start_datetime, to_jsonb(v_new), auth.uid());
    ELSE
        IF p_data ?| ARRAY['start_datetime', 'end_datetime', 'status'] THEN
            RAISE EXCEPTION 'USE_RESCHEDULE_OR_SET_STATUS' USING ERRCODE = '22023';
        END IF;
        SELECT * INTO v_old FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
        IF NOT FOUND OR v_old.status IN ('COMPLETED', 'CANCELLED', 'NO_SHOW') THEN
            RAISE EXCEPTION 'APPOINTMENT_NOT_EDITABLE' USING ERRCODE = '23514';
        END IF;
        v_new := jsonb_populate_record(v_old, p_data);
        UPDATE public.appointments
           SET appointment_type = v_new.appointment_type, customer_id = v_new.customer_id, bill_id = v_new.bill_id,
               related_entity_type = v_new.related_entity_type, related_entity_id = v_new.related_entity_id,
               title = v_new.title, description = v_new.description, location = v_new.location,
               contact_name = v_new.contact_name, contact_phone = v_new.contact_phone,
               assigned_user_id = v_new.assigned_user_id, priority = v_new.priority,
               reminder_before_minutes = v_new.reminder_before_minutes,
               work_order = COALESCE(v_new.work_order, '{}'::jsonb)
         WHERE id = p_appointment_id
        RETURNING * INTO v_new;
        INSERT INTO public.appointment_history (appointment_id, change_type, before_data, after_data, created_by)
        VALUES (p_appointment_id,
                CASE WHEN v_new.assigned_user_id IS DISTINCT FROM v_old.assigned_user_id THEN 'ASSIGN' ELSE 'UPDATE' END,
                to_jsonb(v_old), to_jsonb(v_new), auth.uid());
    END IF;

    SELECT jsonb_agg(jsonb_build_object('id', a.id, 'appointment_no', a.appointment_no, 'start', a.start_datetime)) INTO v_conflicts
      FROM public.appointments a
     WHERE a.id <> v_new.id AND v_new.assigned_user_id IS NOT NULL AND a.assigned_user_id = v_new.assigned_user_id
       AND a.status NOT IN ('CANCELLED', 'COMPLETED', 'NO_SHOW')
       AND tstzrange(a.start_datetime, a.end_datetime, '[]') && tstzrange(v_new.start_datetime, v_new.end_datetime, '[]');
    PERFORM public._audit('APPOINTMENT_SAVE', 'APPOINTMENT', v_new.id, to_jsonb(v_old), to_jsonb(v_new), NULL, NULL);
    RETURN jsonb_build_object('appointment', to_jsonb(v_new), 'conflicts', COALESCE(v_conflicts, '[]'::jsonb));
END;
$$;

CREATE FUNCTION public.appointment_reschedule(p_appointment_id uuid, p_new_start timestamptz, p_new_end timestamptz, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old    public.appointments%ROWTYPE;
    v_new    public.appointments%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_menu('appointments');
    SELECT * INTO v_old FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
    IF NOT FOUND OR v_old.status IN ('COMPLETED', 'CANCELLED', 'NO_SHOW') THEN
        RAISE EXCEPTION 'APPOINTMENT_NOT_EDITABLE' USING ERRCODE = '23514';
    END IF;
    UPDATE public.appointments SET start_datetime = p_new_start, end_datetime = p_new_end, status = 'RESCHEDULED'
     WHERE id = p_appointment_id RETURNING * INTO v_new;
    INSERT INTO public.appointment_history (appointment_id, change_type, original_start_datetime, new_start_datetime,
                                            before_data, after_data, reason, created_by)
    VALUES (p_appointment_id, 'RESCHEDULE', v_old.start_datetime, p_new_start, to_jsonb(v_old), to_jsonb(v_new),
            v_reason, auth.uid());
    PERFORM public._audit('APPOINTMENT_RESCHEDULE', 'APPOINTMENT', p_appointment_id, to_jsonb(v_old), to_jsonb(v_new),
                          v_reason, NULL);
    RETURN to_jsonb(v_new);
END;
$$;

CREATE FUNCTION public.appointment_set_status(p_appointment_id uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old public.appointments%ROWTYPE;
    v_new public.appointments%ROWTYPE;
BEGIN
    PERFORM public._require_menu('appointments');
    SELECT * INTO v_old FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
    IF NOT FOUND OR v_old.status IN ('COMPLETED', 'CANCELLED', 'NO_SHOW') THEN
        RAISE EXCEPTION 'APPOINTMENT_NOT_EDITABLE' USING ERRCODE = '23514';
    END IF;
    IF p_status NOT IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW') THEN
        RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = '22023';
    END IF;
    IF p_status = 'CANCELLED' THEN
        PERFORM public._require_reason(p_reason);
    END IF;
    UPDATE public.appointments
       SET status = p_status,
           cancel_reason = CASE WHEN p_status = 'CANCELLED' THEN p_reason END,
           cancelled_by = CASE WHEN p_status = 'CANCELLED' THEN auth.uid() END,
           cancelled_at = CASE WHEN p_status = 'CANCELLED' THEN now() END
     WHERE id = p_appointment_id RETURNING * INTO v_new;
    INSERT INTO public.appointment_history (appointment_id, change_type, before_data, after_data, reason, created_by)
    VALUES (p_appointment_id, 'STATUS', jsonb_build_object('status', v_old.status), jsonb_build_object('status', p_status),
            p_reason, auth.uid());
    PERFORM public._audit('APPOINTMENT_STATUS', 'APPOINTMENT', p_appointment_id, jsonb_build_object('status', v_old.status),
                          jsonb_build_object('status', p_status), p_reason, NULL);
    RETURN to_jsonb(v_new);
END;
$$;

-- Reading a notification never changes business state (Master §27).
CREATE FUNCTION public.notification_mark(p_notification_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_n public.notifications%ROWTYPE;
BEGIN
    PERFORM public._require_active_member();
    IF p_status NOT IN ('READ', 'HANDLED', 'DISMISSED') THEN
        RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_n FROM public.notifications WHERE id = p_notification_id FOR UPDATE;
    -- COALESCE: a NULL recipient_user_id must not turn the check into NULL (= allowed).
    IF NOT FOUND OR NOT (COALESCE(v_n.recipient_user_id = auth.uid(), false)
                         OR (v_n.recipient_menu IS NOT NULL AND public.has_menu(v_n.recipient_menu))
                         OR public.is_owner()) THEN
        RAISE EXCEPTION 'NOTIFICATION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF p_status = 'DISMISSED' AND v_n.severity = 'CRITICAL' AND NOT public.is_owner()
       AND NOT (v_n.recipient_menu IS NOT NULL AND public.has_menu(v_n.recipient_menu)) THEN
        RAISE EXCEPTION 'FORBIDDEN: critical notification' USING ERRCODE = '42501';
    END IF;
    UPDATE public.notifications
       SET status = p_status,
           read_at = COALESCE(read_at, now()),
           handled_at = CASE WHEN p_status = 'HANDLED' THEN now() ELSE handled_at END,
           handled_by = CASE WHEN p_status = 'HANDLED' THEN auth.uid() ELSE handled_by END
     WHERE id = p_notification_id
    RETURNING * INTO v_n;
    IF p_status <> 'READ' THEN
        PERFORM public._audit('NOTIFICATION_' || p_status, 'NOTIFICATION', p_notification_id, NULL,
                              jsonb_build_object('status', p_status), NULL, NULL);
    END IF;
    RETURN to_jsonb(v_n);
END;
$$;

-- Every print / save / share is recorded (Master §25). Replaces client inserts into audit_logs.
CREATE FUNCTION public.document_reference_log(
    p_document_type  text,
    p_entity_type    text,
    p_entity_id      uuid,
    p_action         text,
    p_format         text,
    p_document_no    text DEFAULT NULL,
    p_copy_number    integer DEFAULT 1,
    p_snapshot_hash  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ref public.document_references%ROWTYPE;
BEGIN
    PERFORM public._require_active_member();
    INSERT INTO public.document_references (document_type, entity_type, entity_id, document_no, action, format,
                                            copy_number, data_snapshot_hash, created_by)
    VALUES (p_document_type, p_entity_type, p_entity_id, p_document_no, p_action, p_format,
            COALESCE(p_copy_number, 1), p_snapshot_hash, auth.uid())
    RETURNING * INTO v_ref;
    RETURN to_jsonb(v_ref);
END;
$$;

-- ============================================================================
-- 25. SYSTEM JOBS / RECONCILIATION (service_role or OWNER)
-- ============================================================================

-- Cron: refresh rental status and raise in-app notices (Master §27). Each notice type is
-- switched on/off and timed in Settings (policies.notifications — same shape as the app's
-- notification panel); nothing here creates a charge or a continuation (Master §16).
CREATE FUNCTION public.rental_overdue_scan()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_n     jsonb := public._policy('notifications', '{}'::jsonb);
    v_row   record;
    v_today date := public._local_date(now());
    v_count integer := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_owner() THEN
        RAISE EXCEPTION 'FORBIDDEN: system job' USING ERRCODE = '42501';
    END IF;

    -- status refresh always runs; the notice only when switched on
    FOR v_row IN
        SELECT l.id, l.bill_id, b.bill_no, l.rental_end_at
          FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
         WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND l.rental_end_at < now()
           AND b.status = 'ACTIVE'
    LOOP
        UPDATE public.bill_lines SET rental_status = 'OVERDUE'
         WHERE id = v_row.id AND rental_status IS DISTINCT FROM 'OVERDUE';
        IF COALESCE((v_n -> 'overdueReturnReminder' ->> 'enabled')::boolean, true) THEN
            PERFORM public._notify('RENTAL_OVERDUE:' || v_row.id, 'RENTAL_OVERDUE', 'WARNING', NULL, 'bills',
                                   'BILL', v_row.bill_id, 'เลยกำหนดคืน: ' || v_row.bill_no,
                                   'ครบกำหนดคืน ' || to_char(v_row.rental_end_at, 'YYYY-MM-DD HH24:MI')
                                   || ' — แจ้งเตือนเท่านั้น ไม่มีค่าปรับ');
            v_count := v_count + 1;
        END IF;
    END LOOP;

    IF COALESCE((v_n -> 'returnReminder' ->> 'enabled')::boolean, true) THEN
        FOR v_row IN
            SELECT l.id, l.bill_id, b.bill_no, l.rental_end_at
              FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
             WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND l.rental_end_at >= now()
               AND public._local_date(l.rental_end_at) - v_today
                   <= COALESCE((v_n -> 'returnReminder' ->> 'daysBefore')::integer, 1)
               AND b.status = 'ACTIVE'
        LOOP
            PERFORM public._notify('RENTAL_DUE_SOON:' || v_row.id, 'RENTAL_DUE_SOON', 'INFO', NULL, 'bills',
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
            PERFORM public._notify('DELIVERY_DUE:' || v_row.id, 'DELIVERY_DUE', 'INFO', NULL, 'bills',
                                   'BILL', v_row.bill_id, 'ถึงวันส่งของ: ' || v_row.bill_no,
                                   'กำหนดส่ง ' || to_char(v_row.rental_start_at, 'YYYY-MM-DD HH24:MI'));
            v_count := v_count + 1;
        END LOOP;
    END IF;

    -- money owed per bill (no cross-bill allocation); repeats daily once the due date has passed
    IF COALESCE((v_n -> 'paymentReminder' ->> 'enabled')::boolean, true) THEN
        FOR v_row IN
            SELECT b.id AS bill_id, b.bill_no, b.balance_due, b.due_date
              FROM public.bills b
             WHERE b.status IN ('CONFIRMED', 'ACTIVE', 'CLOSED') AND b.balance_due > 0 AND b.due_date IS NOT NULL
               AND b.due_date - v_today <= COALESCE((v_n -> 'paymentReminder' ->> 'daysBefore')::integer, 1)
        LOOP
            PERFORM public._notify('PAYMENT_DUE:' || v_row.bill_id || ':' || v_today, 'PAYMENT_DUE',
                                   CASE WHEN v_row.due_date < v_today THEN 'WARNING' ELSE 'INFO' END, NULL, 'finance',
                                   'BILL', v_row.bill_id, 'ยอดค้างชำระ: ' || v_row.bill_no,
                                   'ค้าง ' || v_row.balance_due || ' บาท ครบกำหนด ' || v_row.due_date);
            v_count := v_count + 1;
        END LOOP;
    END IF;

    IF COALESCE((v_n -> 'lowStockReminder' ->> 'enabled')::boolean, true) THEN
        FOR v_row IN
            SELECT p.id, p.sku, p.name, p.reorder_point,
                   COALESCE((SELECT sum(sb.quantity) FROM public.stock_balances sb
                              WHERE sb.product_id = p.id AND sb.stock_state = 'AVAILABLE'), 0) AS available
              FROM public.products p
             WHERE p.active AND p.reorder_point > 0
        LOOP
            CONTINUE WHEN v_row.available > v_row.reorder_point;
            PERFORM public._notify('LOW_STOCK:' || v_row.id || ':' || v_today, 'LOW_STOCK', 'WARNING', NULL, 'products',
                                   'PRODUCT', v_row.id, 'สินค้าใกล้หมด: ' || v_row.sku || ' ' || v_row.name,
                                   'คงเหลือ ' || v_row.available || ' (จุดเตือน ' || v_row.reorder_point || ')');
            v_count := v_count + 1;
        END LOOP;
    END IF;
    IF COALESCE((v_n -> 'appointmentReminder' ->> 'enabled')::boolean, true) THEN
        FOR v_row IN
            SELECT a.id, a.title, a.start_datetime
            FROM public.appointments a
            WHERE a.status IN ('DRAFT', 'SCHEDULED', 'CONFIRMED', 'RESCHEDULED')
              AND a.start_datetime >= now()
              AND public._local_date(a.start_datetime) - v_today
                  <= COALESCE((v_n -> 'appointmentReminder' ->> 'daysBefore')::integer, 3)
        LOOP
            PERFORM public._notify('APPOINTMENT_DUE:' || v_row.id, 'APPOINTMENT_DUE', 'INFO', NULL, 'appointments',
                'APPOINTMENT', v_row.id, 'ใกล้ถึงนัดหมาย: ' || v_row.title,
                'นัดหมาย ' || to_char(v_row.start_datetime, 'YYYY-MM-DD HH24:MI'));
            v_count := v_count + 1;
        END LOOP;
    END IF;
    RETURN v_count;
END;
$$;

-- Compare cached balances with the movement ledger (Master §2.4). Read-only.
CREATE FUNCTION public.reconcile_stock_balances()
RETURNS TABLE (product_id uuid, stock_state text, cached numeric, ledger numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_owner() THEN
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

-- Rebuild one bill's cached money/quantity columns from its records.
CREATE FUNCTION public.reconcile_bill(p_bill_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_before jsonb;
    v_after  jsonb;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_owner() THEN
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

-- Customer AR summary (Master §23) — invoker view, so RLS of the caller applies.
CREATE VIEW public.customer_balances_v
WITH (security_invoker = true) AS
SELECT c.id AS customer_id,
       c.credit_enabled,
       c.credit_limit,
       COALESCE(sum(b.balance_due) FILTER (WHERE b.status IN ('CONFIRMED', 'ACTIVE')), 0) AS current_balance,
       c.credit_limit - COALESCE(sum(b.balance_due) FILTER (WHERE b.status IN ('CONFIRMED', 'ACTIVE')), 0) AS available_credit,
       COALESCE(sum(b.balance_due) FILTER (WHERE b.status IN ('CONFIRMED', 'ACTIVE') AND b.due_date < current_date), 0)
           AS overdue_balance
  FROM public.customers c
  LEFT JOIN public.bills b ON b.customer_id = c.id
 GROUP BY c.id, c.credit_enabled, c.credit_limit;

-- ============================================================================
-- 26. ROW LEVEL SECURITY — every table, SELECT policies only
--     (writes happen inside SECURITY DEFINER RPCs owned by postgres).
--     PENDING / SUSPENDED members see nothing but their own profile.
--     profiles policies come from the auth file and are not recreated here.
-- ============================================================================

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;

    -- Operational tables every ACTIVE member needs at the POS.
    FOREACH t IN ARRAY ARRAY[
        'menu_catalog', 'store_settings', 'product_categories', 'units', 'products', 'product_units',
        'stock_balances', 'quotations', 'quotation_items', 'reservations', 'bills', 'bill_lines',
        'appointments', 'appointment_history', 'deliveries', 'delivery_lines', 'returns', 'return_lines',
        'rental_carry_forwards', 'rental_carry_forward_units', 'rental_carry_forward_reversals', 'incident_cases',
        'charges', 'document_references']
    LOOP
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_active_member()))',
            t || '_select_member', t);
    END LOOP;
END $$;

-- Identity / control
CREATE POLICY user_menu_access_select_own_or_owner ON public.user_menu_access
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_owner()));
CREATE POLICY audit_logs_select_owner ON public.audit_logs
    FOR SELECT TO authenticated USING ((SELECT public.is_owner()));
-- user_pins, pin_confirmations, idempotency_keys, document_sequences: no policy, no grant.

-- Customers and their documents (personal data)
CREATE POLICY customers_select ON public.customers
    FOR SELECT TO authenticated
    USING ((SELECT public.has_menu('customers')) OR (SELECT public.has_menu('pos')) OR (SELECT public.has_menu('bills'))
           OR (SELECT public.has_menu('documents')) OR (SELECT public.has_menu('quotations'))
           OR (SELECT public.has_menu('appointments')));
CREATE POLICY customer_documents_select ON public.customer_documents
    FOR SELECT TO authenticated
    USING ((SELECT public.has_menu('documents')) OR (SELECT public.has_menu('customers')));
CREATE POLICY product_costs_select ON public.product_costs
    FOR SELECT TO authenticated USING ((SELECT public.has_menu('products')));

-- Money on bills
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['payment_receipts', 'payments', 'refunds', 'bill_adjustments', 'write_offs'] LOOP
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_menu(''bills'')) '
            'OR (SELECT public.has_menu(''pos'')) OR (SELECT public.has_menu(''finance'')))', t || '_select', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['finance_ledger_entries', 'expense_entries', 'other_income_entries'] LOOP
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_menu(''finance'')))',
            t || '_select', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['stock_movements', 'stock_counts', 'stock_count_lines'] LOOP
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_menu(''products'')))',
            t || '_select', t);
    END LOOP;
END $$;

-- Notifications: recipient, holders of the recipient menu, or OWNER.
CREATE POLICY notifications_select ON public.notifications
    FOR SELECT TO authenticated
    USING ((SELECT public.is_active_member())
           AND (recipient_user_id = (SELECT auth.uid())
                OR (recipient_menu IS NOT NULL AND public.has_menu(recipient_menu))
                OR (SELECT public.is_owner())));

-- ============================================================================
-- 27. GRANTS
-- ============================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
-- service_role too: Supabase's default privileges grant it every new function, and
-- internal "_" helpers must only run inside the RPCs that lock and validate first.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;  -- server tooling; append-only triggers still apply

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
              AND tablename NOT IN ('idempotency_keys', 'document_sequences', 'user_pins', 'pin_confirmations') LOOP
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    END LOOP;
END $$;
GRANT SELECT ON public.customer_balances_v TO authenticated;
-- Re-grant what the auth file gave (the REVOKE above cleared it).
GRANT UPDATE (first_name, last_name, display_name, avatar_url) ON public.profiles TO authenticated;

-- RLS helpers (policies run as the caller).
GRANT EXECUTE ON FUNCTION public.is_active_member(), public.is_owner(), public.has_menu(text)
    TO authenticated, service_role;

-- Client RPCs. Each one checks ACTIVE member + menu (+ PIN for risky actions) itself.
GRANT EXECUTE ON FUNCTION
    public.owner_set_member_status(uuid, text, text),
    public.owner_set_member_role(uuid, text, text),
    public.owner_set_member_menus(uuid, text[], text),
    public.owner_reset_member_pin(uuid, text),
    public.set_pin(text, uuid),
    public.verify_pin(text, text, text),
    public.owner_recover_pin(text),
    public.my_pin_status(),
    public.set_auto_lock(integer),
    public.settings_update(jsonb, text),
    public.customer_create(jsonb, boolean),
    public.customer_update(uuid, jsonb, text),
    public.customer_set_active(uuid, boolean, text),
    public.customer_document_save(uuid, uuid, jsonb),
    public.customer_document_set_status(uuid, text, text),
    public.product_category_save(uuid, text, boolean),
    public.unit_save(uuid, text, boolean, integer),
    public.product_create(jsonb, numeric, numeric, boolean, uuid),
    public.product_update(uuid, jsonb, text),
    public.product_set_price(uuid, numeric, numeric, text, uuid),
    public.product_set_cost(uuid, numeric, text),
    public.product_set_active(uuid, boolean, text),
    public.product_unit_register(uuid, text, text),
    public.quotation_save_draft(uuid, jsonb, uuid),
    public.quotation_send(uuid),
    public.quotation_set_status(uuid, text, text),
    public.reservation_create(uuid, jsonb, timestamptz, text),
    public.reservation_release(uuid, text),
    public.bill_save_draft(uuid, jsonb, uuid),
    public.bill_confirm(uuid, text, jsonb),
    public.bill_cancel(uuid, text, uuid),
    public.bill_void(uuid, text, uuid),
    public.bill_correct(uuid, jsonb, text, uuid),
    public.bill_adjust(uuid, text, numeric, text, text, uuid, uuid, uuid),
    public.delivery_create(uuid, jsonb, text, timestamptz, uuid, text),
    public.bill_allocate_backorder(uuid),
    public.return_receive(uuid, jsonb, text, timestamptz, text),
    public.overdue_review(uuid, text),
    public.incident_open(uuid, text, numeric, text, uuid),
    public.incident_assess(uuid, jsonb, text, text),
    public.incident_mark_found(uuid, text),
    public.lost_record(uuid, numeric, text, text, uuid),
    public.incident_resolve(uuid, text, boolean, uuid),
    public.create_rental_continuation(uuid, jsonb, text, text, text, uuid),
    public.reverse_carry_forward(uuid, text, uuid),
    public.payment_receive(uuid, jsonb, text, date),
    public.payment_void(uuid, text, uuid),
    public.refund_pay(uuid, numeric, text, text, text, uuid, uuid),
    public.charge_create(uuid, text, numeric, text, uuid, uuid, jsonb, timestamptz, timestamptz, uuid),
    public.charge_confirm(uuid),
    public.charge_cancel(uuid, text, uuid),
    public.write_off_record(uuid, numeric, text, uuid, uuid, uuid),
    public.stock_receive(uuid, numeric, text, text, uuid),
    public.bill_refund_suggestion(uuid),
    public.stock_adjust(uuid, text, text, numeric, text, text, uuid, uuid),
    public.convert_damaged_stock(uuid, uuid, numeric, numeric, text, text, uuid),
    public.stock_count_open(text),
    public.stock_count_record(uuid, jsonb),
    public.stock_count_confirm(uuid, uuid),
    public.expense_create(text, numeric, text, text, uuid),
    public.expense_void(uuid, text, uuid),
    public.other_income_create(text, numeric, text, text),
    public.other_income_void(uuid, text, uuid),
    public.appointment_save(uuid, jsonb),
    public.appointment_reschedule(uuid, timestamptz, timestamptz, text),
    public.appointment_set_status(uuid, text, text),
    public.notification_mark(uuid, text),
    public.document_reference_log(text, text, uuid, text, text, text, integer, text),
    public.reconcile_stock_balances(),
    public.reconcile_bill(uuid)
TO authenticated;

-- System jobs / bootstrap: service_role (SQL editor, cron) only.
GRANT EXECUTE ON FUNCTION
    public.bootstrap_owner(text),
    public.reservations_expire(),
    public.rental_overdue_scan(),
    public.reconcile_stock_balances(),
    public.reconcile_bill(uuid)
TO service_role;

-- The notice scan also runs from an OWNER session until a scheduled job exists
-- (the function itself refuses every non-OWNER signed-in user).
GRANT EXECUTE ON FUNCTION public.rental_overdue_scan() TO authenticated;

-- Internal helpers (prefixed "_") and trigger functions are granted to nobody.

-- ============================================================================
-- 28. REALTIME (only where Supabase's publication exists)
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.bills, public.bill_lines, public.notifications,
            public.stock_balances;
    END IF;
END $$;

-- ============================================================================
-- 29. SEED — configuration only (no business data, no demo data)
-- ============================================================================

-- Menus = the app's sidebar (components/Sidebar.tsx). Which menus are owner-only is a
-- shop policy (Master §37 item 9): only member/permission management is fixed here.
INSERT INTO public.menu_catalog (code, label_th, owner_only, sort_order) VALUES
    ('dashboard',    'แดชบอร์ด',               false, 10),
    ('reports',      'รายงานสรุป',              false, 20),
    ('appointments', 'ปฏิทินนัดหมาย',           false, 30),
    ('pos',          'หน้าร้าน POS',            false, 40),
    ('bills',        'จัดการบิลเช่า',            false, 50),
    ('documents',    'จัดการเอกสาร',            false, 60),
    ('customers',    'ข้อมูลลูกค้า',             false, 70),
    ('products',     'สินค้า/สต็อก',            false, 80),
    ('quotations',   'ใบเสนอราคา',             false, 90),
    ('finance',      'การเงิน',                false, 100),
    ('settings',     'ตั้งค่าระบบ',              false, 110),
    ('members',      'จัดการสิทธิ์ & รายงาน',     true,  120);

-- Owner decisions 2026-10-04: PIN waits like iOS (miss 10 blocks), auto-lock options with
-- default 5 min and "never" (0). No VAT rate/mode or discount limit is preset; notices follow
-- the app's notification panel defaults (on, 1 day before) and are changed in Settings.
INSERT INTO public.store_settings (company_name, timezone, vat_enabled, vat_rate, vat_mode, doc_number_formats, policies)
VALUES (NULL, 'Asia/Bangkok', false, NULL, NULL, '{}'::jsonb,
        jsonb_build_object(
            'allow_backorder', false,
            'allow_overpayment', false,
            'discount_limit_enabled', false,          -- switch off = no percent limit
            'discount_limit_percent', NULL,           -- owner's own percent when the switch is on
            'pin_fail_delays_seconds', jsonb_build_array(0, 0, 0, 60, 300, 900, 3600, 10800, 28800),
            'auto_lock_options_seconds', jsonb_build_array(30, 60, 120, 180, 240, 300, 600, 0),  -- 0 = never
            'auto_lock_default_seconds', 300,
            -- in-app notices, same switches and defaults as the app's notification panel
            'notifications', jsonb_build_object(
                'deliveryReminder', jsonb_build_object('enabled', true, 'daysBefore', 1),
                'returnReminder', jsonb_build_object('enabled', true, 'daysBefore', 1),
                'paymentReminder', jsonb_build_object('enabled', true, 'daysBefore', 1),
                'lowStockReminder', jsonb_build_object('enabled', true),
                'overdueReturnReminder', jsonb_build_object('enabled', true)),
            'reservation_auto_release', false));      -- manual release until the owner sets a policy

-- ============================================================================
-- Customer document files (Master §6): ID card / house registration images live in a
-- PRIVATE Storage bucket; the database keeps only the path (customer_documents.storage_path).
-- Members with the customers or documents menu may upload and view; nobody may overwrite or
-- delete a file (a wrong file is replaced by a new document row, the old one set INACTIVE).
-- Skipped where the Storage schema does not exist (plain Postgres test container).
-- ============================================================================
DO $storage$
BEGIN
    IF to_regclass('storage.buckets') IS NULL THEN
        RAISE NOTICE 'storage schema not present: customer-documents bucket skipped';
        RETURN;
    END IF;
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('customer-documents', 'customer-documents', false, 5242880,
            ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    ON CONFLICT (id) DO NOTHING;

    EXECUTE $p$
        CREATE POLICY customer_documents_files_read ON storage.objects
            FOR SELECT TO authenticated
            USING (bucket_id = 'customer-documents'
                   AND (public.has_menu('customers') OR public.has_menu('documents')))
    $p$;
    EXECUTE $p$
        CREATE POLICY customer_documents_files_insert ON storage.objects
            FOR INSERT TO authenticated
            WITH CHECK (bucket_id = 'customer-documents'
                        AND (public.has_menu('customers') OR public.has_menu('documents'))
                        AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$')
    $p$;
END
$storage$;

-- ============================================================================
-- After apply (manual, by a person with service_role — never by the app):
--   1. The first owner signs up normally (arrives as PENDING).
--   2. SELECT public.bootstrap_owner('<username>');  (skip if an OWNER already exists)
--   3. That OWNER approves members, grants menus and each user sets their own PIN.
-- Real products (43 items) are loaded with supabase/seed/products_43.sql after review,
-- never as part of this schema file.

-- ============================================================================
-- 30. SHARED CUSTOM DOCUMENT TEMPLATES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.document_templates (
    id                text PRIMARY KEY,
    name              text NOT NULL,
    category          text NOT NULL,
    source            text NOT NULL,
    file_type         text NOT NULL,
    file_name         text,
    template_schema   text NOT NULL,
    paper_size        text NOT NULL DEFAULT 'A4',
    orientation       text NOT NULL DEFAULT 'PORTRAIT',
    page_count        integer NOT NULL DEFAULT 1,
    version           integer NOT NULL DEFAULT 1,
    is_default        boolean NOT NULL DEFAULT false,
    description       text,
    default_terms     text,
    status            text NOT NULL DEFAULT 'ACTIVE',
    status_reason     text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    updated_by        uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT document_templates_id_check CHECK (id ~ '^tpl-[A-Za-z0-9-]{1,80}$'),
    CONSTRAINT document_templates_name_check CHECK (btrim(name) <> '' AND length(name) <= 160),
    CONSTRAINT document_templates_category_check CHECK (btrim(category) <> '' AND length(category) <= 100),
    CONSTRAINT document_templates_source_check CHECK (source IN ('BUILTIN', 'CONVERTED_IMPORT')),
    CONSTRAINT document_templates_file_type_check CHECK (btrim(file_type) <> '' AND length(file_type) <= 20),
    CONSTRAINT document_templates_file_name_check CHECK (file_name IS NULL OR length(file_name) <= 255),
    CONSTRAINT document_templates_schema_check CHECK (btrim(template_schema) <> '' AND octet_length(template_schema) <= 1048576),
    CONSTRAINT document_templates_paper_size_check CHECK (paper_size = 'A4'),
    CONSTRAINT document_templates_orientation_check CHECK (orientation IN ('PORTRAIT', 'LANDSCAPE')),
    CONSTRAINT document_templates_page_count_check CHECK (page_count BETWEEN 1 AND 100),
    CONSTRAINT document_templates_version_check CHECK (version >= 1),
    CONSTRAINT document_templates_description_check CHECK (description IS NULL OR length(description) <= 1000),
    CONSTRAINT document_templates_default_terms_check CHECK (default_terms IS NULL OR length(default_terms) <= 10000),
    CONSTRAINT document_templates_status_check CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT document_templates_inactive_check CHECK (status = 'ACTIVE' OR status_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS document_templates_status_created_idx
    ON public.document_templates (status, created_at DESC);

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_templates_select ON public.document_templates;
CREATE POLICY document_templates_select ON public.document_templates
    FOR SELECT TO authenticated
    USING (status = 'ACTIVE' AND (SELECT public.has_menu('documents')));
REVOKE ALL ON public.document_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_templates TO authenticated;
GRANT ALL ON public.document_templates TO service_role;

CREATE OR REPLACE FUNCTION public.document_template_create(p_template_id text, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_template public.document_templates%ROWTYPE;
    v_inserted boolean := false;
    v_allowed text[] := ARRAY[
        'name', 'category', 'source', 'file_type', 'file_name', 'template_schema',
        'paper_size', 'orientation', 'page_count', 'version', 'is_default',
        'description', 'default_terms'
    ];
BEGIN
    PERFORM public._require_menu('documents');
    IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
        RAISE EXCEPTION 'TEMPLATE_DATA_INVALID' USING ERRCODE = '22023';
    END IF;
    IF p_template_id IS NULL OR p_template_id !~ '^tpl-[A-Za-z0-9-]{1,80}$' THEN
        RAISE EXCEPTION 'TEMPLATE_ID_INVALID' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) AS keys(key) WHERE key <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'TEMPLATE_FIELDS_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(btrim(p_data->>'name'), '') IS NULL OR length(p_data->>'name') > 160
       OR NULLIF(btrim(p_data->>'category'), '') IS NULL OR length(p_data->>'category') > 100
       OR NULLIF(btrim(p_data->>'template_schema'), '') IS NULL
       OR octet_length(p_data->>'template_schema') > 1048576 THEN
        RAISE EXCEPTION 'TEMPLATE_REQUIRED_FIELDS_INVALID' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.document_templates (
        id, name, category, source, file_type, file_name, template_schema, paper_size,
        orientation, page_count, version, is_default, description, default_terms, created_by
    ) VALUES (
        p_template_id, btrim(p_data->>'name'), btrim(p_data->>'category'),
        COALESCE(p_data->>'source', 'BUILTIN'), COALESCE(p_data->>'file_type', 'HTML'),
        NULLIF(p_data->>'file_name', ''), p_data->>'template_schema',
        COALESCE(p_data->>'paper_size', 'A4'), COALESCE(p_data->>'orientation', 'PORTRAIT'),
        COALESCE((p_data->>'page_count')::integer, 1), COALESCE((p_data->>'version')::integer, 1),
        COALESCE((p_data->>'is_default')::boolean, false), NULLIF(p_data->>'description', ''),
        NULLIF(p_data->>'default_terms', ''), auth.uid()
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING * INTO v_template;

    v_inserted := FOUND;
    IF NOT v_inserted THEN
        SELECT * INTO v_template FROM public.document_templates WHERE id = p_template_id;
    END IF;
    IF v_inserted THEN
        PERFORM public._audit(
            'DOCUMENT_TEMPLATE_CREATE', 'DOCUMENT_TEMPLATE', NULL, NULL,
            jsonb_build_object('template_id', v_template.id, 'name', v_template.name, 'category', v_template.category),
            NULL, NULL
        );
    END IF;
    RETURN to_jsonb(v_template);
END;
$$;

CREATE OR REPLACE FUNCTION public.document_template_set_status(p_template_ids text[], p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason text := public._require_reason(p_reason);
    v_template public.document_templates%ROWTYPE;
    v_found_count integer;
    v_updated_count integer := 0;
BEGIN
    PERFORM public._require_menu('documents');
    IF p_template_ids IS NULL OR cardinality(p_template_ids) = 0
       OR array_position(p_template_ids, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'TEMPLATE_IDS_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(DISTINCT id) FROM unnest(p_template_ids) AS ids(id)) <> cardinality(p_template_ids) THEN
        RAISE EXCEPTION 'TEMPLATE_IDS_DUPLICATE' USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_found_count FROM public.document_templates WHERE id = ANY (p_template_ids);
    IF v_found_count <> cardinality(p_template_ids) THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    FOR v_template IN
        SELECT * FROM public.document_templates
        WHERE id = ANY (p_template_ids) AND status = 'ACTIVE'
        FOR UPDATE
    LOOP
        UPDATE public.document_templates
           SET status = 'INACTIVE', status_reason = v_reason, updated_at = now(), updated_by = auth.uid()
         WHERE id = v_template.id;
        PERFORM public._audit(
            'DOCUMENT_TEMPLATE_DEACTIVATE', 'DOCUMENT_TEMPLATE', NULL,
            jsonb_build_object('template_id', v_template.id, 'name', v_template.name, 'status', v_template.status),
            jsonb_build_object('template_id', v_template.id, 'status', 'INACTIVE'),
            v_reason, NULL
        );
        v_updated_count := v_updated_count + 1;
    END LOOP;
    RETURN jsonb_build_object('updated_count', v_updated_count);
END;
$$;

REVOKE ALL ON FUNCTION public.document_template_create(text, jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.document_template_set_status(text[], text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.document_template_create(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.document_template_set_status(text[], text) TO authenticated;
-- ============================================================================
