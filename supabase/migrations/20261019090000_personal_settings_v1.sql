-- Personal settings v1 (owner decisions 2026-10-18)
-- 1) The OWNER can take a menu away again. user_menu_access carried the baseline "no hard delete"
--    trigger, so owner_set_member_menus (and promoting a USER with menus to OWNER) always failed
--    when a menu had to go. Every change still goes through the owner_set_member_* RPCs, which
--    require a reason and keep the before/after menus in audit_logs.
-- 2) In-app notifications are a personal setting (ตั้งค่าส่วนตัว), not a shop setting:
--    profiles.notification_prefs holds each member's own switches and days (same shape as the old
--    policies.notifications), written only through my_notification_prefs_set. rental_overdue_scan
--    raises each notice per member, by that member's own switches, and only for menus the member
--    holds. Everyone starts from the shop's current switches. policies.notifications is no longer read.

DROP TRIGGER IF EXISTS trg_user_menu_access_no_delete ON public.user_menu_access;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.profiles p
   SET notification_prefs = COALESCE((SELECT s.policies -> 'notifications' FROM public.store_settings s WHERE s.singleton), '{}'::jsonb)
 WHERE p.notification_prefs = '{}'::jsonb
   AND jsonb_typeof((SELECT s.policies -> 'notifications' FROM public.store_settings s WHERE s.singleton)) = 'object';

-- The member's own notification switches: {KEY: {enabled: boolean, daysBefore: 0-365}}.
CREATE OR REPLACE FUNCTION public.my_notification_prefs_set(p_prefs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_key text;
    v_val jsonb;
BEGIN
    PERFORM public._require_active_member();
    IF jsonb_typeof(p_prefs) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'INVALID_NOTIFICATION_PREFS' USING ERRCODE = '22023';
    END IF;
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_prefs) LOOP
        IF v_key NOT IN ('deliveryReminder', 'returnReminder', 'paymentReminder', 'overdueReturnReminder',
                         'lowStockReminder', 'appointmentReminder')
           OR jsonb_typeof(v_val) <> 'object'
           OR (v_val ? 'enabled' AND jsonb_typeof(v_val -> 'enabled') <> 'boolean')
           OR (v_val ? 'daysBefore' AND CASE
                   WHEN jsonb_typeof(v_val -> 'daysBefore') <> 'number' THEN true
                   ELSE (v_val ->> 'daysBefore')::numeric NOT BETWEEN 0 AND 365
                        OR (v_val ->> 'daysBefore')::numeric <> trunc((v_val ->> 'daysBefore')::numeric)
               END) THEN
            RAISE EXCEPTION 'INVALID_NOTIFICATION_PREFS: %', v_key USING ERRCODE = '22023';
        END IF;
    END LOOP;
    UPDATE public.profiles SET notification_prefs = p_prefs WHERE id = auth.uid();
    RETURN p_prefs;
END;
$$;

REVOKE ALL ON FUNCTION public.my_notification_prefs_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_notification_prefs_set(jsonb) TO authenticated;

-- Cron / OWNER session: refresh rental status (shop data, once) and raise notices per member.
CREATE OR REPLACE FUNCTION public.rental_overdue_scan()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_m     record;
    v_n     jsonb;
    v_row   record;
    v_today date := public._local_date(now());
    v_count integer := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_owner() THEN
        RAISE EXCEPTION 'FORBIDDEN: system job' USING ERRCODE = '42501';
    END IF;

    UPDATE public.bill_lines l
       SET rental_status = 'OVERDUE'
      FROM public.bills b
     WHERE b.id = l.bill_id AND l.line_mode = 'RENTAL' AND l.obligation_held_here > 0
       AND l.rental_end_at < now() AND b.status = 'ACTIVE'
       AND l.rental_status IS DISTINCT FROM 'OVERDUE';

    FOR v_m IN SELECT p.id, p.notification_prefs FROM public.profiles p WHERE p.status = 'ACTIVE' LOOP
        v_n := COALESCE(v_m.notification_prefs, '{}'::jsonb);

        IF public._member_has_menu(v_m.id, 'bills') THEN
            IF COALESCE((v_n -> 'overdueReturnReminder' ->> 'enabled')::boolean, true) THEN
                FOR v_row IN
                    SELECT l.id, l.bill_id, b.bill_no, l.rental_end_at
                      FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
                     WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND l.rental_end_at < now()
                       AND b.status = 'ACTIVE'
                LOOP
                    PERFORM public._notify('RENTAL_OVERDUE:' || v_row.id, 'RENTAL_OVERDUE', 'WARNING', v_m.id, NULL,
                                           'BILL', v_row.bill_id, 'เลยกำหนดคืน: ' || v_row.bill_no,
                                           'ครบกำหนดคืน ' || to_char(v_row.rental_end_at, 'YYYY-MM-DD HH24:MI')
                                           || ' — แจ้งเตือนเท่านั้น ไม่มีค่าปรับ');
                    v_count := v_count + 1;
                END LOOP;
            END IF;

            IF COALESCE((v_n -> 'returnReminder' ->> 'enabled')::boolean, true) THEN
                FOR v_row IN
                    SELECT l.id, l.bill_id, b.bill_no, l.rental_end_at
                      FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
                     WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND l.rental_end_at >= now()
                       AND public._local_date(l.rental_end_at) - v_today
                           <= COALESCE((v_n -> 'returnReminder' ->> 'daysBefore')::integer, 1)
                       AND b.status = 'ACTIVE'
                LOOP
                    PERFORM public._notify('RENTAL_DUE_SOON:' || v_row.id, 'RENTAL_DUE_SOON', 'INFO', v_m.id, NULL,
                                           'BILL', v_row.bill_id, 'ใกล้ถึงวันคืน: ' || v_row.bill_no,
                                           'ครบกำหนดคืน ' || to_char(v_row.rental_end_at, 'YYYY-MM-DD HH24:MI'));
                    v_count := v_count + 1;
                END LOOP;
            END IF;

            IF COALESCE((v_n -> 'deliveryReminder' ->> 'enabled')::boolean, true) THEN
                FOR v_row IN
                    SELECT l.id, l.bill_id, b.bill_no, l.rental_start_at
                      FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
                     WHERE l.rental_start_at IS NOT NULL AND l.delivered_qty + l.cancelled_qty < l.ordered_qty
                       AND public._local_date(l.rental_start_at) - v_today
                           <= COALESCE((v_n -> 'deliveryReminder' ->> 'daysBefore')::integer, 1)
                       AND b.status IN ('CONFIRMED', 'ACTIVE')
                LOOP
                    PERFORM public._notify('DELIVERY_DUE:' || v_row.id, 'DELIVERY_DUE', 'INFO', v_m.id, NULL,
                                           'BILL', v_row.bill_id, 'ถึงวันส่งของ: ' || v_row.bill_no,
                                           'กำหนดส่ง ' || to_char(v_row.rental_start_at, 'YYYY-MM-DD HH24:MI'));
                    v_count := v_count + 1;
                END LOOP;
            END IF;
        END IF;

        -- money owed per bill; repeats daily once the due date has passed
        IF public._member_has_menu(v_m.id, 'finance')
           AND COALESCE((v_n -> 'paymentReminder' ->> 'enabled')::boolean, true) THEN
            FOR v_row IN
                SELECT b.id AS bill_id, b.bill_no, b.balance_due, b.due_date
                  FROM public.bills b
                 WHERE b.status IN ('CONFIRMED', 'ACTIVE', 'CLOSED') AND b.balance_due > 0 AND b.due_date IS NOT NULL
                   AND b.due_date - v_today <= COALESCE((v_n -> 'paymentReminder' ->> 'daysBefore')::integer, 1)
            LOOP
                PERFORM public._notify('PAYMENT_DUE:' || v_row.bill_id || ':' || v_today, 'PAYMENT_DUE',
                                       CASE WHEN v_row.due_date < v_today THEN 'WARNING' ELSE 'INFO' END, v_m.id, NULL,
                                       'BILL', v_row.bill_id, 'ยอดค้างชำระ: ' || v_row.bill_no,
                                       'ค้าง ' || v_row.balance_due || ' บาท ครบกำหนด ' || v_row.due_date);
                v_count := v_count + 1;
            END LOOP;
        END IF;

        IF public._member_has_menu(v_m.id, 'products')
           AND COALESCE((v_n -> 'lowStockReminder' ->> 'enabled')::boolean, true) THEN
            FOR v_row IN
                SELECT p.id, p.sku, p.name, p.reorder_point,
                       COALESCE((SELECT sum(sb.quantity) FROM public.stock_balances sb
                                  WHERE sb.product_id = p.id AND sb.stock_state = 'AVAILABLE'), 0) AS available
                  FROM public.products p
                 WHERE p.active AND p.reorder_point > 0
            LOOP
                CONTINUE WHEN v_row.available > v_row.reorder_point;
                PERFORM public._notify('LOW_STOCK:' || v_row.id || ':' || v_today, 'LOW_STOCK', 'WARNING', v_m.id, NULL,
                                       'PRODUCT', v_row.id, 'สินค้าใกล้หมด: ' || v_row.sku || ' ' || v_row.name,
                                       'คงเหลือ ' || v_row.available || ' (จุดเตือน ' || v_row.reorder_point || ')');
                v_count := v_count + 1;
            END LOOP;
        END IF;

        IF public._member_has_menu(v_m.id, 'appointments')
           AND COALESCE((v_n -> 'appointmentReminder' ->> 'enabled')::boolean, true) THEN
            FOR v_row IN
                SELECT a.id, a.title, a.start_datetime
                  FROM public.appointments a
                 WHERE a.status IN ('DRAFT', 'SCHEDULED', 'CONFIRMED', 'RESCHEDULED')
                   AND a.start_datetime >= now()
                   AND public._local_date(a.start_datetime) - v_today
                       <= COALESCE((v_n -> 'appointmentReminder' ->> 'daysBefore')::integer, 3)
            LOOP
                PERFORM public._notify('APPOINTMENT_DUE:' || v_row.id, 'APPOINTMENT_DUE', 'INFO', v_m.id, NULL,
                                       'APPOINTMENT', v_row.id, 'ใกล้ถึงนัดหมาย: ' || v_row.title,
                                       'นัดหมาย ' || to_char(v_row.start_datetime, 'YYYY-MM-DD HH24:MI'));
                v_count := v_count + 1;
            END LOOP;
        END IF;
    END LOOP;
    RETURN v_count;
END;
$$;

-- Shop-wide notices of these kinds are replaced by the members' own ones from the next scan.
UPDATE public.notifications
   SET status = 'EXPIRED'
 WHERE recipient_user_id IS NULL
   AND event_type IN ('RENTAL_OVERDUE', 'RENTAL_DUE_SOON', 'DELIVERY_DUE', 'PAYMENT_DUE', 'LOW_STOCK', 'APPOINTMENT_DUE')
   AND status IN ('UNREAD', 'READ');
