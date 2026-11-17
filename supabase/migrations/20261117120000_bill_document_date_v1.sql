-- ============================================================================
-- วันที่ออกเอกสาร of a bill (owner 2026-11-17): the POS asks for 3 dates — document date, rental start and return
-- date. Start / return were already kept on the bill lines; the document date was only used for the first print.
-- It is now kept on the bill as printed text: every print (also a reprint) shows it, and it can be corrected in
-- แก้ไขบิล. The bill number works as before, and the bill's own day (lists, search, reports) follows the bill
-- number; money is not touched.
--   * bills.document_date  — existing bills get the day they were confirmed (or created, for drafts);
--                            a new bill defaults to today.
--   * bill_set_document_date(bill, day) — sets it (POS after saving the bill, แก้ไขบิล); a future day is refused;
--                            cancelled / voided bills are left as they are. Audited.
-- ============================================================================

ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS document_date date;

-- Existing bills: the day they were confirmed (drafts: created). updated_at is left as it was.
ALTER TABLE public.bills DISABLE TRIGGER trg_bills_updated_at;
UPDATE public.bills
   SET document_date = public._local_date(COALESCE(confirmed_at, created_at))
 WHERE document_date IS NULL;
ALTER TABLE public.bills ENABLE TRIGGER trg_bills_updated_at;

ALTER TABLE public.bills ALTER COLUMN document_date SET DEFAULT public._local_date(now());
ALTER TABLE public.bills ALTER COLUMN document_date SET NOT NULL;

CREATE OR REPLACE FUNCTION public.bill_set_document_date(p_bill_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill public.bills%ROWTYPE;
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    IF p_date IS NULL OR p_date > public._local_date(now()) THEN
        RAISE EXCEPTION 'INVALID_DOCUMENT_DATE' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_bill.status IN ('CANCELLED', 'VOID') THEN
        RAISE EXCEPTION 'BILL_NOT_REVISABLE' USING ERRCODE = '23514';
    END IF;
    IF v_bill.document_date = p_date THEN
        RETURN jsonb_build_object('id', p_bill_id, 'document_date', p_date);
    END IF;

    UPDATE public.bills SET document_date = p_date WHERE id = p_bill_id;
    -- A draft is still being written at the POS: only a confirmed bill's change goes to the history.
    IF v_bill.status <> 'DRAFT' THEN
        PERFORM public._audit('BILL_DOCUMENT_DATE', 'BILL', p_bill_id,
                              jsonb_build_object('document_date', v_bill.document_date),
                              jsonb_build_object('document_date', p_date),
                              NULL, gen_random_uuid(), false, NULL);
    END IF;
    RETURN jsonb_build_object('id', p_bill_id, 'document_date', p_date);
END;
$$;
REVOKE ALL ON FUNCTION public.bill_set_document_date(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_set_document_date(uuid, date) TO authenticated;
