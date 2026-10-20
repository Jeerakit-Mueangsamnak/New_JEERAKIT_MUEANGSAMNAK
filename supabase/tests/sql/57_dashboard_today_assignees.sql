-- Dashboard appointment assignees are limited to today's saved appointments and callers with
-- the dashboard menu. Runs only against the throwaway local test database.
\set ON_ERROR_STOP 1

CREATE FUNCTION t.dashboard_job(p_day_offset integer, p_title text, p_assignee text DEFAULT 'cashier')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_result jsonb;
    v_timezone text;
BEGIN
    SELECT COALESCE(NULLIF(btrim(timezone), ''), 'Asia/Bangkok')
      INTO v_timezone
      FROM public.store_settings
     WHERE singleton;
    v_timezone := COALESCE(v_timezone, 'Asia/Bangkok');
    v_result := t.ok('DASH-SETUP', 'owner creates ' || p_title, 'owner', format($q$
        SELECT public.appointment_save(NULL, jsonb_build_object(
            'appointment_type', 'DELIVERY',
            'title', %L,
            'start_datetime', (((now() AT TIME ZONE %L)::date + %s + time '10:00') AT TIME ZONE %L),
            'end_datetime', (((now() AT TIME ZONE %L)::date + %s + time '10:30') AT TIME ZONE %L),
            'assigned_user_id', %L::uuid))
        $q$, p_title, v_timezone, p_day_offset, v_timezone,
             v_timezone, p_day_offset, v_timezone, t.u(p_assignee)));
    RETURN (v_result -> 'appointment' ->> 'id')::uuid;
END;
$$;

SELECT t.set('dashboard_today', t.dashboard_job(0, 'dashboard today')::text);
SELECT t.set('dashboard_tomorrow', t.dashboard_job(1, 'dashboard tomorrow')::text);
SELECT t.set('dashboard_unassigned', t.dashboard_job(0, 'dashboard unassigned', NULL)::text);

SELECT t.check('DASH-SEC', 'only authenticated can execute the RPC',
    has_function_privilege('authenticated', 'public.dashboard_today_appointment_assignees()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.dashboard_today_appointment_assignees()', 'EXECUTE'));
SELECT t.err('DASH-SEC', 'authenticated member without dashboard menu is denied', 'finance',
    'SELECT to_jsonb(count(*)) FROM public.dashboard_today_appointment_assignees()', 'FORBIDDEN');

SELECT t.set('dashboard_rows', (t.ok('DASH-DATA', 'owner reads dashboard assignee names', 'owner',
    'SELECT COALESCE(jsonb_agg(to_jsonb(a)), ''[]''::jsonb) FROM public.dashboard_today_appointment_assignees() a'))::text);
SELECT t.check('DASH-DATA', 'only assigned appointments starting today in shop timezone are returned',
    EXISTS (
        SELECT 1
          FROM jsonb_array_elements(t.v('dashboard_rows')::jsonb) AS entries(value)
         WHERE value ->> 'appointment_id' = t.v('dashboard_today')
           AND value ->> 'assignee_id' = t.u('cashier')::text
           AND value ->> 'assignee_name' = (
               SELECT COALESCE(NULLIF(btrim(display_name), ''),
                               NULLIF(concat_ws(' ', NULLIF(btrim(first_name), ''), NULLIF(btrim(last_name), '')), ''),
                               username)
                 FROM public.profiles
                WHERE id = t.u('cashier'))
    )
    AND NOT EXISTS (
        SELECT 1
          FROM jsonb_array_elements(t.v('dashboard_rows')::jsonb) AS entries(value)
         WHERE value ->> 'appointment_id' IN (t.v('dashboard_tomorrow'), t.v('dashboard_unassigned'))
    ));
