-- ============================================================================
-- ออกบิลในครั้งเดียว (owner 2026-11-24): the shop does not use draft bills.
-- The payment page used to call bill_save_draft, then bill_confirm: when the confirm step was refused (money short,
-- stock, network) the bill stayed behind as a DRAFT. bill_issue does both in one transaction, so a refusal leaves
-- nothing behind.
--   1. bill_save_draft (new bill, same price / PIN / discount checks)
--   2. bill_set_document_date (วันที่ออกเอกสาร picked at the POS)
--   3. the money taken is cut to the server's total (bill + deposit), in the order the tenders were taken:
--        p_pay_exact   — one method paying the exact amount (QR, or an empty cash box): it pays the server's total
--        p_allow_short — ค้างชำระ: what was taken is kept, the rest stays owed
--        otherwise the money taken must cover the server's total, or nothing is saved
--   4. bill_confirm (bill number, stock, payment)
-- bill_save_draft / bill_confirm / bill_draft_delete are left as they are.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bill_issue(
    p_data            jsonb,
    p_idempotency_key text,
    p_tenders         jsonb DEFAULT NULL,
    p_pay_exact       boolean DEFAULT false,
    p_allow_short     boolean DEFAULT false,
    p_document_date   date DEFAULT NULL,
    p_pin_token       uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem    record;
    v_saved   jsonb;
    v_bill    public.bills%ROWTYPE;
    v_total   numeric;
    v_given   numeric := 0;
    v_left    numeric;
    v_take    numeric;
    v_tender  jsonb;
    v_send    jsonb := '[]'::jsonb;
    v_result  jsonb;
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    IF p_tenders IS NOT NULL AND jsonb_typeof(p_tenders) <> 'array' THEN
        RAISE EXCEPTION 'TENDERS_REQUIRED' USING ERRCODE = '22023';
    END IF;
    -- A repeated click returns the bill it already made (the PIN reason / token are not part of the request).
    SELECT * INTO v_idem FROM public._idempotency_begin('bill_issue', p_idempotency_key,
        md5(jsonb_build_object('d', COALESCE(p_data, '{}'::jsonb) - 'override_reason', 't', p_tenders,
                               'e', p_pay_exact, 's', p_allow_short, 'dd', p_document_date)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;

    v_saved := public.bill_save_draft(NULL, p_data, p_pin_token);
    IF p_document_date IS NOT NULL THEN
        PERFORM public.bill_set_document_date((v_saved ->> 'id')::uuid, p_document_date);
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = (v_saved ->> 'id')::uuid;

    v_total := round(COALESCE(v_bill.grand_total, 0) + COALESCE(v_bill.deposit_amount, 0), 2);
    SELECT COALESCE(sum((t ->> 'amount')::numeric), 0) INTO v_given
      FROM jsonb_array_elements(COALESCE(p_tenders, '[]'::jsonb)) t;

    IF v_total > 0 AND jsonb_array_length(COALESCE(p_tenders, '[]'::jsonb)) > 0 THEN
        IF p_pay_exact THEN
            v_send := jsonb_build_array((p_tenders -> 0) || jsonb_build_object('amount', v_total));
        ELSE
            IF NOT p_allow_short AND v_given + 0.005 < v_total THEN
                RAISE EXCEPTION 'ยอดสุทธิจากระบบ (รวมมัดจำ) % บาท มากกว่าเงินที่รับมา ยังไม่ได้บันทึกบิล',
                    to_char(v_total, 'FM999,999,999,990.00') USING ERRCODE = '23514';
            END IF;
            -- Change is not money taken: each tender gives only what is still left of the total.
            v_left := v_total;
            FOR v_tender IN SELECT t FROM jsonb_array_elements(p_tenders) WITH ORDINALITY AS x(t, n) ORDER BY n LOOP
                v_take := round(least(v_left, COALESCE((v_tender ->> 'amount')::numeric, 0)), 2);
                IF v_take > 0 THEN
                    v_send := v_send || jsonb_build_array(v_tender || jsonb_build_object('amount', v_take));
                    v_left := round(v_left - v_take, 2);
                END IF;
            END LOOP;
        END IF;
    END IF;

    v_result := public.bill_confirm(v_bill.id, p_idempotency_key,
                                    CASE WHEN jsonb_array_length(v_send) > 0 THEN v_send END);
    RETURN public._idempotency_finish(v_idem.key_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.bill_issue(jsonb, text, jsonb, boolean, boolean, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_issue(jsonb, text, jsonb, boolean, boolean, date, uuid) TO authenticated;
