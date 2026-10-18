-- Shared custom document templates — local migration, not applied to Cloud.
CREATE TABLE IF NOT EXISTS public.document_templates (
    id                text PRIMARY KEY,
    name              text NOT NULL,
    category          text NOT NULL,
    source            text NOT NULL,
    file_type         text NOT NULL,
    file_name         text,
    template_schema   text NOT NULL,
    paper_size        text NOT NULL DEFAULT 'A4',
    orientation       text NOT NULL DEFAULT 'PORTRAIT',
    page_count        integer NOT NULL DEFAULT 1,
    version           integer NOT NULL DEFAULT 1,
    is_default        boolean NOT NULL DEFAULT false,
    description       text,
    default_terms     text,
    status            text NOT NULL DEFAULT 'ACTIVE',
    status_reason     text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    updated_by        uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
    CONSTRAINT document_templates_id_check CHECK (id ~ '^tpl-[A-Za-z0-9-]{1,80}$'),
    CONSTRAINT document_templates_name_check CHECK (btrim(name) <> '' AND length(name) <= 160),
    CONSTRAINT document_templates_category_check CHECK (btrim(category) <> '' AND length(category) <= 100),
    CONSTRAINT document_templates_source_check CHECK (source IN ('BUILTIN', 'CONVERTED_IMPORT')),
    CONSTRAINT document_templates_file_type_check CHECK (btrim(file_type) <> '' AND length(file_type) <= 20),
    CONSTRAINT document_templates_file_name_check CHECK (file_name IS NULL OR length(file_name) <= 255),
    CONSTRAINT document_templates_schema_check CHECK (btrim(template_schema) <> '' AND octet_length(template_schema) <= 1048576),
    CONSTRAINT document_templates_paper_size_check CHECK (paper_size = 'A4'),
    CONSTRAINT document_templates_orientation_check CHECK (orientation IN ('PORTRAIT', 'LANDSCAPE')),
    CONSTRAINT document_templates_page_count_check CHECK (page_count BETWEEN 1 AND 100),
    CONSTRAINT document_templates_version_check CHECK (version >= 1),
    CONSTRAINT document_templates_description_check CHECK (description IS NULL OR length(description) <= 1000),
    CONSTRAINT document_templates_default_terms_check CHECK (default_terms IS NULL OR length(default_terms) <= 10000),
    CONSTRAINT document_templates_status_check CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT document_templates_inactive_check CHECK (status = 'ACTIVE' OR status_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS document_templates_status_created_idx
    ON public.document_templates (status, created_at DESC);

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_templates_select ON public.document_templates;
CREATE POLICY document_templates_select ON public.document_templates
    FOR SELECT TO authenticated
    USING (status = 'ACTIVE' AND (SELECT public.has_menu('documents')));

REVOKE ALL ON public.document_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_templates TO authenticated;
GRANT ALL ON public.document_templates TO service_role;

CREATE OR REPLACE FUNCTION public.document_template_create(p_template_id text, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_template public.document_templates%ROWTYPE;
    v_inserted boolean := false;
    v_allowed text[] := ARRAY[
        'name', 'category', 'source', 'file_type', 'file_name', 'template_schema',
        'paper_size', 'orientation', 'page_count', 'version', 'is_default',
        'description', 'default_terms'
    ];
BEGIN
    PERFORM public._require_menu('documents');
    IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
        RAISE EXCEPTION 'TEMPLATE_DATA_INVALID' USING ERRCODE = '22023';
    END IF;
    IF p_template_id IS NULL OR p_template_id !~ '^tpl-[A-Za-z0-9-]{1,80}$' THEN
        RAISE EXCEPTION 'TEMPLATE_ID_INVALID' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) AS k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'TEMPLATE_FIELDS_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(btrim(p_data->>'name'), '') IS NULL OR length(p_data->>'name') > 160
       OR NULLIF(btrim(p_data->>'category'), '') IS NULL OR length(p_data->>'category') > 100
       OR NULLIF(btrim(p_data->>'template_schema'), '') IS NULL
       OR octet_length(p_data->>'template_schema') > 1048576 THEN
        RAISE EXCEPTION 'TEMPLATE_REQUIRED_FIELDS_INVALID' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.document_templates (
        id, name, category, source, file_type, file_name, template_schema, paper_size,
        orientation, page_count, version, is_default, description, default_terms, created_by
    ) VALUES (
        p_template_id,
        btrim(p_data->>'name'),
        btrim(p_data->>'category'),
        COALESCE(p_data->>'source', 'BUILTIN'),
        COALESCE(p_data->>'file_type', 'HTML'),
        NULLIF(p_data->>'file_name', ''),
        p_data->>'template_schema',
        COALESCE(p_data->>'paper_size', 'A4'),
        COALESCE(p_data->>'orientation', 'PORTRAIT'),
        COALESCE((p_data->>'page_count')::integer, 1),
        COALESCE((p_data->>'version')::integer, 1),
        COALESCE((p_data->>'is_default')::boolean, false),
        NULLIF(p_data->>'description', ''),
        NULLIF(p_data->>'default_terms', ''),
        auth.uid()
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING * INTO v_template;

    v_inserted := FOUND;
    IF NOT v_inserted THEN
        SELECT * INTO v_template FROM public.document_templates WHERE id = p_template_id;
    END IF;
    IF v_inserted THEN
        PERFORM public._audit(
            'DOCUMENT_TEMPLATE_CREATE', 'DOCUMENT_TEMPLATE', NULL, NULL,
            jsonb_build_object('template_id', v_template.id, 'name', v_template.name, 'category', v_template.category),
            NULL, NULL
        );
    END IF;
    RETURN to_jsonb(v_template);
END;
$$;

CREATE OR REPLACE FUNCTION public.document_template_set_status(p_template_ids text[], p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason text := public._require_reason(p_reason);
    v_template public.document_templates%ROWTYPE;
    v_found_count integer;
    v_updated_count integer := 0;
BEGIN
    PERFORM public._require_menu('documents');
    IF p_template_ids IS NULL OR cardinality(p_template_ids) = 0
       OR array_position(p_template_ids, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'TEMPLATE_IDS_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(DISTINCT id) FROM unnest(p_template_ids) AS id) <> cardinality(p_template_ids) THEN
        RAISE EXCEPTION 'TEMPLATE_IDS_DUPLICATE' USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_found_count FROM public.document_templates WHERE id = ANY (p_template_ids);
    IF v_found_count <> cardinality(p_template_ids) THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    FOR v_template IN
        SELECT * FROM public.document_templates
        WHERE id = ANY (p_template_ids) AND status = 'ACTIVE'
        FOR UPDATE
    LOOP
        UPDATE public.document_templates
           SET status = 'INACTIVE', status_reason = v_reason, updated_at = now(), updated_by = auth.uid()
         WHERE id = v_template.id;
        PERFORM public._audit(
            'DOCUMENT_TEMPLATE_DEACTIVATE', 'DOCUMENT_TEMPLATE', NULL,
            jsonb_build_object('template_id', v_template.id, 'name', v_template.name, 'status', v_template.status),
            jsonb_build_object('template_id', v_template.id, 'status', 'INACTIVE'),
            v_reason, NULL
        );
        v_updated_count := v_updated_count + 1;
    END LOOP;
    RETURN jsonb_build_object('updated_count', v_updated_count);
END;
$$;

REVOKE ALL ON FUNCTION public.document_template_create(text, jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.document_template_set_status(text[], text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.document_template_create(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.document_template_set_status(text[], text) TO authenticated;