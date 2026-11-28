-- ============================================================================
-- LINE: switch the automatic reminders on / off per audience (owner 2026-11-28, สมาชิก right bar)
--
--   ลูกค้า   policies.line.customerAlerts { enabled }: the due-date reminders of the schedule (เตือนลูกค้า)
--   พนักงาน  policies.line.staffAlerts { enabled }: the due-date reminders to staff (เตือนพนักงานก่อนครบกำหนด)
--   เจ้าของ  policies.line.ownerAlerts { enabled }: as before (20261126110000)
-- Missing = on, so nothing changes until a switch is turned off. Off stops only the automatic round; the per-rule
-- switches and lead times stay, and sending by hand from สมาชิก still works. Messages from shop actions (bill cards,
-- driver steps) are not affected.
-- Run after 20261128163447. One transaction: a failure leaves nothing half done.
-- ============================================================================

BEGIN;

-- 1. policies.line: 20261126110000 plus customerAlerts and staffAlerts
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
        ELSIF v_key IN ('ownerAlerts', 'customerAlerts', 'staffAlerts') THEN
            -- { enabled: boolean } (default on). ownerAlerts: the owner gets every notice; customerAlerts / staffAlerts:
            -- the automatic due-date reminders of customers / staff (owner 2026-11-28)
            IF jsonb_typeof(v_val) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(v_val) x WHERE x.key <> 'enabled' OR jsonb_typeof(x.value) <> 'boolean') THEN
                RAISE EXCEPTION 'INVALID_POLICY: line.%', v_key USING ERRCODE = '22023';
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

-- 2. Customers: the automatic round (p_auto) is empty while customerAlerts.enabled is false
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
                                 AND public._line_delivery_allowed(c, 'APPOINTMENT', 'CUSTOMER_APPOINTMENT')
     WHERE NOT p_auto OR COALESCE((public._policy('line', '{}'::jsonb) -> 'customerAlerts' ->> 'enabled')::boolean, true);
$$;

-- 3. Staff: the automatic staff rows stop while staffAlerts.enabled is false; the owner rows follow ownerAlerts as before
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
    IF NOT p_auto OR COALESCE((v_line -> 'staffAlerts' ->> 'enabled')::boolean, true) THEN
    RETURN QUERY
    SELECT 'STAFF', i.rule, i.source_type, i.source_id, c.id, i.customer_name, i.ref_no, i.due_at, i.amount, i.days_left,
           'T:' || i.item_key || ':' || c.id
      FROM public._line_reminder_items(v_staff, p_auto) i
      CROSS JOIN public.line_contacts c
      JOIN public.profiles p ON p.id = c.profile_id
     WHERE c.status = 'LINKED' AND NOT c.needs_review AND c.followed AND p.status = 'ACTIVE' AND p.role <> 'OWNER'
       AND public._line_delivery_allowed(c, i.source_type, 'STAFF_NOTICE');
    END IF;
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

COMMIT;
