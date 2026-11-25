-- LINE: pay + slips, staff tasks page, staff QR, owner chat commands (owner 2026-11-25, from line.html).
--   1. Bill card in LINE may carry two buttons to the shop's pay form (LIFF /pay of that bill only).
--   2. A customer sends a slip from the pay form; the shop checks it on สลิปรอตรวจ. Approve = payment_receive
--      (TRANSFER) once (idempotency key per slip, the slip row is locked), then the customer is told; reject = reason.
--   3. Staff tasks: new state ISSUE (มีปัญหา) and a page that lists and sets the state.
--   4. Staff QR (OWNER): a single-use code for one staff member, 5 minutes; dead once used.
--   5. Owner chat commands (#สรุปยอดวันนี้, #สั่งงาน): the linked OWNER's LINE only, switch policies.line.ownerCommands.
-- No existing row is changed or deleted. Late fees are not part of this (shop rule).

-- ----------------------------------------------------------------------------
-- 1. Slips
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.line_payment_slips (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id          uuid NOT NULL REFERENCES public.bills (id) ON DELETE RESTRICT,
    contact_id       uuid NOT NULL REFERENCES public.line_contacts (id) ON DELETE RESTRICT,
    customer_id      uuid NOT NULL REFERENCES public.customers (id) ON DELETE RESTRICT,
    amount           numeric(14,2) NOT NULL,
    image_path       text NOT NULL,
    status           text NOT NULL DEFAULT 'PENDING',
    approved_amount  numeric(14,2),
    receipt          jsonb,
    reject_reason    text,
    decided_by       uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    decided_at       timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT line_payment_slips_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT line_payment_slips_amount_check CHECK (amount > 0 AND amount <= 99999999),
    CONSTRAINT line_payment_slips_path_check CHECK (image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
    CONSTRAINT line_payment_slips_decided_check CHECK ((status = 'PENDING') = (decided_at IS NULL)),
    CONSTRAINT line_payment_slips_approved_check CHECK ((status = 'APPROVED') = (approved_amount IS NOT NULL)),
    CONSTRAINT line_payment_slips_reject_check CHECK (status <> 'REJECTED' OR (reject_reason IS NOT NULL AND length(reject_reason) <= 300))
);
CREATE INDEX IF NOT EXISTS line_payment_slips_status_idx ON public.line_payment_slips (status, created_at DESC);
CREATE INDEX IF NOT EXISTS line_payment_slips_bill_idx ON public.line_payment_slips (bill_id);
CREATE INDEX IF NOT EXISTS line_payment_slips_contact_idx ON public.line_payment_slips (contact_id);
CREATE INDEX IF NOT EXISTS line_payment_slips_customer_idx ON public.line_payment_slips (customer_id);
CREATE INDEX IF NOT EXISTS line_payment_slips_decided_by_idx ON public.line_payment_slips (decided_by) WHERE decided_by IS NOT NULL;
ALTER TABLE public.line_payment_slips ENABLE ROW LEVEL SECURITY;
-- read and written through the functions below only
REVOKE ALL ON public.line_payment_slips FROM PUBLIC, anon, authenticated;

-- Slip pictures: private bucket payment-slips (<bill id>/<uuid>.<ext>), uploaded by the server; members with the
-- bills menu may open them (a short signed link) to check the money.
DO $storage$
BEGIN
    IF to_regclass('storage.buckets') IS NULL THEN
        RETURN;
    END IF;
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('payment-slips', 'payment-slips', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO NOTHING;
    DROP POLICY IF EXISTS payment_slips_read ON storage.objects;
    CREATE POLICY payment_slips_read ON storage.objects FOR SELECT TO authenticated
        USING (bucket_id = 'payment-slips' AND public.has_menu('bills'));
END;
$storage$;

-- The linked, checked customer LINE of a bill (NULL when this LINE may not see it).
CREATE OR REPLACE FUNCTION public._line_pay_contact(p_line_user_id text, p_bill_id uuid)
RETURNS public.line_contacts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT c.*
      FROM public.line_contacts c
      JOIN public.bills b ON b.customer_id = c.customer_id
     WHERE c.line_user_id = p_line_user_id AND c.status = 'LINKED' AND NOT c.needs_review
       AND c.customer_id IS NOT NULL AND b.id = p_bill_id
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._line_pay_contact(text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Pay form (LIFF): the bill as its own customer sees it, the shop's account and the slips already sent.
CREATE OR REPLACE FUNCTION public.line_pay_form(p_line_user_id text, p_bill_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c   public.line_contacts%ROWTYPE;
    v_b   public.bills%ROWTYPE;
    v_bp  jsonb;
BEGIN
    PERFORM public._line_require_server();
    IF public._line_user_blocked(p_line_user_id, 'GENERAL') THEN
        RETURN jsonb_build_object('result', 'SUSPENDED');
    END IF;
    v_c := public._line_pay_contact(p_line_user_id, p_bill_id);
    IF v_c.id IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    SELECT * INTO v_b FROM public.bills WHERE id = p_bill_id;
    SELECT s.policies -> 'business_profile' INTO v_bp FROM public.store_settings s WHERE s.singleton;
    RETURN jsonb_build_object(
        'result', 'OK',
        'bill', jsonb_build_object('id', v_b.id, 'bill_no', v_b.bill_no, 'status', v_b.status,
                                   'grand_total', v_b.grand_total, 'balance_due', v_b.balance_due,
                                   'payable', v_b.status IN ('CONFIRMED', 'ACTIVE') AND v_b.balance_due > 0),
        'customer', (SELECT c.name FROM public.customers c WHERE c.id = v_c.customer_id),
        'shop', jsonb_build_object(
            'name', (SELECT NULLIF(btrim(s.company_name), '') FROM public.store_settings s WHERE s.singleton),
            'promptpay', NULLIF(btrim(COALESCE(v_bp ->> 'promptPayValue', '')), ''),
            'promptpay_type', NULLIF(btrim(COALESCE(v_bp ->> 'promptPayType', '')), ''),
            'bank', NULLIF(btrim(COALESCE(v_bp ->> 'bankName', '')), ''),
            'account_name', NULLIF(btrim(COALESCE(v_bp ->> 'bankAccountName', '')), ''),
            'account_no', NULLIF(btrim(COALESCE(v_bp ->> 'bankAccountNumber', '')), '')),
        'slips', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('amount', x.amount, 'status', x.status, 'created_at', x.created_at,
                                                'approved_amount', x.approved_amount, 'reject_reason', x.reject_reason)
                             ORDER BY x.created_at DESC)
              FROM (SELECT * FROM public.line_payment_slips s WHERE s.bill_id = p_bill_id AND s.contact_id = v_c.id
                     ORDER BY s.created_at DESC LIMIT 10) x), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.line_pay_form(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_pay_form(text, uuid) TO service_role;

-- A slip from the pay form. The picture is already in the bucket (the server removes it when this refuses).
-- p_owner_messages: the notice to the OWNER's LINE (text only), queued once per owner.
CREATE OR REPLACE FUNCTION public.line_slip_submit(p_line_user_id text, p_bill_id uuid, p_amount numeric, p_path text, p_owner_messages jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c     public.line_contacts%ROWTYPE;
    v_b     public.bills%ROWTYPE;
    v_id    uuid;
    v_name  text;
    v_owner record;
BEGIN
    PERFORM public._line_require_server();
    IF public._line_user_blocked(p_line_user_id, 'GENERAL') THEN
        RETURN jsonb_build_object('result', 'SUSPENDED');
    END IF;
    v_c := public._line_pay_contact(p_line_user_id, p_bill_id);
    IF v_c.id IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    SELECT * INTO v_b FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF v_b.status NOT IN ('CONFIRMED', 'ACTIVE') OR v_b.balance_due <= 0 THEN
        RETURN jsonb_build_object('result', 'NOT_PAYABLE');
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 2) <> p_amount OR p_amount > v_b.balance_due
       OR p_path IS NULL OR p_path !~ ('^' || p_bill_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') THEN
        RETURN jsonb_build_object('result', 'INVALID_INPUT');
    END IF;
    IF (SELECT count(*) FROM public.line_payment_slips s WHERE s.bill_id = p_bill_id AND s.status = 'PENDING') >= 5 THEN
        RETURN jsonb_build_object('result', 'TOO_MANY');
    END IF;
    INSERT INTO public.line_payment_slips (bill_id, contact_id, customer_id, amount, image_path)
    VALUES (p_bill_id, v_c.id, v_c.customer_id, p_amount, p_path)
    RETURNING id INTO v_id;
    SELECT c.name INTO v_name FROM public.customers c WHERE c.id = v_c.customer_id;
    PERFORM public._audit_line(NULL, 'LINE_SLIP_SUBMIT', 'BILL', p_bill_id,
                               jsonb_build_object('slip_id', v_id, 'amount', p_amount, 'contact_id', v_c.id));
    FOR v_owner IN SELECT p.id FROM public.profiles p WHERE p.role = 'OWNER' AND p.status = 'ACTIVE' LOOP
        PERFORM public._notify('LINE_SLIP:' || v_id || ':' || v_owner.id, 'LINE_SLIP', 'WARNING', v_owner.id, NULL, 'BILL', p_bill_id,
                               'ลูกค้าแนบสลิปทาง LINE รอตรวจ',
                               COALESCE(v_name, '-') || ' · บิล ' || COALESCE(v_b.bill_no, '-') || ' · '
                               || to_char(p_amount, 'FM999,999,990.00') || ' บาท');
    END LOOP;
    IF public._line_messages_valid(p_owner_messages)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_owner_messages) m WHERE m ->> 'type' <> 'text') THEN
        INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key)
        SELECT c.id, 'BILL', p_bill_id, 'SLIP_OWNER_NEW', p_owner_messages, 'SLIP:' || v_id || ':' || c.id
          FROM public.line_contacts c
          JOIN public.profiles p ON p.id = c.profile_id
         WHERE c.status = 'LINKED' AND c.followed AND NOT c.needs_review AND p.role = 'OWNER' AND p.status = 'ACTIVE'
        ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
    RETURN jsonb_build_object('result', 'OK', 'slip_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.line_slip_submit(text, uuid, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_slip_submit(text, uuid, numeric, text, jsonb) TO service_role;

-- สลิปรอตรวจ: a page of slips (PENDING first view), with the counts of each state.
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

-- The customer's answer (text only) to that slip's own LINE, once.
CREATE OR REPLACE FUNCTION public._line_slip_answer(p_slip public.line_payment_slips, p_template text, p_messages jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NOT public._line_messages_valid(p_messages)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_messages) m WHERE m ->> 'type' <> 'text') THEN
        RETURN NULL;
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key, requested_by)
    VALUES (p_slip.contact_id, 'BILL', p_slip.bill_id, p_template, p_messages, p_template || ':' || p_slip.id, auth.uid())
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public._line_slip_answer(public.line_payment_slips, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- อนุมัติ: the money goes in through payment_receive (TRANSFER) with the slip's own key, so a second press or a
-- retry never takes it twice; the slip is locked and must still wait. p_amount = the amount the shop saw on the slip.
CREATE OR REPLACE FUNCTION public.line_slip_approve(p_slip_id uuid, p_amount numeric, p_received_on date, p_messages jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_s       public.line_payment_slips%ROWTYPE;
    v_amount  numeric;
    v_out     jsonb;
    v_deliv   uuid;
BEGIN
    PERFORM public._require_active_member();
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_s FROM public.line_payment_slips WHERE id = p_slip_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_SLIP_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_s.status <> 'PENDING' THEN
        RAISE EXCEPTION 'LINE_SLIP_NOT_PENDING' USING ERRCODE = '22023';
    END IF;
    v_amount := COALESCE(p_amount, v_s.amount);
    IF v_amount <= 0 OR round(v_amount, 2) <> v_amount THEN
        RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
    END IF;
    v_out := public.payment_receive(
        v_s.bill_id,
        jsonb_build_array(jsonb_build_object('method', 'TRANSFER', 'amount', v_amount, 'reference', 'สลิป LINE')),
        'line-slip-' || v_s.id,
        COALESCE(p_received_on, public._local_date(v_s.created_at)));
    UPDATE public.line_payment_slips
       SET status = 'APPROVED', approved_amount = v_amount, receipt = v_out - 'bill', decided_by = auth.uid(), decided_at = now()
     WHERE id = v_s.id
     RETURNING * INTO v_s;
    v_deliv := public._line_slip_answer(v_s, 'SLIP_APPROVED', p_messages);
    PERFORM public._audit('LINE_SLIP_APPROVE', 'BILL', v_s.bill_id, NULL,
                          jsonb_build_object('slip_id', v_s.id, 'amount', v_amount, 'delivery_id', v_deliv),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('slip_id', v_s.id, 'delivery_id', v_deliv,
                              'balance_due', (SELECT b.balance_due FROM public.bills b WHERE b.id = v_s.bill_id));
END;
$$;
REVOKE ALL ON FUNCTION public.line_slip_approve(uuid, numeric, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_slip_approve(uuid, numeric, date, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.line_slip_reject(p_slip_id uuid, p_reason text, p_messages jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_s      public.line_payment_slips%ROWTYPE;
    v_reason text := btrim(COALESCE(p_reason, ''));
    v_deliv  uuid;
BEGIN
    PERFORM public._require_active_member();
    PERFORM public._require_menu('bills');
    IF v_reason = '' OR length(v_reason) > 300 THEN
        RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_s FROM public.line_payment_slips WHERE id = p_slip_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_SLIP_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_s.status <> 'PENDING' THEN
        RAISE EXCEPTION 'LINE_SLIP_NOT_PENDING' USING ERRCODE = '22023';
    END IF;
    UPDATE public.line_payment_slips
       SET status = 'REJECTED', reject_reason = v_reason, decided_by = auth.uid(), decided_at = now()
     WHERE id = v_s.id
     RETURNING * INTO v_s;
    v_deliv := public._line_slip_answer(v_s, 'SLIP_REJECTED', p_messages);
    PERFORM public._audit('LINE_SLIP_REJECT', 'BILL', v_s.bill_id, NULL,
                          jsonb_build_object('slip_id', v_s.id, 'reason', v_reason, 'delivery_id', v_deliv),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('slip_id', v_s.id, 'delivery_id', v_deliv);
END;
$$;
REVOKE ALL ON FUNCTION public.line_slip_reject(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_slip_reject(uuid, text, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Bill card: the screen's card, plus at most the two buttons to this bill's own pay form
--    (same function as 20261110232606, the action check is the only change)
-- ----------------------------------------------------------------------------
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
    v_pay      text := '^https://liff\.line\.me/[A-Za-z0-9-]{1,60}/pay\?bill=' || p_bill_id::text || '(&tab=slip)?$';
BEGIN
    PERFORM public._require_active_member();
    PERFORM public._require_menu('bills', 'line');
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF NOT public._line_messages_valid(p_messages)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_messages) m WHERE m ->> 'type' NOT IN ('text', 'flex'))
       OR (SELECT count(*) FROM jsonb_path_query(p_messages, 'strict $.**.action') a) > 2
       OR EXISTS (SELECT 1 FROM jsonb_path_query(p_messages, 'strict $.**.action') a
                   WHERE a ->> 'type' IS DISTINCT FROM 'uri' OR COALESCE(a ->> 'uri', '') !~ v_pay) THEN
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

-- ----------------------------------------------------------------------------
-- 3. Staff tasks: ISSUE (มีปัญหา) and the page that lists them and sets the state
-- ----------------------------------------------------------------------------
ALTER TABLE public.line_tasks ADD COLUMN IF NOT EXISTS issue_note text;
ALTER TABLE public.line_tasks ADD COLUMN IF NOT EXISTS issue_at timestamptz;
ALTER TABLE public.line_tasks DROP CONSTRAINT IF EXISTS line_tasks_issue_note_check;
ALTER TABLE public.line_tasks ADD CONSTRAINT line_tasks_issue_note_check CHECK (issue_note IS NULL OR length(issue_note) <= 500);
ALTER TABLE public.line_tasks DROP CONSTRAINT IF EXISTS line_tasks_status_check;
ALTER TABLE public.line_tasks ADD CONSTRAINT line_tasks_status_check CHECK (status IN ('SENT', 'ACCEPTED', 'DONE', 'ISSUE', 'CANCELLED'));

-- Staff tasks only (a driver's job has its own steps on นัดหมาย).
CREATE OR REPLACE FUNCTION public.line_tasks_list(p_status text DEFAULT NULL, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status text := CASE WHEN p_status IN ('SENT', 'ACCEPTED', 'DONE', 'ISSUE', 'CANCELLED') THEN p_status END;
BEGIN
    PERFORM public._require_active_member();
    RETURN jsonb_build_object(
        'counts', (SELECT jsonb_build_object(
                       'ALL', count(*),
                       'SENT', count(*) FILTER (WHERE t.status = 'SENT'),
                       'ACCEPTED', count(*) FILTER (WHERE t.status = 'ACCEPTED'),
                       'DONE', count(*) FILTER (WHERE t.status = 'DONE'),
                       'ISSUE', count(*) FILTER (WHERE t.status = 'ISSUE'),
                       'CANCELLED', count(*) FILTER (WHERE t.status = 'CANCELLED'))
                     FROM public.line_tasks t WHERE t.driver_code IS NULL),
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', x.id, 'title', x.title, 'detail', x.detail, 'status', x.status, 'issue_note', x.issue_note,
                       'assignee', COALESCE(NULLIF(pa.display_name, ''), pa.username), 'bill_id', x.bill_id, 'bill_no', b.bill_no,
                       'created_at', x.created_at, 'accepted_at', x.accepted_at, 'done_at', x.done_at, 'issue_at', x.issue_at,
                       'cancelled_at', x.cancelled_at, 'created_by', COALESCE(NULLIF(pc.display_name, ''), pc.username),
                       'delivery', (SELECT d.status FROM public.line_deliveries d WHERE d.task_id = x.id AND d.template_key = 'TASK_NEW'
                                     ORDER BY d.created_at LIMIT 1)) ORDER BY x.created_at DESC)
              FROM (SELECT * FROM public.line_tasks t
                     WHERE t.driver_code IS NULL AND (v_status IS NULL OR t.status = v_status)
                     ORDER BY t.created_at DESC
                     LIMIT least(greatest(COALESCE(p_limit, 25), 1), 100) OFFSET greatest(COALESCE(p_offset, 0), 0)) x
              LEFT JOIN public.profiles pa ON pa.id = x.assignee_id
              LEFT JOIN public.profiles pc ON pc.id = x.created_by
              LEFT JOIN public.bills b ON b.id = x.bill_id), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.line_tasks_list(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_tasks_list(text, integer, integer) TO authenticated;

-- The shop sets a staff task's state by hand (รอดำเนินการ / กำลังดำเนินการ / เสร็จสิ้น / มีปัญหา); cancel stays line_task_cancel.
CREATE OR REPLACE FUNCTION public.line_task_set_status(p_task_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_t    public.line_tasks%ROWTYPE;
    v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
    PERFORM public._require_active_member();
    IF p_status IS NULL OR p_status NOT IN ('SENT', 'ACCEPTED', 'DONE', 'ISSUE') OR length(COALESCE(v_note, '')) > 500 THEN
        RAISE EXCEPTION 'LINE_TASK_STATUS_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_t FROM public.line_tasks WHERE id = p_task_id AND driver_code IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_TASK_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_t.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'LINE_TASK_CLOSED' USING ERRCODE = '22023';
    END IF;
    IF v_t.status = p_status AND p_status <> 'ISSUE' THEN
        RETURN jsonb_build_object('task_id', v_t.id, 'status', v_t.status, 'changed', false);
    END IF;
    UPDATE public.line_tasks
       SET status = p_status,
           accepted_at = CASE WHEN p_status = 'SENT' THEN NULL
                              WHEN p_status IN ('ACCEPTED', 'DONE') THEN COALESCE(accepted_at, now()) ELSE accepted_at END,
           done_at = CASE WHEN p_status = 'DONE' THEN COALESCE(done_at, now()) END,
           issue_note = CASE WHEN p_status = 'ISSUE' THEN v_note ELSE issue_note END,
           issue_at = CASE WHEN p_status = 'ISSUE' THEN now() ELSE issue_at END,
           updated_at = now()
     WHERE id = v_t.id;
    PERFORM public._audit('LINE_TASK_STATUS', 'LINE_TASK', v_t.id, jsonb_build_object('status', v_t.status),
                          jsonb_build_object('status', p_status, 'note', v_note), NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('task_id', v_t.id, 'status', p_status, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.line_task_set_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_task_set_status(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Staff QR (OWNER): the QR carries a scan token to the shop's own web address, not a code. The first scan
--    (line_staff_qr_scan, server) kills the QR and makes the single-use LINK- code that opens in the shop chat;
--    a second scan gets nothing. 5 minutes; an older open code of that member is cancelled. The screen asks for
--    the state of its own QR only.
-- ----------------------------------------------------------------------------
ALTER TABLE public.line_link_codes ADD COLUMN IF NOT EXISTS scan_hash text;
ALTER TABLE public.line_link_codes ADD COLUMN IF NOT EXISTS scanned_at timestamptz;
ALTER TABLE public.line_link_codes DROP CONSTRAINT IF EXISTS line_link_codes_scan_hash_check;
ALTER TABLE public.line_link_codes ADD CONSTRAINT line_link_codes_scan_hash_check CHECK (scan_hash IS NULL OR scan_hash ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX IF NOT EXISTS line_link_codes_scan_uidx ON public.line_link_codes (scan_hash) WHERE scan_hash IS NOT NULL;

-- p_len characters of the alphabet every LINE code uses (no 0/1/I/O)
CREATE OR REPLACE FUNCTION public._line_random_code(p_len integer)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
    SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b.r, i) % 32) + 1, 1), '' ORDER BY i)
      FROM (SELECT extensions.gen_random_bytes(p_len) AS r) b, generate_series(0, p_len - 1) AS i;
$$;
REVOKE ALL ON FUNCTION public._line_random_code(integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.line_staff_qr_create(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_exp   timestamptz := now() + interval '5 minutes';
    v_token text;
    v_id    uuid;
    v_try   integer := 0;
BEGIN
    PERFORM public._require_owner();
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id AND p.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'MEMBER_NOT_ACTIVE' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.line_contacts x WHERE x.profile_id = p_profile_id AND x.status = 'LINKED') THEN
        RAISE EXCEPTION 'LINE_MEMBER_ALREADY_LINKED' USING ERRCODE = '22023';
    END IF;
    UPDATE public.line_link_codes SET revoked_at = now()
     WHERE used_at IS NULL AND revoked_at IS NULL AND profile_id = p_profile_id;
    LOOP
        v_try := v_try + 1;
        v_token := public._line_random_code(32);
        BEGIN
            -- code_hash: a code nobody is told; the real code is made at the first scan
            INSERT INTO public.line_link_codes (purpose, profile_id, code_hash, scan_hash, expires_at, created_by, via)
            VALUES ('STAFF', p_profile_id, public._line_code_hash('LINK-' || public._line_random_code(10)),
                    public._line_code_hash(v_token), v_exp, auth.uid(), 'INVITE')
            RETURNING id INTO v_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF v_try >= 5 THEN
                RAISE EXCEPTION 'LINE_CODE_BUSY: try again' USING ERRCODE = '40001';
            END IF;
        END;
    END LOOP;
    PERFORM public._audit('LINE_STAFF_QR_CREATE', 'LINE_LINK_CODE', v_id, NULL,
                          jsonb_build_object('profile_id', p_profile_id, 'expires_at', v_exp),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('code_id', v_id, 'token', v_token, 'expires_at', v_exp);
END;
$$;
REVOKE ALL ON FUNCTION public.line_staff_qr_create(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_staff_qr_create(uuid) TO authenticated;

-- The first scan of a staff QR (the web route, server only): the QR dies and the code for the shop chat is made
-- (5 minutes from the scan, single use). Anything else answers DEAD and tells nothing.
CREATE OR REPLACE FUNCTION public.line_staff_qr_scan(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_k    public.line_link_codes%ROWTYPE;
    v_code text;
    v_try  integer := 0;
BEGIN
    PERFORM public._line_require_server();
    IF p_token IS NULL OR p_token !~ '^[A-HJ-NP-Z2-9]{32}$' THEN
        RETURN jsonb_build_object('result', 'DEAD');
    END IF;
    SELECT * INTO v_k FROM public.line_link_codes WHERE scan_hash = public._line_code_hash(p_token) FOR UPDATE;
    IF NOT FOUND OR v_k.purpose <> 'STAFF' OR v_k.scanned_at IS NOT NULL OR v_k.used_at IS NOT NULL
       OR v_k.revoked_at IS NOT NULL OR v_k.expires_at <= now() THEN
        RETURN jsonb_build_object('result', 'DEAD');
    END IF;
    LOOP
        v_try := v_try + 1;
        v_code := 'LINK-' || public._line_random_code(10);
        BEGIN
            UPDATE public.line_link_codes
               SET code_hash = public._line_code_hash(v_code), scanned_at = now(), expires_at = now() + interval '5 minutes'
             WHERE id = v_k.id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF v_try >= 5 THEN
                RETURN jsonb_build_object('result', 'DEAD');
            END IF;
        END;
    END LOOP;
    PERFORM public._audit_line(NULL, 'LINE_STAFF_QR_SCAN', 'LINE_LINK_CODE', v_k.id, jsonb_build_object('profile_id', v_k.profile_id));
    RETURN jsonb_build_object('result', 'OK', 'code', v_code);
END;
$$;
REVOKE ALL ON FUNCTION public.line_staff_qr_scan(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_staff_qr_scan(text) TO service_role;

CREATE OR REPLACE FUNCTION public.line_link_code_state(p_code_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_k public.line_link_codes%ROWTYPE;
BEGIN
    PERFORM public._require_owner();
    SELECT * INTO v_k FROM public.line_link_codes WHERE id = p_code_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CODE_NOT_OPEN' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('state', CASE WHEN v_k.used_at IS NOT NULL THEN 'USED' WHEN v_k.revoked_at IS NOT NULL THEN 'REVOKED'
                                            WHEN v_k.expires_at <= now() THEN 'EXPIRED'
                                            WHEN v_k.scanned_at IS NOT NULL THEN 'SCANNED' ELSE 'OPEN' END,
                              'expires_at', v_k.expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.line_link_code_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_link_code_state(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Owner chat commands (server only; the linked OWNER's LINE, switch policies.line.ownerCommands, default off)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._line_owner_command_owner(p_line_user_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE WHEN COALESCE((public._policy('line', '{}'::jsonb) ->> 'ownerCommands')::boolean, false)
                     AND NOT public._line_user_blocked(p_line_user_id, 'WORK')
                THEN public._line_owner_id(p_line_user_id) END;
$$;
REVOKE ALL ON FUNCTION public._line_owner_command_owner(text) FROM PUBLIC, anon, authenticated, service_role;

-- #สรุปยอดวันนี้: money in today as การเงิน counts it (bill payments, not the ones paid from a deposit, plus other
-- income recorded), by way of paying; new bills today and what customers still owe.
CREATE OR REPLACE FUNCTION public._line_income_today(p_day date)
RETURNS TABLE (method text, amount numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.method, p.amount FROM public.payments p
     WHERE p.status = 'COMPLETED' AND public._local_date(p.received_at) = p_day
       AND NOT (p.method = 'OTHER' AND p.reference IS NOT DISTINCT FROM 'หักจากมัดจำ')
    UNION ALL
    SELECT o.channel, o.amount FROM public.other_income_entries o
     WHERE o.status = 'RECORDED' AND public._local_date(o.created_at) = p_day;
$$;
REVOKE ALL ON FUNCTION public._line_income_today(date) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.line_owner_summary(p_line_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_today date := public._local_date(now());
BEGIN
    PERFORM public._line_require_server();
    IF public._line_owner_command_owner(p_line_user_id) IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_OWNER');
    END IF;
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
END;
$$;
REVOKE ALL ON FUNCTION public.line_owner_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_owner_summary(text) TO service_role;

-- #สั่งงาน <ชื่อพนักงาน> <เรื่อง>: the longest active member name the text starts with; the rest is the task.
CREATE OR REPLACE FUNCTION public.line_owner_task_resolve(p_line_user_id text, p_text text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner uuid;
    v_text  text := btrim(regexp_replace(COALESCE(p_text, ''), '\s+', ' ', 'g'));
    v_hit   record;
    v_title text;
BEGIN
    PERFORM public._line_require_server();
    v_owner := public._line_owner_command_owner(p_line_user_id);
    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_OWNER');
    END IF;
    WITH names AS (
        SELECT p.id, n.name
          FROM public.profiles p
          CROSS JOIN LATERAL (VALUES (NULLIF(btrim(p.display_name), '')), (NULLIF(btrim(p.username), ''))) n(name)
         WHERE p.status = 'ACTIVE' AND n.name IS NOT NULL
           AND (lower(v_text) = lower(n.name) OR lower(v_text) LIKE lower(n.name) || ' %')
    ), best AS (
        SELECT DISTINCT ON (id) id, name FROM names ORDER BY id, length(name) DESC
    )
    SELECT b.id, b.name INTO v_hit FROM best b ORDER BY length(b.name) DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NO_MEMBER');
    END IF;
    -- the same name on two members: the shop must write it so it means one person
    IF EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.status = 'ACTIVE' AND p.id <> v_hit.id
           AND (lower(btrim(p.display_name)) = lower(v_hit.name) OR lower(btrim(p.username)) = lower(v_hit.name))) THEN
        RETURN jsonb_build_object('result', 'MANY_MEMBERS');
    END IF;
    v_title := btrim(substr(v_text, length(v_hit.name) + 1));
    IF v_title = '' THEN
        RETURN jsonb_build_object('result', 'NO_DETAIL');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.line_contacts c WHERE c.profile_id = v_hit.id AND c.status = 'LINKED' AND c.followed) THEN
        RETURN jsonb_build_object('result', 'NOT_LINKED',
                                  'assignee', (SELECT COALESCE(NULLIF(p.display_name, ''), p.username) FROM public.profiles p WHERE p.id = v_hit.id));
    END IF;
    RETURN jsonb_build_object(
        'result', 'OK',
        'assignee_id', v_hit.id,
        'assignee', (SELECT COALESCE(NULLIF(p.display_name, ''), p.username) FROM public.profiles p WHERE p.id = v_hit.id),
        'owner', (SELECT COALESCE(NULLIF(p.display_name, ''), p.username) FROM public.profiles p WHERE p.id = v_owner),
        'title', left(v_title, 200));
END;
$$;
REVOKE ALL ON FUNCTION public.line_owner_task_resolve(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_owner_task_resolve(text, text) TO service_role;

-- The task itself (same rows as line_task_create, made by the OWNER from the chat). p_event_id makes it once per LINE message.
CREATE OR REPLACE FUNCTION public.line_owner_task_create(p_line_user_id text, p_event_id text, p_task_id uuid, p_assignee_id uuid, p_title text, p_messages jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner   uuid;
    v_contact uuid;
    v_key     text;
    v_dup     uuid;
    v_title   text := btrim(COALESCE(p_title, ''));
BEGIN
    PERFORM public._line_require_server();
    v_owner := public._line_owner_command_owner(p_line_user_id);
    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_OWNER');
    END IF;
    IF p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 100 THEN
        RETURN jsonb_build_object('result', 'INVALID_INPUT');
    END IF;
    v_key := 'T:' || v_owner || ':chat:' || p_event_id;
    SELECT task_id INTO v_dup FROM public.line_deliveries WHERE dedupe_key = v_key;
    IF v_dup IS NOT NULL THEN
        RETURN jsonb_build_object('result', 'OK', 'task_id', v_dup, 'duplicate', true);
    END IF;
    IF v_title = '' OR length(v_title) > 200 OR p_task_id IS NULL OR NOT public._line_messages_valid(p_messages)
       OR position(p_task_id::text IN p_messages::text) = 0
       OR EXISTS (SELECT 1 FROM public.line_tasks WHERE id = p_task_id) THEN
        RETURN jsonb_build_object('result', 'INVALID_INPUT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_assignee_id AND p.status = 'ACTIVE') THEN
        RETURN jsonb_build_object('result', 'NO_MEMBER');
    END IF;
    SELECT id INTO v_contact FROM public.line_contacts WHERE profile_id = p_assignee_id AND status = 'LINKED' AND followed;
    IF v_contact IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_LINKED');
    END IF;
    INSERT INTO public.line_tasks (id, title, assignee_id, created_by)
    VALUES (p_task_id, v_title, p_assignee_id, v_owner);
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, task_id, template_key, messages, dedupe_key, requested_by)
    VALUES (v_contact, 'TASK', p_task_id, p_task_id, 'TASK_NEW', p_messages, v_key, v_owner);
    PERFORM public._audit_line(v_owner, 'LINE_TASK_CREATE', 'LINE_TASK', p_task_id,
                               jsonb_build_object('assignee_id', p_assignee_id, 'via', 'OWNER_CHAT'));
    RETURN jsonb_build_object('result', 'OK', 'task_id', p_task_id, 'duplicate', false);
END;
$$;
REVOKE ALL ON FUNCTION public.line_owner_task_create(text, text, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_owner_task_create(text, text, uuid, uuid, text, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Texts the OWNER may reword (same list as lib/line/templates.ts; 20261122125629 plus the new keys)
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
    END;
$$;

-- ----------------------------------------------------------------------------
-- 7. policies.line.ownerCommands (boolean): same check as 20261122125634 plus that key
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
        ELSE
            RAISE EXCEPTION 'INVALID_POLICY: line.% unknown', left(v_key, 60) USING ERRCODE = '22023';
        END IF;
    END LOOP;
END;
$$;
