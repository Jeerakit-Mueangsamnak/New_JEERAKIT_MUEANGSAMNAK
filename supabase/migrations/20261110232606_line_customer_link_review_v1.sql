-- Owner 2026-11-11: a customer who links LINE with the link / QR made by the shop waits for the shop
-- to check ("ยืนยันรอให้ร้านตรวจ หากทำผิดให้แก้ไข"). The link is made, but marked needs_review until
-- the shop confirms it (line_contact_review_ok, unchanged); a wrong link is undone with
-- line_contact_unlink (unchanged) and a new link is made. While it waits, no bill is sent to it.
--  * line_link_code_consume: as on Cloud; a CUSTOMER code now sets needs_review = true and the
--    shop's notice asks to check it.
--  * line_liff_bind: as in 20261022090000; a CUSTOMER code keeps needs_review = true (staff / driver
--    codes still only when the typed name / phone do not match).
--  * line_bill_recipient: as on Cloud + contact_id, needs_review and what the customer typed.
--  * line_bill_send / line_bill_send_card: as on Cloud + refuse a link that waits (LINE_CONTACT_NEEDS_REVIEW).
-- Links made before this migration are not touched.

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

CREATE OR REPLACE FUNCTION public.line_liff_bind(
    p_line_user_id  text,
    p_display_name  text,
    p_code          text,
    p_typed_name    text,
    p_typed_phone   text,
    p_line_handle   text,
    p_is_friend     boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_k       public.line_link_codes%ROWTYPE;
    v_res     jsonb;
    v_known   text;
    v_phone   text;
    v_review  boolean := false;
    v_contact uuid;
    v_name    text := left(btrim(COALESCE(p_typed_name, '')), 200);
    v_tphone  text := left(regexp_replace(COALESCE(p_typed_phone, ''), '[^0-9]', '', 'g'), 30);
BEGIN
    PERFORM public._line_require_server();
    IF p_line_user_id IS NULL OR p_line_user_id !~ '^U[0-9a-f]{32}$' THEN
        RAISE EXCEPTION 'LINE_USER_INVALID' USING ERRCODE = '22023';
    END IF;
    IF v_name = '' THEN
        RETURN jsonb_build_object('result', 'NAME_REQUIRED');
    END IF;
    SELECT * INTO v_k FROM public.line_link_codes
     WHERE code_hash = public._line_code_hash(upper(btrim(COALESCE(p_code, '')))) AND used_at IS NULL AND revoked_at IS NULL;
    IF FOUND AND v_k.purpose = 'CUSTOMER' AND v_tphone = '' THEN
        RETURN jsonb_build_object('result', 'PHONE_REQUIRED');
    END IF;

    INSERT INTO public.line_contacts (line_user_id, display_name, followed, last_event_at)
    VALUES (p_line_user_id, left(p_display_name, 200), COALESCE(p_is_friend, false), now())
    ON CONFLICT (line_user_id) DO UPDATE
       SET display_name = COALESCE(left(EXCLUDED.display_name, 200), public.line_contacts.display_name),
           followed = COALESCE(p_is_friend, public.line_contacts.followed),
           updated_at = now()
    RETURNING id INTO v_contact;

    v_res := public.line_link_code_consume(p_line_user_id, upper(btrim(COALESCE(p_code, ''))));
    IF v_res ->> 'result' NOT IN ('LINKED_STAFF', 'LINKED_DRIVER', 'LINKED_CUSTOMER') THEN
        RETURN v_res;
    END IF;

    IF v_k.purpose = 'STAFF' THEN
        SELECT concat_ws(' ', p.first_name, p.last_name, p.display_name, p.username) INTO v_known
          FROM public.profiles p WHERE p.id = v_k.profile_id;
    ELSIF v_k.purpose = 'DRIVER' THEN
        v_known := public._line_driver_name(v_k.driver_code);
    ELSE
        SELECT c.name, regexp_replace(c.phone, '[^0-9]', '', 'g') INTO v_known, v_phone
          FROM public.customers c WHERE c.id = v_k.customer_id;
        v_review := right(v_tphone, 9) IS DISTINCT FROM right(COALESCE(v_phone, ''), 9);
    END IF;
    v_review := v_review OR NOT public._line_name_matches(v_name, COALESCE(v_known, ''));

    UPDATE public.line_contacts
       SET typed_name = v_name,
           typed_phone = NULLIF(v_tphone, ''),
           line_handle = NULLIF(left(btrim(COALESCE(p_line_handle, '')), 60), ''),
           -- A customer's link always waits for the shop (owner 2026-11-11)
           needs_review = v_review OR v_k.purpose = 'CUSTOMER',
           updated_at = now()
     WHERE id = v_contact;
    IF v_review THEN
        PERFORM public._notify('LINE_REVIEW:' || v_contact || ':' || extract(epoch FROM now())::bigint,
                               'LINE_LINKED', 'WARNING', v_k.created_by, NULL, 'LINE_CONTACT', v_contact,
                               'ตรวจการผูก LINE',
                               'ข้อมูลที่กรอก (' || v_name || COALESCE(' ' || NULLIF(v_tphone, ''), '')
                               || ') ไม่ตรงกับ ' || COALESCE(v_known, '-')
                               || ' ตรวจที่ ตั้งค่า › LINE แล้วกดยืนยันหรือยกเลิกการผูก');
    END IF;
    RETURN v_res || jsonb_build_object('needs_review', v_review OR v_k.purpose = 'CUSTOMER', 'kind', v_k.purpose);
END;
$$;

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
        'display_name', v_c.display_name,
        'contact_id', v_c.id,
        'needs_review', COALESCE(v_c.needs_review, false),
        'typed_name', v_c.typed_name,
        'typed_phone', v_c.typed_phone);
END;
$$;

CREATE OR REPLACE FUNCTION public.line_bill_send(p_bill_id uuid, p_text text, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_customer uuid;
    v_contact  uuid;
    v_review   boolean;
BEGIN
    PERFORM public._require_menu('bills', 'line');
    SELECT b.customer_id INTO v_customer FROM public.bills b WHERE b.id = p_bill_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    SELECT c.id, c.needs_review INTO v_contact, v_review FROM public.line_contacts c WHERE c.customer_id = v_customer AND c.status = 'LINKED';
    IF v_customer IS NULL OR v_contact IS NULL THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = '22023';
    END IF;
    IF v_review THEN
        RAISE EXCEPTION 'LINE_CONTACT_NEEDS_REVIEW' USING ERRCODE = '22023';
    END IF;
    RETURN public.line_delivery_enqueue(v_contact, 'BILL', p_bill_id, 'BILL_MESSAGE',
                                        jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)),
                                        p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.line_bill_send_card(p_bill_id uuid, p_messages jsonb, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_customer uuid;
    v_c        public.line_contacts%ROWTYPE;
    v_key      text;
    v_id       uuid;
    v_status   text;
    v_new      boolean := false;
BEGIN
    PERFORM public._require_active_member();
    PERFORM public._require_menu('bills', 'line');
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF NOT public._line_messages_valid(p_messages)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_messages) m WHERE m ->> 'type' NOT IN ('text', 'flex'))
       OR jsonb_path_exists(p_messages, 'strict $.**.action') THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;

    SELECT b.customer_id INTO v_customer FROM public.bills b WHERE b.id = p_bill_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_c FROM public.line_contacts c WHERE c.customer_id = v_customer AND c.status = 'LINKED';
    IF v_customer IS NULL OR v_c.id IS NULL THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = '22023';
    END IF;
    IF v_c.needs_review THEN
        RAISE EXCEPTION 'LINE_CONTACT_NEEDS_REVIEW' USING ERRCODE = '22023';
    END IF;
    IF NOT v_c.followed THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNREACHABLE' USING ERRCODE = '22023';
    END IF;

    v_key := 'U:' || auth.uid() || ':' || p_idempotency_key;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key, requested_by)
    VALUES (v_c.id, 'BILL', p_bill_id, 'BILL_CARD', p_messages, v_key, auth.uid())
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id, status INTO v_id, v_status;
    IF v_id IS NULL THEN
        SELECT id, status INTO v_id, v_status FROM public.line_deliveries WHERE dedupe_key = v_key;
    ELSE
        v_new := true;
        PERFORM public._audit('LINE_SEND', 'BILL', p_bill_id, NULL,
                              jsonb_build_object('delivery_id', v_id, 'contact_id', v_c.id, 'template', 'BILL_CARD'),
                              NULL, NULL, false, NULL, NULL, 'LINE');
    END IF;
    RETURN jsonb_build_object('delivery_id', v_id, 'status', v_status, 'duplicate', NOT v_new);
END;
$$;
