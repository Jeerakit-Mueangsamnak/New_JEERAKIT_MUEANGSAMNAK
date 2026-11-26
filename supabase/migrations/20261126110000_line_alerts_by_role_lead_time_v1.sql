-- ============================================================================
-- LINE notices by who receives them (owner 2026-11-26): customer / staff / owner
--
--   ลูกค้า   policies.line.reminders (as before) + leadMinutes per rule: 5, 10, 15, 20, 25, 30 minutes, 1, 2, 3 hours,
--            1, 2, 3 days before the due time (every rule that has a due time: return, payment, appointment)
--   พนักงาน  policies.line.staffReminders: the same rules, switches and lead times, to every linked staff member;
--            the owner can also send one by hand (ส่งเตือนพนักงานเอง)
--   เจ้าของ  everything, automatically (owner: ข): the staff rules all on with the staff lead times, and every in-app
--            notice meant for the owner, whatever the แจ้งพนักงาน switches say; one switch policies.line.ownerAlerts
-- Run after 20261126100000. One transaction: a failure leaves nothing half done.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. policies.line: 20261126100000 plus leadMinutes, staffReminders and ownerAlerts
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
    v_rule_ints jsonb := '{"daysBefore": [0, 30], "repeatDays": [0, 30], "leadMinutes": [5, 4320]}'::jsonb;
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
        ELSIF v_key IN ('reminders', 'staffReminders') THEN
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
        ELSIF v_key = 'ownerAlerts' THEN
            -- { enabled: boolean } (default on: the owner gets every notice)
            IF jsonb_typeof(v_val) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(v_val) x WHERE x.key <> 'enabled' OR jsonb_typeof(x.value) <> 'boolean') THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.ownerAlerts' USING ERRCODE = '22023';
            END IF;
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

-- ----------------------------------------------------------------------------
-- 2. What is due, for any audience. p_cfg = the rules of one audience ({ RULE: { enabled, leadMinutes, daysBefore,
--    repeatDays } }). leadMinutes (5 minutes .. 3 days) wins over the older daysBefore. A lead of a day or more keeps the
--    old way (the days before, from reminderHour on); a shorter lead sends from that many minutes before the due time.
--    Date-only due dates (payment) are due at reminderHour of that day. p_auto = false: the wider list of ส่งเตือนเอง.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._line_lead_minutes(p_rule jsonb, p_auto boolean)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE WHEN p_auto THEN v.lead ELSE greatest(v.lead, 4320) END
      FROM (SELECT least(greatest(COALESCE((p_rule ->> 'leadMinutes')::integer, (p_rule ->> 'daysBefore')::integer * 1440, 1440), 1), 4320) AS lead) v;
$$;

-- Inside the lead window of p_due: a day or more = whole days before (p_min_days .. lead days, from reminderHour on);
-- less = from p_lead minutes before the due time.
CREATE OR REPLACE FUNCTION public._line_lead_due(p_due timestamptz, p_lead integer, p_after_hour boolean, p_today date, p_min_days integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_lead >= 1440 THEN p_after_hour AND (public._local_date(p_due) - p_today) BETWEEN p_min_days AND (p_lead / 1440)
        ELSE now() >= p_due - make_interval(mins => p_lead)
    END;
$$;

-- Active rental bills with what is still out: the earliest return time of the bill.
CREATE OR REPLACE FUNCTION public._line_open_rentals()
RETURNS TABLE (bill_id uuid, bill_no text, customer_id uuid, balance_due numeric, end_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT b.id, b.bill_no, b.customer_id, b.balance_due, min(l.rental_end_at)
      FROM public.bills b JOIN public.bill_lines l ON l.bill_id = b.id
     WHERE l.line_mode = 'RENTAL' AND l.obligation_held_here > 0 AND b.status = 'ACTIVE'
     GROUP BY b.id, b.bill_no, b.customer_id, b.balance_due;
$$;

CREATE OR REPLACE FUNCTION public._line_reminder_items(p_cfg jsonb, p_auto boolean)
RETURNS TABLE (rule text, source_type text, source_id uuid, customer_id uuid, customer_name text,
               ref_no text, due_at timestamptz, amount numeric, days_left integer, item_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_cfg    jsonb := COALESCE(p_cfg, '{}'::jsonb);
    v_hour   integer := public._line_option_int('reminderHour', 9, 0, 23);
    v_today  date := public._local_date(now());
    v_after  boolean := NOT p_auto OR extract(hour FROM now() AT TIME ZONE 'Asia/Bangkok') >= public._line_option_int('reminderHour', 9, 0, 23);
    v_lead   integer;
    v_repeat integer;
BEGIN
    IF NOT p_auto OR COALESCE((v_cfg -> 'RENTAL_DUE_SOON' ->> 'enabled')::boolean, false) THEN
        v_lead := public._line_lead_minutes(v_cfg -> 'RENTAL_DUE_SOON', p_auto);
        RETURN QUERY
        SELECT 'RENTAL_DUE_SOON', 'BILL', x.bill_id, x.customer_id, cu.name, x.bill_no, x.end_at, x.balance_due,
               public._local_date(x.end_at) - v_today,
               'DUE_SOON:' || x.bill_id || ':' || public._local_date(x.end_at)
          FROM public._line_open_rentals() x
          LEFT JOIN public.customers cu ON cu.id = x.customer_id
         WHERE x.end_at > now() AND public._line_lead_due(x.end_at, v_lead, v_after, v_today, 1);
    END IF;

    IF NOT p_auto OR COALESCE((v_cfg -> 'RENTAL_DUE_TODAY' ->> 'enabled')::boolean, false) THEN
        RETURN QUERY
        SELECT 'RENTAL_DUE_TODAY', 'BILL', x.bill_id, x.customer_id, cu.name, x.bill_no, x.end_at, x.balance_due, 0,
               'DUE_TODAY:' || x.bill_id || ':' || public._local_date(x.end_at)
          FROM public._line_open_rentals() x
          LEFT JOIN public.customers cu ON cu.id = x.customer_id
         WHERE public._local_date(x.end_at) = v_today AND v_after;
    END IF;

    IF NOT p_auto OR COALESCE((v_cfg -> 'RENTAL_OVERDUE' ->> 'enabled')::boolean, false) THEN
        v_repeat := COALESCE((v_cfg -> 'RENTAL_OVERDUE' ->> 'repeatDays')::integer, 0);
        RETURN QUERY
        SELECT 'RENTAL_OVERDUE', 'BILL', x.bill_id, x.customer_id, cu.name, x.bill_no, x.end_at, x.balance_due,
               public._local_date(x.end_at) - v_today,
               'OVERDUE:' || x.bill_id || ':' || public._local_date(x.end_at)
               || CASE WHEN v_repeat > 0 THEN ':' || ((v_today - public._local_date(x.end_at) - 1) / v_repeat) ELSE '' END
          FROM public._line_open_rentals() x
          LEFT JOIN public.customers cu ON cu.id = x.customer_id
         WHERE public._local_date(x.end_at) < v_today AND v_after;
    END IF;

    IF NOT p_auto OR COALESCE((v_cfg -> 'PAYMENT_DUE' ->> 'enabled')::boolean, false) THEN
        v_lead := public._line_lead_minutes(v_cfg -> 'PAYMENT_DUE', p_auto);
        v_repeat := COALESCE((v_cfg -> 'PAYMENT_DUE' ->> 'repeatDays')::integer, 0);
        RETURN QUERY
        SELECT 'PAYMENT_DUE', 'BILL', y.id, y.customer_id, cu.name, y.bill_no, y.due_at, y.balance_due,
               y.due_date - v_today,
               'PAY:' || y.id || ':' || y.due_date
               || CASE WHEN y.due_date < v_today THEN ':late'
                       || CASE WHEN v_repeat > 0 THEN ':' || ((v_today - y.due_date - 1) / v_repeat) ELSE '' END
                       ELSE '' END
          FROM (SELECT b.id, b.customer_id, b.bill_no, b.balance_due, b.due_date,
                       (b.due_date::timestamp + make_interval(hours => v_hour)) AT TIME ZONE 'Asia/Bangkok' AS due_at
                  FROM public.bills b
                 WHERE b.status IN ('CONFIRMED', 'ACTIVE', 'CLOSED') AND b.balance_due > 0 AND b.due_date IS NOT NULL) y
          LEFT JOIN public.customers cu ON cu.id = y.customer_id
         WHERE (y.due_date >= v_today AND public._line_lead_due(y.due_at, v_lead, v_after, v_today, 0))
            OR (y.due_date < v_today AND v_after);
    END IF;

    IF NOT p_auto OR COALESCE((v_cfg -> 'APPOINTMENT_DUE' ->> 'enabled')::boolean, false) THEN
        v_lead := public._line_lead_minutes(v_cfg -> 'APPOINTMENT_DUE', p_auto);
        RETURN QUERY
        SELECT 'APPOINTMENT_DUE', 'APPOINTMENT', a.id, a.customer_id, COALESCE(cu.name, NULLIF(btrim(a.contact_name), '')), a.title,
               a.start_datetime, NULL::numeric,
               public._local_date(a.start_datetime) - v_today,
               'APPT:' || a.id || ':' || public._local_date(a.start_datetime)
          FROM public.appointments a
          LEFT JOIN public.customers cu ON cu.id = a.customer_id
         WHERE a.status IN ('DRAFT', 'SCHEDULED', 'CONFIRMED', 'RESCHEDULED') AND a.start_datetime >= now()
           AND public._line_lead_due(a.start_datetime, v_lead, v_after, v_today, 0);
    END IF;
END;
$$;

-- Customers (เตือนลูกค้า, policies.line.reminders): same columns and keys as before, so nothing already sent goes again.
CREATE OR REPLACE FUNCTION public._line_customer_reminder_rows(p_auto boolean)
RETURNS TABLE (rule text, source_type text, source_id uuid, contact_id uuid, customer_name text,
               ref_no text, due_at timestamptz, amount numeric, days_left integer, dedupe_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT i.rule, i.source_type, i.source_id, c.id, i.customer_name, i.ref_no, i.due_at, i.amount, i.days_left, 'R:' || i.item_key
      FROM public._line_reminder_items(COALESCE(public._policy('line', '{}'::jsonb) -> 'reminders', '{}'::jsonb), p_auto) i
      JOIN public.line_contacts c ON c.customer_id = i.customer_id
                                 AND public._line_delivery_allowed(c, 'APPOINTMENT', 'CUSTOMER_APPOINTMENT');
$$;

-- Staff (policies.line.staffReminders) and the owner (everything, while policies.line.ownerAlerts.enabled is not
-- false; the owner's lead times are the staff ones). One row per linked person.
CREATE OR REPLACE FUNCTION public._line_team_reminder_rows(p_auto boolean)
RETURNS TABLE (audience text, rule text, source_type text, source_id uuid, contact_id uuid, customer_name text,
               ref_no text, due_at timestamptz, amount numeric, days_left integer, dedupe_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_line  jsonb := public._policy('line', '{}'::jsonb);
    v_staff jsonb := COALESCE(public._policy('line', '{}'::jsonb) -> 'staffReminders', '{}'::jsonb);
    v_owner jsonb := '{}'::jsonb;
    v_rule  text;
BEGIN
    RETURN QUERY
    SELECT 'STAFF', i.rule, i.source_type, i.source_id, c.id, i.customer_name, i.ref_no, i.due_at, i.amount, i.days_left,
           'T:' || i.item_key || ':' || c.id
      FROM public._line_reminder_items(v_staff, p_auto) i
      CROSS JOIN public.line_contacts c
      JOIN public.profiles p ON p.id = c.profile_id
     WHERE c.status = 'LINKED' AND NOT c.needs_review AND c.followed AND p.status = 'ACTIVE' AND p.role <> 'OWNER'
       AND public._line_delivery_allowed(c, i.source_type, 'STAFF_NOTICE');
    IF COALESCE((v_line -> 'ownerAlerts' ->> 'enabled')::boolean, true) THEN
        FOREACH v_rule IN ARRAY ARRAY['RENTAL_DUE_SOON', 'RENTAL_DUE_TODAY', 'RENTAL_OVERDUE', 'PAYMENT_DUE', 'APPOINTMENT_DUE'] LOOP
            v_owner := v_owner || jsonb_build_object(v_rule, COALESCE(v_staff -> v_rule, '{}'::jsonb) || '{"enabled": true}'::jsonb);
        END LOOP;
        RETURN QUERY
        SELECT 'OWNER', i.rule, i.source_type, i.source_id, c.id, i.customer_name, i.ref_no, i.due_at, i.amount, i.days_left,
               'O:' || i.item_key || ':' || c.id
          FROM public._line_reminder_items(v_owner, p_auto) i
          CROSS JOIN public.line_contacts c
          JOIN public.profiles p ON p.id = c.profile_id
         WHERE c.status = 'LINKED' AND NOT c.needs_review AND c.followed AND p.status = 'ACTIVE' AND p.role = 'OWNER'
           AND public._line_delivery_allowed(c, i.source_type, 'STAFF_NOTICE');
    END IF;
END;
$$;

-- The background round (service_role): the staff / owner reminders not queued yet.
CREATE OR REPLACE FUNCTION public.line_team_reminders_due()
RETURNS TABLE (audience text, rule text, source_type text, source_id uuid, contact_id uuid, customer_name text,
               ref_no text, due_at timestamptz, amount numeric, days_left integer, dedupe_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    PERFORM public._line_require_server();
    RETURN QUERY
    SELECT r.* FROM public._line_team_reminder_rows(true) r
     WHERE NOT EXISTS (SELECT 1 FROM public.line_deliveries d WHERE d.dedupe_key = 'X:' || r.dedupe_key);
END;
$$;

-- ส่งเตือนพนักงานเอง (OWNER): what is due (the wider list) with the last time the owner sent it to staff.
CREATE OR REPLACE FUNCTION public.line_team_reminder_candidates()
RETURNS TABLE (rule text, source_type text, source_id uuid, customer_name text, ref_no text,
               due_at timestamptz, amount numeric, days_left integer, last_queued_at timestamptz, staff_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    PERFORM public._require_owner();
    RETURN QUERY
    SELECT i.rule, i.source_type, i.source_id, i.customer_name, i.ref_no, i.due_at, i.amount, i.days_left,
           (SELECT max(d.created_at) FROM public.line_deliveries d
             WHERE d.source_id = i.source_id AND d.dedupe_key LIKE 'M:T:' || i.rule || ':%'),
           (SELECT count(*)::integer FROM public.line_contacts c JOIN public.profiles p ON p.id = c.profile_id
             WHERE c.status = 'LINKED' AND NOT c.needs_review AND c.followed AND p.status = 'ACTIVE' AND p.role <> 'OWNER')
      FROM public._line_reminder_items(COALESCE(public._policy('line', '{}'::jsonb) -> 'staffReminders', '{}'::jsonb), false) i
     ORDER BY i.days_left, i.ref_no;
END;
$$;

-- ส่งเตือนพนักงานเอง (OWNER): the notice (plain text, made by the server) to every linked staff member.
CREATE OR REPLACE FUNCTION public.line_team_reminder_send(p_rule text, p_source_type text, p_source_id uuid, p_messages jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_n integer;
    v_at text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
BEGIN
    PERFORM public._require_owner();
    IF p_rule NOT IN ('RENTAL_DUE_SOON', 'RENTAL_DUE_TODAY', 'RENTAL_OVERDUE', 'PAYMENT_DUE', 'APPOINTMENT_DUE')
       OR p_source_type NOT IN ('BILL', 'APPOINTMENT') OR p_source_id IS NULL
       OR NOT public._line_messages_valid(p_messages)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_messages) m WHERE m ->> 'type' <> 'text') THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key, requested_by)
    SELECT c.id, p_source_type, p_source_id, 'STAFF_NOTICE', p_messages, 'M:T:' || p_rule || ':' || p_source_id || ':' || c.id || ':' || v_at, auth.uid()
      FROM public.line_contacts c
      JOIN public.profiles p ON p.id = c.profile_id
     WHERE c.status = 'LINKED' AND NOT c.needs_review AND c.followed AND p.status = 'ACTIVE' AND p.role <> 'OWNER'
       AND public._line_delivery_allowed(c, p_source_type, 'STAFF_NOTICE')
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public._audit('LINE_STAFF_REMINDER_SEND', 'LINE_DELIVERY', p_source_id, NULL,
                          jsonb_build_object('rule', p_rule, 'source_type', p_source_type, 'recipients', v_n),
                          NULL, NULL, false, NULL, NULL, 'LINE');
    RETURN jsonb_build_object('queued', v_n);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. In-app notices to LINE: staff by the แจ้งพนักงาน switches (as before); the owner gets every notice meant for them,
--    whatever those switches say, while policies.line.ownerAlerts.enabled is not false.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.line_notification_recipients(p_notification_id uuid)
RETURNS TABLE (contact_id uuid, profile_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_n        public.notifications%ROWTYPE;
    v_staff_on boolean;
    v_owner_on boolean := COALESCE((public._policy('line', '{}'::jsonb) -> 'ownerAlerts' ->> 'enabled')::boolean, true);
BEGIN
    PERFORM public._line_require_server();
    SELECT * INTO v_n FROM public.notifications WHERE id = p_notification_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    v_staff_on := COALESCE((public._policy('line', '{}'::jsonb) -> 'notify' ->> v_n.event_type)::boolean, false);
    IF NOT v_staff_on AND NOT v_owner_on THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT c.id, c.profile_id
      FROM public.line_contacts c
      JOIN public.profiles p ON p.id = c.profile_id AND p.status = 'ACTIVE'
     WHERE c.status = 'LINKED' AND c.followed AND c.profile_id IS NOT NULL
       AND (c.profile_id = v_n.recipient_user_id
            OR (v_n.recipient_menu IS NOT NULL AND public._member_has_menu(c.profile_id, v_n.recipient_menu)))
       AND ((p.role = 'OWNER' AND v_owner_on) OR (p.role <> 'OWNER' AND v_staff_on));
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._line_lead_minutes(jsonb, boolean), public._line_lead_due(timestamptz, integer, boolean, date, integer),
    public._line_open_rentals(), public._line_reminder_items(jsonb, boolean), public._line_team_reminder_rows(boolean)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.line_team_reminders_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_team_reminders_due() TO service_role;
REVOKE ALL ON FUNCTION public.line_team_reminder_candidates(), public.line_team_reminder_send(text, text, uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.line_team_reminder_candidates(), public.line_team_reminder_send(text, text, uuid, jsonb) TO authenticated;

COMMIT;
