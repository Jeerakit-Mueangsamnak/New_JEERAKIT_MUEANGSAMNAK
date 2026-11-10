-- Pending staff accounts have no approved business activity and may be removed by the OWNER.
-- Auth Admin API deletion cascades into profiles; historical references remain RESTRICTed.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey,
  ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;

ALTER TABLE public.user_menu_access
  DROP CONSTRAINT IF EXISTS user_menu_access_user_id_fkey,
  ADD CONSTRAINT user_menu_access_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE;

ALTER TABLE public.user_pins
  DROP CONSTRAINT IF EXISTS user_pins_user_id_fkey,
  ADD CONSTRAINT user_pins_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE;

ALTER TABLE public.member_action_grants
  DROP CONSTRAINT IF EXISTS member_action_grants_user_id_fkey,
  ADD CONSTRAINT member_action_grants_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE;

ALTER TABLE public.line_link_codes
  DROP CONSTRAINT IF EXISTS line_link_codes_profile_id_fkey,
  ADD CONSTRAINT line_link_codes_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.profiles (id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public._pending_member_profile_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'PENDING' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'NO_HARD_DELETE: only pending member profiles may be deleted'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_no_delete ON public.profiles;
CREATE TRIGGER trg_profiles_no_delete
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._pending_member_profile_delete_guard();

REVOKE ALL ON FUNCTION public._pending_member_profile_delete_guard()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.owner_audit_pending_member_delete(
  p_user_id uuid,
  p_before jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public._require_owner();

  IF p_user_id IS NULL
     OR p_before ->> 'status' IS DISTINCT FROM 'PENDING'
     OR p_before ->> 'role' IS DISTINCT FROM 'USER' THEN
    RAISE EXCEPTION 'INVALID_PENDING_MEMBER_DELETE' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'MEMBER_DELETE_NOT_COMPLETED' USING ERRCODE = '22023';
  END IF;

  PERFORM public._audit(
    'MEMBER_DELETE',
    'MEMBER',
    p_user_id,
    p_before,
    jsonb_build_object('deleted', true),
    'ลบบัญชีพนักงานที่รออนุมัติ',
    NULL
  );

  RETURN jsonb_build_object('user_id', p_user_id, 'deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_audit_pending_member_delete(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_audit_pending_member_delete(uuid, jsonb)
  TO authenticated;