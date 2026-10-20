-- Expose only assignee names attached to appointments starting today in the shop timezone.
-- SECURITY DEFINER is required because profiles RLS intentionally hides other members.
CREATE OR REPLACE FUNCTION public.dashboard_today_appointment_assignees()
RETURNS TABLE (appointment_id uuid, assignee_id uuid, assignee_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_timezone text;
    v_today date;
    v_start timestamptz;
    v_end timestamptz;
BEGIN
    PERFORM public._require_menu('dashboard');

    SELECT COALESCE(NULLIF(btrim(s.timezone), ''), 'Asia/Bangkok')
      INTO v_timezone
      FROM public.store_settings s
     WHERE s.singleton;
    v_timezone := COALESCE(v_timezone, 'Asia/Bangkok');
    v_today := (now() AT TIME ZONE v_timezone)::date;
    v_start := v_today::timestamp AT TIME ZONE v_timezone;
    v_end := (v_today + 1)::timestamp AT TIME ZONE v_timezone;

    RETURN QUERY
    SELECT a.id,
           a.assigned_user_id,
           COALESCE(
               NULLIF(btrim(p.display_name), ''),
               NULLIF(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), '')), ''),
               p.username
           )
      FROM public.appointments a
      LEFT JOIN public.profiles p ON p.id = a.assigned_user_id
     WHERE a.start_datetime >= v_start
       AND a.start_datetime < v_end
       AND a.assigned_user_id IS NOT NULL
     ORDER BY a.start_datetime, a.id;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_today_appointment_assignees() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_today_appointment_assignees() TO authenticated;