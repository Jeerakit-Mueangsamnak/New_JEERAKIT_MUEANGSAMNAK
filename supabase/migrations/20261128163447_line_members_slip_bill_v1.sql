-- ============================================================================
-- LINE สมาชิก + สลิปเลือกบิล (owner 2026-11-28, answers 1ก 2ก 3ก)
--   1. line_people_list: view MEMBERS = linked customers who have a bill not closed yet (CONFIRMED / ACTIVE).
--   2. line_member_reminders: today's reminders of one LINE customer (the same rows as
--      line_customer_reminder_candidates), so the shop picks the customer first, then the topic, then the bill.
--   3. line_slip_bill_choices / line_slip_set_bill: the shop chooses which open bill of the same customer a
--      pending slip pays before approving it. line_slip_approve itself is unchanged (it pays the slip's bill).
-- Nothing else changes; no data is written by this file.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. People list with MEMBERS (body as 20261122125634, plus the MEMBERS view)
-- ----------------------------------------------------------------------------
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
    IF p_view IS NULL OR p_view NOT IN ('ALL', 'UNREG', 'PENDING', 'NEEDINFO', 'CUSTOMERS', 'MEMBERS', 'STAFF', 'DRIVERS', 'GENERAL', 'REJECTED', 'UNLINKED', 'BLOCKED') THEN
        RAISE EXCEPTION 'LINE_VIEW_INVALID' USING ERRCODE = '22023';
    END IF;
    RETURN (
        WITH base AS (
            SELECT c.*, cu.name AS customer_name, cu.phone AS customer_phone,
                   COALESCE(NULLIF(pr.display_name, ''), pr.username) AS profile_name
              FROM public.line_contacts c
              LEFT JOIN public.customers cu ON cu.id = c.customer_id
              LEFT JOIN public.profiles pr ON pr.id = c.profile_id
             WHERE public._line_people_in_view(CASE WHEN p_view = 'MEMBERS' THEN 'CUSTOMERS' ELSE p_view END, c)
               AND (p_view <> 'MEMBERS' OR EXISTS (
                       SELECT 1 FROM public.bills b
                        WHERE b.customer_id = c.customer_id AND b.status IN ('CONFIRMED', 'ACTIVE')))
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

-- ----------------------------------------------------------------------------
-- 2. Reminders of one LINE customer (same rows and rights as line_customer_reminder_candidates)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.line_member_reminders(p_contact_id uuid)
RETURNS TABLE (rule text, source_type text, source_id uuid, customer_name text, ref_no text,
               due_at timestamptz, amount numeric, days_left integer, last_queued_at timestamptz, last_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    PERFORM public._require_menu('bills', 'line');
    RETURN QUERY
    SELECT r.rule, r.source_type, r.source_id, r.customer_name, r.ref_no, r.due_at, r.amount, r.days_left,
           d.created_at, d.status
      FROM public._line_customer_reminder_rows(false) r
      LEFT JOIN LATERAL (
          SELECT x.created_at, x.status FROM public.line_deliveries x
           WHERE x.source_id = r.source_id AND x.contact_id = r.contact_id
             AND (x.dedupe_key LIKE 'X:R:%' OR x.dedupe_key LIKE 'M:%')
           ORDER BY x.created_at DESC LIMIT 1) d ON true
     WHERE r.contact_id = p_contact_id
     ORDER BY r.days_left, r.ref_no;
END;
$$;
REVOKE ALL ON FUNCTION public.line_member_reminders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_member_reminders(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Which bill a pending slip pays
-- ----------------------------------------------------------------------------
-- The open bills of the slip's own customer (the bill it was sent for first).
CREATE OR REPLACE FUNCTION public.line_slip_bill_choices(p_slip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_s public.line_payment_slips%ROWTYPE;
BEGIN
    PERFORM public._require_active_member();
    PERFORM public._require_menu('bills');
    SELECT * INTO v_s FROM public.line_payment_slips WHERE id = p_slip_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_SLIP_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', b.id, 'bill_no', b.bill_no, 'balance_due', b.balance_due, 'status', b.status)
                         ORDER BY (b.id = v_s.bill_id) DESC, b.created_at DESC)
          FROM public.bills b
         WHERE b.customer_id = v_s.customer_id
           AND (b.status IN ('CONFIRMED', 'ACTIVE') OR b.id = v_s.bill_id)), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.line_slip_bill_choices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_slip_bill_choices(uuid) TO authenticated;

-- Move a pending slip to another open bill of the same customer (before line_slip_approve).
CREATE OR REPLACE FUNCTION public.line_slip_set_bill(p_slip_id uuid, p_bill_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_s    public.line_payment_slips%ROWTYPE;
    v_old  uuid;
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
    IF v_s.bill_id = p_bill_id THEN
        RETURN jsonb_build_object('slip_id', v_s.id, 'bill_id', v_s.bill_id, 'changed', false);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bills b
                    WHERE b.id = p_bill_id AND b.customer_id = v_s.customer_id AND b.status IN ('CONFIRMED', 'ACTIVE')) THEN
        RAISE EXCEPTION 'LINE_SLIP_BILL_INVALID' USING ERRCODE = '22023';
    END IF;
    v_old := v_s.bill_id;
    UPDATE public.line_payment_slips SET bill_id = p_bill_id WHERE id = v_s.id;
    PERFORM public._audit('LINE_SLIP_SET_BILL', 'BILL', p_bill_id, NULL,
                          jsonb_build_object('slip_id', v_s.id, 'from_bill_id', v_old, 'to_bill_id', p_bill_id),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('slip_id', v_s.id, 'bill_id', p_bill_id, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.line_slip_set_bill(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_slip_set_bill(uuid, uuid) TO authenticated;
