-- ============================================================================
-- LINE Operations Center v1 (2026-10-08) — LOCAL MIGRATION, NOT APPLIED (local or Cloud).
-- Spec: "LINE Operations Center: UI Specification" (rev 11). LINE is one more delivery
-- channel; public.notifications stays the only event source, public.audit_logs the only
-- audit trail, store_settings.policies.line the only place for LINE options.
--
-- Tables (all RLS on, clients SELECT only, writes through the RPCs below):
--   line_contacts     LINE userId <-> staff (profiles) or customer (customers)
--   line_link_codes   one-time codes that prove identity before a link
--   line_tasks        work orders sent to staff over LINE
--   line_deliveries   OUTBOX: every outbound push, idempotent (dedupe_key), retried
--   line_messages     inbound / outbound chat log, webhook events de-duplicated
--
-- Identity proof before a link:
--   STAFF     the signed-in ACTIVE member creates a code for HIS OWN profile (session proves
--             the account) and types it in the shop OA chat (proves the LINE account).
--             Every staff link raises a notice to that member (a hijacked link is visible),
--             and failed codes are throttled per LINE account and shop-wide.
--   CUSTOMER  1:1 chat with the shop's official account only (group / room events are never
--             read). A member who serves customers issues a single-use code for ONE customer:
--             "LINK-" + 10 random characters (~50 bits, 10 minutes by default), handed over as a
--             QR / link that opens the OA chat with the code typed in. The customer sends it from
--             their own LINE; that LINE userId is bound to that customer. Expired, used or
--             revoked codes are refused, and the member who issued it gets an in-app notice
--             with the LINE display name to check. No phone digits are used as proof.
--
-- Secrets: Channel Secret / Access Token live in Supabase Vault (vault.secrets), written by
-- an OWNER RPC and readable only by service_role (server). Never in a client-readable table.
--
-- Audit actor rule (baseline: "actor always from auth.uid(), never from a parameter"):
-- client RPCs use _audit(). Webhook RPCs run as service_role (auth.uid() NULL); there the
-- actor is resolved INSIDE the function from the verified line_contacts row, never taken
-- from the caller, and written by the private helper _audit_line().
-- ============================================================================

INSERT INTO public.menu_catalog (code, label_th, owner_only, sort_order)
VALUES ('line', 'LINE', false, 105)
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.line_link_codes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose       text NOT NULL,
    profile_id    uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    customer_id   uuid REFERENCES public.customers (id) ON DELETE RESTRICT,
    code_hash     text NOT NULL,                 -- sha256 hex of the 6-digit code; the code itself is never stored
    expires_at    timestamptz NOT NULL,
    used_at       timestamptz,
    revoked_at    timestamptz,
    created_by    uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT line_link_codes_purpose_check CHECK (purpose IN ('STAFF', 'CUSTOMER')),
    CONSTRAINT line_link_codes_target_check CHECK (
        (purpose = 'STAFF' AND profile_id IS NOT NULL AND customer_id IS NULL)
        OR (purpose = 'CUSTOMER' AND customer_id IS NOT NULL AND profile_id IS NULL)),
    CONSTRAINT line_link_codes_hash_check CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT line_link_codes_expiry_check CHECK (expires_at > created_at)
);
-- An open code is unique, so a typed code finds exactly one target.
CREATE UNIQUE INDEX IF NOT EXISTS line_link_codes_open_uidx
    ON public.line_link_codes (code_hash) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS line_link_codes_profile_idx ON public.line_link_codes (profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS line_link_codes_customer_idx ON public.line_link_codes (customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.line_contacts (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    line_user_id          text NOT NULL UNIQUE,
    display_name          text,
    profile_id            uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    customer_id           uuid REFERENCES public.customers (id) ON DELETE RESTRICT,
    status                text NOT NULL DEFAULT 'UNLINKED',
    followed              boolean NOT NULL DEFAULT true,     -- false after unfollow / block
    code_failures         integer NOT NULL DEFAULT 0,
    code_locked_until     timestamptz,
    linked_at             timestamptz,
    unlinked_at           timestamptz,
    unlinked_by           uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    unlink_reason         text,
    last_event_at         timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT line_contacts_user_id_check CHECK (line_user_id ~ '^U[0-9a-f]{32}$'),
    CONSTRAINT line_contacts_status_check CHECK (status IN ('UNLINKED', 'LINKED')),
    CONSTRAINT line_contacts_one_target_check CHECK (NOT (profile_id IS NOT NULL AND customer_id IS NOT NULL)),
    CONSTRAINT line_contacts_linked_check CHECK (
        status <> 'LINKED' OR ((profile_id IS NOT NULL) <> (customer_id IS NOT NULL))),
    CONSTRAINT line_contacts_failures_check CHECK (code_failures >= 0),
    CONSTRAINT line_contacts_name_check CHECK (display_name IS NULL OR length(display_name) <= 200)
);
-- 1 LINE = 1 account, and 1 account = 1 LINE (staff and customer alike).
CREATE UNIQUE INDEX IF NOT EXISTS line_contacts_profile_uidx ON public.line_contacts (profile_id) WHERE status = 'LINKED' AND profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS line_contacts_customer_uidx ON public.line_contacts (customer_id) WHERE status = 'LINKED' AND customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.line_tasks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title           text NOT NULL,
    detail          text,
    assignee_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    bill_id         uuid REFERENCES public.bills (id) ON DELETE RESTRICT,
    appointment_id  uuid REFERENCES public.appointments (id) ON DELETE RESTRICT,
    status          text NOT NULL DEFAULT 'SENT',
    accepted_at     timestamptz,
    done_at         timestamptz,
    cancelled_at    timestamptz,
    cancelled_by    uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    cancel_reason   text,
    created_by      uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT line_tasks_title_check CHECK (btrim(title) <> '' AND length(title) <= 200),
    CONSTRAINT line_tasks_detail_check CHECK (detail IS NULL OR length(detail) <= 2000),
    CONSTRAINT line_tasks_status_check CHECK (status IN ('SENT', 'ACCEPTED', 'DONE', 'CANCELLED')),
    CONSTRAINT line_tasks_accept_check CHECK (status NOT IN ('ACCEPTED', 'DONE') OR accepted_at IS NOT NULL),
    CONSTRAINT line_tasks_done_check CHECK ((status = 'DONE') = (done_at IS NOT NULL)),
    CONSTRAINT line_tasks_cancel_check CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS line_tasks_assignee_idx ON public.line_tasks (assignee_id, status);
CREATE INDEX IF NOT EXISTS line_tasks_bill_idx ON public.line_tasks (bill_id) WHERE bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS line_tasks_appointment_idx ON public.line_tasks (appointment_id) WHERE appointment_id IS NOT NULL;

-- OUTBOX. A row is the one and only record of an outbound push. dedupe_key makes enqueue
-- idempotent; retry_key is sent as X-Line-Retry-Key on every attempt so LINE accepts it once.
CREATE TABLE IF NOT EXISTS public.line_deliveries (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id       uuid NOT NULL REFERENCES public.line_contacts (id) ON DELETE RESTRICT,
    source_type      text NOT NULL,
    source_id        uuid,
    notification_id  uuid REFERENCES public.notifications (id) ON DELETE RESTRICT,
    task_id          uuid REFERENCES public.line_tasks (id) ON DELETE RESTRICT,
    template_key     text NOT NULL,
    messages         jsonb NOT NULL,
    dedupe_key       text NOT NULL UNIQUE,
    retry_key        uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    status           text NOT NULL DEFAULT 'PENDING',
    attempts         integer NOT NULL DEFAULT 0,
    max_attempts     integer NOT NULL DEFAULT 5,
    next_attempt_at  timestamptz NOT NULL DEFAULT now(),
    locked_until     timestamptz,
    last_http_status integer,
    last_error_code  text,
    line_request_id  text,
    requested_by     uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,   -- NULL = system
    sent_at          timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT line_deliveries_source_check CHECK (source_type IN (
        'NOTIFICATION', 'BILL', 'APPOINTMENT', 'TASK', 'TEST', 'DAILY_SUMMARY')),
    CONSTRAINT line_deliveries_status_check CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD', 'CANCELLED')),
    CONSTRAINT line_deliveries_messages_check CHECK (
        jsonb_typeof(messages) = 'array' AND jsonb_array_length(messages) BETWEEN 1 AND 5),
    CONSTRAINT line_deliveries_template_check CHECK (template_key ~ '^[A-Z_]{2,40}$'),
    CONSTRAINT line_deliveries_dedupe_check CHECK (length(dedupe_key) BETWEEN 8 AND 200),
    CONSTRAINT line_deliveries_attempts_check CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 10 AND attempts <= max_attempts),
    CONSTRAINT line_deliveries_sent_check CHECK ((status = 'SENT') = (sent_at IS NOT NULL)),
    CONSTRAINT line_deliveries_notification_check CHECK ((source_type = 'NOTIFICATION') = (notification_id IS NOT NULL)),
    CONSTRAINT line_deliveries_task_check CHECK (source_type <> 'TASK' OR task_id IS NOT NULL)
);
-- F4: one notice reaches one person once.
CREATE UNIQUE INDEX IF NOT EXISTS line_deliveries_notification_uidx
    ON public.line_deliveries (notification_id, contact_id) WHERE notification_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS line_deliveries_due_idx ON public.line_deliveries (next_attempt_at) WHERE status IN ('PENDING', 'FAILED', 'SENDING');
CREATE INDEX IF NOT EXISTS line_deliveries_contact_idx ON public.line_deliveries (contact_id, created_at);
CREATE INDEX IF NOT EXISTS line_deliveries_source_idx ON public.line_deliveries (source_type, source_id);

CREATE TABLE IF NOT EXISTS public.line_messages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id        uuid NOT NULL REFERENCES public.line_contacts (id) ON DELETE RESTRICT,
    direction         text NOT NULL,
    webhook_event_id  text UNIQUE,                 -- LINE webhookEventId: a redelivered event is skipped
    line_message_id   text,                        -- LINE message id (image content is fetched later by id)
    delivery_id       uuid REFERENCES public.line_deliveries (id) ON DELETE RESTRICT,
    message_type      text NOT NULL,
    text              text,
    storage_path      text,
    task_id           uuid REFERENCES public.line_tasks (id) ON DELETE RESTRICT,
    read_at           timestamptz,
    read_by           uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    event_at          timestamptz NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT line_messages_direction_check CHECK (direction IN ('IN', 'OUT')),
    CONSTRAINT line_messages_type_check CHECK (message_type IN ('TEXT', 'IMAGE', 'POSTBACK', 'FOLLOW', 'UNFOLLOW', 'OTHER')),
    CONSTRAINT line_messages_text_check CHECK (text IS NULL OR length(text) <= 5000),
    CONSTRAINT line_messages_in_event_check CHECK (direction = 'OUT' OR webhook_event_id IS NOT NULL),
    CONSTRAINT line_messages_out_check CHECK (direction = 'IN' OR delivery_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS line_messages_contact_idx ON public.line_messages (contact_id, event_at);
CREATE INDEX IF NOT EXISTS line_messages_task_idx ON public.line_messages (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS line_messages_unread_idx ON public.line_messages (event_at) WHERE direction = 'IN' AND read_at IS NULL;

-- ----------------------------------------------------------------------------
-- Private helpers (granted to nobody)
-- ----------------------------------------------------------------------------

-- has_menu() for another user (server-side fan-out). has_menu() itself reads auth.uid().
CREATE OR REPLACE FUNCTION public._member_has_menu(p_user uuid, p_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = p_user AND p.status = 'ACTIVE'
           AND (p.role = 'OWNER'
                OR EXISTS (SELECT 1 FROM public.user_menu_access a
                             JOIN public.menu_catalog m ON m.code = a.menu_code
                            WHERE a.user_id = p.id AND a.menu_code = p_code AND NOT m.owner_only)));
$$;

-- LINE options (policies.line) with safe bounds; nothing here is a secret.
CREATE OR REPLACE FUNCTION public._line_option_int(p_key text, p_default integer, p_min integer, p_max integer)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v jsonb := public._policy('line', '{}'::jsonb) -> p_key;
BEGIN
    IF v IS NULL OR jsonb_typeof(v) <> 'number' THEN
        RETURN p_default;
    END IF;
    RETURN least(greatest((v #>> '{}')::numeric::integer, p_min), p_max);
END;
$$;

-- Audit for webhook-driven events: actor resolved by the CALLING function from a verified
-- line_contacts row (or NULL = system). Never granted, so no client can pick an actor.
CREATE OR REPLACE FUNCTION public._audit_line(
    p_actor        uuid,
    p_action       text,
    p_entity_type  text,
    p_entity_id    uuid,
    p_after        jsonb,
    p_result       text DEFAULT 'SUCCESS'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, after_data, channel, result, correlation_id)
    VALUES (p_actor, p_action, p_entity_type, p_entity_id, p_after, 'LINE', COALESCE(p_result, 'SUCCESS'), gen_random_uuid());
END;
$$;

CREATE OR REPLACE FUNCTION public._line_code_hash(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT encode(extensions.digest(convert_to(p_code, 'UTF8'), 'sha256'), 'hex');
$$;

-- New single-use code for one target (STAFF: 6 digits, CUSTOMER: LINK-xxxxxxxxxx); older open
-- codes of that target are revoked, so only the newest code works.
CREATE OR REPLACE FUNCTION public._line_code_issue(p_purpose text, p_profile uuid, p_customer uuid)
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
    UPDATE public.line_link_codes SET revoked_at = now()
     WHERE used_at IS NULL AND revoked_at IS NULL
       AND ((p_profile IS NOT NULL AND profile_id = p_profile) OR (p_customer IS NOT NULL AND customer_id = p_customer));
    LOOP
        v_try := v_try + 1;
        IF p_purpose = 'CUSTOMER' THEN
            -- 10 characters from a 32-letter alphabet (no 0/O/1/I): 50 random bits.
            SELECT 'LINK-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b.r, i) % 32) + 1, 1), '' ORDER BY i)
              INTO v_code
              FROM (SELECT extensions.gen_random_bytes(10) AS r) b, generate_series(0, 9) AS i;
        ELSE
            v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
        END IF;
        BEGIN
            INSERT INTO public.line_link_codes (purpose, profile_id, customer_id, code_hash, expires_at, created_by)
            VALUES (p_purpose, p_profile, p_customer, public._line_code_hash(v_code), v_exp, auth.uid())
            RETURNING id INTO v_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF v_try >= 5 THEN
                RAISE EXCEPTION 'LINE_CODE_BUSY: try again' USING ERRCODE = '40001';
            END IF;
        END;
    END LOOP;
    RETURN jsonb_build_object('code_id', v_id, 'code', v_code, 'expires_at', v_exp);
END;
$$;

-- Messages the outbox may carry: LINE text, or a buttons template whose actions are
-- postbacks/URIs. Anything else is refused before it is queued.
CREATE OR REPLACE FUNCTION public._line_messages_valid(p_messages jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_m jsonb;
BEGIN
    IF p_messages IS NULL OR jsonb_typeof(p_messages) <> 'array'
       OR jsonb_array_length(p_messages) NOT BETWEEN 1 AND 5 THEN
        RETURN false;
    END IF;
    FOR v_m IN SELECT * FROM jsonb_array_elements(p_messages) LOOP
        IF v_m ->> 'type' = 'text' THEN
            IF jsonb_typeof(v_m -> 'text') IS DISTINCT FROM 'string' OR btrim(v_m ->> 'text') = '' OR length(v_m ->> 'text') > 5000 THEN
                RETURN false;
            END IF;
        ELSIF v_m ->> 'type' = 'template' THEN
            IF jsonb_typeof(v_m -> 'altText') IS DISTINCT FROM 'string' OR length(v_m ->> 'altText') NOT BETWEEN 1 AND 400
               OR (v_m -> 'template' ->> 'type') IS DISTINCT FROM 'buttons'
               OR jsonb_typeof(v_m -> 'template' -> 'actions') IS DISTINCT FROM 'array'
               OR jsonb_array_length(v_m -> 'template' -> 'actions') NOT BETWEEN 1 AND 4 THEN
                RETURN false;
            END IF;
            -- Buttons carry postbacks (task buttons) or https links only; no other action types.
            IF EXISTS (
                SELECT 1 FROM jsonb_array_elements(v_m -> 'template' -> 'actions') a
                 WHERE jsonb_typeof(a -> 'label') IS DISTINCT FROM 'string'
                    OR length(a ->> 'label') NOT BETWEEN 1 AND 20
                    OR NOT ((a ->> 'type' = 'postback' AND jsonb_typeof(a -> 'data') = 'string'
                             AND length(a ->> 'data') BETWEEN 1 AND 300)
                         OR (a ->> 'type' = 'uri' AND jsonb_typeof(a -> 'uri') = 'string'
                             AND a ->> 'uri' ~ '^https://' AND length(a ->> 'uri') <= 1000))) THEN
                RETURN false;
            END IF;
        ELSE
            RETURN false;
        END IF;
    END LOOP;
    RETURN true;
END;
$$;

-- Server-only RPCs: refused for any signed-in user and for an anon / authenticated JWT,
-- even if a grant were ever widened by mistake. A direct DB session (no JWT) counts as server.
CREATE OR REPLACE FUNCTION public._line_require_server()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NOT NULL
       OR COALESCE(NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
                   NULLIF(current_setting('request.jwt.claim.role', true), ''),
                   'service_role') <> 'service_role' THEN
        RAISE EXCEPTION 'FORBIDDEN: server only' USING ERRCODE = '42501';
    END IF;
END;
$$;

-- Placeholders each template may use. Mirrors LINE_TEMPLATES in lib/line/templates.ts
-- (a unit test compares the two). NULL = unknown key.
CREATE OR REPLACE FUNCTION public._line_template_vars(p_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_key
        WHEN 'LINK_SUCCESS'             THEN ARRAY['ชื่อ', 'ชื่อร้าน']
        WHEN 'LINK_INVALID'             THEN ARRAY[]::text[]
        WHEN 'LINK_EXPIRED'             THEN ARRAY[]::text[]
        WHEN 'LINK_LOCKED'              THEN ARRAY[]::text[]
        WHEN 'LINK_TAKEN'               THEN ARRAY[]::text[]
        WHEN 'TEST'                     THEN ARRAY['ชื่อร้าน']
        WHEN 'STAFF_NOTICE'             THEN ARRAY['หัวข้อ', 'รายละเอียด']
        WHEN 'TASK_NEW'                 THEN ARRAY['ผู้สั่ง', 'เรื่อง']
        WHEN 'TASK_ACCEPTED'            THEN ARRAY['เรื่อง']
        WHEN 'TASK_DONE'                THEN ARRAY['เรื่อง']
        WHEN 'TASK_NOT_ALLOWED'         THEN ARRAY[]::text[]
        WHEN 'CUSTOMER_RETURN_REMINDER' THEN ARRAY['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน']
    END;
$$;

-- Server-side validation of store_settings.policies.line (keys, types, ranges, template
-- placeholders). Mirrors validateLinePolicy() in lib/line/policy.ts.
CREATE OR REPLACE FUNCTION public._line_policy_check(p_line jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_ints  jsonb := '{"linkCodeTtlMinutes": [2, 60], "linkMaxFailures": [3, 10],
                       "linkLockMinutes": [5, 1440], "linkGlobalMaxFailures": [10, 200]}';
    v_key   text;
    v_val   jsonb;
    v_sub   text;
    v_subv  jsonb;
    v_vars  text[];
    v_ph    text[];
    v_num   numeric;
BEGIN
    IF p_line IS NULL OR p_line = 'null'::jsonb THEN
        RETURN;
    END IF;
    IF jsonb_typeof(p_line) <> 'object' THEN
        RAISE EXCEPTION 'INVALID_POLICY: line' USING ERRCODE = '22023';
    END IF;
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_line) LOOP
        IF v_ints ? v_key THEN
            IF jsonb_typeof(v_val) <> 'number' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.%', v_key USING ERRCODE = '22023';
            END IF;
            v_num := (v_val #>> '{}')::numeric;
            IF v_num <> trunc(v_num)
               OR v_num NOT BETWEEN (v_ints -> v_key ->> 0)::numeric AND (v_ints -> v_key ->> 1)::numeric THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.%', v_key USING ERRCODE = '22023';
            END IF;
        ELSIF v_key = 'notify' THEN
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.notify' USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                IF v_sub !~ '^[A-Z][A-Z0-9_]{1,59}$' OR jsonb_typeof(v_subv) <> 'boolean' THEN
                    RAISE EXCEPTION 'INVALID_POLICY: line.notify.%', left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
            END LOOP;
        ELSIF v_key = 'templates' THEN
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.templates' USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                v_vars := public._line_template_vars(v_sub);
                IF v_vars IS NULL OR jsonb_typeof(v_subv) <> 'string'
                   OR btrim(v_subv #>> '{}') = '' OR length(v_subv #>> '{}') > 5000 THEN
                    RAISE EXCEPTION 'INVALID_POLICY: line.templates.%', left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
                FOR v_ph IN SELECT regexp_matches(v_subv #>> '{}', '\{([^{}]+)\}', 'g') LOOP
                    IF NOT (v_ph[1] = ANY (v_vars)) THEN
                        RAISE EXCEPTION 'INVALID_POLICY: line.templates.% placeholder', v_sub USING ERRCODE = '22023';
                    END IF;
                END LOOP;
            END LOOP;
        ELSE
            RAISE EXCEPTION 'INVALID_POLICY: line.% unknown', left(v_key, 60) USING ERRCODE = '22023';
        END IF;
    END LOOP;
END;
$$;

-- Runs on every write of store_settings.policies (settings_update and anything else), but only
-- looks at policies.line and only when it changed, so other Settings sections are unaffected.
CREATE OR REPLACE FUNCTION public._trg_store_settings_line_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' OR (NEW.policies -> 'line') IS DISTINCT FROM (OLD.policies -> 'line') THEN
        PERFORM public._line_policy_check(NEW.policies -> 'line');
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_store_settings_line_policy ON public.store_settings;
CREATE TRIGGER trg_store_settings_line_policy
    BEFORE INSERT OR UPDATE OF policies ON public.store_settings
    FOR EACH ROW EXECUTE FUNCTION public._trg_store_settings_line_policy();

-- ----------------------------------------------------------------------------
-- Client RPCs (authenticated)
-- ----------------------------------------------------------------------------

-- STAFF link: only for the caller's own ACTIVE account.
CREATE OR REPLACE FUNCTION public.line_link_code_create_staff()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM public._require_active_member();
    v_out := public._line_code_issue('STAFF', auth.uid(), NULL);
    PERFORM public._audit('LINE_LINK_CODE_CREATE', 'PROFILE', auth.uid(), NULL,
                          jsonb_build_object('purpose', 'STAFF', 'expires_at', v_out ->> 'expires_at'),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN v_out - 'code_id';
END;
$$;

-- CUSTOMER link code: issued by a member who serves customers, for one active customer.
CREATE OR REPLACE FUNCTION public.line_link_code_create_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM public._require_menu('customers', 'bills', 'appointments', 'line');
    IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = p_customer_id AND c.active) THEN
        RAISE EXCEPTION 'CUSTOMER_INACTIVE' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.customer_id = p_customer_id AND x.status = 'LINKED') THEN
        RAISE EXCEPTION 'LINE_CUSTOMER_ALREADY_LINKED' USING ERRCODE = '22023';
    END IF;
    v_out := public._line_code_issue('CUSTOMER', NULL, p_customer_id);
    PERFORM public._audit('LINE_LINK_CODE_CREATE', 'CUSTOMER', p_customer_id, NULL,
                          jsonb_build_object('purpose', 'CUSTOMER', 'expires_at', v_out ->> 'expires_at'),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN v_out - 'code_id';
END;
$$;

-- Unlink: own LINE; OWNER for anyone (reason); a LINE-menu member for customer contacts (reason).
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
    ELSIF public.is_owner() OR (v_c.customer_id IS NOT NULL AND public.has_menu('line')) THEN
        v_reason := public._require_reason(p_reason);
    ELSE
        RAISE EXCEPTION 'FORBIDDEN: cannot unlink another member''s LINE' USING ERRCODE = '42501';
    END IF;
    UPDATE public.line_contacts
       SET status = 'UNLINKED', profile_id = NULL, customer_id = NULL,
           unlinked_at = now(), unlinked_by = auth.uid(), unlink_reason = v_reason, updated_at = now()
     WHERE id = p_contact_id;
    -- Nothing still queued may reach a person who is no longer linked.
    UPDATE public.line_deliveries SET status = 'CANCELLED', last_error_code = 'UNLINKED', updated_at = now()
     WHERE contact_id = p_contact_id AND status IN ('PENDING', 'FAILED');
    PERFORM public._audit('LINE_UNLINK', CASE WHEN v_c.profile_id IS NOT NULL THEN 'PROFILE' ELSE 'CUSTOMER' END,
                          COALESCE(v_c.profile_id, v_c.customer_id),
                          jsonb_build_object('contact_id', v_c.id), jsonb_build_object('status', 'UNLINKED'),
                          v_reason, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('contact_id', p_contact_id, 'status', 'UNLINKED');
END;
$$;

-- Queue one outbound message from a screen (bill, appointment, test to self).
-- p_idempotency_key: one per button press; a repeat returns the first row (no second send).
CREATE OR REPLACE FUNCTION public.line_delivery_enqueue(
    p_contact_id       uuid,
    p_source_type      text,
    p_source_id        uuid,
    p_template_key     text,
    p_messages         jsonb,
    p_idempotency_key  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c      public.line_contacts%ROWTYPE;
    v_key    text;
    v_id     uuid;
    v_status text;
    v_new    boolean := false;
BEGIN
    PERFORM public._require_active_member();
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    -- A screen sends plain text only; buttons / links come from server-built messages.
    IF NOT public._line_messages_valid(p_messages)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_messages) m WHERE m ->> 'type' <> 'text') THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_c FROM public.line_contacts WHERE id = p_contact_id;
    IF NOT FOUND OR v_c.status <> 'LINKED' THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = '22023';
    END IF;
    IF NOT v_c.followed THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNREACHABLE' USING ERRCODE = '22023';
    END IF;

    IF p_source_type = 'BILL' THEN
        PERFORM public._require_menu('bills', 'line');
        -- the recipient must be THIS bill's customer
        IF v_c.customer_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.bills b WHERE b.id = p_source_id AND b.customer_id = v_c.customer_id) THEN
            RAISE EXCEPTION 'LINE_RECIPIENT_MISMATCH' USING ERRCODE = '42501';
        END IF;
    ELSIF p_source_type = 'APPOINTMENT' THEN
        PERFORM public._require_menu('appointments', 'line');
        IF NOT EXISTS (
            SELECT 1 FROM public.appointments a
             WHERE a.id = p_source_id
               AND ((v_c.customer_id IS NOT NULL AND a.customer_id = v_c.customer_id)
                    OR (v_c.profile_id IS NOT NULL AND a.assigned_user_id = v_c.profile_id))) THEN
            RAISE EXCEPTION 'LINE_RECIPIENT_MISMATCH' USING ERRCODE = '42501';
        END IF;
    ELSIF p_source_type = 'TEST' THEN
        IF v_c.profile_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'FORBIDDEN: a test goes to your own LINE only' USING ERRCODE = '42501';
        END IF;
    ELSE
        RAISE EXCEPTION 'FORBIDDEN: source % is queued by the server only', p_source_type USING ERRCODE = '42501';
    END IF;

    v_key := 'U:' || auth.uid() || ':' || p_idempotency_key;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key, requested_by)
    VALUES (p_contact_id, p_source_type, p_source_id, p_template_key, p_messages, v_key, auth.uid())
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id, status INTO v_id, v_status;
    IF v_id IS NULL THEN
        SELECT id, status INTO v_id, v_status FROM public.line_deliveries WHERE dedupe_key = v_key;
    ELSE
        v_new := true;
        PERFORM public._audit('LINE_SEND', p_source_type, p_source_id, NULL,
                              jsonb_build_object('delivery_id', v_id, 'contact_id', p_contact_id, 'template', p_template_key),
                              NULL, NULL, false, NULL, NULL, 'LINE');
    END IF;
    RETURN jsonb_build_object('delivery_id', v_id, 'status', v_status, 'duplicate', NOT v_new);
END;
$$;

-- Bill screen: can this bill's customer be reached on LINE? Never returns the LINE userId.
-- state: LINKED / NOT_LINKED / UNREACHABLE (blocked the OA) / NO_CUSTOMER.
CREATE OR REPLACE FUNCTION public.line_bill_recipient(p_bill_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_customer uuid;
    v_c        public.line_contacts%ROWTYPE;
BEGIN
    PERFORM public._require_menu('bills', 'line');
    SELECT b.customer_id INTO v_customer FROM public.bills b WHERE b.id = p_bill_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_customer IS NULL THEN
        RETURN jsonb_build_object('state', 'NO_CUSTOMER');
    END IF;
    SELECT * INTO v_c FROM public.line_contacts c WHERE c.customer_id = v_customer AND c.status = 'LINKED';
    RETURN jsonb_build_object(
        'state', CASE WHEN v_c.id IS NULL THEN 'NOT_LINKED' WHEN NOT v_c.followed THEN 'UNREACHABLE' ELSE 'LINKED' END,
        'customer_id', v_customer,
        'display_name', v_c.display_name);
END;
$$;

-- Send a bill message to the bill's own customer over LINE (outbox). The text is the bill
-- screen's message built from the stored bill (no money is computed here). The recipient is
-- resolved from the bill, so a screen cannot point a bill at someone else's LINE.
CREATE OR REPLACE FUNCTION public.line_bill_send(p_bill_id uuid, p_text text, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_customer uuid;
    v_contact  uuid;
BEGIN
    PERFORM public._require_menu('bills', 'line');
    SELECT b.customer_id INTO v_customer FROM public.bills b WHERE b.id = p_bill_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    SELECT c.id INTO v_contact FROM public.line_contacts c WHERE c.customer_id = v_customer AND c.status = 'LINKED';
    IF v_customer IS NULL OR v_contact IS NULL THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = '22023';
    END IF;
    -- Same checks as any screen send: text only, reachable, recipient = this bill's customer.
    RETURN public.line_delivery_enqueue(v_contact, 'BILL', p_bill_id, 'BILL_MESSAGE',
                                        jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)),
                                        p_idempotency_key);
END;
$$;

-- Work order to a staff member (OWNER only, spec Permissions table). The caller supplies a
-- fresh task id so the LINE buttons (postback data) can carry it; it must be unused and
-- appear in the messages.
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
    PERFORM public._require_owner();
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
    PERFORM public._require_owner();
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

-- Attach a staff report (inbound message) to a task, or mark it read.
CREATE OR REPLACE FUNCTION public.line_message_mark(p_message_id uuid, p_task_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_m public.line_messages%ROWTYPE;
BEGIN
    PERFORM public._require_menu('line');
    SELECT * INTO v_m FROM public.line_messages WHERE id = p_message_id AND direction = 'IN' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_MESSAGE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF p_task_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.line_tasks t JOIN public.line_contacts c ON c.profile_id = t.assignee_id
         WHERE t.id = p_task_id AND c.id = v_m.contact_id) THEN
        RAISE EXCEPTION 'LINE_TASK_NOT_OF_SENDER' USING ERRCODE = '22023';
    END IF;
    UPDATE public.line_messages
       SET read_at = COALESCE(read_at, now()), read_by = COALESCE(read_by, auth.uid()),
           task_id = COALESCE(p_task_id, task_id)
     WHERE id = p_message_id;
    RETURN jsonb_build_object('message_id', p_message_id, 'task_id', COALESCE(p_task_id, v_m.task_id));
END;
$$;

-- OA credentials into Vault (OWNER). Set = create, change = update in place (same id), a NULL
-- argument keeps that value. Values are never returned, never audited, never in an error.
CREATE OR REPLACE FUNCTION public.line_channel_set(p_channel_secret text, p_access_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    PERFORM public._require_owner();
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
    PERFORM public._require_owner();
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

-- Configured or not; never the values (and nothing is decrypted to answer it).
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
    PERFORM public._require_owner();
    IF to_regnamespace('vault') IS NOT NULL THEN
        SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'line_channel_secret'),
               EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'line_channel_access_token')
          INTO v_secret, v_token;
    END IF;
    RETURN jsonb_build_object('vault', to_regnamespace('vault') IS NOT NULL,
                              'secret_configured', v_secret, 'token_configured', v_token);
END;
$$;

-- ----------------------------------------------------------------------------
-- Server RPCs (service_role only — webhook route, outbox worker)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.line_channel_credentials()
RETURNS TABLE (channel_secret text, access_token text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    PERFORM public._line_require_server();
    IF to_regnamespace('vault') IS NULL THEN
        RETURN QUERY SELECT NULL::text, NULL::text;
        RETURN;
    END IF;
    RETURN QUERY
    SELECT NULLIF(max(decrypted_secret) FILTER (WHERE name = 'line_channel_secret'), ''),
           NULLIF(max(decrypted_secret) FILTER (WHERE name = 'line_channel_access_token'), '')
      FROM vault.decrypted_secrets
     WHERE name IN ('line_channel_secret', 'line_channel_access_token');
END;
$$;

-- One webhook event in. Idempotent on webhookEventId: a redelivery returns duplicate=true
-- and changes nothing. Creates the contact row on first sight (UNLINKED).
CREATE OR REPLACE FUNCTION public.line_webhook_event(
    p_event_id       text,
    p_line_user_id   text,
    p_kind           text,        -- TEXT / IMAGE / POSTBACK / FOLLOW / UNFOLLOW / OTHER
    p_text           text,
    p_line_message_id text,
    p_event_at       timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c   public.line_contacts%ROWTYPE;
    v_msg uuid;
BEGIN
    PERFORM public._line_require_server();
    IF p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'LINE_EVENT_ID_INVALID' USING ERRCODE = '22023';
    END IF;
    IF p_kind NOT IN ('TEXT', 'IMAGE', 'POSTBACK', 'FOLLOW', 'UNFOLLOW', 'OTHER') THEN
        RAISE EXCEPTION 'LINE_EVENT_KIND_INVALID' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.line_messages WHERE webhook_event_id = p_event_id) THEN
        RETURN jsonb_build_object('duplicate', true);
    END IF;
    INSERT INTO public.line_contacts (line_user_id, followed, last_event_at)
    VALUES (p_line_user_id, p_kind <> 'UNFOLLOW', p_event_at)
    ON CONFLICT (line_user_id) DO UPDATE
       SET followed = CASE WHEN p_kind = 'UNFOLLOW' THEN false
                           WHEN p_kind = 'FOLLOW' THEN true
                           ELSE public.line_contacts.followed END,
           last_event_at = greatest(public.line_contacts.last_event_at, p_event_at),
           updated_at = now()
    RETURNING * INTO v_c;
    INSERT INTO public.line_messages (contact_id, direction, webhook_event_id, line_message_id, message_type, text, event_at)
    VALUES (v_c.id, 'IN', p_event_id, p_line_message_id, p_kind, left(p_text, 5000), p_event_at)
    ON CONFLICT (webhook_event_id) DO NOTHING
    RETURNING id INTO v_msg;
    IF v_msg IS NULL THEN
        RETURN jsonb_build_object('duplicate', true);
    END IF;
    IF p_kind = 'UNFOLLOW' THEN
        UPDATE public.line_deliveries SET status = 'CANCELLED', last_error_code = 'UNFOLLOWED', updated_at = now()
         WHERE contact_id = v_c.id AND status IN ('PENDING', 'FAILED');
    END IF;
    RETURN jsonb_build_object('duplicate', false, 'contact_id', v_c.id, 'message_id', v_msg,
                              'status', v_c.status, 'is_staff', v_c.profile_id IS NOT NULL);
END;
$$;

-- A link code sent in the 1:1 OA chat (the webhook never passes group / room events).
-- STAFF codes are 6 digits, CUSTOMER codes LINK-xxxxxxxxxx; a code only links its own kind.
-- Results: LINKED_STAFF, LINKED_CUSTOMER, INVALID, EXPIRED, LOCKED, ALREADY_LINKED, TARGET_TAKEN.
-- Brute force: max failures per LINE account and shop-wide, from policies.line.
CREATE OR REPLACE FUNCTION public.line_link_code_consume(p_line_user_id text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c     public.line_contacts%ROWTYPE;
    v_k     public.line_link_codes%ROWTYPE;
    v_max   integer := public._line_option_int('linkMaxFailures', 5, 3, 10);
    v_lock  integer := public._line_option_int('linkLockMinutes', 15, 5, 1440);
    v_glob  integer := public._line_option_int('linkGlobalMaxFailures', 30, 10, 200);
    v_name  text;
    v_found boolean;
BEGIN
    PERFORM public._line_require_server();
    SELECT * INTO v_c FROM public.line_contacts WHERE line_user_id = p_line_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002';
    END IF;
    IF v_c.code_locked_until IS NOT NULL AND v_c.code_locked_until > now() THEN
        RETURN jsonb_build_object('result', 'LOCKED', 'until', v_c.code_locked_until);
    END IF;
    IF v_c.status = 'LINKED' THEN
        RETURN jsonb_build_object('result', 'ALREADY_LINKED');
    END IF;
    IF p_code IS NULL OR p_code !~ '^([0-9]{6}|LINK-[A-HJ-NP-Z2-9]{10})$' THEN
        RETURN jsonb_build_object('result', 'INVALID');
    END IF;
    -- Shop-wide throttle: many LINE accounts guessing codes together stop here, so the
    -- 10^6 staff code space cannot be swept inside a code's lifetime.
    IF (SELECT count(*) FROM public.audit_logs a
         WHERE a.created_at > now() - make_interval(mins => v_lock)
           AND a.action = 'LINE_LINK_ATTEMPT' AND a.result = 'FAILED') >= v_glob THEN
        RETURN jsonb_build_object('result', 'LOCKED');
    END IF;
    SELECT * INTO v_k FROM public.line_link_codes
     WHERE code_hash = public._line_code_hash(p_code) AND used_at IS NULL AND revoked_at IS NULL
     FOR UPDATE;
    v_found := FOUND AND v_k.purpose = CASE WHEN p_code LIKE 'LINK-%' THEN 'CUSTOMER' ELSE 'STAFF' END;
    IF NOT v_found OR v_k.expires_at <= now() THEN
        UPDATE public.line_contacts
           SET code_failures = code_failures + 1,
               code_locked_until = CASE WHEN code_failures + 1 >= v_max THEN now() + make_interval(mins => v_lock) END,
               updated_at = now()
         WHERE id = v_c.id;
        PERFORM public._audit_line(NULL, 'LINE_LINK_ATTEMPT', 'LINE_CONTACT', v_c.id,
                                   jsonb_build_object('reason', CASE WHEN v_found THEN 'EXPIRED' ELSE 'NO_MATCH' END), 'FAILED');
        RETURN jsonb_build_object('result', CASE WHEN v_c.code_failures + 1 >= v_max THEN 'LOCKED'
                                                 WHEN v_found THEN 'EXPIRED' ELSE 'INVALID' END);
    END IF;

    IF v_k.purpose = 'STAFF' THEN
        IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_k.profile_id AND p.status = 'ACTIVE') THEN
            RETURN jsonb_build_object('result', 'INVALID');
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.profile_id = v_k.profile_id AND x.status = 'LINKED') THEN
            RETURN jsonb_build_object('result', 'TARGET_TAKEN');
        END IF;
        UPDATE public.line_link_codes SET used_at = now() WHERE id = v_k.id;
        UPDATE public.line_contacts
           SET status = 'LINKED', profile_id = v_k.profile_id, customer_id = NULL,
               code_failures = 0, code_locked_until = NULL, linked_at = now(), updated_at = now()
         WHERE id = v_c.id;
        SELECT COALESCE(NULLIF(p.display_name, ''), p.username) INTO v_name FROM public.profiles p WHERE p.id = v_k.profile_id;
        PERFORM public._audit_line(v_k.profile_id, 'LINE_LINK', 'PROFILE', v_k.profile_id,
                                   jsonb_build_object('contact_id', v_c.id));
        -- The member sees every new link in the app, so a link they did not make is noticed.
        PERFORM public._notify('LINE_LINKED:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                               'LINE_LINKED', 'WARNING', v_k.profile_id, NULL, 'PROFILE', v_k.profile_id,
                               'ผูก LINE กับบัญชีของคุณแล้ว',
                               'LINE ' || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ')
                               || ' ถูกผูกกับบัญชีนี้ ถ้าไม่ได้ทำเอง ให้ยกเลิกการผูกทันทีและแจ้งเจ้าของร้าน');
        RETURN jsonb_build_object('result', 'LINKED_STAFF', 'name', v_name);
    END IF;

    -- CUSTOMER: the code itself is the proof. It was issued for this one customer by a member
    -- who serves customers, handed over in person (QR / link), is single use and short-lived.
    IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_k.customer_id AND c.active) THEN
        RETURN jsonb_build_object('result', 'INVALID');
    END IF;
    IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.customer_id = v_k.customer_id AND x.status = 'LINKED') THEN
        RETURN jsonb_build_object('result', 'TARGET_TAKEN');
    END IF;
    UPDATE public.line_link_codes SET used_at = now() WHERE id = v_k.id;
    UPDATE public.line_contacts
       SET status = 'LINKED', customer_id = v_k.customer_id, profile_id = NULL,
           code_failures = 0, code_locked_until = NULL, linked_at = now(), updated_at = now()
     WHERE id = v_c.id;
    SELECT c.name INTO v_name FROM public.customers c WHERE c.id = v_k.customer_id;
    PERFORM public._audit_line(v_k.created_by, 'LINE_LINK', 'CUSTOMER', v_k.customer_id,
                               jsonb_build_object('contact_id', v_c.id, 'code_created_by', v_k.created_by));
    -- The member who handed out the code sees which LINE took it.
    PERFORM public._notify('LINE_LINKED:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                           'LINE_LINKED', 'INFO', v_k.created_by, NULL, 'CUSTOMER', v_k.customer_id,
                           'ลูกค้าผูก LINE แล้ว',
                           'ลูกค้า ' || COALESCE(v_name, '-') || ' ผูกกับ LINE '
                           || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ')
                           || ' ถ้าไม่ใช่ลูกค้าคนนี้ ให้ยกเลิกการผูกที่หน้า LINE');
    RETURN jsonb_build_object('result', 'LINKED_CUSTOMER', 'name', v_name);
END;
$$;

-- Postback from a task message: only the assignee's own linked LINE moves the task.
-- Results: ACCEPTED, DONE, ALREADY, NOT_ASSIGNEE, INVALID_STATE, NOT_FOUND.
CREATE OR REPLACE FUNCTION public.line_task_postback(p_line_user_id text, p_task_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_t      public.line_tasks%ROWTYPE;
    v_actor  uuid;
BEGIN
    PERFORM public._line_require_server();
    IF p_action NOT IN ('ACCEPT', 'DONE') THEN
        RETURN jsonb_build_object('result', 'INVALID_STATE');
    END IF;
    SELECT c.profile_id INTO v_actor
      FROM public.line_contacts c JOIN public.profiles p ON p.id = c.profile_id
     WHERE c.line_user_id = p_line_user_id AND c.status = 'LINKED' AND p.status = 'ACTIVE';
    SELECT * INTO v_t FROM public.line_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    IF v_actor IS NULL OR v_t.assignee_id <> v_actor THEN
        PERFORM public._audit_line(NULL, 'LINE_TASK_POSTBACK', 'LINE_TASK', p_task_id,
                                   jsonb_build_object('reason', 'NOT_ASSIGNEE'), 'FAILED');
        RETURN jsonb_build_object('result', 'NOT_ASSIGNEE');
    END IF;
    IF (p_action = 'ACCEPT' AND v_t.status IN ('ACCEPTED', 'DONE')) OR (p_action = 'DONE' AND v_t.status = 'DONE') THEN
        RETURN jsonb_build_object('result', 'ALREADY', 'status', v_t.status);
    END IF;
    IF v_t.status = 'CANCELLED' THEN
        RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
    END IF;
    UPDATE public.line_tasks
       SET status = CASE WHEN p_action = 'ACCEPT' THEN 'ACCEPTED' ELSE 'DONE' END,
           accepted_at = COALESCE(accepted_at, now()),
           done_at = CASE WHEN p_action = 'DONE' THEN now() ELSE done_at END,
           updated_at = now()
     WHERE id = p_task_id;
    PERFORM public._audit_line(v_actor, CASE WHEN p_action = 'ACCEPT' THEN 'LINE_TASK_ACCEPT' ELSE 'LINE_TASK_DONE' END,
                               'LINE_TASK', p_task_id, jsonb_build_object('from', v_t.status));
    RETURN jsonb_build_object('result', CASE WHEN p_action = 'ACCEPT' THEN 'ACCEPTED' ELSE 'DONE' END);
END;
$$;

-- Notice -> LINE fan-out (server). Only types switched on in policies.line.notify (default
-- OFF, spec), only ACTIVE members who can see the notice (recipient or recipient_menu holder),
-- only LINKED + followed contacts. The rendered text comes from the server templates.
CREATE OR REPLACE FUNCTION public.line_notification_recipients(p_notification_id uuid)
RETURNS TABLE (contact_id uuid, profile_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_n public.notifications%ROWTYPE;
BEGIN
    PERFORM public._line_require_server();
    SELECT * INTO v_n FROM public.notifications WHERE id = p_notification_id;
    IF NOT FOUND OR COALESCE((public._policy('line', '{}'::jsonb) -> 'notify' ->> v_n.event_type)::boolean, false) IS NOT TRUE THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT c.id, c.profile_id
      FROM public.line_contacts c
     WHERE c.status = 'LINKED' AND c.followed AND c.profile_id IS NOT NULL
       AND (c.profile_id = v_n.recipient_user_id
            OR (v_n.recipient_menu IS NOT NULL AND public._member_has_menu(c.profile_id, v_n.recipient_menu)))
       AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.profile_id AND p.status = 'ACTIVE');
END;
$$;

CREATE OR REPLACE FUNCTION public.line_outbox_enqueue_system(
    p_contact_id       uuid,
    p_source_type      text,
    p_source_id        uuid,
    p_notification_id  uuid,
    p_template_key     text,
    p_messages         jsonb,
    p_dedupe_key       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    PERFORM public._line_require_server();
    IF p_source_type NOT IN ('NOTIFICATION', 'DAILY_SUMMARY') THEN
        RAISE EXCEPTION 'LINE_SOURCE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT public._line_messages_valid(p_messages) THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.id = p_contact_id AND c.status = 'LINKED' AND c.followed) THEN
        RETURN jsonb_build_object('skipped', 'CONTACT_NOT_LINKED');
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, notification_id, template_key, messages, dedupe_key)
    VALUES (p_contact_id, p_source_type, p_source_id, p_notification_id, p_template_key, p_messages, 'S:' || p_dedupe_key)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('delivery_id', v_id, 'duplicate', v_id IS NULL);
END;
$$;

-- Worker: lease due rows. SKIP LOCKED lets two workers run without sending a row twice;
-- an expired lease (worker died mid-send) makes the row due again with the SAME retry_key.
CREATE OR REPLACE FUNCTION public.line_outbox_claim(p_limit integer, p_lease_seconds integer)
RETURNS TABLE (id uuid, line_user_id text, messages jsonb, retry_key uuid, attempts integer, max_attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    PERFORM public._line_require_server();
    -- Rows that can never be sent are closed first, so they are not leased again and again.
    UPDATE public.line_deliveries d
       SET status = 'CANCELLED', last_error_code = 'CONTACT_UNREACHABLE', locked_until = NULL, updated_at = now()
     WHERE d.status IN ('PENDING', 'FAILED', 'SENDING')
       AND (d.status <> 'SENDING' OR d.locked_until < now())
       AND NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.id = d.contact_id AND c.status = 'LINKED' AND c.followed);
    UPDATE public.line_deliveries d
       SET status = 'DEAD', last_error_code = COALESCE(d.last_error_code, 'MAX_ATTEMPTS'), locked_until = NULL, updated_at = now()
     WHERE d.status = 'SENDING' AND d.locked_until < now() AND d.attempts >= d.max_attempts;
    RETURN QUERY
    WITH due AS (
        SELECT d.id
          FROM public.line_deliveries d
         WHERE (d.status IN ('PENDING', 'FAILED') AND d.next_attempt_at <= now())
            OR (d.status = 'SENDING' AND d.locked_until < now())
         ORDER BY d.next_attempt_at
         LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100)
         FOR UPDATE SKIP LOCKED
    )
    UPDATE public.line_deliveries d
       SET status = 'SENDING', attempts = d.attempts + 1,
           locked_until = now() + make_interval(secs => least(greatest(COALESCE(p_lease_seconds, 60), 10), 600)),
           updated_at = now()
      FROM due, public.line_contacts c
     WHERE d.id = due.id AND c.id = d.contact_id AND d.attempts < d.max_attempts
       AND c.status = 'LINKED' AND c.followed
    RETURNING d.id, c.line_user_id, d.messages, d.retry_key, d.attempts, d.max_attempts;
END;
$$;

-- Worker: result of one attempt. p_outcome SENT / RETRY / DEAD.
CREATE OR REPLACE FUNCTION public.line_outbox_complete(
    p_id           uuid,
    p_outcome      text,
    p_http_status  integer,
    p_error_code   text,
    p_request_id   text,
    p_retry_at     timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_d public.line_deliveries%ROWTYPE;
BEGIN
    PERFORM public._line_require_server();
    SELECT * INTO v_d FROM public.line_deliveries WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR v_d.status <> 'SENDING' THEN
        RETURN;   -- cancelled or completed meanwhile: keep the stored outcome
    END IF;
    IF p_outcome = 'SENT' THEN
        UPDATE public.line_deliveries
           SET status = 'SENT', sent_at = now(), locked_until = NULL, last_http_status = p_http_status,
               last_error_code = NULL, line_request_id = left(p_request_id, 100), updated_at = now()
         WHERE id = p_id;
        INSERT INTO public.line_messages (contact_id, direction, delivery_id, message_type, text, event_at)
        SELECT v_d.contact_id, 'OUT', v_d.id, 'TEXT', left(v_d.messages -> 0 ->> 'text', 5000), now();
    ELSIF p_outcome = 'RETRY' AND v_d.attempts < v_d.max_attempts THEN
        UPDATE public.line_deliveries
           SET status = 'FAILED', locked_until = NULL, last_http_status = p_http_status,
               last_error_code = left(p_error_code, 60), next_attempt_at = COALESCE(p_retry_at, now() + interval '5 minutes'),
               updated_at = now()
         WHERE id = p_id;
    ELSE
        UPDATE public.line_deliveries
           SET status = 'DEAD', locked_until = NULL, last_http_status = p_http_status,
               last_error_code = left(COALESCE(p_error_code, 'MAX_ATTEMPTS'), 60), updated_at = now()
         WHERE id = p_id;
        PERFORM public._audit_line(NULL, 'LINE_SEND', v_d.source_type, v_d.source_id,
                                   jsonb_build_object('delivery_id', v_d.id, 'http_status', p_http_status,
                                                      'error', left(p_error_code, 60)), 'FAILED');
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- RLS (SELECT only; no client INSERT/UPDATE/DELETE grant anywhere)
-- ----------------------------------------------------------------------------
ALTER TABLE public.line_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_contacts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_messages   ENABLE ROW LEVEL SECURITY;

-- line_link_codes: no policy and no grant — a code is shown once by the RPC that made it.

CREATE POLICY line_contacts_select ON public.line_contacts
    FOR SELECT TO authenticated
    USING ((SELECT public.is_active_member())
           AND (profile_id = (SELECT auth.uid()) OR (SELECT public.is_owner()) OR (SELECT public.has_menu('line'))));

CREATE POLICY line_tasks_select ON public.line_tasks
    FOR SELECT TO authenticated
    USING ((SELECT public.is_active_member())
           AND (assignee_id = (SELECT auth.uid()) OR (SELECT public.is_owner()) OR (SELECT public.has_menu('line'))));

CREATE POLICY line_deliveries_select ON public.line_deliveries
    FOR SELECT TO authenticated
    USING ((SELECT public.is_active_member())
           AND (requested_by = (SELECT auth.uid()) OR (SELECT public.is_owner()) OR (SELECT public.has_menu('line'))));

CREATE POLICY line_messages_select ON public.line_messages
    FOR SELECT TO authenticated
    USING ((SELECT public.is_active_member()) AND ((SELECT public.is_owner()) OR (SELECT public.has_menu('line'))));

REVOKE ALL ON public.line_link_codes, public.line_contacts, public.line_tasks,
              public.line_deliveries, public.line_messages FROM PUBLIC, anon, authenticated;
-- line_user_id stays server-side: the column is not granted to clients.
GRANT SELECT (id, display_name, profile_id, customer_id, status, followed, linked_at, unlinked_at,
              unlinked_by, unlink_reason, last_event_at, created_at, updated_at)
    ON public.line_contacts TO authenticated;
GRANT SELECT ON public.line_tasks, public.line_messages TO authenticated;
GRANT SELECT (id, contact_id, source_type, source_id, notification_id, task_id, template_key, messages, status,
              attempts, max_attempts, next_attempt_at, last_http_status, last_error_code, requested_by, sent_at,
              created_at, updated_at)
    ON public.line_deliveries TO authenticated;

-- ----------------------------------------------------------------------------
-- Function grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
    public._member_has_menu(uuid, text),
    public._line_option_int(text, integer, integer, integer),
    public._audit_line(uuid, text, text, uuid, jsonb, text),
    public._line_code_hash(text),
    public._line_code_issue(text, uuid, uuid),
    public._line_messages_valid(jsonb),
    public._line_require_server(),
    public._line_template_vars(text),
    public._line_policy_check(jsonb),
    public._trg_store_settings_line_policy()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
    public.line_link_code_create_staff(),
    public.line_link_code_create_customer(uuid),
    public.line_contact_unlink(uuid, text),
    public.line_delivery_enqueue(uuid, text, uuid, text, jsonb, text),
    public.line_bill_recipient(uuid),
    public.line_bill_send(uuid, text, text),
    public.line_task_create(uuid, uuid, text, text, uuid, uuid, jsonb, text),
    public.line_task_cancel(uuid, text),
    public.line_message_mark(uuid, uuid),
    public.line_channel_set(text, text),
    public.line_channel_clear(text),
    public.line_channel_status()
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
    public.line_link_code_create_staff(),
    public.line_link_code_create_customer(uuid),
    public.line_contact_unlink(uuid, text),
    public.line_delivery_enqueue(uuid, text, uuid, text, jsonb, text),
    public.line_bill_recipient(uuid),
    public.line_bill_send(uuid, text, text),
    public.line_task_create(uuid, uuid, text, text, uuid, uuid, jsonb, text),
    public.line_task_cancel(uuid, text),
    public.line_message_mark(uuid, uuid),
    public.line_channel_set(text, text),
    public.line_channel_clear(text),
    public.line_channel_status()
TO authenticated;

REVOKE ALL ON FUNCTION
    public.line_channel_credentials(),
    public.line_webhook_event(text, text, text, text, text, timestamptz),
    public.line_link_code_consume(text, text),
    public.line_task_postback(text, uuid, text),
    public.line_notification_recipients(uuid),
    public.line_outbox_enqueue_system(uuid, text, uuid, uuid, text, jsonb, text),
    public.line_outbox_claim(integer, integer),
    public.line_outbox_complete(uuid, text, integer, text, text, timestamptz)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.line_channel_credentials(),
    public.line_webhook_event(text, text, text, text, text, timestamptz),
    public.line_link_code_consume(text, text),
    public.line_task_postback(text, uuid, text),
    public.line_notification_recipients(uuid),
    public.line_outbox_enqueue_system(uuid, text, uuid, uuid, text, jsonb, text),
    public.line_outbox_claim(integer, integer),
    public.line_outbox_complete(uuid, text, integer, text, text, timestamptz)
TO service_role;
