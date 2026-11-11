-- Owner 2026-11-11: a new customer needs only a name. Phone and address (ต. อ. จ.) may be left empty.
-- The columns stay NOT NULL text: an empty field is saved as '' (never NULL), so existing readers keep working.
-- Existing customers are not changed.

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_phone_check;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_address_check;

-- customer_create: same as before, except
--   * phone / address default to '' when not given;
--   * the possible-duplicate check compares phones only when both have digits (customers without a
--     phone are no longer all "duplicates" of each other); the same-name check is unchanged.
CREATE OR REPLACE FUNCTION public.customer_create(p_data jsonb, p_confirm_duplicate boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_new     public.customers%ROWTYPE;
    v_dups    jsonb;
    v_digits  text;
    v_allowed text[] := ARRAY['customer_code', 'name', 'phone', 'address', 'customer_type', 'tax_id', 'email',
                              'contact_person', 'billing_address', 'delivery_address', 'tags', 'credit_note',
                              'risk_note', 'document_reference', 'note', 'credit_enabled', 'credit_limit',
                              'payment_terms_days', 'contact_details'];
BEGIN
    PERFORM public._require_menu('customers', 'pos', 'bills');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;
    v_new := jsonb_populate_record(NULL::public.customers, p_data);
    v_new.phone   := btrim(COALESCE(v_new.phone, ''));
    v_new.address := btrim(COALESCE(v_new.address, ''));
    v_digits := regexp_replace(v_new.phone, '\D', '', 'g');

    -- Master §5: possible duplicate by phone digits or name → caller must confirm.
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone)) INTO v_dups
      FROM public.customers c
     WHERE c.active
       AND ((v_digits <> '' AND regexp_replace(c.phone, '\D', '', 'g') = v_digits)
            OR lower(btrim(c.name)) = lower(btrim(COALESCE(v_new.name, ''))));
    IF v_dups IS NOT NULL AND NOT COALESCE(p_confirm_duplicate, false) THEN
        RAISE EXCEPTION 'DUPLICATE_CUSTOMER' USING ERRCODE = '23505', DETAIL = v_dups::text;
    END IF;

    INSERT INTO public.customers (customer_code, name, phone, address, customer_type, tax_id, email, contact_person,
        billing_address, delivery_address, tags, credit_note, risk_note, document_reference, note,
        credit_enabled, credit_limit, payment_terms_days, contact_details, created_by)
    VALUES (v_new.customer_code, v_new.name, v_new.phone, v_new.address, v_new.customer_type, v_new.tax_id,
        v_new.email, v_new.contact_person, v_new.billing_address, v_new.delivery_address,
        COALESCE(v_new.tags, '{}'), v_new.credit_note, v_new.risk_note, v_new.document_reference, v_new.note,
        COALESCE(v_new.credit_enabled, false), COALESCE(v_new.credit_limit, 0), COALESCE(v_new.payment_terms_days, 0),
        COALESCE(v_new.contact_details, '{}'::jsonb), auth.uid())
    RETURNING * INTO v_new;

    PERFORM public._audit('CUSTOMER_CREATE', 'CUSTOMER', v_new.id, NULL, to_jsonb(v_new), NULL, NULL);
    RETURN to_jsonb(v_new);
END;
$function$;

-- Grants stay as they were (CREATE OR REPLACE keeps them); re-stated for a fresh database.
REVOKE ALL ON FUNCTION public.customer_create(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_create(jsonb, boolean) TO authenticated;
