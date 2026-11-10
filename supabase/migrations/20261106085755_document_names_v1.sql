-- จัดการเอกสาร › เพิ่มแบบฟอร์ม (2026-11-06): the shop's own document names for the
-- "หมวดหมู่เอกสาร" dropdown, one list per tab (แบบฟอร์มลูกค้า / แบบฟอร์มบิล).
-- [+] beside the name box adds a name, the bin icon in the dropdown removes it. Starts empty.

CREATE TABLE IF NOT EXISTS public.document_names (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_group  text NOT NULL,
    name          text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    CONSTRAINT document_names_target_check CHECK (target_group IN ('CUSTOMER', 'BILL')),
    CONSTRAINT document_names_name_check CHECK (btrim(name) = name AND name <> '' AND length(name) <= 100),
    CONSTRAINT document_names_unique UNIQUE (target_group, name)
);

ALTER TABLE public.document_names ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_names_select ON public.document_names;
CREATE POLICY document_names_select ON public.document_names
    FOR SELECT TO authenticated
    USING ((SELECT public.has_menu('documents')));

REVOKE ALL ON public.document_names FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_names TO authenticated;
GRANT ALL ON public.document_names TO service_role;

-- Adds a name to one tab's list; a name already there comes back as it is.
CREATE OR REPLACE FUNCTION public.document_name_add(p_target_group text, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name text := btrim(COALESCE(p_name, ''));
    v_row public.document_names%ROWTYPE;
BEGIN
    PERFORM public._require_menu('documents');
    IF p_target_group IS NULL OR p_target_group NOT IN ('CUSTOMER', 'BILL') THEN
        RAISE EXCEPTION 'DOCUMENT_NAME_TARGET_INVALID' USING ERRCODE = '22023';
    END IF;
    IF v_name = '' OR length(v_name) > 100 THEN
        RAISE EXCEPTION 'DOCUMENT_NAME_INVALID' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.document_names (target_group, name, created_by)
    VALUES (p_target_group, v_name, auth.uid())
    ON CONFLICT (target_group, name) DO NOTHING
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        SELECT * INTO v_row FROM public.document_names WHERE target_group = p_target_group AND name = v_name;
    ELSE
        PERFORM public._audit(
            'DOCUMENT_NAME_ADD', 'DOCUMENT_NAME', v_row.id, NULL,
            jsonb_build_object('id', v_row.id, 'target_group', v_row.target_group, 'name', v_row.name),
            NULL, NULL
        );
    END IF;
    RETURN to_jsonb(v_row);
END;
$$;

-- Removes a name from the list only; forms already saved under that name keep it.
CREATE OR REPLACE FUNCTION public.document_name_delete(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row public.document_names%ROWTYPE;
BEGIN
    PERFORM public._require_menu('documents');
    DELETE FROM public.document_names WHERE id = p_id RETURNING * INTO v_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DOCUMENT_NAME_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._audit(
        'DOCUMENT_NAME_DELETE', 'DOCUMENT_NAME', v_row.id,
        jsonb_build_object('id', v_row.id, 'target_group', v_row.target_group, 'name', v_row.name),
        NULL, NULL, NULL
    );
    RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.document_name_add(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.document_name_delete(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.document_name_add(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.document_name_delete(uuid) TO authenticated;
