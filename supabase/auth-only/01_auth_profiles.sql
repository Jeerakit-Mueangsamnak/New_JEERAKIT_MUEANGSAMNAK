-- ============================================================================
-- Auth / Profile only — subset of supabase/baseline/00_baseline.sql
-- Scope: login with real Supabase Auth. No business tables.
-- Objects: public.profiles, signup trigger on auth.users, membership helpers,
--          profiles RLS + grants. Definitions are copied unchanged from the baseline;
--          when the full baseline is applied later, these objects must be skipped.
-- ============================================================================

SET check_function_bodies = true;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Entities with history: no hard delete (Master §3.3). Use active/status instead.
CREATE FUNCTION public._forbid_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'NO_HARD_DELETE: deleting from %.% is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$;

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- profiles — SoT of members (PENDING on signup, OWNER/USER only).
CREATE TABLE public.profiles (
    id                 uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
    email              text,
    username           text NOT NULL,
    first_name         text,
    last_name          text,
    display_name       text,
    avatar_url         text,
    role               text NOT NULL DEFAULT 'USER',
    status             text NOT NULL DEFAULT 'PENDING',
    is_approved        boolean GENERATED ALWAYS AS (status = 'ACTIVE') STORED,
    status_changed_at  timestamptz,
    status_changed_by  uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profiles_role_check     CHECK (role IN ('OWNER', 'USER')),
    CONSTRAINT profiles_status_check   CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
    CONSTRAINT profiles_username_check CHECK (username <> '' AND username = lower(btrim(username)))
);
CREATE UNIQUE INDEX profiles_username_uidx ON public.profiles (username);
CREATE INDEX profiles_role_status_idx ON public.profiles (role, status);

-- Membership helpers. SECURITY DEFINER so RLS on profiles cannot recurse.
CREATE FUNCTION public.is_active_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.status = 'ACTIVE'
    );
$$;

CREATE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'OWNER' AND p.status = 'ACTIVE'
    );
$$;

-- Signup trigger: every self-registered account starts PENDING USER;
-- role is never read from user metadata.
CREATE FUNCTION public.handle_new_auth_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_first_name    text := COALESCE(NEW.raw_user_meta_data ->> 'first_name', '');
    v_last_name     text := COALESCE(NEW.raw_user_meta_data ->> 'last_name', '');
    v_username      text;
    v_display_name  text;
BEGIN
    v_username := lower(btrim(COALESCE(
        NULLIF(btrim(NEW.raw_user_meta_data ->> 'username'), ''),
        split_part(NEW.email, '@', 1))));
    v_username := ltrim(v_username, '@');
    v_display_name := COALESCE(
        NULLIF(btrim(NEW.raw_user_meta_data ->> 'display_name'), ''),
        NULLIF(btrim(v_first_name || ' ' || v_last_name), ''),
        v_username);

    INSERT INTO public.profiles (id, email, username, first_name, last_name, display_name, avatar_url, role, status)
    VALUES (NEW.id, NEW.email, v_username, v_first_name, v_last_name, v_display_name,
            NEW.raw_user_meta_data ->> 'avatar_url', 'USER', 'PENDING');
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_create_profile
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user_profile();

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_profiles_no_delete BEFORE DELETE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public._forbid_delete();

-- RLS: a member reads their own row; an ACTIVE OWNER reads all.
-- Clients may only edit their own name/avatar columns (role/status never).
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own_or_owner ON public.profiles
    FOR SELECT TO authenticated USING (id = (SELECT auth.uid()) OR (SELECT public.is_owner()));
CREATE POLICY profiles_update_own ON public.profiles
    FOR UPDATE TO authenticated USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

-- Grants
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._forbid_delete(), public.set_updated_at(), public.handle_new_auth_user_profile(),
    public.is_active_member(), public.is_owner()
    FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT ALL ON public.profiles TO service_role;  -- server-side username lookup; no-delete trigger still applies
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (first_name, last_name, display_name, avatar_url) ON public.profiles TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_member(), public.is_owner() TO authenticated, service_role;
