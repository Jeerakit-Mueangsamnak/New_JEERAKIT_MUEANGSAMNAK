-- Owner decision 2026-10-22: actions run at once for anyone who has the menu/action right.
-- No PIN and no typed reason per action; the audit log records who/when/what/before/after by itself.
-- The lock-screen PIN (verify_pin 'UNLOCK', set_pin with PIN_CHANGE) is unchanged.
-- Permission checks (_require_menu / _require_action / OWNER only) are not touched.

-- 1. Reason: optional everywhere. Empty → a fixed marker so NOT NULL reason columns and history stay valid.
CREATE OR REPLACE FUNCTION public._require_reason(p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
BEGIN
    RETURN COALESCE(NULLIF(btrim(p_reason), ''), 'บันทึกอัตโนมัติ');
END;
$function$;

-- 2. Action PIN: no longer required. Only PIN_CHANGE (changing one's own lock-screen PIN) still
--    needs a fresh confirmation of the current PIN. A token that is sent anyway is still spent,
--    and only then does the audit row say pin_verified.
CREATE OR REPLACE FUNCTION public._require_pin(p_token uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    IF p_token IS NULL THEN
        IF p_action = 'PIN_CHANGE' THEN
            RAISE EXCEPTION 'PIN_REQUIRED: %', p_action USING ERRCODE = '42501';
        END IF;
        RETURN;
    END IF;
    UPDATE public.pin_confirmations
       SET used_at = now(), used_for = p_action
     WHERE id = p_token AND user_id = auth.uid() AND action = p_action AND used_at IS NULL AND expires_at > now();
    IF FOUND THEN
        PERFORM set_config('app.pin_verified', 'on', true);
    ELSIF p_action = 'PIN_CHANGE' THEN
        RAISE EXCEPTION 'PIN_CONFIRMATION_INVALID: verify the PIN again' USING ERRCODE = '42501';
    END IF;
END;
$function$;

-- 3. Audit log: keep the existing table and writer; add the screen the request came from and the
--    actor's name at that moment. Old rows keep NULL in the new columns.
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS screen text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_name text;

-- Screen path sent by the app as the x-app-screen header (lib/db/rpc.ts); NULL from server code.
CREATE OR REPLACE FUNCTION public._request_screen()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
    RETURN left(NULLIF(current_setting('request.headers', true), '')::json ->> 'x-app-screen', 200);
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._audit(p_action text, p_entity_type text, p_entity_id uuid, p_before jsonb, p_after jsonb, p_reason text, p_correlation_id uuid, p_pin_verified boolean DEFAULT false, p_amount numeric DEFAULT NULL::numeric, p_quantity numeric DEFAULT NULL::numeric, p_channel text DEFAULT NULL::text, p_result text DEFAULT 'SUCCESS'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    INSERT INTO public.audit_logs (actor_id, actor_name, action, entity_type, entity_id, before_data, after_data, reason,
                                   pin_verified, amount, quantity, channel, result, correlation_id, screen)
    VALUES (auth.uid(),
            (SELECT COALESCE(NULLIF(p.display_name, ''), p.username) FROM public.profiles p WHERE p.id = auth.uid()),
            p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason,
            COALESCE(p_pin_verified, false) AND current_setting('app.pin_verified', true) IS NOT DISTINCT FROM 'on',
            p_amount, p_quantity, p_channel, COALESCE(p_result, 'SUCCESS'),
            COALESCE(p_correlation_id, gen_random_uuid()), public._request_screen());
END;
$function$;

-- 4. Failed attempts: the failed transaction rolls back its own audit row, so the app reports the
--    refusal here right after (rpc.ts). Actor is always the caller; no arguments are stored.
CREATE OR REPLACE FUNCTION public.audit_log_failure(p_rpc text, p_error text, p_screen text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    IF auth.uid() IS NULL OR p_rpc IS NULL OR btrim(p_rpc) = '' THEN
        RETURN;
    END IF;
    INSERT INTO public.audit_logs (actor_id, actor_name, action, entity_type, after_data, result, correlation_id, screen)
    VALUES (auth.uid(),
            (SELECT COALESCE(NULLIF(p.display_name, ''), p.username) FROM public.profiles p WHERE p.id = auth.uid()),
            upper(left(btrim(p_rpc), 80)), 'RPC',
            jsonb_build_object('rpc', left(btrim(p_rpc), 80), 'error', left(COALESCE(p_error, ''), 500)),
            'FAILED', gen_random_uuid(), COALESCE(left(p_screen, 200), public._request_screen()));
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_log_failure(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_log_failure(text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public._request_screen() FROM PUBLIC, anon, authenticated;
