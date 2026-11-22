-- ============================================================================
-- LINE chat menus (rich menu) v1 (owner 2026-11-21, phase 4)
--
-- Four menus, one per kind of person: GENERAL (anyone who added the OA, set as LINE's default menu), CUSTOMER, STAFF,
-- DRIVER (each linked to the people of that kind). Which menu a person should have is decided here, from what the shop
-- has CONFIRMED (a linked customer / staff / driver), never from what the person typed. A background step makes LINE
-- agree with this (line_rich_menu_pending → link → line_rich_menu_mark); a friend who blocked the OA is never touched.
-- The menus the owner published (the ids LINE gave) are kept here; nothing is published by a migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.line_rich_menus (
    kind          text PRIMARY KEY,
    rich_menu_id  text NOT NULL,
    published_at  timestamptz NOT NULL DEFAULT now(),
    published_by  uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT line_rich_menus_kind_check CHECK (kind IN ('GENERAL', 'CUSTOMER', 'STAFF', 'DRIVER')),
    CONSTRAINT line_rich_menus_id_check CHECK (rich_menu_id ~ '^richmenu-[0-9a-f]{32}$')
);
ALTER TABLE public.line_rich_menus ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.line_rich_menus FROM PUBLIC, anon, authenticated;

-- Which menu LINE was last told to show this person (NULL = never told: the default menu shows) and when we last tried.
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS rich_menu_kind text;
ALTER TABLE public.line_contacts ADD COLUMN IF NOT EXISTS rich_menu_at timestamptz;
ALTER TABLE public.line_contacts DROP CONSTRAINT IF EXISTS line_contacts_rich_menu_kind_check;
ALTER TABLE public.line_contacts ADD CONSTRAINT line_contacts_rich_menu_kind_check CHECK (rich_menu_kind IS NULL OR rich_menu_kind IN ('GENERAL', 'CUSTOMER', 'STAFF', 'DRIVER'));

-- The kind a contact should have: only what the shop confirmed counts.
CREATE OR REPLACE FUNCTION public._line_rich_menu_kind(c public.line_contacts)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN c.status = 'LINKED' AND c.customer_id IS NOT NULL THEN 'CUSTOMER'
        WHEN c.status = 'LINKED' AND c.profile_id IS NOT NULL THEN 'STAFF'
        WHEN c.status = 'LINKED' AND c.driver_code IS NOT NULL THEN 'DRIVER'
        ELSE 'GENERAL'
    END;
$$;

-- ----------------------------------------------------------------------------
-- 1. The background step (service_role)
-- ----------------------------------------------------------------------------
-- People whose menu is not what it should be, oldest attempt first; a person whose last try failed less than 15 minutes ago waits.
-- A kind the owner has not published yet is not asked for (nothing to link); GENERAL is the default menu, so those
-- people only need their personal menu taken away.
CREATE OR REPLACE FUNCTION public.line_rich_menu_pending(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._line_require_server();
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', x.id, 'line_user_id', x.line_user_id, 'kind', x.kind, 'from_kind', x.from_kind))
          FROM (SELECT c.id, c.line_user_id, public._line_rich_menu_kind(c) AS kind, c.rich_menu_kind AS from_kind
                  FROM public.line_contacts c
                 WHERE c.followed
                   AND public._line_rich_menu_kind(c) IS DISTINCT FROM COALESCE(c.rich_menu_kind, 'GENERAL')
                   AND (public._line_rich_menu_kind(c) = 'GENERAL' OR EXISTS (SELECT 1 FROM public.line_rich_menus m WHERE m.kind = public._line_rich_menu_kind(c)))
                   AND (c.rich_menu_at IS NULL OR c.rich_menu_at < now() - interval '15 minutes')
                 ORDER BY c.rich_menu_at NULLS FIRST, c.created_at
                 LIMIT least(greatest(COALESCE(p_limit, 50), 1), 200)) x), '[]'::jsonb);
END;
$$;

-- Records the result of one try. ok = LINE now shows p_kind to that person (no waiting: a later change is done at once);
-- not ok = remember when we tried, so the person waits 15 minutes and the others are not held up.
CREATE OR REPLACE FUNCTION public.line_rich_menu_mark(p_contact_id uuid, p_kind text, p_ok boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._line_require_server();
    UPDATE public.line_contacts
       SET rich_menu_kind = CASE WHEN p_ok THEN p_kind ELSE rich_menu_kind END, rich_menu_at = CASE WHEN p_ok THEN NULL ELSE now() END
     WHERE id = p_contact_id;
END;
$$;

-- The menu ids the owner published, by kind: { "GENERAL": "richmenu-…", … }
CREATE OR REPLACE FUNCTION public.line_rich_menu_published()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._line_require_server();
    RETURN COALESCE((SELECT jsonb_object_agg(kind, rich_menu_id) FROM public.line_rich_menus), '{}'::jsonb);
END;
$$;

-- One person right now (a friend who just added the OA): their contact id and the kind they should have.
CREATE OR REPLACE FUNCTION public.line_rich_menu_for_user(p_line_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._line_require_server();
    RETURN (SELECT jsonb_build_object('id', c.id, 'line_user_id', c.line_user_id, 'kind', public._line_rich_menu_kind(c), 'from_kind', c.rich_menu_kind)
              FROM public.line_contacts c WHERE c.line_user_id = p_line_user_id AND c.followed);
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Publishing (the server calls these after LINE accepted the menu)
-- ----------------------------------------------------------------------------
-- Keeps the new menu id for the kind and returns the old one, so the old menu can be deleted at LINE.
CREATE OR REPLACE FUNCTION public.line_rich_menu_save(p_kind text, p_rich_menu_id text, p_actor uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old text;
BEGIN
    PERFORM public._line_require_server();
    SELECT rich_menu_id INTO v_old FROM public.line_rich_menus WHERE kind = p_kind FOR UPDATE;
    INSERT INTO public.line_rich_menus (kind, rich_menu_id, published_at, published_by)
    VALUES (p_kind, p_rich_menu_id, now(), p_actor)
    ON CONFLICT (kind) DO UPDATE SET rich_menu_id = EXCLUDED.rich_menu_id, published_at = now(), published_by = EXCLUDED.published_by;
    -- people of this kind must be told again (the old menu id is gone)
    UPDATE public.line_contacts c SET rich_menu_kind = NULL, rich_menu_at = NULL WHERE c.rich_menu_kind = p_kind;
    PERFORM public._audit_line(p_actor, 'LINE_RICH_MENU_PUBLISH', 'LINE_RICH_MENU', NULL, jsonb_build_object('kind', p_kind));
    RETURN v_old;
END;
$$;

CREATE OR REPLACE FUNCTION public.line_rich_menu_clear(p_kind text, p_actor uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old text;
BEGIN
    PERFORM public._line_require_server();
    DELETE FROM public.line_rich_menus WHERE kind = p_kind RETURNING rich_menu_id INTO v_old;
    UPDATE public.line_contacts c SET rich_menu_kind = NULL, rich_menu_at = NULL WHERE c.rich_menu_kind = p_kind;
    IF v_old IS NOT NULL THEN
        PERFORM public._audit_line(p_actor, 'LINE_RICH_MENU_CLEAR', 'LINE_RICH_MENU', NULL, jsonb_build_object('kind', p_kind));
    END IF;
    RETURN v_old;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. What the owner sees (authenticated, OWNER only): per kind, published or not, and how many people are on it
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.line_rich_menu_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_owner();
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', k.kind,
                   'published_at', m.published_at,
                   'people', (SELECT count(*) FROM public.line_contacts c WHERE c.followed AND public._line_rich_menu_kind(c) = k.kind),
                   'on_menu', (SELECT count(*) FROM public.line_contacts c WHERE c.followed AND c.rich_menu_kind = k.kind)) ORDER BY k.ord)
          FROM (VALUES ('GENERAL', 1), ('CUSTOMER', 2), ('STAFF', 3), ('DRIVER', 4)) AS k(kind, ord)
          LEFT JOIN public.line_rich_menus m ON m.kind = k.kind), '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._line_rich_menu_kind(public.line_contacts) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
    public.line_rich_menu_pending(integer),
    public.line_rich_menu_mark(uuid, text, boolean),
    public.line_rich_menu_published(),
    public.line_rich_menu_for_user(text),
    public.line_rich_menu_save(text, text, uuid),
    public.line_rich_menu_clear(text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.line_rich_menu_pending(integer),
    public.line_rich_menu_mark(uuid, text, boolean),
    public.line_rich_menu_published(),
    public.line_rich_menu_for_user(text),
    public.line_rich_menu_save(text, text, uuid),
    public.line_rich_menu_clear(text, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.line_rich_menu_status() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.line_rich_menu_status() TO authenticated;
