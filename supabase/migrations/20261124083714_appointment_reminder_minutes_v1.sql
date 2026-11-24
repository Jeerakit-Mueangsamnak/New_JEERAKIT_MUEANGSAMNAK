-- Per-appointment reminder lead time (minutes). Legacy appointments without a value keep the shop-wide day setting.
ALTER TABLE public.appointments
    ADD COLUMN IF NOT EXISTS reminder_before_minutes integer
    CHECK (reminder_before_minutes IS NULL OR reminder_before_minutes >= 0);

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
    IF auth.uid() IS NOT NULL AND NOT public.is_active_member() THEN
        RAISE EXCEPTION 'FORBIDDEN: job' USING ERRCODE = '42501';
    END IF;

    UPDATE public.bill_lines l
       SET rental_status = 'OVERDUE'
      FROM public.bills b
     WHERE b.id = l.bill_id AND l.line_mode = 'RENTAL' AND l.obligation_held_here > 0
       AND l.rental_end_at < now() AND b.status = 'ACTIVE'
       AND l.rental_status IS DISTINCT FROM 'OVERDUE';

    v_n := COALESCE((SELECT s.policies -> 'notifications' FROM public.store_settings s WHERE s.singleton), '{}'::jsonb);

    FOR v_m IN SELECT p.id FROM public.profiles p WHERE p.status = 'ACTIVE' LOOP
        IF public._member_has_menu(v_m.id, 'bills') THEN
            IF COALESCE((v_n -> 'overdueReturnReminder' ->> 'enabled')::boolean, true) THEN
                FOR v_row IN
                    SELECT l.bill_id, b.bill_no, min(l.rental_end_at) AS due_at, count(*) AS items
                      FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
                     WHERE l.line_mode = 'RENTAL' AND l.removed_at IS NULL AND l.obligation_held_here > 0
                       AND l.rental_end_at < now() AND b.status = 'ACTIVE'
                     GROUP BY l.bill_id, b.bill_no
                LOOP
                    PERFORM public._notify('RENTAL_OVERDUE:' || v_row.bill_id || ':' || public._local_date(v_row.due_at),
                                           'RENTAL_OVERDUE', 'WARNING', v_m.id, NULL, 'BILL', v_row.bill_id,
                                           'เลยกำหนดคืน: ' || v_row.bill_no,
                                           'ครบกำหนดคืน ' || to_char(v_row.due_at, 'YYYY-MM-DD HH24:MI') || ' · ' || v_row.items || ' รายการ — แจ้งเตือนเท่านั้น ไม่มีค่าปรับ');
                    v_count := v_count + 1;
                END LOOP;
            END IF;
            IF COALESCE((v_n -> 'returnReminder' ->> 'enabled')::boolean, true) THEN
                FOR v_row IN
                    SELECT l.bill_id, b.bill_no, min(l.rental_end_at) AS due_at, count(*) AS items
                      FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
                     WHERE l.line_mode = 'RENTAL' AND l.removed_at IS NULL AND l.obligation_held_here > 0
                       AND l.rental_end_at >= now()
                       AND public._local_date(l.rental_end_at) - v_today <= COALESCE((v_n -> 'returnReminder' ->> 'daysBefore')::integer, 1)
                       AND b.status = 'ACTIVE'
                     GROUP BY l.bill_id, b.bill_no
                LOOP
                    PERFORM public._notify('RENTAL_DUE_SOON:' || v_row.bill_id || ':' || public._local_date(v_row.due_at),
                                           'RENTAL_DUE_SOON', 'INFO', v_m.id, NULL, 'BILL', v_row.bill_id,
                                           'ใกล้ถึงวันคืน: ' || v_row.bill_no,
                                           'ครบกำหนดคืน ' || to_char(v_row.due_at, 'YYYY-MM-DD HH24:MI') || ' · ' || v_row.items || ' รายการ');
                    v_count := v_count + 1;
                END LOOP;
            END IF;
            IF COALESCE((v_n -> 'deliveryReminder' ->> 'enabled')::boolean, true) THEN
                FOR v_row IN
                    SELECT l.bill_id, b.bill_no, min(l.rental_start_at) AS start_at, count(*) AS items
                      FROM public.bill_lines l JOIN public.bills b ON b.id = l.bill_id
                     WHERE l.removed_at IS NULL AND l.rental_start_at IS NOT NULL
                       AND l.delivered_qty + l.cancelled_qty < l.ordered_qty
                       AND public._local_date(l.rental_start_at) - v_today <= COALESCE((v_n -> 'deliveryReminder' ->> 'daysBefore')::integer, 1)
                       AND b.status IN ('CONFIRMED', 'ACTIVE')
                     GROUP BY l.bill_id, b.bill_no
                LOOP
                    PERFORM public._notify('DELIVERY_DUE:' || v_row.bill_id || ':' || public._local_date(v_row.start_at),
                                           'DELIVERY_DUE', 'INFO', v_m.id, NULL, 'BILL', v_row.bill_id,
                                           'ถึงวันส่งของ: ' || v_row.bill_no,
                                           'กำหนดส่ง ' || to_char(v_row.start_at, 'YYYY-MM-DD HH24:MI') || ' · ' || v_row.items || ' รายการ');
                    v_count := v_count + 1;
                END LOOP;
            END IF;
        END IF;

        IF public._member_has_menu(v_m.id, 'finance') AND COALESCE((v_n -> 'paymentReminder' ->> 'enabled')::boolean, true) THEN
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

        IF public._member_has_menu(v_m.id, 'products') AND COALESCE((v_n -> 'lowStockReminder' ->> 'enabled')::boolean, true) THEN
            FOR v_row IN
                SELECT p.id, p.sku, p.name, p.reorder_point,
                       COALESCE((SELECT sum(sb.quantity) FROM public.stock_balances sb WHERE sb.product_id = p.id AND sb.stock_state = 'AVAILABLE'), 0) AS available
                  FROM public.products p WHERE p.active AND p.reorder_point > 0
            LOOP
                CONTINUE WHEN v_row.available > v_row.reorder_point;
                PERFORM public._notify('LOW_STOCK:' || v_row.id || ':' || v_today, 'LOW_STOCK', 'WARNING', v_m.id, NULL,
                                        'PRODUCT', v_row.id, 'สินค้าใกล้หมด: ' || v_row.sku || ' ' || v_row.name,
                                       'คงเหลือ ' || v_row.available || ' (จุดเตือน ' || v_row.reorder_point || ')');
                v_count := v_count + 1;
            END LOOP;
        END IF;

        IF public._member_has_menu(v_m.id, 'appointments') AND COALESCE((v_n -> 'appointmentReminder' ->> 'enabled')::boolean, true) THEN
            FOR v_row IN
                SELECT a.id, a.title, a.start_datetime, a.reminder_before_minutes
                  FROM public.appointments a
                 WHERE a.status IN ('DRAFT', 'SCHEDULED', 'CONFIRMED', 'RESCHEDULED')
                   AND a.start_datetime >= now()
                   AND (
                       (a.reminder_before_minutes IS NOT NULL
                        AND a.start_datetime - make_interval(mins => a.reminder_before_minutes) <= now())
                       OR
                       (a.reminder_before_minutes IS NULL
                        AND public._local_date(a.start_datetime) - v_today <= COALESCE((v_n -> 'appointmentReminder' ->> 'daysBefore')::integer, 3))
                   )
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
