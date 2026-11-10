-- จัดการเอกสาร (2026-11-06): each form keeps the tab it was saved under
-- (แบบฟอร์มลูกค้า = CUSTOMER / แบบฟอร์มบิล = BILL), so a form always shows in that tab.
-- Forms saved before this get their tab from the old rule the app used (customer form names → CUSTOMER,
-- everything else, e.g. ใบเสนอราคา → BILL). No form content changes.

ALTER TABLE public.document_templates ADD COLUMN IF NOT EXISTS target_group text;

UPDATE public.document_templates
SET target_group = CASE
    WHEN category IN (
        'สัญญาเช่าสินค้า', 'แบบฟอร์มลูกค้า', 'หนังสือมอบอำนาจ',
        'แบบฟอร์มยืนยันลายเซ็น', 'เอกสารยินยอม/ข้อตกลง', 'แบบฟอร์มลูกค้าอื่น ๆ'
    ) THEN 'CUSTOMER'
    ELSE 'BILL'
END
WHERE target_group IS NULL;

ALTER TABLE public.document_templates ALTER COLUMN target_group SET NOT NULL;
ALTER TABLE public.document_templates DROP CONSTRAINT IF EXISTS document_templates_target_group_check;
ALTER TABLE public.document_templates
    ADD CONSTRAINT document_templates_target_group_check CHECK (target_group IN ('CUSTOMER', 'BILL'));

-- Same as before, plus target_group (required).
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
        'name', 'category', 'target_group', 'source', 'file_type', 'file_name', 'template_schema',
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
    IF p_data->>'target_group' IS NULL OR p_data->>'target_group' NOT IN ('CUSTOMER', 'BILL') THEN
        RAISE EXCEPTION 'TEMPLATE_TARGET_INVALID' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.document_templates (
        id, name, category, target_group, source, file_type, file_name, template_schema, paper_size,
        orientation, page_count, version, is_default, description, default_terms, created_by
    ) VALUES (
        p_template_id,
        btrim(p_data->>'name'),
        btrim(p_data->>'category'),
        p_data->>'target_group',
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
            jsonb_build_object('template_id', v_template.id, 'name', v_template.name,
                               'category', v_template.category, 'target_group', v_template.target_group),
            NULL, NULL
        );
    END IF;
    RETURN to_jsonb(v_template);
END;
$$;

REVOKE ALL ON FUNCTION public.document_template_create(text, jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.document_template_create(text, jsonb) TO authenticated;
