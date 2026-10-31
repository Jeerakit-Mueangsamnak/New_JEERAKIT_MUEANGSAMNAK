-- ============================================================================
-- LINE self-registration v1 (owner approved 2026-10-31)
--
-- A stranger who adds the shop OA gets a reply asking for name + phone in one message.
--   * phone not in customers            -> create the customer and link (self_registered)
--   * phone of ONE customer without LINE -> link to that customer (no shop step)
--   * phone of a customer with a LINE    -> never replaced: stays pending (PHONE_TAKEN)
--   * phone of SEVERAL customers         -> stays pending (DUPLICATE), the shop decides
-- The shop can type name + phone for a pending contact (same rule) or reject it.
-- 1 customer = 1 LINE (line_contacts_customer_uidx). Replies only, never a push.
--
-- Drivers: unchanged. Drivers already have no POS account (store_settings.policies
-- .delivery_drivers, code D001…); line_contacts.driver_code and line_tasks.driver_code from
-- 20261010090000 link them and assign jobs. No second driver table is made.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Registration state per contact
-- ----------------------------------------------------------------------------
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS register_status text;
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS register_customer_id uuid REFERENCES public.customers (id) ON DELETE RESTRICT;
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS self_registered boolean NOT NULL DEFAULT false;
ALTER TABLE public.line_contacts DROP CONSTRAINT IF EXISTS line_contacts_register_status_check;
ALTER TABLE public.line_contacts ADD CONSTRAINT line_contacts_register_status_check CHECK (
    register_status IS NULL OR register_status IN ('WAITING', 'PHONE_TAKEN', 'DUPLICATE', 'REJECTED'));
CREATE INDEX IF NOT EXISTS line_contacts_register_idx ON public.line_contacts (register_status)
    WHERE status = 'UNLINKED' AND register_status IS NOT NULL;
GRANT SELECT (register_status, register_customer_id, self_registered) ON public.line_contacts TO authenticated;

-- Friends who added the OA before this version and are still not linked wait for the shop too.
UPDATE public.line_contacts SET register_status = 'WAITING', updated_at = now()
 WHERE status = 'UNLINKED' AND followed AND register_status IS NULL;

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
-- 3. The one rule (webhook and shop share it). p_actor NULL = the customer typed it in LINE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._line_register_apply(p_contact_id uuid, p_name text, p_phone text, p_actor uuid)
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
        -- New customer. The shop member who typed it is the creator; from LINE it is the shop OWNER.
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
               register_status = NULL, register_customer_id = NULL,
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
-- 4. Webhook side (service_role only)
-- ----------------------------------------------------------------------------
-- After a FOLLOW event: keep the LINE display name, and an unlinked friend waits for the
-- shop (a friend who was rejected and adds the OA again waits again).
CREATE OR REPLACE FUNCTION public.line_contact_follow(p_line_user_id text, p_display_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c public.line_contacts%ROWTYPE;
BEGIN
    PERFORM public._line_require_server();
    UPDATE public.line_contacts
       SET display_name = COALESCE(NULLIF(left(btrim(COALESCE(p_display_name, '')), 200), ''), display_name),
           register_status = CASE WHEN status = 'UNLINKED' THEN 'WAITING' ELSE register_status END,
           register_customer_id = CASE WHEN status = 'UNLINKED' THEN NULL ELSE register_customer_id END,
           updated_at = now()
     WHERE line_user_id = p_line_user_id
    RETURNING * INTO v_c;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('status', v_c.status, 'register_status', v_c.register_status);
END;
$$;

-- Name + phone typed in the 1:1 chat by an unlinked contact.
CREATE OR REPLACE FUNCTION public.line_self_register(p_line_user_id text, p_name text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c public.line_contacts%ROWTYPE;
BEGIN
    PERFORM public._line_require_server();
    SELECT * INTO v_c FROM public.line_contacts WHERE line_user_id = p_line_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002';
    END IF;
    IF v_c.status = 'LINKED' THEN
        RETURN jsonb_build_object('result', 'ALREADY_LINKED');
    END IF;
    IF v_c.register_status = 'REJECTED' THEN
        RETURN jsonb_build_object('result', 'REJECTED');
    END IF;
    RETURN public._line_register_apply(v_c.id, p_name, p_phone, NULL);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Shop side (signed-in member; RLS-free through these functions only)
-- ----------------------------------------------------------------------------
-- "ร้านกรอกให้": the shop types name + phone for a pending contact; same rule as the chat.
CREATE OR REPLACE FUNCTION public.line_contact_register_by_shop(p_contact_id uuid, p_name text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_active_member();
    PERFORM public._require_menu('customers', 'pos', 'bills');
    RETURN public._line_register_apply(p_contact_id, p_name, p_phone, auth.uid());
END;
$$;

-- "ไม่รับ": the contact stays a friend of the OA but leaves the list and is linked to no one.
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
    UPDATE public.line_contacts SET register_status = 'REJECTED', register_customer_id = NULL, updated_at = now()
     WHERE id = p_contact_id;
    PERFORM public._audit('LINE_CONTACT_REJECT', 'LINE_CONTACT', p_contact_id,
                          jsonb_build_object('register_status', v_c.register_status), jsonb_build_object('register_status', 'REJECTED'),
                          v_reason, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('contact_id', p_contact_id, 'register_status', 'REJECTED');
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._line_register_apply(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
    public.line_contact_follow(text, text),
    public.line_self_register(text, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.line_contact_follow(text, text),
    public.line_self_register(text, text, text)
TO service_role;

REVOKE ALL ON FUNCTION
    public.line_contact_register_by_shop(uuid, text, text),
    public.line_contact_reject(uuid, text)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
    public.line_contact_register_by_shop(uuid, text, text),
    public.line_contact_reject(uuid, text)
TO authenticated;
