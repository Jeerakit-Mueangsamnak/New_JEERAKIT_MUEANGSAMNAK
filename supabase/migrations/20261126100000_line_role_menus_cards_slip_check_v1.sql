-- ============================================================================
-- LINE: chat menus by role, card/text switch per message, automatic slip check (owner 2026-11-26)
--
--   1. Chat menu (rich menu) kind OWNER: the linked, confirmed OWNER gets their own menu (สรุปยอด / สั่งงาน /
--      ตรวจสลิป / อนุมัติลูกค้าใหม่). Drivers keep their kind and get the staff buttons (owner: ก).
--   2. What the menu buttons read (server only, by the LINE user id; only what the shop confirmed counts):
--      customer: own open bills, a return request (owner told on LINE, the shop arranges it in the chat);
--      staff / driver / owner: today's delivery / pickup / return queue, own open tasks, stock by category
--      (available, out on bills, reserved: the numbers the bills move); owner: today's money, slips waiting,
--      registrations waiting (approved in the app, owner: ก).
--   3. policies.line.templateCards: per message, card (FLEX) or plain text plus the card's heading / colour /
--      footer; policies.line.slipCheck: switch + the shop's receiving account names.
--   4. Slip check result on line_payment_slips (PASS / FAIL / ERROR, the bank reference); a reference seen on
--      another slip is a duplicate. The shop still approves (owner: ก). The checking service key is in Vault.
--   5. New texts the OWNER may reword.
-- Run as one transaction: a failure leaves nothing half done.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Chat menu kind OWNER
-- ----------------------------------------------------------------------------
ALTER TABLE public.line_rich_menus DROP CONSTRAINT IF EXISTS line_rich_menus_kind_check;
ALTER TABLE public.line_rich_menus ADD CONSTRAINT line_rich_menus_kind_check CHECK (kind IN ('GENERAL', 'CUSTOMER', 'STAFF', 'DRIVER', 'OWNER'));
ALTER TABLE public.line_contacts DROP CONSTRAINT IF EXISTS line_contacts_rich_menu_kind_check;
ALTER TABLE public.line_contacts ADD CONSTRAINT line_contacts_rich_menu_kind_check
    CHECK (rich_menu_kind IS NULL OR rich_menu_kind IN ('GENERAL', 'CUSTOMER', 'STAFF', 'DRIVER', 'OWNER'));

CREATE OR REPLACE FUNCTION public._line_rich_menu_kind(c public.line_contacts)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN public._line_scope_blocked(c.id,'ALL') THEN 'GENERAL'
        WHEN c.status = 'LINKED' AND NOT c.needs_review AND c.customer_id IS NOT NULL THEN 'CUSTOMER'
        WHEN c.status = 'LINKED' AND NOT c.needs_review AND c.profile_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.profile_id AND p.role = 'OWNER' AND p.status = 'ACTIVE') THEN 'OWNER'
        WHEN c.status = 'LINKED' AND NOT c.needs_review AND c.profile_id IS NOT NULL THEN 'STAFF'
        WHEN c.status = 'LINKED' AND NOT c.needs_review AND c.driver_code IS NOT NULL THEN 'DRIVER'
        ELSE 'GENERAL'
    END;
$$;
REVOKE ALL ON FUNCTION public._line_rich_menu_kind(public.line_contacts) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.line_rich_menu_status()
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
                   'kind', k.kind,
                   'published_at', m.published_at,
                   'people', (SELECT count(*) FROM public.line_contacts c WHERE c.followed AND public._line_rich_menu_kind(c) = k.kind),
                   'on_menu', (SELECT count(*) FROM public.line_contacts c WHERE c.followed AND c.rich_menu_kind = k.kind)) ORDER BY k.ord)
          FROM (VALUES ('GENERAL', 1), ('CUSTOMER', 2), ('STAFF', 3), ('DRIVER', 4), ('OWNER', 5)) AS k(kind, ord)
          LEFT JOIN public.line_rich_menus m ON m.kind = k.kind), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.line_rich_menu_status() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.line_rich_menu_status() TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. What the menu buttons read (service_role: the webhook, by the LINE user id)
-- ----------------------------------------------------------------------------
-- The contact of a LINE user when the menu kind the shop confirmed is one of p_kinds; else a row of NULLs.
CREATE OR REPLACE FUNCTION public._line_menu_contact(p_line_user_id text, p_kinds text[])
RETURNS public.line_contacts
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v public.line_contacts%ROWTYPE;
BEGIN
    SELECT * INTO v FROM public.line_contacts c WHERE c.line_user_id = p_line_user_id;
    IF NOT FOUND OR NOT (public._line_rich_menu_kind(v) = ANY (p_kinds)) THEN
        RETURN NULL;
    END IF;
    RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public._line_menu_contact(text, text[]) FROM PUBLIC, anon, authenticated, service_role;

-- Customer: the bills still open (at most 10, newest first) with what is owed and the first rental return date.
CREATE OR REPLACE FUNCTION public.line_menu_customer_bills(p_line_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v public.line_contacts%ROWTYPE;
BEGIN
    PERFORM public._line_require_server();
    v := public._line_menu_contact(p_line_user_id, ARRAY['CUSTOMER']);
    IF v.id IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_ALLOWED');
    END IF;
    RETURN jsonb_build_object(
        'result', 'OK',
        'customer_name', (SELECT cu.name FROM public.customers cu WHERE cu.id = v.customer_id),
        'owed', (SELECT COALESCE(sum(b.balance_due), 0) FROM public.bills b WHERE b.customer_id = v.customer_id AND b.status IN ('CONFIRMED', 'ACTIVE')),
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', x.id, 'bill_no', x.bill_no, 'status', x.status, 'grand_total', x.grand_total,
                       'balance_due', x.balance_due, 'due_date', x.due_date, 'return_at', x.return_at) ORDER BY x.at DESC)
              FROM (SELECT b.id, b.bill_no, b.status, b.grand_total, b.balance_due, b.due_date,
                           COALESCE(b.confirmed_at, b.created_at) AS at,
                           (SELECT min(l.rental_end_at) FROM public.bill_lines l
                             WHERE l.bill_id = b.id AND l.line_mode = 'RENTAL' AND l.obligation_held_here > 0) AS return_at
                      FROM public.bills b
                     WHERE b.customer_id = v.customer_id AND b.status IN ('CONFIRMED', 'ACTIVE')
                     ORDER BY COALESCE(b.confirmed_at, b.created_at) DESC
                     LIMIT 10) x), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.line_menu_customer_bills(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_menu_customer_bills(text) TO service_role;

-- Customer: "แจ้งนัดส่งคืนสินค้า". The owners are told (in the app and, text only, on their LINE) once an hour at
-- most per customer; the shop arranges the day in the chat. NO_BILL when nothing is out.
CREATE OR REPLACE FUNCTION public.line_menu_return_request(p_line_user_id text, p_owner_messages jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v      public.line_contacts%ROWTYPE;
    v_bill public.bills%ROWTYPE;
    v_name text;
    v_hour text := to_char(now(), 'YYYYMMDDHH24');
    v_owner record;
BEGIN
    PERFORM public._line_require_server();
    v := public._line_menu_contact(p_line_user_id, ARRAY['CUSTOMER']);
    IF v.id IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_ALLOWED');
    END IF;
    SELECT b.* INTO v_bill FROM public.bills b
     WHERE b.customer_id = v.customer_id AND b.status IN ('CONFIRMED', 'ACTIVE')
       AND EXISTS (SELECT 1 FROM public.bill_lines l WHERE l.bill_id = b.id AND l.line_mode = 'RENTAL' AND l.obligation_held_here > 0)
     ORDER BY COALESCE(b.confirmed_at, b.created_at) DESC
     LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NO_BILL');
    END IF;
    SELECT cu.name INTO v_name FROM public.customers cu WHERE cu.id = v.customer_id;
    FOR v_owner IN SELECT p.id FROM public.profiles p WHERE p.role = 'OWNER' AND p.status = 'ACTIVE' LOOP
        PERFORM public._notify('LINE_RETURN:' || v.id || ':' || v_hour || ':' || v_owner.id, 'LINE_RETURN_REQUEST', 'INFO', v_owner.id, NULL,
                               'BILL', v_bill.id, 'ลูกค้าขอนัดส่งคืนสินค้าทาง LINE',
                               COALESCE(v_name, '-') || ' · บิล ' || COALESCE(v_bill.bill_no, '-'));
    END LOOP;
    IF public._line_messages_valid(p_owner_messages)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_owner_messages) m WHERE m ->> 'type' <> 'text') THEN
        INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key)
        SELECT c.id, 'BILL', v_bill.id, 'RETURN_REQUEST_OWNER', p_owner_messages, 'RETURN:' || v.id || ':' || v_hour || ':' || c.id
          FROM public.line_contacts c
          JOIN public.profiles p ON p.id = c.profile_id
         WHERE c.status = 'LINKED' AND c.followed AND NOT c.needs_review AND p.role = 'OWNER' AND p.status = 'ACTIVE'
        ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
    PERFORM public._audit_line(NULL, 'LINE_RETURN_REQUEST', 'BILL', v_bill.id, jsonb_build_object('contact_id', v.id));
    RETURN jsonb_build_object('result', 'OK', 'bill_id', v_bill.id, 'bill_no', v_bill.bill_no, 'customer_name', v_name);
END;
$$;
REVOKE ALL ON FUNCTION public.line_menu_return_request(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_menu_return_request(text, jsonb) TO service_role;

-- Staff / driver / owner: today's delivery, pickup and return appointments (shop-wide) and this person's open tasks.
CREATE OR REPLACE FUNCTION public.line_menu_staff_jobs(p_line_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v       public.line_contacts%ROWTYPE;
    v_today date := public._local_date(now());
BEGIN
    PERFORM public._line_require_server();
    v := public._line_menu_contact(p_line_user_id, ARRAY['STAFF', 'DRIVER', 'OWNER']);
    IF v.id IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_ALLOWED');
    END IF;
    RETURN jsonb_build_object(
        'result', 'OK',
        'date', v_today,
        'queue', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', x.id, 'type', x.appointment_type, 'title', x.title, 'start', x.start_datetime, 'status', x.status,
                       'place', x.location, 'contact', COALESCE(NULLIF(btrim(x.contact_name), ''), x.customer_name),
                       'phone', COALESCE(NULLIF(btrim(x.contact_phone), ''), x.customer_phone), 'bill_no', x.bill_no) ORDER BY x.start_datetime)
              FROM (SELECT a.*, cu.name AS customer_name, cu.phone AS customer_phone, b.bill_no
                      FROM public.appointments a
                      LEFT JOIN public.customers cu ON cu.id = a.customer_id
                      LEFT JOIN public.bills b ON b.id = a.bill_id
                     WHERE a.appointment_type IN ('DELIVERY', 'PICKUP', 'RETURN')
                       AND a.status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
                       AND public._local_date(a.start_datetime) = v_today
                     ORDER BY a.start_datetime
                     LIMIT 10) x), '[]'::jsonb),
        'tasks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', t.id, 'title', t.title, 'status', t.status, 'appointment_id', t.appointment_id,
                       'driver', t.driver_code IS NOT NULL, 'bill_no', b.bill_no) ORDER BY t.created_at)
              FROM (SELECT * FROM public.line_tasks t
                     WHERE t.status IN ('SENT', 'ACCEPTED', 'ISSUE')
                       AND ((v.profile_id IS NOT NULL AND t.assignee_id = v.profile_id)
                         OR (v.driver_code IS NOT NULL AND t.driver_code = v.driver_code))
                     ORDER BY t.created_at
                     LIMIT 10) t
              LEFT JOIN public.bills b ON b.id = t.bill_id), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.line_menu_staff_jobs(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_menu_staff_jobs(text) TO service_role;

-- Staff / driver / owner: stock. No category: the active categories; a category: its active products with what is
-- available, out on bills and reserved (stock_balances, which the bills move).
CREATE OR REPLACE FUNCTION public.line_menu_stock(p_line_user_id text, p_category uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v public.line_contacts%ROWTYPE;
    v_cat public.product_categories%ROWTYPE;
BEGIN
    PERFORM public._line_require_server();
    v := public._line_menu_contact(p_line_user_id, ARRAY['STAFF', 'DRIVER', 'OWNER']);
    IF v.id IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_ALLOWED');
    END IF;
    IF p_category IS NULL THEN
        RETURN jsonb_build_object('result', 'OK', 'categories', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'count', x.n) ORDER BY x.name)
              FROM (SELECT pc.id, pc.name, count(pr.id) AS n
                      FROM public.product_categories pc
                      JOIN public.products pr ON pr.category_id = pc.id AND pr.active
                     WHERE pc.active
                     GROUP BY pc.id, pc.name
                     ORDER BY pc.name
                     LIMIT 12) x), '[]'::jsonb));
    END IF;
    SELECT * INTO v_cat FROM public.product_categories pc WHERE pc.id = p_category AND pc.active;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    RETURN jsonb_build_object(
        'result', 'OK',
        'category', jsonb_build_object('id', v_cat.id, 'name', v_cat.name),
        'total', (SELECT count(*) FROM public.products pr WHERE pr.category_id = v_cat.id AND pr.active),
        'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'name', x.name, 'unit', x.unit, 'available', x.available, 'rented', x.rented, 'reserved', x.reserved) ORDER BY x.name)
              FROM (SELECT pr.name, u.name AS unit,
                           COALESCE(sum(sb.quantity) FILTER (WHERE sb.stock_state = 'AVAILABLE'), 0) AS available,
                           COALESCE(sum(sb.quantity) FILTER (WHERE sb.stock_state = 'RENTED_OUT'), 0) AS rented,
                           COALESCE(sum(sb.quantity) FILTER (WHERE sb.stock_state = 'RESERVED'), 0) AS reserved
                      FROM public.products pr
                      LEFT JOIN public.units u ON u.id = pr.unit_id
                      LEFT JOIN public.stock_balances sb ON sb.product_id = pr.id
                     WHERE pr.category_id = v_cat.id AND pr.active
                     GROUP BY pr.id, pr.name, u.name
                     ORDER BY pr.name
                     LIMIT 30) x), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.line_menu_stock(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_menu_stock(text, uuid) TO service_role;

-- Owner: SUMMARY (money in today, as #สรุปยอดวันนี้, but not tied to the chat-command switch), SLIPS (waiting slips) or
-- REGISTER (registrations waiting for the shop). The decisions are made in the app.
CREATE OR REPLACE FUNCTION public.line_menu_owner(p_line_user_id text, p_what text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v       public.line_contacts%ROWTYPE;
    v_today date := public._local_date(now());
BEGIN
    PERFORM public._line_require_server();
    v := public._line_menu_contact(p_line_user_id, ARRAY['OWNER']);
    IF v.id IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_ALLOWED');
    END IF;
    IF p_what = 'SUMMARY' THEN
        RETURN jsonb_build_object(
            'result', 'OK',
            'date', v_today,
            'by_method', COALESCE((SELECT jsonb_agg(jsonb_build_object('method', m.method, 'amount', m.amount) ORDER BY m.amount DESC)
                                     FROM (SELECT x.method, sum(x.amount) AS amount FROM public._line_income_today(v_today) x
                                            GROUP BY x.method) m), '[]'::jsonb),
            'income', (SELECT COALESCE(sum(x.amount), 0) FROM public._line_income_today(v_today) x),
            'new_bills', (SELECT count(*) FROM public.bills b
                           WHERE b.confirmed_at IS NOT NULL AND public._local_date(b.confirmed_at) = v_today
                             AND b.status NOT IN ('DRAFT', 'CANCELLED', 'VOID')),
            'owed', (SELECT COALESCE(sum(b.balance_due), 0) FROM public.bills b WHERE b.status IN ('CONFIRMED', 'ACTIVE')));
    ELSIF p_what = 'SLIPS' THEN
        RETURN jsonb_build_object(
            'result', 'OK',
            'count', (SELECT count(*) FROM public.line_payment_slips s WHERE s.status = 'PENDING'),
            'rows', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                           'bill_no', b.bill_no, 'customer_name', cu.name, 'amount', x.amount, 'created_at', x.created_at,
                           'check_status', x.check_status) ORDER BY x.created_at)
                  FROM (SELECT * FROM public.line_payment_slips s WHERE s.status = 'PENDING' ORDER BY s.created_at LIMIT 10) x
                  JOIN public.bills b ON b.id = x.bill_id
                  LEFT JOIN public.customers cu ON cu.id = x.customer_id), '[]'::jsonb));
    ELSIF p_what = 'REGISTER' THEN
        RETURN jsonb_build_object(
            'result', 'OK',
            'count', (SELECT count(*) FROM public.line_contacts c WHERE c.register_status IN ('PENDING', 'PHONE_TAKEN', 'DUPLICATE')),
            'rows', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                           'name', COALESCE(NULLIF(btrim(x.typed_name), ''), x.display_name), 'phone', x.typed_phone,
                           'at', x.updated_at) ORDER BY x.updated_at)
                  FROM (SELECT * FROM public.line_contacts c
                         WHERE c.register_status IN ('PENDING', 'PHONE_TAKEN', 'DUPLICATE')
                         ORDER BY c.updated_at LIMIT 10) x), '[]'::jsonb));
    END IF;
    RETURN jsonb_build_object('result', 'INVALID_INPUT');
END;
$$;
REVOKE ALL ON FUNCTION public.line_menu_owner(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_menu_owner(text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Slip check result
-- ----------------------------------------------------------------------------
ALTER TABLE public.line_payment_slips ADD COLUMN IF NOT EXISTS check_status text;
ALTER TABLE public.line_payment_slips ADD COLUMN IF NOT EXISTS check_detail jsonb;
ALTER TABLE public.line_payment_slips ADD COLUMN IF NOT EXISTS check_ref text;
ALTER TABLE public.line_payment_slips ADD COLUMN IF NOT EXISTS checked_at timestamptz;
ALTER TABLE public.line_payment_slips DROP CONSTRAINT IF EXISTS line_payment_slips_check_status_check;
ALTER TABLE public.line_payment_slips ADD CONSTRAINT line_payment_slips_check_status_check
    CHECK (check_status IS NULL OR check_status IN ('PASS', 'FAIL', 'ERROR'));
ALTER TABLE public.line_payment_slips DROP CONSTRAINT IF EXISTS line_payment_slips_check_ref_check;
ALTER TABLE public.line_payment_slips ADD CONSTRAINT line_payment_slips_check_ref_check
    CHECK (check_ref IS NULL OR (length(check_ref) BETWEEN 1 AND 100));
CREATE INDEX IF NOT EXISTS line_payment_slips_check_ref_idx ON public.line_payment_slips (check_ref) WHERE check_ref IS NOT NULL;

-- The server's answer for a waiting slip. A bank reference already on another slip that was not refused makes it a
-- duplicate (FAIL), whatever the service said. Returns the stored result.
CREATE OR REPLACE FUNCTION public.line_slip_check_save(p_slip_id uuid, p_status text, p_ref text, p_detail jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_s      public.line_payment_slips%ROWTYPE;
    v_ref    text := NULLIF(btrim(COALESCE(p_ref, '')), '');
    v_dup    boolean := false;
    v_status text;
BEGIN
    PERFORM public._line_require_server();
    IF p_status NOT IN ('PASS', 'FAIL', 'ERROR') OR (v_ref IS NOT NULL AND length(v_ref) > 100)
       OR (p_detail IS NOT NULL AND (jsonb_typeof(p_detail) <> 'object' OR length(p_detail::text) > 4000)) THEN
        RETURN jsonb_build_object('result', 'INVALID_INPUT');
    END IF;
    SELECT * INTO v_s FROM public.line_payment_slips WHERE id = p_slip_id FOR UPDATE;
    IF NOT FOUND OR v_s.status <> 'PENDING' THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    IF v_ref IS NOT NULL THEN
        v_dup := EXISTS (SELECT 1 FROM public.line_payment_slips s
                          WHERE s.check_ref = v_ref AND s.id <> p_slip_id AND s.status <> 'REJECTED');
    END IF;
    v_status := CASE WHEN v_dup THEN 'FAIL' ELSE p_status END;
    UPDATE public.line_payment_slips
       SET check_status = v_status,
           check_ref = v_ref,
           check_detail = COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object('duplicate', v_dup),
           checked_at = now()
     WHERE id = p_slip_id;
    RETURN jsonb_build_object('result', 'OK', 'check_status', v_status, 'duplicate', v_dup);
END;
$$;
REVOKE ALL ON FUNCTION public.line_slip_check_save(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_slip_check_save(uuid, text, text, jsonb) TO service_role;

-- The checking service key (EasySlip) in Vault: the OWNER sets / clears it, never sees it again; the server reads it.
CREATE OR REPLACE FUNCTION public.line_slip_check_key_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_owner();
    IF to_regnamespace('vault') IS NULL THEN
        RETURN jsonb_build_object('vault', false, 'configured', false);
    END IF;
    RETURN jsonb_build_object('vault', true, 'configured', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'slip_check_api_key'));
END;
$$;

CREATE OR REPLACE FUNCTION public.line_slip_check_key_set(p_key text)
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
    IF p_key IS NULL OR length(p_key) NOT BETWEEN 20 AND 200 OR p_key ~ '\s' THEN
        RAISE EXCEPTION 'SLIP_CHECK_KEY_FORMAT' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('public.slip_check_vault'));
    SELECT id INTO v_id FROM vault.secrets WHERE name = 'slip_check_api_key';
    IF v_id IS NULL THEN
        PERFORM vault.create_secret(p_key, 'slip_check_api_key', 'Slip check service API key');
    ELSE
        PERFORM vault.update_secret(v_id, p_key);
    END IF;
    PERFORM public._audit('SLIP_CHECK_KEY_UPDATE', 'LINE_CHANNEL', NULL, NULL, '{}'::jsonb, NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN public.line_slip_check_key_status();
END;
$$;

CREATE OR REPLACE FUNCTION public.line_slip_check_key_clear()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_owner();
    IF to_regnamespace('vault') IS NOT NULL THEN
        DELETE FROM vault.secrets WHERE name = 'slip_check_api_key';
    END IF;
    PERFORM public._audit('SLIP_CHECK_KEY_CLEAR', 'LINE_CHANNEL', NULL, NULL, '{}'::jsonb, NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN public.line_slip_check_key_status();
END;
$$;

CREATE OR REPLACE FUNCTION public.line_slip_check_key()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._line_require_server();
    IF to_regnamespace('vault') IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN (SELECT NULLIF(decrypted_secret, '') FROM vault.decrypted_secrets WHERE name = 'slip_check_api_key' LIMIT 1);
END;
$$;

REVOKE ALL ON FUNCTION public.line_slip_check_key_status(), public.line_slip_check_key_set(text), public.line_slip_check_key_clear()
    FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.line_slip_check_key_status(), public.line_slip_check_key_set(text), public.line_slip_check_key_clear()
    TO authenticated;
REVOKE ALL ON FUNCTION public.line_slip_check_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_slip_check_key() TO service_role;

-- waiting slips for the screen: the same as 20261125100000 plus the check result
CREATE OR REPLACE FUNCTION public.line_slips_list(p_status text DEFAULT 'PENDING', p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status text := CASE WHEN p_status IN ('PENDING', 'APPROVED', 'REJECTED') THEN p_status END;
BEGIN
    PERFORM public._require_active_member();
    PERFORM public._require_menu('bills');
    RETURN jsonb_build_object(
        'counts', (SELECT jsonb_build_object(
                       'PENDING', count(*) FILTER (WHERE s.status = 'PENDING'),
                       'APPROVED', count(*) FILTER (WHERE s.status = 'APPROVED'),
                       'REJECTED', count(*) FILTER (WHERE s.status = 'REJECTED'))
                     FROM public.line_payment_slips s),
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', x.id, 'bill_id', x.bill_id, 'bill_no', b.bill_no, 'balance_due', b.balance_due, 'bill_status', b.status,
                       'customer_name', cu.name, 'line_name', lc.display_name, 'amount', x.amount, 'status', x.status,
                       'approved_amount', x.approved_amount, 'reject_reason', x.reject_reason, 'image_path', x.image_path,
                       'created_at', x.created_at, 'decided_at', x.decided_at,
                       'check_status', x.check_status, 'check_detail', x.check_detail,
                       'decided_by', COALESCE(NULLIF(pr.display_name, ''), pr.username)) ORDER BY x.created_at DESC)
              FROM (SELECT * FROM public.line_payment_slips s
                     WHERE v_status IS NULL OR s.status = v_status
                     ORDER BY s.created_at DESC
                     LIMIT least(greatest(COALESCE(p_limit, 25), 1), 100) OFFSET greatest(COALESCE(p_offset, 0), 0)) x
              JOIN public.bills b ON b.id = x.bill_id
              LEFT JOIN public.customers cu ON cu.id = x.customer_id
              LEFT JOIN public.line_contacts lc ON lc.id = x.contact_id
              LEFT JOIN public.profiles pr ON pr.id = x.decided_by), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.line_slips_list(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_slips_list(text, integer, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Texts the OWNER may reword (20261125100000 plus the menu answers)
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
        WHEN 'SLIP_OWNER_NEW'           THEN ARRAY['ชื่อลูกค้า', 'เลขบิล', 'ยอดเงิน']
        WHEN 'SLIP_APPROVED'            THEN ARRAY['เลขบิล', 'ยอดเงิน', 'ยอดค้าง', 'ชื่อร้าน']
        WHEN 'SLIP_REJECTED'            THEN ARRAY['เลขบิล', 'เหตุผล', 'ชื่อร้าน']
        WHEN 'OWNER_SUMMARY'            THEN ARRAY['วันที่', 'รายรับรวม', 'รายรับแยกช่องทาง', 'บิลใหม่', 'ยอดค้างรวม']
        WHEN 'OWNER_TASK_SENT'          THEN ARRAY['ชื่อพนักงาน', 'เรื่อง']
        WHEN 'OWNER_COMMAND_HELP'       THEN ARRAY[]::text[]
        WHEN 'OWNER_COMMAND_FAILED'     THEN ARRAY['เหตุผล']
        WHEN 'RETURN_REQUEST_REPLY'     THEN ARRAY[]::text[]
        WHEN 'RETURN_REQUEST_OWNER'     THEN ARRAY['ชื่อลูกค้า', 'เลขบิล']
        WHEN 'RETURN_REQUEST_NO_BILL'   THEN ARRAY['ชื่อร้าน', 'เบอร์โทรร้าน']
        WHEN 'OWNER_ORDER_HOWTO'        THEN ARRAY[]::text[]
        WHEN 'MENU_NOTHING'             THEN ARRAY[]::text[]
        WHEN 'MENU_NOT_ALLOWED'         THEN ARRAY[]::text[]
    END;
$$;

-- ----------------------------------------------------------------------------
-- 3. policies.line: 20261125100000 plus templateCards and slipCheck
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
        ELSIF v_key = 'ownerCommands' THEN
            IF jsonb_typeof(v_val) <> 'boolean' THEN RAISE EXCEPTION 'INVALID_POLICY: line.ownerCommands' USING ERRCODE = '22023'; END IF;
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
        ELSIF v_key = 'templateCards' THEN
            -- per message: { format: FLEX | TEXT, title, color #RRGGBB, footer } (owner 2026-11-26)
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.templateCards' USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                IF public._line_template_vars(v_sub) IS NULL OR jsonb_typeof(v_subv) <> 'object' THEN
                    RAISE EXCEPTION 'INVALID_POLICY: line.templateCards.%', left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
                FOR v_f, v_fv IN SELECT * FROM jsonb_each(v_subv) LOOP
                    IF jsonb_typeof(v_fv) <> 'string'
                       OR (v_f = 'format' AND NOT ((v_fv #>> '{}') = ANY (ARRAY['FLEX', 'TEXT'])))
                       OR (v_f = 'title' AND length(v_fv #>> '{}') > 60)
                       OR (v_f = 'footer' AND length(v_fv #>> '{}') > 300)
                       OR (v_f = 'color' AND (v_fv #>> '{}') !~ '^#[0-9A-Fa-f]{6}$')
                       OR NOT (v_f = ANY (ARRAY['format', 'title', 'footer', 'color'])) THEN
                        RAISE EXCEPTION 'INVALID_POLICY: line.templateCards.%.%', left(v_sub, 60), left(v_f, 40) USING ERRCODE = '22023';
                    END IF;
                END LOOP;
            END LOOP;
        ELSIF v_key = 'slipCheck' THEN
            -- { enabled: boolean, receiverNames: [the shop's receiving account names / numbers, at most 5] }
            IF jsonb_typeof(v_val) <> 'object' THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.slipCheck' USING ERRCODE = '22023';
            END IF;
            FOR v_sub, v_subv IN SELECT * FROM jsonb_each(v_val) LOOP
                IF v_sub = 'enabled' THEN
                    IF jsonb_typeof(v_subv) <> 'boolean' THEN
                        RAISE EXCEPTION 'INVALID_POLICY: line.slipCheck.enabled' USING ERRCODE = '22023';
                    END IF;
                ELSIF v_sub = 'receiverNames' THEN
                    IF jsonb_typeof(v_subv) <> 'array' OR jsonb_array_length(v_subv) > 5
                       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_subv) e
                                   WHERE jsonb_typeof(e) <> 'string' OR btrim(e #>> '{}') = '' OR length(e #>> '{}') > 100) THEN
                        RAISE EXCEPTION 'INVALID_POLICY: line.slipCheck.receiverNames' USING ERRCODE = '22023';
                    END IF;
                ELSE
                    RAISE EXCEPTION 'INVALID_POLICY: line.slipCheck.% unknown', left(v_sub, 60) USING ERRCODE = '22023';
                END IF;
            END LOOP;
        ELSE
            RAISE EXCEPTION 'INVALID_POLICY: line.% unknown', left(v_key, 60) USING ERRCODE = '22023';
        END IF;
    END LOOP;
END;
$$;

COMMIT;
