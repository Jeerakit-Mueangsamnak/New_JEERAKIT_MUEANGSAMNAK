-- ============================================================================
-- Auto-lock is personal (owner 2026-11-17): each member picks their own time in ตั้งค่าส่วนตัว › การตั้งค่า; the
-- OWNER no longer limits the choices (ตั้งค่าระบบ › ความปลอดภัย is gone). Any of the app's times is accepted
-- (0 = never). A member who never picked keeps the shop default (policies.auto_lock_default_seconds, as before).
-- Same body as before otherwise.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_auto_lock(p_seconds integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    PERFORM public._require_active_member();
    IF p_seconds IS NOT NULL AND NOT ('[30, 60, 120, 180, 240, 300, 600, 0]'::jsonb @> to_jsonb(p_seconds)) THEN
        RAISE EXCEPTION 'AUTO_LOCK_OPTION_INVALID' USING ERRCODE = '22023';
    END IF;
    UPDATE public.user_pins SET auto_lock_seconds = p_seconds WHERE user_id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PIN_NOT_SET' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._audit('AUTO_LOCK_SET', 'MEMBER', auth.uid(), NULL,
                          jsonb_build_object('auto_lock_seconds', p_seconds), NULL, NULL);
    RETURN public.my_pin_status();
END;
$function$;
