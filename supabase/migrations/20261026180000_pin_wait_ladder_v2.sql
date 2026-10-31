-- PIN waits v2 (owner decision 2026-10-26, Master §4.3).
--   miss 1-5 : no wait          miss 6 : 1 min    miss 7 : 5 min
--   miss 8   : 15 min           miss 9 : 60 min   miss 10: PIN blocked (as before)
-- The count is kept across waits; a right PIN starts it over. Unblocking is unchanged:
-- a USER needs the OWNER's reset (owner_reset_member_pin), the OWNER uses "ลืม PIN"
-- (owner_recover_pin). The account itself is never closed by PIN misses.
--
-- The waits live in store_settings.policies.pin_fail_delays_seconds (read by verify_pin);
-- miss n waits element n-1, and the miss after the last element blocks the PIN.

UPDATE public.store_settings
   SET policies = COALESCE(policies, '{}'::jsonb)
                  || jsonb_build_object('pin_fail_delays_seconds', jsonb_build_array(0, 0, 0, 0, 0, 60, 300, 900, 3600))
 WHERE singleton;

-- Same function as the baseline; only the fallback used when the setting is missing changes.
CREATE OR REPLACE FUNCTION public.verify_pin(p_pin text, p_purpose text DEFAULT 'UNLOCK', p_action text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pin       public.user_pins%ROWTYPE;
    v_steps     jsonb := public._policy('pin_fail_delays_seconds',
                                        '[0, 0, 0, 0, 0, 60, 300, 900, 3600]'::jsonb);
    v_n         integer;
    v_secs      integer;
    v_until     timestamptz;
    v_token     uuid;
BEGIN
    PERFORM public._require_active_member();
    IF p_purpose IS NULL OR p_purpose NOT IN ('UNLOCK', 'ACTION') THEN
        RAISE EXCEPTION 'INVALID_PURPOSE' USING ERRCODE = '22023';
    END IF;
    IF p_purpose = 'ACTION' AND (p_action IS NULL OR p_action !~ '^[A-Z_]+$') THEN
        RAISE EXCEPTION 'ACTION_REQUIRED: name the risky action this PIN confirms' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_pin FROM public.user_pins WHERE user_id = auth.uid() FOR UPDATE;
    IF NOT FOUND OR v_pin.pin_hash IS NULL THEN
        RAISE EXCEPTION 'PIN_NOT_SET' USING ERRCODE = 'P0002';
    END IF;
    IF v_pin.blocked_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'blocked', true, 'failed_attempts', v_pin.failed_attempts,
                                  'recovery', CASE WHEN public.is_owner() THEN 'REAUTHENTICATE' ELSE 'OWNER_RESET' END);
    END IF;
    IF v_pin.locked_until IS NOT NULL AND v_pin.locked_until > now() THEN
        RETURN jsonb_build_object('ok', false, 'locked_until', v_pin.locked_until,
                                  'failed_attempts', v_pin.failed_attempts);
    END IF;

    IF p_pin IS NOT NULL AND v_pin.pin_hash = extensions.crypt(p_pin, v_pin.pin_hash) THEN
        UPDATE public.user_pins SET failed_attempts = 0, locked_until = NULL
         WHERE user_id = v_pin.user_id;
        IF p_purpose = 'ACTION' THEN
            INSERT INTO public.pin_confirmations (user_id, action, expires_at)
            VALUES (v_pin.user_id, p_action, now() + interval '30 seconds')
            RETURNING id INTO v_token;
        END IF;
        RETURN jsonb_build_object('ok', true, 'pin_token', v_token);
    END IF;

    v_n := v_pin.failed_attempts + 1;
    IF v_n > jsonb_array_length(v_steps) THEN
        UPDATE public.user_pins SET failed_attempts = v_n, locked_until = NULL, blocked_at = now()
         WHERE user_id = v_pin.user_id;
        PERFORM public._audit('PIN_BLOCKED', 'MEMBER', v_pin.user_id, NULL,
                              jsonb_build_object('purpose', p_purpose, 'failed_attempts', v_n),
                              NULL, NULL, false, NULL, NULL, NULL, 'FAILED');
        RETURN jsonb_build_object('ok', false, 'blocked', true, 'failed_attempts', v_n,
                                  'recovery', CASE WHEN public.is_owner() THEN 'REAUTHENTICATE' ELSE 'OWNER_RESET' END);
    END IF;
    v_secs := COALESCE((v_steps ->> (v_n - 1))::integer, 0);
    v_until := CASE WHEN v_secs > 0 THEN now() + make_interval(secs => v_secs) END;
    UPDATE public.user_pins SET failed_attempts = v_n, locked_until = v_until WHERE user_id = v_pin.user_id;
    PERFORM public._audit(CASE WHEN v_secs > 0 THEN 'PIN_LOCKED' ELSE 'PIN_VERIFY_FAILED' END, 'MEMBER',
                          v_pin.user_id, NULL,
                          jsonb_build_object('purpose', p_purpose, 'failed_attempts', v_n, 'wait_seconds', v_secs),
                          NULL, NULL, false, NULL, NULL, NULL, 'FAILED');
    RETURN jsonb_build_object('ok', false, 'failed_attempts', v_n, 'locked_until', v_until);
END;
$$;
