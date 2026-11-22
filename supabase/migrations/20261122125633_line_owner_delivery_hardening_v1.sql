-- LINE hardening: owner-only account decisions and delivery eligibility. No LINE API calls.
-- The CLI-created migration is ordered after the four existing LINE migrations (their timestamps are ahead of the local clock).

CREATE OR REPLACE FUNCTION public.line_link_code_create_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM public._require_owner();
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
        PERFORM public._require_owner();
        v_profile := p_target::uuid;
        IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_profile AND p.status = 'ACTIVE') THEN
            RAISE EXCEPTION 'MEMBER_NOT_ACTIVE' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.profile_id = v_profile AND x.status = 'LINKED') THEN
            RAISE EXCEPTION 'LINE_MEMBER_ALREADY_LINKED' USING ERRCODE = '22023';
        END IF;
    ELSIF p_kind = 'DRIVER' THEN
        PERFORM public._require_owner();
        v_driver := p_target;
        IF NOT public._line_driver_active(v_driver) THEN
            RAISE EXCEPTION 'DRIVER_NOT_ACTIVE' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.driver_code = v_driver AND x.status = 'LINKED') THEN
            RAISE EXCEPTION 'LINE_DRIVER_ALREADY_LINKED' USING ERRCODE = '22023';
        END IF;
    ELSIF p_kind = 'CUSTOMER' THEN
        PERFORM public._require_owner();
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

CREATE OR REPLACE FUNCTION public.line_contact_review_ok(p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_owner();
    UPDATE public.line_contacts SET needs_review = false, updated_at = now()
     WHERE id = p_contact_id AND status = 'LINKED';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = '22023';
    END IF;
    PERFORM public._audit('LINE_CONTACT_REVIEW_OK', 'LINE_CONTACT', p_contact_id, NULL, NULL,
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('contact_id', p_contact_id, 'needs_review', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.line_contact_register_by_shop(p_contact_id uuid, p_name text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_owner();
    RETURN public._line_register_apply(p_contact_id, p_name, p_phone, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.line_contact_register_need_info(p_contact_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c    public.line_contacts%ROWTYPE;
    v_note text := left(btrim(COALESCE(p_note, '')), 500);
BEGIN
    PERFORM public._require_owner();
    IF v_note = '' THEN
        RAISE EXCEPTION 'LINE_NOTE_REQUIRED' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_c FROM public.line_contacts WHERE id = p_contact_id FOR UPDATE;
    IF NOT FOUND OR v_c.status <> 'UNLINKED' OR v_c.register_status NOT IN ('PENDING', 'NEED_INFO', 'PHONE_TAKEN', 'DUPLICATE') THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_PENDING' USING ERRCODE = '22023';
    END IF;
    UPDATE public.line_contacts SET register_status = 'NEED_INFO', register_note = v_note, updated_at = now() WHERE id = v_c.id;
    PERFORM public._audit_line(auth.uid(), 'LINE_REGISTER_NEED_INFO', 'LINE_CONTACT', v_c.id, jsonb_build_object('note', v_note));
    RETURN jsonb_build_object('contact_id', v_c.id, 'register_status', 'NEED_INFO', 'notify', v_c.followed);
END;
$$;

CREATE OR REPLACE FUNCTION public.line_contact_register_approve(
    p_contact_id  uuid,
    p_customer_id uuid DEFAULT NULL,
    p_name        text DEFAULT NULL,
    p_phone       text DEFAULT NULL,
    p_address     jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c       public.line_contacts%ROWTYPE;
    v_cust    uuid;
    v_name    text;
    v_phone   text;
    v_addr    jsonb;
    v_text    text;
    v_details jsonb;
    v_created boolean := false;
    v_try     integer := 0;
BEGIN
    PERFORM public._require_owner();
    SELECT * INTO v_c FROM public.line_contacts WHERE id = p_contact_id FOR UPDATE;
    IF NOT FOUND OR v_c.status <> 'UNLINKED' OR v_c.register_status NOT IN ('PENDING', 'NEED_INFO', 'PHONE_TAKEN', 'DUPLICATE') THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_PENDING' USING ERRCODE = '22023';
    END IF;

    IF p_customer_id IS NOT NULL THEN
        SELECT c.id, c.name INTO v_cust, v_name FROM public.customers c WHERE c.id = p_customer_id AND c.active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'CUSTOMER_INACTIVE' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.customer_id = v_cust AND x.status = 'LINKED') THEN
            RAISE EXCEPTION 'LINE_CUSTOMER_ALREADY_LINKED' USING ERRCODE = '22023';
        END IF;
    ELSE
        v_name := left(btrim(regexp_replace(COALESCE(NULLIF(btrim(p_name), ''), v_c.typed_name, ''), '\s+', ' ', 'g')), 200);
        v_phone := regexp_replace(COALESCE(NULLIF(btrim(p_phone), ''), v_c.typed_phone, ''), '\D', '', 'g');
        IF v_name = '' OR v_phone !~ '^0[0-9]{9}$' THEN
            RAISE EXCEPTION 'LINE_REGISTER_INVALID' USING ERRCODE = '22023';
        END IF;
        -- a phone the shop already has: link THAT customer instead of making a second one
        IF EXISTS (SELECT 1 FROM public.customers c WHERE c.active AND regexp_replace(c.phone, '\D', '', 'g') = v_phone) THEN
            RAISE EXCEPTION 'LINE_CUSTOMER_PHONE_EXISTS' USING ERRCODE = '22023';
        END IF;
        v_addr := COALESCE(p_address, v_c.register_payload -> 'address', '{}'::jsonb);
        IF jsonb_typeof(v_addr) <> 'object' THEN
            v_addr := '{}'::jsonb;
        END IF;
        v_details := jsonb_strip_nulls(jsonb_build_object(
            'subDistrict', NULLIF(left(btrim(v_addr ->> 'subdistrict'), 100), ''),
            'district',    NULLIF(left(btrim(v_addr ->> 'district'), 100), ''),
            'province',    NULLIF(left(btrim(v_addr ->> 'province'), 100), ''),
            'postalCode',  NULLIF(left(btrim(v_addr ->> 'postcode'), 10), '')));
        v_text := NULLIF(btrim(concat_ws(' ',
            NULLIF(left(btrim(v_addr ->> 'address'), 300), ''),
            CASE WHEN v_details ? 'subDistrict' THEN 'ต.' || (v_details ->> 'subDistrict') END,
            CASE WHEN v_details ? 'district' THEN 'อ.' || (v_details ->> 'district') END,
            CASE WHEN v_details ? 'province' THEN 'จ.' || (v_details ->> 'province') END,
            v_details ->> 'postalCode')), '');
        LOOP
            v_try := v_try + 1;
            BEGIN
                INSERT INTO public.customers (customer_code, name, phone, address, contact_details, created_by)
                VALUES ('CUST-' || lpad((floor(random() * 1000000))::int::text, 6, '0'), v_name, v_phone,
                        COALESCE(v_text, '-'), v_details, auth.uid())
                RETURNING id INTO v_cust;
                EXIT;
            EXCEPTION WHEN unique_violation THEN
                IF v_try >= 5 THEN
                    RAISE EXCEPTION 'LINE_CODE_BUSY: try again' USING ERRCODE = '40001';
                END IF;
            END;
        END LOOP;
        v_created := true;
        PERFORM public._audit_line(auth.uid(), 'CUSTOMER_CREATE', 'CUSTOMER', v_cust,
                                   jsonb_build_object('name', v_name, 'via', 'LINE_APPROVE'));
    END IF;

    BEGIN
        UPDATE public.line_contacts
           SET status = 'LINKED', customer_id = v_cust, profile_id = NULL, driver_code = NULL,
               code_failures = 0, code_locked_until = NULL, linked_at = now(), needs_review = false,
               register_status = NULL, register_customer_id = NULL, register_note = NULL,
               self_registered = false, updated_at = now()
         WHERE id = v_c.id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'LINE_CUSTOMER_ALREADY_LINKED' USING ERRCODE = '22023';
    END;
    PERFORM public._audit_line(auth.uid(), 'LINE_REGISTER_APPROVE', 'LINE_CONTACT', v_c.id,
                               jsonb_build_object('customer_id', v_cust, 'created', v_created, 'channel', v_c.register_payload ->> 'channel'));
    RETURN jsonb_build_object('result', 'LINKED_CUSTOMER', 'contact_id', v_c.id, 'customer_id', v_cust, 'created', v_created,
                              'name', v_name, 'notify',
                              v_c.followed AND COALESCE((public._policy('line', '{}'::jsonb) -> 'register' ->> 'notifyApproved')::boolean, true));
END;
$$;

CREATE OR REPLACE FUNCTION public.line_contact_reject(p_contact_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c      public.line_contacts%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_owner();
    SELECT * INTO v_c FROM public.line_contacts WHERE id = p_contact_id FOR UPDATE;
    IF NOT FOUND OR v_c.status <> 'UNLINKED' THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_PENDING' USING ERRCODE = '22023';
    END IF;
    UPDATE public.line_contacts
       SET register_status = 'REJECTED', register_customer_id = NULL, register_note = left(v_reason, 500), updated_at = now()
     WHERE id = p_contact_id;
    PERFORM public._audit('LINE_CONTACT_REJECT', 'LINE_CONTACT', p_contact_id,
                          jsonb_build_object('register_status', v_c.register_status), jsonb_build_object('register_status', 'REJECTED'),
                          v_reason, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('contact_id', p_contact_id, 'register_status', 'REJECTED',
                              'notify', v_c.followed AND v_c.register_status IN ('PENDING', 'NEED_INFO', 'PHONE_TAKEN', 'DUPLICATE')
                                        AND COALESCE((public._policy('line', '{}'::jsonb) -> 'register' ->> 'notifyRejected')::boolean, true));
END;
$$;



CREATE OR REPLACE FUNCTION public._line_delivery_allowed(c public.line_contacts, p_source text, p_template text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT COALESCE(c.followed AND CASE
        WHEN p_source = 'REGISTER' THEN p_template IN ('REGISTER_WELCOME', 'REGISTER_NEED_INFO', 'REGISTER_APPROVED', 'REGISTER_REJECTED')
        WHEN p_source = 'SHOP_MESSAGE' THEN p_template = 'SHOP_MESSAGE'
        ELSE c.status = 'LINKED' AND NOT c.needs_review AND (
            (c.customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.customers x WHERE x.id = c.customer_id AND x.active)) OR
            (c.profile_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles x WHERE x.id = c.profile_id AND x.status = 'ACTIVE')) OR
            (c.driver_code IS NOT NULL AND public._line_driver_active(c.driver_code)))
    END, false);
$$;
REVOKE ALL ON FUNCTION public._line_delivery_allowed(public.line_contacts, text, text) FROM PUBLIC, anon, authenticated, service_role;

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
       AND NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.id = d.contact_id AND public._line_delivery_allowed(c, d.source_type, d.template_key));
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
       AND public._line_delivery_allowed(c, d.source_type, d.template_key)
    RETURNING d.id, c.line_user_id, d.messages, d.retry_key, d.attempts, d.max_attempts;
END;
$$;

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
    IF v_c.needs_review THEN
        RAISE EXCEPTION 'LINE_CONTACT_NEEDS_REVIEW' USING ERRCODE = '22023';
    END IF;
    IF NOT public._line_delivery_allowed(v_c, p_source_type, p_template_key) THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNREACHABLE' USING ERRCODE = '22023';
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
    IF NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.id = p_contact_id AND public._line_delivery_allowed(c, p_source_type, p_template_key)) THEN
        RETURN jsonb_build_object('skipped', 'CONTACT_NOT_LINKED');
    END IF;
    IF p_notification_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.notifications n WHERE n.id = p_notification_id AND n.status = 'EXPIRED') THEN
        RETURN jsonb_build_object('skipped', 'NOTIFICATION_ENDED');
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, notification_id, template_key, messages, dedupe_key)
    VALUES (p_contact_id, p_source_type, p_source_id, p_notification_id, p_template_key, p_messages, 'S:' || p_dedupe_key)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('delivery_id', v_id, 'duplicate', v_id IS NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.line_outbox_enqueue_server(
    p_contact_id    uuid,
    p_source_type   text,
    p_source_id     uuid,
    p_task_id       uuid,
    p_template_key  text,
    p_messages      jsonb,
    p_dedupe_key    text
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
    IF p_source_type NOT IN ('BILL', 'APPOINTMENT', 'TASK') THEN
        RAISE EXCEPTION 'LINE_SOURCE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT public._line_messages_valid(p_messages) THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.id = p_contact_id AND public._line_delivery_allowed(c, p_source_type, p_template_key)) THEN
        RETURN jsonb_build_object('skipped', 'CONTACT_NOT_LINKED');
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, task_id, template_key, messages, dedupe_key)
    VALUES (p_contact_id, p_source_type, p_source_id, p_task_id, p_template_key, p_messages, 'X:' || p_dedupe_key)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('delivery_id', v_id, 'duplicate', v_id IS NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.line_outbox_enqueue_register(p_contact_id uuid, p_template_key text, p_messages jsonb, p_dedupe_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    PERFORM public._line_require_server();
    IF p_template_key NOT IN ('REGISTER_WELCOME', 'REGISTER_NEED_INFO', 'REGISTER_APPROVED', 'REGISTER_REJECTED')
       OR NOT public._line_messages_valid(p_messages)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_messages) m WHERE m ->> 'type' <> 'text') THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.id = p_contact_id AND public._line_delivery_allowed(c, 'REGISTER', p_template_key)) THEN
        RETURN jsonb_build_object('skipped', 'CONTACT_UNREACHABLE');
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key)
    VALUES (p_contact_id, 'REGISTER', p_contact_id, p_template_key, p_messages, 'R:' || p_dedupe_key)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('delivery_id', v_id, 'duplicate', v_id IS NULL);
END;
$$;

-- Internal bill helpers are called inside privileged business RPCs/triggers, not directly by API roles.
REVOKE ALL ON FUNCTION public._bill_customer_snapshot(uuid, text), public._bill_revising(),
    public._bill_line_take_back(uuid, uuid, uuid), public._bill_line_write(uuid, integer, jsonb, uuid), public._bill_reprice(uuid)
FROM PUBLIC, anon, authenticated, service_role;

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
    PERFORM public._require_owner();
    SELECT * INTO v_c FROM public.line_contacts WHERE id = p_contact_id FOR UPDATE;
    IF NOT FOUND OR v_c.status <> 'LINKED' THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = 'P0002';
    END IF;
    v_reason := public._require_reason(p_reason);
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
    PERFORM public._require_owner();
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
