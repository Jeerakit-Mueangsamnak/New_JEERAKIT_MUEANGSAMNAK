-- ============================================================================
-- LINE people management + registration review v1 (owner 2026-11-21, phases 1–2)
--
--   * One rule for "which people are in which list" (_line_people_in_view), used by the counts and the
--     list so the numbers on screen and the rows always agree. Pages of 25, only the columns a screen
--     needs, never line_user_id.
--   * The shop checks a request: approve (new customer, or an existing customer after the shop is sure),
--     ask for more, reject with a reason. Each one is audited; none of them can link a LINE to a customer
--     that already has one.
--   * The registration form (LIFF) files the same request, with the address and the consent the person gave.
--   * Messages to people who are not linked yet (answer to a request, a word from the shop) have their own
--     sources in the outbox (REGISTER, SHOP_MESSAGE); an unfollowed / blocked friend is never queued.
--   * Link codes can be listed and revoked; the LINE audit trail can be read (owner).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Outbox sources
-- ----------------------------------------------------------------------------
ALTER TABLE public.line_deliveries DROP CONSTRAINT IF EXISTS line_deliveries_source_check;
ALTER TABLE public.line_deliveries ADD CONSTRAINT line_deliveries_source_check CHECK (source_type IN (
    'NOTIFICATION', 'BILL', 'APPOINTMENT', 'TASK', 'TEST', 'DAILY_SUMMARY', 'REGISTER', 'SHOP_MESSAGE'));

-- ----------------------------------------------------------------------------
-- 2. Texts the OWNER may reword (same list as lib/line/templates.ts)
-- ----------------------------------------------------------------------------
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
        WHEN 'REGISTER_WELCOME'         THEN ARRAY['ชื่อร้าน']
        WHEN 'REGISTER_RETRY'           THEN ARRAY[]::text[]
        WHEN 'REGISTER_PHONE_TAKEN'     THEN ARRAY[]::text[]
        WHEN 'REGISTER_PENDING'         THEN ARRAY[]::text[]
        WHEN 'REGISTER_HOWTO'           THEN ARRAY[]::text[]
        WHEN 'REGISTER_APPROVED'        THEN ARRAY['ชื่อ', 'ชื่อร้าน']
        WHEN 'REGISTER_REJECTED'        THEN ARRAY['ชื่อร้าน', 'เบอร์โทรร้าน']
        WHEN 'REGISTER_NEED_INFO'       THEN ARRAY['ข้อความจากร้าน', 'ชื่อร้าน']
        WHEN 'SHOP_INFO'                THEN ARRAY['ชื่อร้าน', 'เบอร์โทรร้าน']
        WHEN 'CONTACT_SHOP'             THEN ARRAY['ชื่อร้าน', 'เบอร์โทรร้าน']
        WHEN 'PRICE_INQUIRY_REPLY'      THEN ARRAY['รายการ']
        WHEN 'PREORDER_INQUIRY_REPLY'   THEN ARRAY['รายการ']
        WHEN 'CATALOG_INTRO'            THEN ARRAY[]::text[]
        WHEN 'CATALOG_ITEMS_INTRO'      THEN ARRAY['หมวด']
        WHEN 'CATALOG_EMPTY'            THEN ARRAY['เบอร์โทรร้าน']
        WHEN 'TEST'                     THEN ARRAY['ชื่อร้าน']
        WHEN 'STAFF_NOTICE'             THEN ARRAY['หัวข้อ', 'รายละเอียด']
        WHEN 'TASK_NEW'                 THEN ARRAY['ผู้สั่ง', 'เรื่อง']
        WHEN 'TASK_ACCEPTED'            THEN ARRAY['เรื่อง']
        WHEN 'TASK_DONE'                THEN ARRAY['เรื่อง']
        WHEN 'TASK_NOT_ALLOWED'         THEN ARRAY[]::text[]
        WHEN 'TASK_STEP_DONE'           THEN ARRAY['ขั้นตอน', 'เรื่อง']
        WHEN 'TASK_ACCEPT_FIRST'        THEN ARRAY[]::text[]
        WHEN 'TASK_WITHDRAWN'           THEN ARRAY['เรื่อง']
        WHEN 'TASK_CANCELLED'           THEN ARRAY['เรื่อง', 'เหตุผล']
        WHEN 'DRIVER_ACCEPT_REMINDER'   THEN ARRAY['เรื่อง']
        WHEN 'CUSTOMER_RETURN_REMINDER' THEN ARRAY['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน']
        WHEN 'CUSTOMER_DUE_TODAY'       THEN ARRAY['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน']
        WHEN 'CUSTOMER_OVERDUE'         THEN ARRAY['ชื่อลูกค้า', 'เลขบิล', 'วันคืน', 'ยอดค้าง', 'ชื่อร้าน']
        WHEN 'CUSTOMER_PAYMENT_DUE'     THEN ARRAY['ชื่อลูกค้า', 'เลขบิล', 'วันครบ', 'ยอดค้าง', 'ชื่อร้าน']
        WHEN 'CUSTOMER_APPOINTMENT'     THEN ARRAY['ชื่อลูกค้า', 'เรื่อง', 'วันนัด', 'ชื่อร้าน']
        WHEN 'CUSTOMER_JOB_STEP'        THEN ARRAY['ชื่อลูกค้า', 'เรื่อง', 'ขั้นตอน', 'คนขับ', 'ชื่อร้าน']
    END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Which list a person is in (the one rule for counts and rows)
--    UNREG     friend who typed nothing yet             PENDING   a request waits for the shop
--    NEEDINFO  the shop asked for more                  CUSTOMERS / STAFF / DRIVERS  linked
--    GENERAL   friend nobody has confirmed (not rejected, not blocked)
--    REJECTED  the shop said no                         UNLINKED  the shop took the link away
--    BLOCKED   added the OA, then blocked / deleted it   ALL       everybody
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._line_people_in_view(p_view text, c public.line_contacts)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_view
        WHEN 'ALL'       THEN true
        WHEN 'UNREG'     THEN c.status = 'UNLINKED' AND c.followed AND c.unlinked_at IS NULL
                              AND COALESCE(c.register_status, 'WAITING') = 'WAITING'
        WHEN 'PENDING'   THEN c.status = 'UNLINKED' AND c.register_status IN ('PENDING', 'PHONE_TAKEN', 'DUPLICATE')
        WHEN 'NEEDINFO'  THEN c.status = 'UNLINKED' AND c.register_status = 'NEED_INFO'
        WHEN 'CUSTOMERS' THEN c.status = 'LINKED' AND c.customer_id IS NOT NULL
        WHEN 'STAFF'     THEN c.status = 'LINKED' AND c.profile_id IS NOT NULL
        WHEN 'DRIVERS'   THEN c.status = 'LINKED' AND c.driver_code IS NOT NULL
        WHEN 'GENERAL'   THEN c.status = 'UNLINKED' AND c.followed AND c.register_status IS DISTINCT FROM 'REJECTED'
        WHEN 'REJECTED'  THEN c.status = 'UNLINKED' AND c.register_status = 'REJECTED'
        WHEN 'UNLINKED'  THEN c.status = 'UNLINKED' AND c.unlinked_at IS NOT NULL
        WHEN 'BLOCKED'   THEN NOT c.followed AND c.followed_at IS NOT NULL
        ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION public.line_people_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_active_member();
    RETURN (
        SELECT jsonb_build_object(
            'all',       count(*),
            'unreg',     count(*) FILTER (WHERE public._line_people_in_view('UNREG', c)),
            'pending',   count(*) FILTER (WHERE public._line_people_in_view('PENDING', c)),
            'needinfo',  count(*) FILTER (WHERE public._line_people_in_view('NEEDINFO', c)),
            'customers', count(*) FILTER (WHERE public._line_people_in_view('CUSTOMERS', c)),
            'staff',     count(*) FILTER (WHERE public._line_people_in_view('STAFF', c)),
            'drivers',   count(*) FILTER (WHERE public._line_people_in_view('DRIVERS', c)),
            'general',   count(*) FILTER (WHERE public._line_people_in_view('GENERAL', c)),
            'rejected',  count(*) FILTER (WHERE public._line_people_in_view('REJECTED', c)),
            'unlinked',  count(*) FILTER (WHERE public._line_people_in_view('UNLINKED', c)),
            'blocked',   count(*) FILTER (WHERE public._line_people_in_view('BLOCKED', c)))
          FROM public.line_contacts c);
END;
$$;

-- One page of a list: { total, rows[] }. line_user_id never leaves the database.
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
                'self_registered', self_registered) ORDER BY COALESCE(last_event_at, created_at) DESC, id), '[]'::jsonb))
          FROM page);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. The shop checks a request
-- ----------------------------------------------------------------------------
-- "ขอข้อมูลเพิ่ม": the request stays open, the person is told what the shop needs.
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
    PERFORM public._require_active_member();
    PERFORM public._require_menu('customers', 'pos', 'bills');
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

-- "อนุมัติ": link the request to an existing customer the shop is sure about, or make the customer from
-- what the person gave (the shop may correct it first). 1 customer = 1 LINE, never replaced here.
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
    PERFORM public._require_active_member();
    PERFORM public._require_menu('customers', 'pos', 'bills');
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

-- "ปฏิเสธ": the reason is kept (audit + register_note); the person stays a friend, linked to no one.
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
    PERFORM public._require_active_member();
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

-- ----------------------------------------------------------------------------
-- 5. The registration form (LIFF): same request as the chat, plus the address and the consent.
--    service_role only: the LINE account comes from the verified ID token, never from the page.
-- ----------------------------------------------------------------------------
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
    IF v_res ->> 'result' = 'PENDING' THEN
        UPDATE public.line_contacts
           SET register_payload = register_payload || jsonb_build_object('address', v_addr, 'channel', 'FORM', 'consent_at', now()),
               updated_at = now()
         WHERE id = v_c.id;
    END IF;
    RETURN v_res;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Outbox for people who are not linked yet (service_role): the answer to a request. Any friend who
--    still follows the OA; never a blocked / deleted one.
-- ----------------------------------------------------------------------------
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
    IF NOT public._line_messages_valid(p_messages) THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.id = p_contact_id AND c.followed) THEN
        RETURN jsonb_build_object('skipped', 'CONTACT_UNREACHABLE');
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key)
    VALUES (p_contact_id, 'REGISTER', p_contact_id, p_template_key, p_messages, 'R:' || p_dedupe_key)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('delivery_id', v_id, 'duplicate', v_id IS NULL);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. "ติดต่อผ่าน LINE": a plain text from the shop to one friend (any status, not blocked)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 8. Link codes (owner): list without the secret, and revoke an open one
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.line_codes_list(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_owner();
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', k.id, 'purpose', k.purpose, 'driver_code', k.driver_code,
            'target', COALESCE(cu.name, NULLIF(pr.display_name, ''), pr.username, k.driver_code),
            'created_at', k.created_at, 'expires_at', k.expires_at, 'used_at', k.used_at, 'revoked_at', k.revoked_at,
            'state', CASE WHEN k.used_at IS NOT NULL THEN 'USED' WHEN k.revoked_at IS NOT NULL THEN 'REVOKED'
                          WHEN k.expires_at <= now() THEN 'EXPIRED' ELSE 'OPEN' END,
            'created_by', COALESCE(NULLIF(cb.display_name, ''), cb.username)) ORDER BY k.created_at DESC)
          FROM (SELECT * FROM public.line_link_codes ORDER BY created_at DESC LIMIT least(greatest(COALESCE(p_limit, 50), 1), 100)) k
          LEFT JOIN public.customers cu ON cu.id = k.customer_id
          LEFT JOIN public.profiles pr ON pr.id = k.profile_id
          LEFT JOIN public.profiles cb ON cb.id = k.created_by), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.line_link_code_revoke(p_code_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_k public.line_link_codes%ROWTYPE;
BEGIN
    PERFORM public._require_owner();
    SELECT * INTO v_k FROM public.line_link_codes WHERE id = p_code_id FOR UPDATE;
    IF NOT FOUND OR v_k.used_at IS NOT NULL OR v_k.revoked_at IS NOT NULL OR v_k.expires_at <= now() THEN
        RAISE EXCEPTION 'LINE_CODE_NOT_OPEN' USING ERRCODE = '22023';
    END IF;
    UPDATE public.line_link_codes SET revoked_at = now() WHERE id = v_k.id;
    PERFORM public._audit_line(auth.uid(), 'LINE_CODE_REVOKE', 'LINE_CONTACT', NULL, jsonb_build_object('purpose', v_k.purpose));
    RETURN jsonb_build_object('code_id', v_k.id, 'revoked', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. The LINE audit trail (owner): who did what, newest first, a page at a time; one person's history with p_entity
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.line_audit_list(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_entity uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_owner();
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', a.id, 'created_at', a.created_at, 'action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id,
            'result', a.result, 'reason', a.reason,
            'actor', COALESCE(NULLIF(p.display_name, ''), p.username, 'ระบบ'),
            'detail', left(COALESCE(a.after_data::text, ''), 400)) ORDER BY a.created_at DESC)
          FROM (SELECT * FROM public.audit_logs
                 WHERE (action LIKE 'LINE%' OR entity_type = 'LINE_CONTACT')
                   AND (p_entity IS NULL OR entity_id = p_entity)
                 ORDER BY created_at DESC
                 LIMIT least(greatest(COALESCE(p_limit, 50), 1), 100) OFFSET greatest(COALESCE(p_offset, 0), 0)) a
          LEFT JOIN public.profiles p ON p.id = a.actor_id), '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._line_people_in_view(text, public.line_contacts) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
    public.line_people_counts(),
    public.line_people_list(text, text, integer, integer),
    public.line_contact_register_need_info(uuid, text),
    public.line_contact_register_approve(uuid, uuid, text, text, jsonb),
    public.line_contact_message_send(uuid, text, text),
    public.line_codes_list(integer),
    public.line_link_code_revoke(uuid),
    public.line_audit_list(integer, integer, uuid)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
    public.line_people_counts(),
    public.line_people_list(text, text, integer, integer),
    public.line_contact_register_need_info(uuid, text),
    public.line_contact_register_approve(uuid, uuid, text, text, jsonb),
    public.line_contact_message_send(uuid, text, text),
    public.line_codes_list(integer),
    public.line_link_code_revoke(uuid),
    public.line_audit_list(integer, integer, uuid)
TO authenticated;

REVOKE ALL ON FUNCTION public.line_contact_reject(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.line_contact_reject(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION
    public.line_register_submit(text, text, text, jsonb, boolean, text, boolean),
    public.line_outbox_enqueue_register(uuid, text, jsonb, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.line_register_submit(text, text, text, jsonb, boolean, text, boolean),
    public.line_outbox_enqueue_register(uuid, text, jsonb, text)
TO service_role;
