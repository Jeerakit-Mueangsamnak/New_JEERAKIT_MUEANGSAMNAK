-- LINE forms v1 (owner 2026-11-13): forms opened inside LINE (LIFF), each proven by a LINE ID
-- token that the server checks with LINE before calling these service_role-only functions.
--   1. Driver job form: the job, its bill items and steps; a step may carry a note and photos.
--   2. Income / expense form: the OWNER's own LINE only; saved straight into finance.
-- Photos live in the private bucket job-photos (<task id>/<uuid>.<ext>), uploaded by the server.

-- ── job photos bucket (skipped on a bare Postgres test database without Supabase Storage) ──
DO $storage$
BEGIN
    IF to_regclass('storage.buckets') IS NULL THEN
        RETURN;
    END IF;
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('job-photos', 'job-photos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO NOTHING;
    DROP POLICY IF EXISTS job_photos_read ON storage.objects;
    CREATE POLICY job_photos_read ON storage.objects FOR SELECT TO authenticated
        USING (bucket_id = 'job-photos' AND public.has_menu('appointments'));
END;
$storage$;

-- ── driver step with a note and photos ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.line_task_step(text, uuid, text);

CREATE OR REPLACE FUNCTION public.line_task_step(
    p_line_user_id text,
    p_task_id uuid,
    p_stage text,
    p_note text DEFAULT NULL,
    p_photos text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_t      public.line_tasks%ROWTYPE;
    v_a      public.appointments%ROWTYPE;
    v_driver text;
    v_stage  text := upper(btrim(COALESCE(p_stage, '')));
    v_next   text;
    v_note   text := NULLIF(btrim(COALESCE(p_note, '')), '');
    v_photos text[] := COALESCE(p_photos, ARRAY[]::text[]);
    v_photo  text;
    v_event  jsonb;
BEGIN
    PERFORM public._line_require_server();
    IF v_note IS NOT NULL AND length(v_note) > 500 THEN
        RETURN jsonb_build_object('result', 'INVALID_INPUT');
    END IF;
    IF cardinality(v_photos) > 3 THEN
        RETURN jsonb_build_object('result', 'INVALID_INPUT');
    END IF;
    FOREACH v_photo IN ARRAY v_photos LOOP
        IF v_photo IS NULL OR v_photo !~ ('^' || p_task_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') THEN
            RETURN jsonb_build_object('result', 'INVALID_INPUT');
        END IF;
    END LOOP;

    SELECT c.driver_code INTO v_driver FROM public.line_contacts c
     WHERE c.line_user_id = p_line_user_id AND c.status = 'LINKED';
    SELECT * INTO v_t FROM public.line_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    IF v_t.driver_code IS NULL OR v_driver IS DISTINCT FROM v_t.driver_code OR NOT public._line_driver_active(v_driver) THEN
        PERFORM public._audit_line(NULL, 'LINE_TASK_STEP', 'LINE_TASK', p_task_id,
                                   jsonb_build_object('reason', 'NOT_ASSIGNEE', 'stage', v_stage), 'FAILED');
        RETURN jsonb_build_object('result', 'NOT_ASSIGNEE');
    END IF;
    IF v_t.status = 'CANCELLED' THEN
        RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
    END IF;
    SELECT * INTO v_a FROM public.appointments WHERE id = v_t.appointment_id FOR UPDATE;
    IF NOT FOUND OR NOT public._line_driver_holds(v_a, v_driver) THEN
        PERFORM public._audit_line(NULL, 'LINE_TASK_STEP', 'LINE_TASK', p_task_id,
                                   jsonb_build_object('reason', 'NOT_HOLDER', 'stage', v_stage), 'FAILED');
        RETURN jsonb_build_object('result', 'INVALID_STATE', 'status', v_t.status);
    END IF;
    IF v_t.status = 'SENT' THEN
        RETURN jsonb_build_object('result', 'NOT_ACCEPTED');
    END IF;
    v_next := public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events');
    IF v_stage = ANY (public._work_order_run_done(v_a.work_order -> 'events')) THEN
        RETURN jsonb_build_object('result', 'ALREADY', 'stage', v_stage, 'next_stage', v_next);
    END IF;
    IF v_next IS NULL OR v_stage IS DISTINCT FROM v_next THEN
        RETURN jsonb_build_object('result', 'OUT_OF_ORDER', 'stage', v_stage, 'next_stage', v_next);
    END IF;

    v_event := jsonb_build_object(
        'id', gen_random_uuid(), 'stage', v_stage, 'status', 'DONE',
        'by', COALESCE(public._line_driver_name(v_driver), v_driver) || ' (LINE)',
        'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'note', COALESCE(v_note, 'อัปเดตทาง LINE'));
    IF cardinality(v_photos) > 0 THEN
        v_event := v_event || jsonb_build_object('photos', to_jsonb(v_photos));
    END IF;

    UPDATE public.appointments a
       SET work_order = jsonb_set(COALESCE(a.work_order, '{}'::jsonb), '{events}',
               (CASE WHEN jsonb_typeof(a.work_order -> 'events') = 'array' THEN a.work_order -> 'events' ELSE '[]'::jsonb END)
               || jsonb_build_array(v_event))
     WHERE a.id = v_a.id
    RETURNING * INTO v_a;
    v_next := public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events');
    IF v_next IS NULL THEN
        UPDATE public.line_tasks SET status = 'DONE', done_at = now(), updated_at = now() WHERE id = p_task_id;
    END IF;
    PERFORM public._audit_line(NULL, 'LINE_TASK_STEP', 'LINE_TASK', p_task_id,
                               jsonb_build_object('stage', v_stage, 'driver_code', v_driver, 'appointment_id', v_a.id,
                                                  'note', v_note, 'photos', cardinality(v_photos)));
    RETURN jsonb_build_object('result', 'STEP_DONE', 'stage', v_stage, 'next_stage', v_next);
END;
$function$;

-- ── driver job form: what the driver sees ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.line_driver_job(p_line_user_id text, p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_t      public.line_tasks%ROWTYPE;
    v_a      public.appointments%ROWTYPE;
    v_driver text;
    v_c      public.customers%ROWTYPE;
    v_items  jsonb;
BEGIN
    PERFORM public._line_require_server();
    SELECT c.driver_code INTO v_driver FROM public.line_contacts c
     WHERE c.line_user_id = p_line_user_id AND c.status = 'LINKED';
    SELECT * INTO v_t FROM public.line_tasks WHERE id = p_task_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    IF v_t.driver_code IS NULL OR v_driver IS DISTINCT FROM v_t.driver_code OR NOT public._line_driver_active(v_driver) THEN
        RETURN jsonb_build_object('result', 'NOT_ASSIGNEE');
    END IF;
    SELECT * INTO v_a FROM public.appointments WHERE id = v_t.appointment_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'NOT_FOUND');
    END IF;
    IF v_a.customer_id IS NOT NULL THEN
        SELECT * INTO v_c FROM public.customers WHERE id = v_a.customer_id;
    END IF;
    IF v_a.bill_id IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('name', l.product_name, 'qty', l.ordered_qty - COALESCE(l.cancelled_qty, 0),
                                                     'unit', l.unit_name) ORDER BY l.line_no), '[]'::jsonb)
          INTO v_items
          FROM public.bill_lines l
         WHERE l.bill_id = v_a.bill_id AND l.ordered_qty - COALESCE(l.cancelled_qty, 0) > 0;
    END IF;
    RETURN jsonb_build_object(
        'result', 'OK',
        'task', jsonb_build_object('id', v_t.id, 'title', v_t.title, 'detail', v_t.detail, 'status', v_t.status),
        'holds', public._line_driver_holds(v_a, v_driver),
        'appointment', jsonb_build_object(
            'type', v_a.appointment_type,
            'start', v_a.start_datetime,
            'place', COALESCE(NULLIF(v_a.location, ''), v_c.address),
            'contact', COALESCE(NULLIF(v_a.contact_name, ''), v_c.name),
            'phone', COALESCE(NULLIF(v_a.contact_phone, ''), v_c.phone),
            'description', v_a.description),
        'items', COALESCE(v_items, '[]'::jsonb),
        'events', CASE WHEN jsonb_typeof(v_a.work_order -> 'events') = 'array' THEN v_a.work_order -> 'events' ELSE '[]'::jsonb END,
        'next_stage', public._work_order_next_driver_stage(v_a.appointment_type, v_a.work_order -> 'events'));
END;
$function$;

-- ── OWNER's income / expense form ────────────────────────────────────────────────────────
/** The OWNER (active) whose LINE this is, or NULL. */
CREATE OR REPLACE FUNCTION public._line_owner_id(p_line_user_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
    SELECT p.id
      FROM public.line_contacts c
      JOIN public.profiles p ON p.id = c.profile_id
     WHERE c.line_user_id = p_line_user_id AND c.status = 'LINKED'
       AND p.role = 'OWNER' AND p.status = 'ACTIVE'
     LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.line_owner_finance_form(p_line_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_owner uuid;
    v_items jsonb;
BEGIN
    PERFORM public._line_require_server();
    v_owner := public._line_owner_id(p_line_user_id);
    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('result', 'NOT_OWNER');
    END IF;
    SELECT CASE WHEN jsonb_typeof(s.policies -> 'finance_income_items') = 'array' THEN s.policies -> 'finance_income_items' END
      INTO v_items FROM public.store_settings s WHERE s.singleton;
    RETURN jsonb_build_object(
        'result', 'OK',
        'name', (SELECT COALESCE(NULLIF(p.display_name, ''), p.username) FROM public.profiles p WHERE p.id = v_owner),
        'income_items', COALESCE(v_items, '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.line_finance_entry(
    p_line_user_id text,
    p_kind text,
    p_category text,
    p_amount numeric,
    p_channel text,
    p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_owner    uuid;
    v_name     text;
    v_kind     text := upper(btrim(COALESCE(p_kind, '')));
    v_category text := btrim(COALESCE(p_category, ''));
    v_channel  text := upper(btrim(COALESCE(p_channel, '')));
    v_note     text := NULLIF(btrim(COALESCE(p_note, '')), '');
    v_corr     uuid := gen_random_uuid();
    v_e        public.expense_entries%ROWTYPE;
    v_i        public.other_income_entries%ROWTYPE;
    v_row      jsonb;
BEGIN
    PERFORM public._line_require_server();
    v_owner := public._line_owner_id(p_line_user_id);
    IF v_owner IS NULL THEN
        PERFORM public._audit_line(NULL, 'LINE_FINANCE_ENTRY', 'FINANCE', NULL, jsonb_build_object('reason', 'NOT_OWNER'), 'FAILED');
        RETURN jsonb_build_object('result', 'NOT_OWNER');
    END IF;
    IF v_kind NOT IN ('INCOME', 'EXPENSE') OR p_amount IS NULL OR p_amount <= 0 OR p_amount > 99999999
       OR v_channel NOT IN ('CASH', 'TRANSFER', 'CARD', 'QR', 'OTHER')
       OR v_category = '' OR length(v_category) > 100 OR (v_note IS NOT NULL AND length(v_note) > 500)
       OR (v_kind = 'EXPENSE' AND v_category NOT IN ('PURCHASE', 'REPAIR', 'SHIPPING', 'LABOR', 'FUEL', 'EQUIPMENT', 'GENERAL')) THEN
        RETURN jsonb_build_object('result', 'INVALID_INPUT');
    END IF;
    SELECT COALESCE(NULLIF(p.display_name, ''), p.username) INTO v_name FROM public.profiles p WHERE p.id = v_owner;

    IF v_kind = 'EXPENSE' THEN
        INSERT INTO public.expense_entries (expense_no, category, amount, paid_method, note, created_by)
        VALUES (public._next_document_no('EXPENSE'), v_category, round(p_amount, 2), v_channel,
                v_note, v_owner)
        RETURNING * INTO v_e;
        INSERT INTO public.finance_ledger_entries (entry_type, revenue_class, amount, direction, source_type, source_id,
                                                   correlation_id, created_by)
        VALUES ('EXPENSE', NULL, v_e.amount, -1, 'EXPENSE', v_e.id, v_corr, v_owner);
        v_row := to_jsonb(v_e);
    ELSE
        INSERT INTO public.other_income_entries (income_no, category, amount, channel, note, created_by)
        VALUES (public._next_document_no('OTHER_INCOME'), v_category, round(p_amount, 2), v_channel, v_note, v_owner)
        RETURNING * INTO v_i;
        INSERT INTO public.finance_ledger_entries (entry_type, revenue_class, amount, direction, source_type, source_id,
                                                   correlation_id, created_by)
        VALUES ('REVENUE', 'OTHER', v_i.amount, 1, 'OTHER_INCOME', v_i.id, v_corr, v_owner);
        v_row := to_jsonb(v_i);
    END IF;
    -- same ledger lines as expense_create / other_income_create (_ledger), written for the OWNER (no auth.uid() here)

    INSERT INTO public.audit_logs (actor_id, actor_name, action, entity_type, entity_id, after_data, reason,
                                   pin_verified, amount, channel, result, correlation_id)
    VALUES (v_owner, v_name,
            CASE WHEN v_kind = 'EXPENSE' THEN 'EXPENSE_CREATE' ELSE 'OTHER_INCOME_CREATE' END,
            CASE WHEN v_kind = 'EXPENSE' THEN 'EXPENSE' ELSE 'OTHER_INCOME' END,
            (v_row ->> 'id')::uuid, v_row || jsonb_build_object('via', 'LINE'), v_note,
            false, (v_row ->> 'amount')::numeric, 'LINE', 'SUCCESS', v_corr);

    RETURN jsonb_build_object('result', 'OK', 'kind', v_kind,
                              'doc_no', COALESCE(v_row ->> 'expense_no', v_row ->> 'income_no'),
                              'amount', (v_row ->> 'amount')::numeric);
END;
$function$;

-- ── grants: server (service_role) only ───────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.line_task_step(text, uuid, text, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_task_step(text, uuid, text, text, text[]) TO service_role;
REVOKE ALL ON FUNCTION public.line_driver_job(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_driver_job(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public._line_owner_id(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.line_owner_finance_form(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_owner_finance_form(text) TO service_role;
REVOKE ALL ON FUNCTION public.line_finance_entry(text, text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_finance_entry(text, text, text, numeric, text, text) TO service_role;
