-- LINE-specific restrictions, atomic per-account interaction limits and public catalog versioning.
-- No POS account status, bill, quotation, stock, Cloud or LINE API is changed here.
CREATE TABLE public.line_contact_restrictions (
    contact_id uuid NOT NULL REFERENCES public.line_contacts(id) ON DELETE RESTRICT,
    scope text NOT NULL CHECK (scope IN ('ALL','REGISTER','CATALOG','INQUIRY','WORK','MESSAGES')),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    until_at timestamptz,
    source text NOT NULL CHECK (source IN ('OWNER','ABUSE')),
    revoked_at timestamptz,
    revoked_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    PRIMARY KEY (contact_id, scope)
);
ALTER TABLE public.line_contact_restrictions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.line_contact_restrictions FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE public.line_contact_usage (
    contact_id uuid PRIMARY KEY REFERENCES public.line_contacts(id) ON DELETE RESTRICT,
    window_at timestamptz, requests integer NOT NULL DEFAULT 0,
    inquiry_at timestamptz, inquiries integer NOT NULL DEFAULT 0,
    register_at timestamptz, last_key text, last_at timestamptz,
    strike_at timestamptz, strikes integer NOT NULL DEFAULT 0, notice_at timestamptz
);
ALTER TABLE public.line_contact_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.line_contact_usage FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE public.line_catalog_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision bigint NOT NULL DEFAULT 1
);
INSERT INTO public.line_catalog_state(singleton) VALUES (true);
ALTER TABLE public.line_catalog_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.line_catalog_state FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._line_scope_blocked(p_contact uuid, p_scope text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.line_contact_restrictions r WHERE r.contact_id = p_contact
        AND r.revoked_at IS NULL AND (r.until_at IS NULL OR r.until_at > now())
        AND (r.scope IN ('ALL', p_scope) OR (p_scope = 'INQUIRY' AND r.scope = 'CATALOG')));
$$;
CREATE OR REPLACE FUNCTION public._line_user_blocked(p_line_user_id text, p_scope text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT COALESCE((SELECT public._line_scope_blocked(c.id, p_scope) FROM public.line_contacts c WHERE c.line_user_id = p_line_user_id), false);
$$;
CREATE OR REPLACE FUNCTION public.line_contact_restriction_set(p_contact_id uuid, p_scope text, p_until timestamptz, p_reason text, p_revoke boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_reason text; v_before jsonb;
BEGIN
    PERFORM public._require_owner();
    v_reason := public._require_reason(p_reason);
    IF p_scope IS NULL OR p_scope NOT IN ('ALL','REGISTER','CATALOG','INQUIRY','WORK','MESSAGES') OR length(v_reason) > 500
       OR p_revoke IS NULL OR (NOT p_revoke AND p_until IS NOT NULL AND p_until <= now()) THEN
        RAISE EXCEPTION 'LINE_RESTRICTION_INVALID' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.line_contacts WHERE id = p_contact_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002'; END IF;
    SELECT to_jsonb(r) INTO v_before FROM public.line_contact_restrictions r WHERE contact_id = p_contact_id AND scope = p_scope;
    IF p_revoke THEN
        UPDATE public.line_contact_restrictions SET revoked_at = now(), revoked_by = auth.uid() WHERE contact_id = p_contact_id AND scope = p_scope AND revoked_at IS NULL;
        -- Owner restoration also clears accumulated strikes, so the next ordinary click is not immediately blocked again.
        UPDATE public.line_contact_usage SET strikes = 0, strike_at = NULL, requests = 0, window_at = NULL, last_key = NULL, last_at = NULL,
            inquiries = 0, inquiry_at = NULL, register_at = NULL WHERE contact_id = p_contact_id;
    ELSE
        INSERT INTO public.line_contact_restrictions(contact_id, scope, reason, created_by, until_at, source)
        VALUES (p_contact_id, p_scope, v_reason, auth.uid(), p_until, 'OWNER')
        ON CONFLICT (contact_id, scope) DO UPDATE SET reason = EXCLUDED.reason, created_at = now(), created_by = auth.uid(),
            until_at = EXCLUDED.until_at, source = 'OWNER', revoked_at = NULL, revoked_by = NULL;
    END IF;
    PERFORM public._audit('LINE_RESTRICTION_' || CASE WHEN p_revoke THEN 'REVOKE' ELSE 'SET' END, 'LINE_CONTACT', p_contact_id,
        v_before, jsonb_build_object('scope',p_scope,'until',p_until,'revoked',p_revoke), v_reason, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('contact_id',p_contact_id,'scope',p_scope,'revoked',p_revoke);
END;
$$;
CREATE OR REPLACE FUNCTION public.line_contact_restrictions(p_contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM public._require_owner();
    RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('scope',r.scope,'reason',r.reason,'created_at',r.created_at,
        'created_by',COALESCE(NULLIF(p.display_name,''),p.username,'ระบบ'),'until_at',r.until_at,'source',r.source,'revoked_at',r.revoked_at,
        'active',r.revoked_at IS NULL AND (r.until_at IS NULL OR r.until_at > now())) ORDER BY r.created_at DESC)
        FROM public.line_contact_restrictions r LEFT JOIN public.profiles p ON p.id = r.created_by WHERE r.contact_id = p_contact_id), '[]'::jsonb);
END;
$$;
CREATE OR REPLACE FUNCTION public._line_owner_notice_allowed(p_contact uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_ok boolean;
BEGIN
    INSERT INTO public.line_contact_usage(contact_id,notice_at) VALUES (p_contact,now())
    ON CONFLICT (contact_id) DO UPDATE SET notice_at = now()
    WHERE line_contact_usage.notice_at IS NULL OR line_contact_usage.notice_at <= now() - make_interval(mins => public._line_option_int('ownerNoticeCooldownMinutes',15,1,1440))
    RETURNING true INTO v_ok;
    RETURN COALESCE(v_ok,false);
END;
$$;
CREATE OR REPLACE FUNCTION public.line_interaction_check(p_line_user_id text, p_scope text, p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_c uuid; v_u public.line_contact_usage%ROWTYPE; v_now timestamptz := clock_timestamp();
    v_line jsonb := public._policy('line','{}'::jsonb); v_reason text; v_strikes integer; v_scope text;
    v_max integer := COALESCE((v_line->>'interactionMaxPerMinute')::integer,12);
    v_dup integer := COALESCE((v_line->>'interactionDuplicateSeconds')::integer,3);
    v_inq integer := COALESCE((v_line->>'inquiryMaxPerWindow')::integer,5);
    v_inq_mins integer := COALESCE((v_line->>'inquiryWindowMinutes')::integer,5);
    v_reg integer := COALESCE((v_line->>'registerCooldownMinutes')::integer,5);
    v_strike_max integer := COALESCE((v_line->>'abuseStrikeLimit')::integer,3);
    v_strike_mins integer := COALESCE((v_line->>'abuseWindowMinutes')::integer,10);
    v_suspend integer := COALESCE((v_line->>'abuseSuspendMinutes')::integer,15);
BEGIN
    PERFORM public._line_require_server();
    IF p_scope IS NULL OR p_scope NOT IN ('GENERAL','REGISTER','CATALOG','INQUIRY','WORK') OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'LINE_INTERACTION_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT id INTO v_c FROM public.line_contacts WHERE line_user_id = p_line_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'result','UNKNOWN'); END IF;
    IF public._line_scope_blocked(v_c,p_scope) THEN RETURN jsonb_build_object('allowed',false,'result','SUSPENDED'); END IF;
    INSERT INTO public.line_contact_usage(contact_id) VALUES (v_c) ON CONFLICT DO NOTHING;
    SELECT * INTO v_u FROM public.line_contact_usage WHERE contact_id = v_c FOR UPDATE;
    IF v_u.window_at IS NULL OR v_u.window_at <= v_now - interval '1 minute' THEN v_u.window_at := v_now; v_u.requests := 0; END IF;
    v_u.requests := v_u.requests + 1;
    UPDATE public.line_contact_usage SET window_at = v_u.window_at, requests = v_u.requests WHERE contact_id = v_c;
    IF v_u.requests > v_max THEN v_reason := 'RATE_LIMITED';
    ELSIF v_u.last_key = p_key AND (v_u.last_at > v_now - make_interval(secs => v_dup) OR (p_scope = 'REGISTER' AND p_key LIKE 'register:%' AND v_u.register_at > v_now - make_interval(mins => v_reg))) THEN
        RETURN jsonb_build_object('allowed',false,'result','DUPLICATE');
    END IF;
    IF p_scope = 'INQUIRY' THEN
        IF v_u.inquiry_at IS NULL OR v_u.inquiry_at <= v_now - make_interval(mins => v_inq_mins) THEN v_u.inquiry_at := v_now; v_u.inquiries := 0; END IF;
        IF v_u.inquiries >= v_inq THEN v_reason := 'RATE_LIMITED'; END IF;
    ELSIF p_scope = 'REGISTER' AND p_key LIKE 'register:%' AND v_u.register_at > v_now - make_interval(mins => v_reg) THEN
        v_reason := 'RATE_LIMITED';
    END IF;
    IF v_reason IS NOT NULL THEN
        v_strikes := CASE WHEN v_u.strike_at IS NULL OR v_u.strike_at <= v_now - make_interval(mins => v_strike_mins) THEN 1 ELSE v_u.strikes + 1 END;
        UPDATE public.line_contact_usage SET strikes = v_strikes,
            strike_at = CASE WHEN v_strikes = 1 THEN v_now ELSE strike_at END WHERE contact_id = v_c;
        IF COALESCE((v_line->>'abuseAutoSuspend')::boolean,true) AND v_strikes >= v_strike_max THEN
            v_scope := CASE WHEN p_scope = 'GENERAL' THEN 'ALL' ELSE p_scope END;
            INSERT INTO public.line_contact_restrictions(contact_id,scope,reason,until_at,source)
            VALUES (v_c,v_scope,'ใช้งานถี่เกินเงื่อนไขที่เจ้าของกำหนด',v_now + make_interval(mins => v_suspend),'ABUSE')
            ON CONFLICT (contact_id,scope) DO UPDATE SET reason = EXCLUDED.reason, created_at = v_now, created_by = NULL,
                until_at = EXCLUDED.until_at, source = 'ABUSE', revoked_at = NULL, revoked_by = NULL;
            PERFORM public._audit_line(NULL,'LINE_RESTRICTION_AUTO','LINE_CONTACT',v_c,jsonb_build_object('scope',v_scope,'minutes',v_suspend));
            RETURN jsonb_build_object('allowed',false,'result','SUSPENDED');
        END IF;
        RETURN jsonb_build_object('allowed',false,'result',v_reason);
    END IF;
    UPDATE public.line_contact_usage SET last_key = p_key, last_at = v_now,
        inquiry_at = CASE WHEN p_scope = 'INQUIRY' THEN v_u.inquiry_at ELSE inquiry_at END,
        inquiries = CASE WHEN p_scope = 'INQUIRY' THEN v_u.inquiries + 1 ELSE inquiries END,
        register_at = CASE WHEN p_scope = 'REGISTER' AND p_key LIKE 'register:%' THEN v_now ELSE register_at END WHERE contact_id = v_c;
    RETURN jsonb_build_object('allowed',true,'result','OK','catalog_revision',(SELECT revision::text FROM public.line_catalog_state WHERE singleton));
END;
$$;
CREATE OR REPLACE FUNCTION public.line_catalog_revision()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM public._line_require_server(); RETURN (SELECT revision::text FROM public.line_catalog_state WHERE singleton); END;
$$;
CREATE OR REPLACE FUNCTION public._line_catalog_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_TABLE_NAME = 'store_settings' THEN
        IF (to_jsonb(NEW)#>>'{policies,line,catalog,showPrice}') IS NOT DISTINCT FROM (to_jsonb(OLD)#>>'{policies,line,catalog,showPrice}') THEN RETURN NULL; END IF;
    END IF;
    UPDATE public.line_catalog_state SET revision = revision + 1 WHERE singleton;
    RETURN NULL;
END;
$$;
CREATE TRIGGER trg_line_catalog_products AFTER INSERT OR DELETE OR UPDATE OF name,category_id,unit_id,active,line_listed,can_sell,can_rent,sale_price,rental_price,calculation_type
    ON public.products FOR EACH STATEMENT EXECUTE FUNCTION public._line_catalog_changed();
CREATE TRIGGER trg_line_catalog_categories AFTER INSERT OR DELETE OR UPDATE OF name,active,line_listed,line_order
    ON public.product_categories FOR EACH STATEMENT EXECUTE FUNCTION public._line_catalog_changed();
CREATE TRIGGER trg_line_catalog_units AFTER INSERT OR DELETE OR UPDATE OF name ON public.units FOR EACH STATEMENT EXECUTE FUNCTION public._line_catalog_changed();
CREATE TRIGGER trg_line_catalog_prices AFTER UPDATE OF policies ON public.store_settings FOR EACH ROW EXECUTE FUNCTION public._line_catalog_changed();
REVOKE ALL ON FUNCTION public._line_scope_blocked(uuid,text), public._line_user_blocked(text,text), public._line_owner_notice_allowed(uuid),public._line_catalog_changed()
    FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.line_contact_restriction_set(uuid,text,timestamptz,text,boolean),public.line_contact_restrictions(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.line_contact_restriction_set(uuid,text,timestamptz,text,boolean),public.line_contact_restrictions(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.line_interaction_check(text,text,text),public.line_catalog_revision() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.line_interaction_check(text,text,text),public.line_catalog_revision() TO service_role;

CREATE OR REPLACE FUNCTION public._line_policy_check(p_line jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_ints  jsonb := '{"linkCodeTtlMinutes": [2, 60], "linkMaxFailures": [3, 10],
                       "linkLockMinutes": [5, 1440], "linkGlobalMaxFailures": [10, 200],
                       "linkInviteTtlHours": [1, 720], "acceptTimeoutMinutes": [0, 1440],
                       "reminderHour": [0, 23], "interactionMaxPerMinute": [1, 120], "interactionDuplicateSeconds": [1, 60], "inquiryMaxPerWindow": [1, 60], "inquiryWindowMinutes": [1, 60], "registerCooldownMinutes": [1, 1440], "ownerNoticeCooldownMinutes": [1, 1440], "abuseStrikeLimit": [1, 20], "abuseWindowMinutes": [1, 1440], "abuseSuspendMinutes": [1, 1440]}'::jsonb;
    v_rule_ints jsonb := '{"daysBefore": [0, 30], "repeatDays": [0, 30]}'::jsonb;
    v_rules text[] := ARRAY['RENTAL_DUE_SOON', 'RENTAL_DUE_TODAY', 'RENTAL_OVERDUE', 'PAYMENT_DUE', 'APPOINTMENT_DUE'];
    v_key   text;
    v_val   jsonb;
    v_sub   text;
    v_subv  jsonb;
    v_f     text;
    v_fv    jsonb;
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
        ELSIF v_key = 'abuseAutoSuspend' THEN
            IF jsonb_typeof(v_val) <> 'boolean' THEN RAISE EXCEPTION 'INVALID_POLICY: line.abuseAutoSuspend' USING ERRCODE = '22023'; END IF;
        ELSIF v_key IN ('notify', 'customerStages') THEN
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.%', v_key USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                IF v_sub !~ '^[A-Z][A-Z0-9_]{1,59}$' OR jsonb_typeof(v_subv) <> 'boolean' THEN
                    RAISE EXCEPTION 'INVALID_POLICY: line.%.%', v_key, left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
            END LOOP;
        ELSIF v_key = 'friend' THEN
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.friend' USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                IF NOT (v_sub = ANY (ARRAY['welcome', 'notifyOwner'])) OR jsonb_typeof(v_subv) <> 'boolean' THEN
                    RAISE EXCEPTION 'INVALID_POLICY: line.friend.%', left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
            END LOOP;
        ELSIF v_key = 'catalog' THEN
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.catalog' USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                IF v_sub <> 'showPrice' OR jsonb_typeof(v_subv) <> 'boolean' THEN
                    RAISE EXCEPTION 'INVALID_POLICY: line.catalog.%', left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
            END LOOP;
        ELSIF v_key = 'register' THEN
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.register' USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                IF v_sub IN ('notifyOwner', 'notifyApproved', 'notifyRejected') THEN
                    IF jsonb_typeof(v_subv) <> 'boolean' THEN
                        RAISE EXCEPTION 'INVALID_POLICY: line.register.%', v_sub USING ERRCODE = '22023';
                    END IF;
                ELSIF v_sub = 'privacy' THEN
                    IF jsonb_typeof(v_subv) <> 'string' OR btrim(v_subv #>> '{}') = '' OR length(v_subv #>> '{}') > 1000 THEN
                        RAISE EXCEPTION 'INVALID_POLICY: line.register.privacy' USING ERRCODE = '22023';
                    END IF;
                ELSIF v_sub = 'required' THEN
                    IF jsonb_typeof(v_subv) <> 'object' THEN
                        RAISE EXCEPTION 'INVALID_POLICY: line.register.required' USING ERRCODE = '22023';
                    END IF;
                    FOR v_f, v_fv IN SELECT * FROM jsonb_each(v_subv) LOOP
                        IF NOT (v_f = ANY (ARRAY['province', 'district', 'subdistrict', 'address', 'postcode']))
                           OR jsonb_typeof(v_fv) <> 'boolean' THEN
                            RAISE EXCEPTION 'INVALID_POLICY: line.register.required.%', left(v_f, 40) USING ERRCODE = '22023';
                        END IF;
                    END LOOP;
                ELSE
                    RAISE EXCEPTION 'INVALID_POLICY: line.register.% unknown', left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
            END LOOP;
        ELSIF v_key = 'reminders' THEN
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.reminders' USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                IF NOT (v_sub = ANY (v_rules)) OR jsonb_typeof(v_subv) <> 'object' THEN
                    RAISE EXCEPTION 'INVALID_POLICY: line.reminders.%', left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
                FOR v_f, v_fv IN SELECT * FROM jsonb_each(v_subv) LOOP
                    IF v_f = 'enabled' THEN
                        IF jsonb_typeof(v_fv) <> 'boolean' THEN
                            RAISE EXCEPTION 'INVALID_POLICY: line.reminders.%.%', v_sub, v_f USING ERRCODE = '22023';
                        END IF;
                    ELSIF v_rule_ints ? v_f THEN
                        IF jsonb_typeof(v_fv) <> 'number' THEN
                            RAISE EXCEPTION 'INVALID_POLICY: line.reminders.%.%', v_sub, v_f USING ERRCODE = '22023';
                        END IF;
                        v_num := (v_fv #>> '{}')::numeric;
                        IF v_num <> trunc(v_num)
                           OR v_num NOT BETWEEN (v_rule_ints -> v_f ->> 0)::numeric AND (v_rule_ints -> v_f ->> 1)::numeric THEN
                            RAISE EXCEPTION 'INVALID_POLICY: line.reminders.%.%', v_sub, v_f USING ERRCODE = '22023';
                        END IF;
                    ELSE
                        RAISE EXCEPTION 'INVALID_POLICY: line.reminders.%.% unknown', v_sub, left(v_f, 40) USING ERRCODE = '22023';
                    END IF;
                END LOOP;
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

CREATE OR REPLACE FUNCTION public._line_register_apply(p_contact_id uuid, p_name text, p_phone text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c      public.line_contacts%ROWTYPE;
    v_name   text := left(btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g')), 200);
    v_phone  text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
    v_ids    uuid[];
    v_n      integer;
    v_match  text;
    v_owner  uuid;
    v_guard jsonb;
BEGIN
    IF p_actor IS NOT NULL THEN
        RETURN public._line_register_link(p_contact_id, p_name, p_phone, p_actor);
    END IF;

    SELECT * INTO v_c FROM public.line_contacts WHERE id = p_contact_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002';
    END IF;
    IF v_c.status = 'LINKED' THEN
        RETURN jsonb_build_object('result', 'ALREADY_LINKED');
    END IF;
    IF v_name = '' OR v_phone !~ '^0[0-9]{9}$' THEN
        RETURN jsonb_build_object('result', 'INVALID');
    END IF;

    v_guard := public.line_interaction_check(v_c.line_user_id,'REGISTER','register:' || md5(v_name || ':' || v_phone));
    IF NOT (v_guard ->> 'allowed')::boolean THEN
        IF v_guard ->> 'result' = 'DUPLICATE' AND v_c.register_status = 'PENDING'
           AND v_c.typed_name = v_name AND v_c.typed_phone = v_phone THEN
            RETURN jsonb_build_object('result','PENDING','duplicate',true);
        END IF;
        RETURN jsonb_build_object('result',v_guard ->> 'result');
    END IF;
    IF v_c.register_status = 'PENDING' AND v_c.typed_name = v_name AND v_c.typed_phone = v_phone THEN
        RETURN jsonb_build_object('result','PENDING','duplicate',true);
    END IF;
    -- Only a hint for the shop's screen: who might this be. Never used to link or to answer the stranger.
    SELECT array_agg(c.id ORDER BY c.created_at) INTO v_ids
      FROM public.customers c
     WHERE c.active AND regexp_replace(c.phone, '\D', '', 'g') = v_phone;
    v_n := COALESCE(cardinality(v_ids), 0);
    v_match := CASE
        WHEN v_n = 0 THEN 'NONE'
        WHEN v_n > 1 THEN 'MANY'
        WHEN EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.customer_id = v_ids[1] AND x.status = 'LINKED') THEN 'TAKEN'
        ELSE 'ONE'
    END;

    UPDATE public.line_contacts
       SET typed_name = v_name, typed_phone = v_phone,
           register_status = 'PENDING',
           register_customer_id = CASE WHEN v_n = 1 THEN v_ids[1] ELSE NULL END,
           register_note = NULL,
           register_payload = register_payload || jsonb_build_object('match', v_match, 'channel', 'CHAT', 'submitted_at', now()),
           updated_at = now()
     WHERE id = v_c.id;
    PERFORM public._audit_line(NULL, 'LINE_REGISTER', 'LINE_CONTACT', v_c.id,
                               jsonb_build_object('result', 'PENDING', 'match', v_match), 'SUCCESS');

    SELECT p.id INTO v_owner FROM public.profiles p WHERE p.role = 'OWNER' AND p.status = 'ACTIVE' ORDER BY p.created_at LIMIT 1;
    IF v_owner IS NOT NULL
       AND COALESCE((public._policy('line', '{}'::jsonb) -> 'register' ->> 'notifyOwner')::boolean, true)
       AND public._line_owner_notice_allowed(v_c.id) THEN
        PERFORM public._notify('LINE_REGISTER_PENDING:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                               'LINE_REGISTER_PENDING', 'WARNING', v_owner, NULL, 'LINE_CONTACT', v_c.id,
                               'มีคำขอลงทะเบียนทาง LINE รอร้านตรวจ',
                               'ชื่อที่แจ้ง ' || v_name || ' · LINE ' || COALESCE(NULLIF(v_c.display_name, ''), 'ไม่ทราบชื่อ'));
    END IF;
    RETURN jsonb_build_object('result', 'PENDING');
END;
$$;

CREATE OR REPLACE FUNCTION public.line_contact_follow(
    p_line_user_id text,
    p_display_name text,
    p_picture_url  text DEFAULT NULL,
    p_is_unblock   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c       public.line_contacts%ROWTYPE;
    v_first   boolean;
    v_friend  jsonb := COALESCE(public._policy('line', '{}'::jsonb) -> 'friend', '{}'::jsonb);
    v_welcome boolean := COALESCE((v_friend ->> 'welcome')::boolean, true);
    v_notify  boolean := COALESCE((v_friend ->> 'notifyOwner')::boolean, false);
    v_owner   uuid;
BEGIN
    PERFORM public._line_require_server();
    SELECT * INTO v_c FROM public.line_contacts WHERE line_user_id = p_line_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002';
    END IF;
    v_first := v_c.followed_at IS NULL;

    UPDATE public.line_contacts
       SET display_name = COALESCE(NULLIF(left(btrim(COALESCE(p_display_name, '')), 200), ''), display_name),
           picture_url = CASE WHEN p_picture_url ~ '^https://' AND length(p_picture_url) <= 1000 THEN p_picture_url ELSE picture_url END,
           followed = true,
           followed_at = CASE WHEN p_is_unblock THEN COALESCE(followed_at, now()) ELSE now() END,
           register_status = CASE WHEN status = 'UNLINKED' AND (register_status IS NULL OR register_status = 'REJECTED')
                                  AND NOT p_is_unblock THEN 'WAITING' ELSE register_status END,
           register_customer_id = CASE WHEN status = 'UNLINKED' AND (register_status IS NULL OR register_status = 'REJECTED')
                                       AND NOT p_is_unblock THEN NULL ELSE register_customer_id END,
           updated_at = now()
     WHERE id = v_c.id
    RETURNING * INTO v_c;

    IF v_notify AND NOT p_is_unblock AND public._line_owner_notice_allowed(v_c.id) THEN
        SELECT p.id INTO v_owner FROM public.profiles p WHERE p.role = 'OWNER' AND p.status = 'ACTIVE' ORDER BY p.created_at LIMIT 1;
        IF v_owner IS NOT NULL THEN
            PERFORM public._notify('LINE_FRIEND_NEW:' || v_c.id || ':' || extract(epoch FROM v_c.followed_at)::bigint,
                                   'LINE_FRIEND_NEW', 'INFO', v_owner, NULL, 'LINE_CONTACT', v_c.id,
                                   CASE WHEN v_first THEN 'มีเพื่อนใหม่ใน LINE ร้าน' ELSE 'เพื่อนเดิมกลับมาเพิ่ม LINE ร้านอีกครั้ง' END,
                                   'ชื่อโปรไฟล์ ' || COALESCE(NULLIF(v_c.display_name, ''), 'ไม่ทราบชื่อ')
                                   || ' · ยังไม่ได้ยืนยันว่าเป็นใคร');
        END IF;
    END IF;

    RETURN jsonb_build_object('status', v_c.status, 'register_status', v_c.register_status,
                              'is_new', v_first, 'is_unblock', p_is_unblock,
                              'send_welcome', v_welcome AND v_c.status <> 'LINKED' AND NOT p_is_unblock AND NOT public._line_scope_blocked(v_c.id,'MESSAGES'));
END;
$$;

CREATE OR REPLACE FUNCTION public.line_register_submit(
    p_line_user_id text,
    p_name         text,
    p_phone        text,
    p_address      jsonb,
    p_consent      boolean,
    p_display_name text DEFAULT NULL,
    p_is_friend    boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c       public.line_contacts%ROWTYPE;
    v_addr    jsonb;
    v_missing text[];
    v_res     jsonb;
    v_key     text;
    v_req     jsonb := COALESCE(public._policy('line', '{}'::jsonb) -> 'register' -> 'required', '{}'::jsonb);
BEGIN
    PERFORM public._line_require_server();
    IF p_line_user_id !~ '^U[0-9a-f]{32}$' THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002';
    END IF;
    -- The form can be opened by someone who has not added the OA yet: the person is kept (followed = what LINE
    -- says about the friendship, never a guess) and can be answered once they add the OA.
    INSERT INTO public.line_contacts (line_user_id, followed, display_name, last_event_at)
    VALUES (p_line_user_id, COALESCE(p_is_friend, false), NULLIF(left(btrim(COALESCE(p_display_name, '')), 200), ''), now())
    ON CONFLICT (line_user_id) DO NOTHING;
    SELECT * INTO v_c FROM public.line_contacts WHERE line_user_id = p_line_user_id FOR UPDATE;
    IF v_c.status = 'LINKED' THEN
        RETURN jsonb_build_object('result', 'ALREADY_LINKED');
    END IF;
    IF v_c.register_status = 'REJECTED' THEN
        RETURN jsonb_build_object('result', 'REJECTED');
    END IF;
    IF p_consent IS NOT TRUE THEN
        RETURN jsonb_build_object('result', 'CONSENT_REQUIRED');
    END IF;

    v_addr := jsonb_strip_nulls(jsonb_build_object(
        'address',     NULLIF(left(btrim(COALESCE(p_address ->> 'address', '')), 300), ''),
        'subdistrict', NULLIF(left(btrim(COALESCE(p_address ->> 'subdistrict', '')), 100), ''),
        'district',    NULLIF(left(btrim(COALESCE(p_address ->> 'district', '')), 100), ''),
        'province',    NULLIF(left(btrim(COALESCE(p_address ->> 'province', '')), 100), ''),
        'postcode',    NULLIF(left(regexp_replace(COALESCE(p_address ->> 'postcode', ''), '\D', '', 'g'), 10), '')));

    -- Fields the owner marked as required (Settings › LINE › การลงทะเบียน)
    FOREACH v_key IN ARRAY ARRAY['province', 'district', 'subdistrict', 'address', 'postcode'] LOOP
        IF COALESCE((v_req ->> v_key)::boolean, false) AND NOT (v_addr ? v_key) THEN
            v_missing := array_append(v_missing, v_key);
        END IF;
    END LOOP;
    IF COALESCE(cardinality(v_missing), 0) > 0 THEN
        RETURN jsonb_build_object('result', 'MISSING', 'fields', to_jsonb(v_missing));
    END IF;

    v_res := public._line_register_apply(v_c.id, p_name, p_phone, NULL);
    IF v_res ->> 'result' = 'PENDING' AND NOT COALESCE((v_res ->> 'duplicate')::boolean,false) THEN
        UPDATE public.line_contacts
           SET register_payload = register_payload || jsonb_build_object('address', v_addr, 'channel', 'FORM', 'consent_at', now()),
               updated_at = now()
         WHERE id = v_c.id;
    END IF;
    RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public._line_register_link(p_contact_id uuid, p_name text, p_phone text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c        public.line_contacts%ROWTYPE;
    v_name     text := left(btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g')), 200);
    v_phone    text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
    v_ids      uuid[];
    v_cust     uuid;
    v_known    text;
    v_creator  uuid;
    v_created  boolean := false;
    v_try      integer := 0;
BEGIN
    IF public._line_scope_blocked(p_contact_id,'REGISTER') THEN RAISE EXCEPTION 'LINE_CONTACT_SUSPENDED' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_c FROM public.line_contacts WHERE id = p_contact_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002';
    END IF;
    IF v_c.status = 'LINKED' THEN
        RETURN jsonb_build_object('result', 'ALREADY_LINKED');
    END IF;
    IF v_name = '' OR v_phone !~ '^0[0-9]{9}$' THEN
        RETURN jsonb_build_object('result', 'INVALID');
    END IF;
    UPDATE public.line_contacts SET typed_name = v_name, typed_phone = v_phone, updated_at = now() WHERE id = v_c.id;

    SELECT array_agg(c.id ORDER BY c.created_at) INTO v_ids
      FROM public.customers c
     WHERE c.active AND regexp_replace(c.phone, '\D', '', 'g') = v_phone;

    -- Known duplicate customer data: never guess which one.
    IF COALESCE(cardinality(v_ids), 0) > 1 THEN
        UPDATE public.line_contacts SET register_status = 'DUPLICATE', register_customer_id = NULL, updated_at = now()
         WHERE id = v_c.id;
        PERFORM public._audit_line(p_actor, 'LINE_REGISTER', 'LINE_CONTACT', v_c.id,
                                   jsonb_build_object('result', 'DUPLICATE', 'matches', cardinality(v_ids)), 'FAILED');
        RETURN jsonb_build_object('result', 'DUPLICATE');
    END IF;

    IF COALESCE(cardinality(v_ids), 0) = 1 THEN
        v_cust := v_ids[1];
        -- 1 customer = 1 LINE: an existing link is never replaced automatically.
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.customer_id = v_cust AND x.status = 'LINKED') THEN
            UPDATE public.line_contacts SET register_status = 'PHONE_TAKEN', register_customer_id = v_cust, updated_at = now()
             WHERE id = v_c.id;
            PERFORM public._audit_line(p_actor, 'LINE_REGISTER', 'LINE_CONTACT', v_c.id,
                                       jsonb_build_object('result', 'PHONE_TAKEN', 'customer_id', v_cust), 'FAILED');
            RETURN jsonb_build_object('result', 'PHONE_TAKEN', 'customer_id', v_cust);
        END IF;
        SELECT c.name INTO v_known FROM public.customers c WHERE c.id = v_cust;
    ELSE
        -- New customer: the shop member who typed it is the creator.
        v_creator := COALESCE(p_actor, (SELECT p.id FROM public.profiles p
                                         WHERE p.role = 'OWNER' AND p.status = 'ACTIVE' ORDER BY p.created_at LIMIT 1));
        IF v_creator IS NULL THEN
            RAISE EXCEPTION 'LINE_REGISTER_NO_OWNER' USING ERRCODE = 'P0002';
        END IF;
        LOOP
            v_try := v_try + 1;
            BEGIN
                INSERT INTO public.customers (customer_code, name, phone, address, created_by)
                VALUES ('CUST-' || lpad((floor(random() * 1000000))::int::text, 6, '0'), v_name, v_phone, '-', v_creator)
                RETURNING id INTO v_cust;
                EXIT;
            EXCEPTION WHEN unique_violation THEN
                IF v_try >= 5 THEN
                    RAISE EXCEPTION 'LINE_CODE_BUSY: try again' USING ERRCODE = '40001';
                END IF;
            END;
        END LOOP;
        v_created := true;
        v_known := v_name;
        PERFORM public._audit_line(v_creator, 'CUSTOMER_CREATE', 'CUSTOMER', v_cust,
                                   jsonb_build_object('name', v_name, 'via', CASE WHEN p_actor IS NULL THEN 'LINE_SELF' ELSE 'LINE_SHOP' END));
    END IF;

    BEGIN
        UPDATE public.line_contacts
           SET status = 'LINKED', customer_id = v_cust, profile_id = NULL, driver_code = NULL,
               code_failures = 0, code_locked_until = NULL, linked_at = now(), needs_review = false,
               register_status = NULL, register_customer_id = NULL, register_note = NULL,
               self_registered = (v_created AND p_actor IS NULL), updated_at = now()
         WHERE id = v_c.id;
    EXCEPTION WHEN unique_violation THEN
        -- another LINE took this customer a moment ago
        UPDATE public.line_contacts SET register_status = 'PHONE_TAKEN', register_customer_id = v_cust, updated_at = now()
         WHERE id = v_c.id;
        RETURN jsonb_build_object('result', 'PHONE_TAKEN', 'customer_id', v_cust);
    END;
    PERFORM public._audit_line(p_actor, 'LINE_LINK', 'CUSTOMER', v_cust,
                               jsonb_build_object('contact_id', v_c.id, 'via', CASE WHEN p_actor IS NULL THEN 'LINE_SELF' ELSE 'LINE_SHOP' END,
                                                  'created', v_created));
    RETURN jsonb_build_object('result', 'LINKED_CUSTOMER', 'name', v_known, 'customer_id', v_cust, 'created', v_created);
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
    IF public._line_scope_blocked(p_contact_id,'REGISTER') THEN RAISE EXCEPTION 'LINE_CONTACT_SUSPENDED' USING ERRCODE = '42501'; END IF;
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
    UPDATE public.line_contact_usage SET register_at = NULL,last_key = NULL WHERE contact_id = v_c.id;
    UPDATE public.line_contacts SET register_status = 'NEED_INFO', register_note = v_note, updated_at = now() WHERE id = v_c.id;
    PERFORM public._audit_line(auth.uid(), 'LINE_REGISTER_NEED_INFO', 'LINE_CONTACT', v_c.id, jsonb_build_object('note', v_note));
    RETURN jsonb_build_object('contact_id', v_c.id, 'register_status', 'NEED_INFO', 'notify', v_c.followed);
END;
$$;

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
    v_guard jsonb;
BEGIN
    PERFORM public._line_require_server();
    v_guard := public.line_interaction_check(p_line_user_id,'REGISTER','link:' || md5(COALESCE(p_code,'')));
    IF NOT (v_guard ->> 'allowed')::boolean THEN RETURN jsonb_build_object('result',v_guard ->> 'result'); END IF;
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
    IF (SELECT count(*) FROM public.audit_logs a
         WHERE a.created_at > now() - make_interval(mins => v_lock)
           AND a.action = 'LINE_LINK_ATTEMPT' AND a.result = 'FAILED') >= v_glob THEN
        RETURN jsonb_build_object('result', 'LOCKED');
    END IF;
    SELECT * INTO v_k FROM public.line_link_codes
     WHERE code_hash = public._line_code_hash(p_code) AND used_at IS NULL AND revoked_at IS NULL
     FOR UPDATE;
    v_found := FOUND AND CASE WHEN p_code LIKE 'LINK-%'
                              THEN v_k.purpose IN ('CUSTOMER', 'DRIVER') OR (v_k.purpose = 'STAFF' AND v_k.via = 'INVITE')
                              ELSE v_k.purpose = 'STAFF' AND v_k.via = 'CODE' END;
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
           SET status = 'LINKED', profile_id = v_k.profile_id, customer_id = NULL, driver_code = NULL,
               code_failures = 0, code_locked_until = NULL, linked_at = now(), updated_at = now()
         WHERE id = v_c.id;
        SELECT COALESCE(NULLIF(p.display_name, ''), p.username) INTO v_name FROM public.profiles p WHERE p.id = v_k.profile_id;
        PERFORM public._audit_line(v_k.profile_id, 'LINE_LINK', 'PROFILE', v_k.profile_id,
                                   jsonb_build_object('contact_id', v_c.id, 'via', v_k.via));
        PERFORM public._notify('LINE_LINKED:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                               'LINE_LINKED', 'WARNING', v_k.profile_id, NULL, 'PROFILE', v_k.profile_id,
                               'ผูก LINE กับบัญชีของคุณแล้ว',
                               'LINE ' || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ')
                               || ' ถูกผูกกับบัญชีนี้ ถ้าไม่ได้ทำเอง ให้ยกเลิกการผูกทันทีและแจ้งเจ้าของร้าน');
        IF v_k.via = 'INVITE' AND v_k.created_by IS DISTINCT FROM v_k.profile_id THEN
            PERFORM public._notify('LINE_LINKED:' || v_c.id || ':issuer', 'LINE_LINKED', 'INFO', v_k.created_by, NULL,
                                   'PROFILE', v_k.profile_id, 'พนักงานผูก LINE แล้ว',
                                   COALESCE(v_name, '-') || ' ผูกกับ LINE ' || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ'));
        END IF;
        RETURN jsonb_build_object('result', 'LINKED_STAFF', 'name', v_name);
    END IF;

    IF v_k.purpose = 'DRIVER' THEN
        IF NOT public._line_driver_active(v_k.driver_code) THEN
            RETURN jsonb_build_object('result', 'INVALID');
        END IF;
        IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.driver_code = v_k.driver_code AND x.status = 'LINKED') THEN
            RETURN jsonb_build_object('result', 'TARGET_TAKEN');
        END IF;
        UPDATE public.line_link_codes SET used_at = now() WHERE id = v_k.id;
        UPDATE public.line_contacts
           SET status = 'LINKED', driver_code = v_k.driver_code, profile_id = NULL, customer_id = NULL,
               code_failures = 0, code_locked_until = NULL, linked_at = now(), updated_at = now()
         WHERE id = v_c.id;
        v_name := public._line_driver_name(v_k.driver_code);
        PERFORM public._audit_line(v_k.created_by, 'LINE_LINK', 'LINE_CONTACT', v_c.id,
                                   jsonb_build_object('driver_code', v_k.driver_code, 'code_created_by', v_k.created_by, 'via', v_k.via));
        PERFORM public._notify('LINE_LINKED:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                               'LINE_LINKED', 'INFO', v_k.created_by, NULL, 'LINE_CONTACT', v_c.id,
                               'คนขับผูก LINE แล้ว',
                               'คนขับ ' || v_k.driver_code || ' ' || COALESCE(v_name, '') || ' ผูกกับ LINE '
                               || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ')
                               || ' ถ้าไม่ใช่คนขับคนนี้ ให้ยกเลิกการผูกที่หน้า ตั้งค่า › LINE');
        RETURN jsonb_build_object('result', 'LINKED_DRIVER', 'name', v_name);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = v_k.customer_id AND c.active) THEN
        RETURN jsonb_build_object('result', 'INVALID');
    END IF;
    IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.customer_id = v_k.customer_id AND x.status = 'LINKED') THEN
        RETURN jsonb_build_object('result', 'TARGET_TAKEN');
    END IF;
    UPDATE public.line_link_codes SET used_at = now() WHERE id = v_k.id;
    -- The customer's link waits for the shop to check it (owner 2026-11-11)
    UPDATE public.line_contacts
       SET status = 'LINKED', customer_id = v_k.customer_id, profile_id = NULL, driver_code = NULL,
           code_failures = 0, code_locked_until = NULL, linked_at = now(), needs_review = true, updated_at = now()
     WHERE id = v_c.id;
    SELECT c.name INTO v_name FROM public.customers c WHERE c.id = v_k.customer_id;
    PERFORM public._audit_line(v_k.created_by, 'LINE_LINK', 'CUSTOMER', v_k.customer_id,
                               jsonb_build_object('contact_id', v_c.id, 'code_created_by', v_k.created_by, 'via', v_k.via));
    PERFORM public._notify('LINE_LINKED:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                           'LINE_LINKED', 'WARNING', v_k.created_by, NULL, 'CUSTOMER', v_k.customer_id,
                           'ลูกค้าผูก LINE แล้ว รอร้านตรวจ',
                           'ลูกค้า ' || COALESCE(v_name, '-') || ' ผูกกับ LINE '
                           || COALESCE(NULLIF(v_c.display_name, ''), 'ที่ไม่ทราบชื่อ')
                           || ' ตรวจแล้วกดยืนยัน หรือยกเลิกการผูกถ้าไม่ใช่ลูกค้าคนนี้');
    RETURN jsonb_build_object('result', 'LINKED_CUSTOMER', 'name', v_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.line_task_postback(p_line_user_id text, p_task_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_t      public.line_tasks%ROWTYPE;
    v_a      public.appointments%ROWTYPE;
    v_actor  uuid;
    v_driver text;
    v_ok     boolean;
BEGIN
    PERFORM public._line_require_server();
    IF public._line_user_blocked(p_line_user_id,'WORK') THEN RETURN jsonb_build_object('result','SUSPENDED'); END IF;
    IF p_action NOT IN ('ACCEPT', 'DONE') THEN
        RETURN jsonb_build_object('result', 'INVALID_STATE');
    END IF;
    SELECT p.id, c.driver_code INTO v_actor, v_driver
      FROM public.line_contacts c LEFT JOIN public.profiles p ON p.id = c.profile_id AND p.status = 'ACTIVE'
     WHERE c.line_user_id = p_line_user_id AND c.status = 'LINKED' AND NOT c.needs_review;
    SELECT * INTO v_t FROM public.line_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    v_ok := (v_t.assignee_id IS NOT NULL AND v_t.assignee_id = v_actor)
         OR (v_t.driver_code IS NOT NULL AND v_t.driver_code = v_driver AND public._line_driver_active(v_driver));
    IF NOT COALESCE(v_ok, false) THEN
        PERFORM public._audit_line(NULL, 'LINE_TASK_POSTBACK', 'LINE_TASK', p_task_id,
                                   jsonb_build_object('reason', 'NOT_ASSIGNEE'), 'FAILED');
        RETURN jsonb_build_object('result', 'NOT_ASSIGNEE');
    END IF;

    IF v_t.driver_code IS NOT NULL THEN
        IF p_action = 'DONE' OR v_t.status = 'CANCELLED' THEN
            RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
        END IF;
        SELECT * INTO v_a FROM public.appointments WHERE id = v_t.appointment_id FOR UPDATE;
        IF NOT FOUND OR NOT public._line_driver_holds(v_a, v_driver) THEN
            PERFORM public._audit_line(NULL, 'LINE_TASK_POSTBACK', 'LINE_TASK', p_task_id,
                                       jsonb_build_object('reason', 'NOT_HOLDER', 'driver_code', v_driver), 'FAILED');
            RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
        END IF;
        IF v_t.status IN ('ACCEPTED', 'DONE') THEN
            RETURN jsonb_build_object('result', 'ALREADY', 'status', v_t.status,
                                      'next_stage', public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events'));
        END IF;
        UPDATE public.line_tasks SET status = 'ACCEPTED', accepted_at = COALESCE(accepted_at, now()), updated_at = now()
         WHERE id = p_task_id;
        PERFORM public._audit_line(NULL, 'LINE_TASK_ACCEPT', 'LINE_TASK', p_task_id,
                                   jsonb_build_object('from', v_t.status, 'driver_code', v_driver));
        -- รับงาน of the current dispatch: appended once, earlier steps are never rewritten
        IF NOT ('ACCEPT' = ANY (public._work_order_run_done(v_a.work_order -> 'events'))) THEN
            UPDATE public.appointments a
               SET work_order = jsonb_set(COALESCE(a.work_order, '{}'::jsonb), '{events}',
                       (CASE WHEN jsonb_typeof(a.work_order -> 'events') = 'array' THEN a.work_order -> 'events' ELSE '[]'::jsonb END)
                       || jsonb_build_array(jsonb_build_object(
                           'id', gen_random_uuid(), 'stage', 'ACCEPT', 'status', 'DONE',
                           'by', COALESCE(public._line_driver_name(v_driver), v_driver) || ' (LINE)',
                           'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                           'note', 'รับงานทาง LINE')))
             WHERE a.id = v_a.id
            RETURNING * INTO v_a;
        END IF;
        RETURN jsonb_build_object('result', 'ACCEPTED',
                                  'next_stage', public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events'));
    END IF;

    -- Staff task (assignee): as in 20261008160000
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



CREATE OR REPLACE FUNCTION public.line_task_step(
    p_line_user_id text,
    p_task_id uuid,
    p_stage text,
    p_note text DEFAULT NULL,
    p_photos text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_t      public.line_tasks%ROWTYPE;
    v_a      public.appointments%ROWTYPE;
    v_driver text;
    v_stage  text := upper(btrim(COALESCE(p_stage, '')));
    v_next   text;
    v_note   text := NULLIF(btrim(COALESCE(p_note, '')), '');
    v_photos text[] := COALESCE(p_photos, ARRAY[]::text[]);
    v_photo  text;
    v_event  jsonb;
BEGIN
    PERFORM public._line_require_server();
    IF public._line_user_blocked(p_line_user_id,'WORK') THEN RETURN jsonb_build_object('result','SUSPENDED'); END IF;
    IF v_note IS NOT NULL AND length(v_note) > 500 THEN
        RETURN jsonb_build_object('result', 'INVALID_INPUT');
    END IF;
    IF cardinality(v_photos) > 3 THEN
        RETURN jsonb_build_object('result', 'INVALID_INPUT');
    END IF;
    FOREACH v_photo IN ARRAY v_photos LOOP
        IF v_photo IS NULL OR v_photo !~ ('^' || p_task_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') THEN
            RETURN jsonb_build_object('result', 'INVALID_INPUT');
        END IF;
    END LOOP;

    SELECT c.driver_code INTO v_driver FROM public.line_contacts c
     WHERE c.line_user_id = p_line_user_id AND c.status = 'LINKED' AND NOT c.needs_review;
    SELECT * INTO v_t FROM public.line_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    IF v_t.driver_code IS NULL OR v_driver IS DISTINCT FROM v_t.driver_code OR NOT public._line_driver_active(v_driver) THEN
        PERFORM public._audit_line(NULL, 'LINE_TASK_STEP', 'LINE_TASK', p_task_id,
                                   jsonb_build_object('reason', 'NOT_ASSIGNEE', 'stage', v_stage), 'FAILED');
        RETURN jsonb_build_object('result', 'NOT_ASSIGNEE');
    END IF;
    IF v_t.status = 'CANCELLED' THEN
        RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
    END IF;
    SELECT * INTO v_a FROM public.appointments WHERE id = v_t.appointment_id FOR UPDATE;
    IF NOT FOUND OR NOT public._line_driver_holds(v_a, v_driver) THEN
        PERFORM public._audit_line(NULL, 'LINE_TASK_STEP', 'LINE_TASK', p_task_id,
                                   jsonb_build_object('reason', 'NOT_HOLDER', 'stage', v_stage), 'FAILED');
        RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
    END IF;
    IF v_t.status = 'SENT' THEN
        RETURN jsonb_build_object('result', 'NOT_ACCEPTED');
    END IF;
    v_next := public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events');
    IF v_stage = ANY (public._work_order_run_done(v_a.work_order -> 'events')) THEN
        RETURN jsonb_build_object('result', 'ALREADY', 'stage', v_stage, 'next_stage', v_next);
    END IF;
    IF v_next IS NULL OR v_stage IS DISTINCT FROM v_next THEN
        RETURN jsonb_build_object('result', 'OUT_OF_ORDER', 'stage', v_stage, 'next_stage', v_next);
    END IF;

    v_event := jsonb_build_object(
        'id', gen_random_uuid(), 'stage', v_stage, 'status', 'DONE',
        'by', COALESCE(public._line_driver_name(v_driver), v_driver) || ' (LINE)',
        'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'note', COALESCE(v_note, 'อัปเดตทาง LINE'));
    IF cardinality(v_photos) > 0 THEN
        v_event := v_event || jsonb_build_object('photos', to_jsonb(v_photos));
    END IF;

    UPDATE public.appointments a
       SET work_order = jsonb_set(COALESCE(a.work_order, '{}'::jsonb), '{events}',
               (CASE WHEN jsonb_typeof(a.work_order -> 'events') = 'array' THEN a.work_order -> 'events' ELSE '[]'::jsonb END)
               || jsonb_build_array(v_event))
     WHERE a.id = v_a.id
    RETURNING * INTO v_a;
    v_next := public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events');
    IF v_next IS NULL THEN
        UPDATE public.line_tasks SET status = 'DONE', done_at = now(), updated_at = now() WHERE id = p_task_id;
    END IF;
    PERFORM public._audit_line(NULL, 'LINE_TASK_STEP', 'LINE_TASK', p_task_id,
                               jsonb_build_object('stage', v_stage, 'driver_code', v_driver, 'appointment_id', v_a.id,
                                                  'note', v_note, 'photos', cardinality(v_photos)));
    RETURN jsonb_build_object('result', 'STEP_DONE', 'stage', v_stage, 'next_stage', v_next);
END;
$function$;

CREATE OR REPLACE FUNCTION public.line_driver_job(p_line_user_id text, p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_t      public.line_tasks%ROWTYPE;
    v_a      public.appointments%ROWTYPE;
    v_driver text;
    v_c      public.customers%ROWTYPE;
    v_items  jsonb;
BEGIN
    PERFORM public._line_require_server();
    IF public._line_user_blocked(p_line_user_id,'WORK') THEN RETURN jsonb_build_object('result','SUSPENDED'); END IF;
    SELECT c.driver_code INTO v_driver FROM public.line_contacts c
     WHERE c.line_user_id = p_line_user_id AND c.status = 'LINKED' AND NOT c.needs_review;
    SELECT * INTO v_t FROM public.line_tasks WHERE id = p_task_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    IF v_t.driver_code IS NULL OR v_driver IS DISTINCT FROM v_t.driver_code OR NOT public._line_driver_active(v_driver) THEN
        RETURN jsonb_build_object('result', 'NOT_ASSIGNEE');
    END IF;
    SELECT * INTO v_a FROM public.appointments WHERE id = v_t.appointment_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    IF v_t.status = 'CANCELLED' OR NOT public._line_driver_holds(v_a, v_driver) THEN
        RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
    END IF;
    IF v_a.customer_id IS NOT NULL THEN
        SELECT * INTO v_c FROM public.customers WHERE id = v_a.customer_id;
    END IF;
    IF v_a.bill_id IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('name', l.product_name, 'qty', l.ordered_qty - COALESCE(l.cancelled_qty, 0),
                                                     'unit', l.unit_name) ORDER BY l.line_no), '[]'::jsonb)
          INTO v_items
          FROM public.bill_lines l
         WHERE l.bill_id = v_a.bill_id AND l.ordered_qty - COALESCE(l.cancelled_qty, 0) > 0;
    END IF;
    RETURN jsonb_build_object(
        'result', 'OK',
        'task', jsonb_build_object('id', v_t.id, 'title', v_t.title, 'detail', v_t.detail, 'status', v_t.status),
        'holds', public._line_driver_holds(v_a, v_driver),
        'appointment', jsonb_build_object(
            'type', v_a.appointment_type,
            'start', v_a.start_datetime,
            'place', COALESCE(NULLIF(v_a.location, ''), v_c.address),
            'contact', COALESCE(NULLIF(v_a.contact_name, ''), v_c.name),
            'phone', COALESCE(NULLIF(v_a.contact_phone, ''), v_c.phone),
            'description', v_a.description),
        'items', COALESCE(v_items, '[]'::jsonb),
        'events', CASE WHEN jsonb_typeof(v_a.work_order -> 'events') = 'array' THEN v_a.work_order -> 'events' ELSE '[]'::jsonb END,
        'next_stage', public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.line_owner_finance_form(p_line_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_owner uuid;
    v_items jsonb;
BEGIN
    PERFORM public._line_require_server();
    IF public._line_user_blocked(p_line_user_id,'WORK') THEN RETURN jsonb_build_object('result','SUSPENDED'); END IF;
    v_owner := public._line_owner_id(p_line_user_id);
    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_OWNER');
    END IF;
    SELECT CASE WHEN jsonb_typeof(s.policies -> 'finance_income_items') = 'array' THEN s.policies -> 'finance_income_items' END
      INTO v_items FROM public.store_settings s WHERE s.singleton;
    RETURN jsonb_build_object(
        'result', 'OK',
        'name', (SELECT COALESCE(NULLIF(p.display_name, ''), p.username) FROM public.profiles p WHERE p.id = v_owner),
        'income_items', COALESCE(v_items, '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.line_finance_entry(
    p_line_user_id text,
    p_kind text,
    p_category text,
    p_amount numeric,
    p_channel text,
    p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_owner    uuid;
    v_name     text;
    v_kind     text := upper(btrim(COALESCE(p_kind, '')));
    v_category text := btrim(COALESCE(p_category, ''));
    v_channel  text := upper(btrim(COALESCE(p_channel, '')));
    v_note     text := NULLIF(btrim(COALESCE(p_note, '')), '');
    v_corr     uuid := gen_random_uuid();
    v_e        public.expense_entries%ROWTYPE;
    v_i        public.other_income_entries%ROWTYPE;
    v_row      jsonb;
BEGIN
    PERFORM public._line_require_server();
    IF public._line_user_blocked(p_line_user_id,'WORK') THEN RETURN jsonb_build_object('result','SUSPENDED'); END IF;
    v_owner := public._line_owner_id(p_line_user_id);
    IF v_owner IS NULL THEN
        PERFORM public._audit_line(NULL, 'LINE_FINANCE_ENTRY', 'FINANCE', NULL, jsonb_build_object('reason', 'NOT_OWNER'), 'FAILED');
        RETURN jsonb_build_object('result', 'NOT_OWNER');
    END IF;
    IF v_kind NOT IN ('INCOME', 'EXPENSE') OR p_amount IS NULL OR p_amount <= 0 OR p_amount > 99999999
       OR v_channel NOT IN ('CASH', 'TRANSFER', 'CARD', 'QR', 'OTHER')
       OR v_category = '' OR length(v_category) > 100 OR (v_note IS NOT NULL AND length(v_note) > 500)
       OR (v_kind = 'EXPENSE' AND v_category NOT IN ('PURCHASE', 'REPAIR', 'SHIPPING', 'LABOR', 'FUEL', 'EQUIPMENT', 'GENERAL')) THEN
        RETURN jsonb_build_object('result', 'INVALID_INPUT');
    END IF;
    SELECT COALESCE(NULLIF(p.display_name, ''), p.username) INTO v_name FROM public.profiles p WHERE p.id = v_owner;

    IF v_kind = 'EXPENSE' THEN
        INSERT INTO public.expense_entries (expense_no, category, amount, paid_method, note, created_by)
        VALUES (public._next_document_no('EXPENSE'), v_category, round(p_amount, 2), v_channel,
                v_note, v_owner)
        RETURNING * INTO v_e;
        INSERT INTO public.finance_ledger_entries (entry_type, revenue_class, amount, direction, source_type, source_id,
                                                   correlation_id, created_by)
        VALUES ('EXPENSE', NULL, v_e.amount, -1, 'EXPENSE', v_e.id, v_corr, v_owner);
        v_row := to_jsonb(v_e);
    ELSE
        INSERT INTO public.other_income_entries (income_no, category, amount, channel, note, created_by)
        VALUES (public._next_document_no('OTHER_INCOME'), v_category, round(p_amount, 2), v_channel, v_note, v_owner)
        RETURNING * INTO v_i;
        INSERT INTO public.finance_ledger_entries (entry_type, revenue_class, amount, direction, source_type, source_id,
                                                   correlation_id, created_by)
        VALUES ('REVENUE', 'OTHER', v_i.amount, 1, 'OTHER_INCOME', v_i.id, v_corr, v_owner);
        v_row := to_jsonb(v_i);
    END IF;
    -- same ledger lines as expense_create / other_income_create (_ledger), written for the OWNER (no auth.uid() here)

    INSERT INTO public.audit_logs (actor_id, actor_name, action, entity_type, entity_id, after_data, reason,
                                   pin_verified, amount, channel, result, correlation_id)
    VALUES (v_owner, v_name,
            CASE WHEN v_kind = 'EXPENSE' THEN 'EXPENSE_CREATE' ELSE 'OTHER_INCOME_CREATE' END,
            CASE WHEN v_kind = 'EXPENSE' THEN 'EXPENSE' ELSE 'OTHER_INCOME' END,
            (v_row ->> 'id')::uuid, v_row || jsonb_build_object('via', 'LINE'), v_note,
            false, (v_row ->> 'amount')::numeric, 'LINE', 'SUCCESS', v_corr);

    RETURN jsonb_build_object('result', 'OK', 'kind', v_kind,
                              'doc_no', COALESCE(v_row ->> 'expense_no', v_row ->> 'income_no'),
                              'amount', (v_row ->> 'amount')::numeric);
END;
$function$;

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
                              'status', v_c.status, 'is_staff', v_c.profile_id IS NOT NULL, 'reply_allowed', NOT public._line_scope_blocked(v_c.id,'MESSAGES'),
                              'interaction', CASE WHEN p_kind = 'POSTBACK' AND p_text ~ '(^|&)kind=catalog(&|$)'
                                  AND p_text ~ '(^|&)a=(main|home|cat|price|preorder|contact|info|register)(&|$)' THEN
                                  public.line_interaction_check(p_line_user_id, CASE
                                      WHEN p_text ~ '(^|&)a=(price|preorder)(&|$)' THEN 'INQUIRY'
                                      WHEN p_text ~ '(^|&)a=(home|cat)(&|$)' THEN 'CATALOG' ELSE 'GENERAL' END, left(p_text,128)) END);
END;
$$;

CREATE OR REPLACE FUNCTION public._line_delivery_allowed(c public.line_contacts, p_source text, p_template text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT COALESCE(c.followed AND NOT public._line_scope_blocked(c.id,'MESSAGES') AND CASE
        WHEN p_source = 'REGISTER' THEN p_template IN ('REGISTER_WELCOME', 'REGISTER_NEED_INFO', 'REGISTER_APPROVED', 'REGISTER_REJECTED')
        WHEN p_source = 'SHOP_MESSAGE' THEN p_template = 'SHOP_MESSAGE'
        ELSE c.status = 'LINKED' AND NOT c.needs_review AND (
            (c.customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.customers x WHERE x.id = c.customer_id AND x.active)) OR
            (c.profile_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles x WHERE x.id = c.profile_id AND x.status = 'ACTIVE')) OR
            (c.driver_code IS NOT NULL AND public._line_driver_active(c.driver_code)))
    END, false);
$$;

CREATE OR REPLACE FUNCTION public.line_contact_message_send(p_contact_id uuid, p_text text, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c    public.line_contacts%ROWTYPE;
    v_text text := btrim(COALESCE(p_text, ''));
    v_id   uuid;
BEGIN
    PERFORM public._require_active_member();
    PERFORM public._require_menu('customers', 'bills', 'appointments', 'line');
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF v_text = '' OR length(v_text) > 1000 THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_c FROM public.line_contacts WHERE id = p_contact_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002';
    END IF;
    IF public._line_scope_blocked(v_c.id,'MESSAGES') THEN RAISE EXCEPTION 'LINE_CONTACT_SUSPENDED' USING ERRCODE = '42501'; END IF;
    IF NOT v_c.followed THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNREACHABLE' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key, requested_by)
    VALUES (v_c.id, 'SHOP_MESSAGE', NULL, 'SHOP_MESSAGE', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text)),
            'M:' || v_c.id || ':' || p_idempotency_key, auth.uid())
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
        PERFORM public._audit_line(auth.uid(), 'LINE_SHOP_MESSAGE', 'LINE_CONTACT', v_c.id, jsonb_build_object('length', length(v_text)));
    END IF;
    RETURN jsonb_build_object('delivery_id', v_id, 'duplicate', v_id IS NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.line_people_list(p_view text, p_search text DEFAULT NULL, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limit integer := least(greatest(COALESCE(p_limit, 25), 1), 50);
    v_off   integer := greatest(COALESCE(p_offset, 0), 0);
    v_q     text := lower(btrim(COALESCE(p_search, '')));
BEGIN
    PERFORM public._require_active_member();
    IF p_view IS NULL OR p_view NOT IN ('ALL', 'UNREG', 'PENDING', 'NEEDINFO', 'CUSTOMERS', 'STAFF', 'DRIVERS', 'GENERAL', 'REJECTED', 'UNLINKED', 'BLOCKED') THEN
        RAISE EXCEPTION 'LINE_VIEW_INVALID' USING ERRCODE = '22023';
    END IF;
    RETURN (
        WITH base AS (
            SELECT c.*, cu.name AS customer_name, cu.phone AS customer_phone,
                   COALESCE(NULLIF(pr.display_name, ''), pr.username) AS profile_name
              FROM public.line_contacts c
              LEFT JOIN public.customers cu ON cu.id = c.customer_id
              LEFT JOIN public.profiles pr ON pr.id = c.profile_id
             WHERE public._line_people_in_view(p_view, c)
               AND (v_q = '' OR position(v_q IN lower(concat_ws(' ', c.display_name, c.typed_name, c.typed_phone,
                                                                  cu.name, cu.phone, pr.display_name, pr.username, c.driver_code))) > 0)
        ), page AS (
            SELECT * FROM base ORDER BY COALESCE(last_event_at, created_at) DESC, id LIMIT v_limit OFFSET v_off
        )
        SELECT jsonb_build_object(
            'total', (SELECT count(*) FROM base),
            'rows', COALESCE(jsonb_agg(jsonb_build_object(
                'id', id, 'display_name', display_name, 'picture_url', picture_url,
                'status', status, 'followed', followed, 'followed_at', followed_at, 'created_at', created_at,
                'last_event_at', last_event_at, 'register_status', register_status, 'register_note', register_note,
                'register_payload', register_payload, 'register_customer_id', register_customer_id,
                'typed_name', typed_name, 'typed_phone', typed_phone, 'needs_review', needs_review,
                'customer_id', customer_id, 'customer_name', customer_name, 'customer_phone', customer_phone,
                'profile_id', profile_id, 'profile_name', profile_name, 'driver_code', driver_code,
                'linked_at', linked_at, 'unlinked_at', unlinked_at, 'unlink_reason', unlink_reason,
                'self_registered', self_registered, 'restriction_count', (SELECT count(*) FROM public.line_contact_restrictions r WHERE r.contact_id = page.id AND r.revoked_at IS NULL AND (r.until_at IS NULL OR r.until_at > now()))) ORDER BY COALESCE(last_event_at, created_at) DESC, id), '[]'::jsonb))
          FROM page);
END;
$$;

CREATE OR REPLACE FUNCTION public._line_rich_menu_kind(c public.line_contacts)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN public._line_scope_blocked(c.id,'ALL') THEN 'GENERAL'
        WHEN c.status = 'LINKED' AND NOT c.needs_review AND c.customer_id IS NOT NULL THEN 'CUSTOMER'
        WHEN c.status = 'LINKED' AND NOT c.needs_review AND c.profile_id IS NOT NULL THEN 'STAFF'
        WHEN c.status = 'LINKED' AND NOT c.needs_review AND c.driver_code IS NOT NULL THEN 'DRIVER'
        ELSE 'GENERAL'
    END;
$$;

REVOKE ALL ON FUNCTION public._line_user_blocked(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.line_delivery_ready(p_delivery_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_d public.line_deliveries%ROWTYPE; v_c public.line_contacts%ROWTYPE;
BEGIN
    PERFORM public._line_require_server();
    SELECT * INTO v_d FROM public.line_deliveries WHERE id = p_delivery_id FOR UPDATE;
    IF NOT FOUND OR v_d.status <> 'SENDING' THEN RETURN false; END IF;
    SELECT * INTO v_c FROM public.line_contacts WHERE id = v_d.contact_id;
    IF NOT FOUND OR NOT public._line_delivery_allowed(v_c,v_d.source_type,v_d.template_key) THEN
        UPDATE public.line_deliveries SET status = 'CANCELLED',last_error_code = 'CONTACT_UNREACHABLE',locked_until = NULL,updated_at = now() WHERE id = p_delivery_id;
        RETURN false;
    END IF;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.line_delivery_ready(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.line_delivery_ready(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public._line_owner_id(p_line_user_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
    SELECT p.id
      FROM public.line_contacts c
      JOIN public.profiles p ON p.id = c.profile_id
     WHERE c.line_user_id = p_line_user_id AND c.status = 'LINKED' AND NOT c.needs_review
       AND p.role = 'OWNER' AND p.status = 'ACTIVE'
     LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.line_contact_review_ok(p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_owner();
    IF public._line_scope_blocked(p_contact_id,'REGISTER') THEN RAISE EXCEPTION 'LINE_CONTACT_SUSPENDED' USING ERRCODE = '42501'; END IF;
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

CREATE OR REPLACE FUNCTION public._line_customer_reminder_rows(p_auto boolean)
RETURNS TABLE (rule text, source_type text, source_id uuid, contact_id uuid, customer_name text,
               ref_no text, due_at timestamptz, amount numeric, days_left integer, dedupe_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_r       jsonb := COALESCE(public._policy('line', '{}'::jsonb) -> 'reminders', '{}'::jsonb);
    v_hour    integer := public._line_option_int('reminderHour', 9, 0, 23);
    v_today   date := public._local_date(now());
    v_on      boolean;
    v_before  integer;
    v_repeat  integer;
BEGIN
    IF p_auto AND extract(hour FROM now() AT TIME ZONE 'Asia/Bangkok') < v_hour THEN
        RETURN;
    END IF;

    -- rental bills: earliest open return of the bill
    v_on := NOT p_auto OR COALESCE((v_r -> 'RENTAL_DUE_SOON' ->> 'enabled')::boolean, false);
    v_before := COALESCE((v_r -> 'RENTAL_DUE_SOON' ->> 'daysBefore')::integer, CASE WHEN p_auto THEN 1 ELSE 3 END);
    IF v_on THEN
        RETURN QUERY
        SELECT 'RENTAL_DUE_SOON', 'BILL', x.bill_id, c.id, cu.name, x.bill_no, x.end_at, x.balance_due,
               public._local_date(x.end_at) - v_today,
               'R:DUE_SOON:' || x.bill_id || ':' || public._local_date(x.end_at)
          FROM (SELECT b.id AS bill_id, b.bill_no, b.customer_id, b.balance_due, min(l.rental_end_at) AS end_at
                  FROM public.bills b JOIN public.bill_lines l ON l.bill_id = b.id
                 WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND b.status = 'ACTIVE'
                 GROUP BY b.id) x
          JOIN public.customers cu ON cu.id = x.customer_id
          JOIN public.line_contacts c ON c.customer_id = x.customer_id AND public._line_delivery_allowed(c,'APPOINTMENT','CUSTOMER_APPOINTMENT')
         WHERE public._local_date(x.end_at) - v_today BETWEEN 1 AND greatest(v_before, 1);
    END IF;

    v_on := NOT p_auto OR COALESCE((v_r -> 'RENTAL_DUE_TODAY' ->> 'enabled')::boolean, false);
    IF v_on THEN
        RETURN QUERY
        SELECT 'RENTAL_DUE_TODAY', 'BILL', x.bill_id, c.id, cu.name, x.bill_no, x.end_at, x.balance_due, 0,
               'R:DUE_TODAY:' || x.bill_id || ':' || public._local_date(x.end_at)
          FROM (SELECT b.id AS bill_id, b.bill_no, b.customer_id, b.balance_due, min(l.rental_end_at) AS end_at
                  FROM public.bills b JOIN public.bill_lines l ON l.bill_id = b.id
                 WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND b.status = 'ACTIVE'
                 GROUP BY b.id) x
          JOIN public.customers cu ON cu.id = x.customer_id
          JOIN public.line_contacts c ON c.customer_id = x.customer_id AND public._line_delivery_allowed(c,'APPOINTMENT','CUSTOMER_APPOINTMENT')
         WHERE public._local_date(x.end_at) = v_today;
    END IF;

    v_on := NOT p_auto OR COALESCE((v_r -> 'RENTAL_OVERDUE' ->> 'enabled')::boolean, false);
    v_repeat := COALESCE((v_r -> 'RENTAL_OVERDUE' ->> 'repeatDays')::integer, 0);
    IF v_on THEN
        RETURN QUERY
        SELECT 'RENTAL_OVERDUE', 'BILL', x.bill_id, c.id, cu.name, x.bill_no, x.end_at, x.balance_due,
               public._local_date(x.end_at) - v_today,
               'R:OVERDUE:' || x.bill_id || ':' || public._local_date(x.end_at)
               || CASE WHEN v_repeat > 0 THEN ':' || ((v_today - public._local_date(x.end_at) - 1) / v_repeat) ELSE '' END
          FROM (SELECT b.id AS bill_id, b.bill_no, b.customer_id, b.balance_due, min(l.rental_end_at) AS end_at
                  FROM public.bills b JOIN public.bill_lines l ON l.bill_id = b.id
                 WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND b.status = 'ACTIVE'
                 GROUP BY b.id) x
          JOIN public.customers cu ON cu.id = x.customer_id
          JOIN public.line_contacts c ON c.customer_id = x.customer_id AND public._line_delivery_allowed(c,'APPOINTMENT','CUSTOMER_APPOINTMENT')
         WHERE public._local_date(x.end_at) < v_today;
    END IF;

    v_on := NOT p_auto OR COALESCE((v_r -> 'PAYMENT_DUE' ->> 'enabled')::boolean, false);
    v_before := COALESCE((v_r -> 'PAYMENT_DUE' ->> 'daysBefore')::integer, CASE WHEN p_auto THEN 1 ELSE 3 END);
    v_repeat := COALESCE((v_r -> 'PAYMENT_DUE' ->> 'repeatDays')::integer, 0);
    IF v_on THEN
        RETURN QUERY
        SELECT 'PAYMENT_DUE', 'BILL', b.id, c.id, cu.name, b.bill_no, b.due_date::timestamptz, b.balance_due,
               b.due_date - v_today,
               'R:PAY:' || b.id || ':' || b.due_date
               || CASE WHEN b.due_date < v_today THEN ':late'
                       || CASE WHEN v_repeat > 0 THEN ':' || ((v_today - b.due_date - 1) / v_repeat) ELSE '' END
                       ELSE '' END
          FROM public.bills b
          JOIN public.customers cu ON cu.id = b.customer_id
          JOIN public.line_contacts c ON c.customer_id = b.customer_id AND public._line_delivery_allowed(c,'APPOINTMENT','CUSTOMER_APPOINTMENT')
         WHERE b.status IN ('CONFIRMED', 'ACTIVE', 'CLOSED') AND b.balance_due > 0 AND b.due_date IS NOT NULL
           AND b.due_date - v_today <= v_before;
    END IF;

    v_on := NOT p_auto OR COALESCE((v_r -> 'APPOINTMENT_DUE' ->> 'enabled')::boolean, false);
    v_before := COALESCE((v_r -> 'APPOINTMENT_DUE' ->> 'daysBefore')::integer, CASE WHEN p_auto THEN 1 ELSE 3 END);
    IF v_on THEN
        RETURN QUERY
        SELECT 'APPOINTMENT_DUE', 'APPOINTMENT', a.id, c.id, cu.name, a.title, a.start_datetime, NULL::numeric,
               public._local_date(a.start_datetime) - v_today,
               'R:APPT:' || a.id || ':' || public._local_date(a.start_datetime)
          FROM public.appointments a
          JOIN public.customers cu ON cu.id = a.customer_id
          JOIN public.line_contacts c ON c.customer_id = a.customer_id AND public._line_delivery_allowed(c,'APPOINTMENT','CUSTOMER_APPOINTMENT')
         WHERE a.status IN ('DRAFT', 'SCHEDULED', 'CONFIRMED', 'RESCHEDULED') AND a.start_datetime >= now()
           AND public._local_date(a.start_datetime) - v_today <= v_before;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.line_delivery_retry(p_delivery_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_menu('line');
    UPDATE public.line_deliveries
       SET status = 'PENDING', attempts = 0, next_attempt_at = now(), locked_until = NULL,
           last_error_code = NULL, updated_at = now()
     WHERE id = p_delivery_id AND status IN ('DEAD', 'FAILED', 'CANCELLED')
       AND EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.id = contact_id AND public._line_delivery_allowed(c,line_deliveries.source_type,line_deliveries.template_key));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_DELIVERY_NOT_RETRYABLE' USING ERRCODE = '22023';
    END IF;
    PERFORM public._audit('LINE_DELIVERY_RETRY', 'LINE_DELIVERY', p_delivery_id, NULL, NULL,
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', 'PENDING');
END;
$$;
