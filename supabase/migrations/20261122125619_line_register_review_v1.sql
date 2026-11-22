-- ============================================================================
-- LINE registration review v1 (owner 2026-11-21)
--
-- Before: a friend who typed "ชื่อ + เบอร์" in the OA chat was linked AT ONCE to the customer with that
-- phone (needs_review = false → that LINE then received the customer's bill cards), or a NEW customer
-- was created in the POS by itself. Anyone who knew a customer's phone could take over their LINE.
--
-- Now: whatever a stranger types in the chat only files a REQUEST (register_status = 'PENDING').
-- No customer is created, no LINE is linked, no bill text/card goes to that LINE until the shop
-- approves it. The shop's own action ("ร้านกรอกให้") keeps the old rule: a member of the shop typed
-- it and is the one who checks (_line_register_link, unchanged logic).
--
-- Also: the profile picture, the time the friend was added, an optional note and the form payload are
-- kept per contact; a FOLLOW event is split into new friend / returning friend / unblock; the owner can
-- switch the welcome text and the "new friend" notice (policies.line.friend.{welcome, notifyOwner}).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS picture_url text;
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS followed_at timestamptz;
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS register_note text;
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS register_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.line_contacts DROP CONSTRAINT IF EXISTS line_contacts_picture_check;
ALTER TABLE public.line_contacts ADD CONSTRAINT line_contacts_picture_check CHECK (
    picture_url IS NULL OR (picture_url ~ '^https://' AND length(picture_url) <= 1000));
ALTER TABLE public.line_contacts DROP CONSTRAINT IF EXISTS line_contacts_register_note_check;
ALTER TABLE public.line_contacts ADD CONSTRAINT line_contacts_register_note_check CHECK (
    register_note IS NULL OR length(register_note) <= 500);
ALTER TABLE public.line_contacts DROP CONSTRAINT IF EXISTS line_contacts_register_payload_check;
ALTER TABLE public.line_contacts ADD CONSTRAINT line_contacts_register_payload_check CHECK (
    jsonb_typeof(register_payload) = 'object' AND pg_column_size(register_payload) <= 4000);

-- Friends that already exist were added when their row was first seen (a row is only made by a LINE event);
-- followed_at stays empty only for a person who sent the form without ever adding the OA.
UPDATE public.line_contacts SET followed_at = created_at WHERE followed_at IS NULL;

-- WAITING   = friend, nothing typed yet            PENDING   = a request waits for the shop
-- NEED_INFO = the shop asked for more              REJECTED  = the shop said no
-- PHONE_TAKEN / DUPLICATE stay for the shop's own typing (_line_register_link).
ALTER TABLE public.line_contacts DROP CONSTRAINT IF EXISTS line_contacts_register_status_check;
ALTER TABLE public.line_contacts ADD CONSTRAINT line_contacts_register_status_check CHECK (
    register_status IS NULL OR register_status IN ('WAITING', 'PENDING', 'NEED_INFO', 'PHONE_TAKEN', 'DUPLICATE', 'REJECTED'));

GRANT SELECT (picture_url, followed_at, register_note, register_payload) ON public.line_contacts TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. policies.line.friend = { welcome, notifyOwner }, policies.line.catalog = { showPrice } and policies.line.register = { notifyOwner,
--    notifyApproved, notifyRejected, privacy (text), required: { province, district, subdistrict, address, postcode } }
--    (same function as 20261022090000_line_full_v1 plus the 'friend' and 'register' branches)
-- ----------------------------------------------------------------------------
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
                       "reminderHour": [0, 23]}'::jsonb;
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

-- ----------------------------------------------------------------------------
-- 3. The shop's own typing keeps the old rule (a member of the shop checks it):
--    this is the body of _line_register_apply from 20261031090000, unchanged, under a new name.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 4. The one rule for what a STRANGER types (p_actor NULL): a request, nothing else.
--    p_actor set = a shop member typed it → _line_register_link.
-- ----------------------------------------------------------------------------
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
       AND COALESCE((public._policy('line', '{}'::jsonb) -> 'register' ->> 'notifyOwner')::boolean, true) THEN
        PERFORM public._notify('LINE_REGISTER_PENDING:' || v_c.id || ':' || extract(epoch FROM now())::bigint,
                               'LINE_REGISTER_PENDING', 'WARNING', v_owner, NULL, 'LINE_CONTACT', v_c.id,
                               'มีคำขอลงทะเบียนทาง LINE รอร้านตรวจ',
                               'ชื่อที่แจ้ง ' || v_name || ' · LINE ' || COALESCE(NULLIF(v_c.display_name, ''), 'ไม่ทราบชื่อ'));
    END IF;
    RETURN jsonb_build_object('result', 'PENDING');
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. FOLLOW (service_role only): profile picture, the time the friend was added, new / returning /
--    unblock, the welcome and "new friend" switches. A pending request is never wiped by a re-follow.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.line_contact_follow(text, text);

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

    IF v_notify AND NOT p_is_unblock THEN
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
                              'send_welcome', v_welcome AND v_c.status <> 'LINKED' AND NOT p_is_unblock);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._line_register_link(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._line_register_apply(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.line_contact_follow(text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_contact_follow(text, text, text, boolean) TO service_role;
