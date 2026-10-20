CREATE FUNCTION public._payment_receive_core(
    p_bill_id          uuid,
    p_tenders          jsonb,
    p_key_id           uuid,
    p_correlation_id   uuid,
    p_received_on      date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill        public.bills%ROWTYPE;
    v_receipt     public.payment_receipts%ROWTYPE;
    v_tender      record;
    v_total       numeric(14,2) := 0;
    v_payments    jsonb := '[]'::jsonb;
    v_pid         uuid;
    v_received_at timestamptz := CASE
        WHEN p_received_on IS NULL OR p_received_on = public._local_date(now()) THEN now()
        ELSE (p_received_on + time '12:00') AT TIME ZONE COALESCE(
            (SELECT s.timezone FROM public.store_settings s WHERE s.singleton), 'Asia/Bangkok')
    END;
BEGIN
    IF p_received_on > public._local_date(now()) THEN
        RAISE EXCEPTION 'PAYMENT_DATE_IN_FUTURE' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    IF v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_PAYABLE: %', v_bill.status USING ERRCODE = '23514';
    END IF;
    IF COALESCE(CASE WHEN jsonb_typeof(p_tenders) = 'array' THEN jsonb_array_length(p_tenders) END, 0) = 0 THEN
        RAISE EXCEPTION 'TENDERS_REQUIRED' USING ERRCODE = '22023';
    END IF;

    FOR v_tender IN SELECT * FROM jsonb_to_recordset(p_tenders) AS x(method text, amount numeric, reference text) LOOP
        IF v_tender.amount IS NULL OR v_tender.amount <= 0 OR round(v_tender.amount, 2) <> v_tender.amount THEN
            RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
        END IF;
        IF v_tender.method NOT IN ('CASH', 'TRANSFER', 'CARD', 'QR', 'OTHER') THEN
            RAISE EXCEPTION 'INVALID_METHOD: %', v_tender.method USING ERRCODE = '22023';
        END IF;
        v_total := v_total + v_tender.amount;
    END LOOP;

    IF v_total > v_bill.balance_due
       AND NOT (public._policy('allow_overpayment', 'false'::jsonb))::text::boolean THEN
        RAISE EXCEPTION 'OVERPAYMENT: balance due %, received %', v_bill.balance_due, v_total USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.payment_receipts (receipt_no, bill_id, total_amount, received_at, received_by,
                                         idempotency_key_id, correlation_id, created_by)
    VALUES (public._next_document_no('RECEIPT'), p_bill_id, v_total, v_received_at, auth.uid(),
            p_key_id, p_correlation_id, auth.uid())
    RETURNING * INTO v_receipt;

    FOR v_tender IN SELECT * FROM jsonb_to_recordset(p_tenders) AS x(method text, amount numeric, reference text) LOOP
        INSERT INTO public.payments (receipt_id, bill_id, method, amount, reference, status, received_at, created_by)
        VALUES (v_receipt.id, p_bill_id, v_tender.method, v_tender.amount, v_tender.reference, 'COMPLETED',
                v_receipt.received_at, auth.uid())
        RETURNING id INTO v_pid;
        v_payments := v_payments || jsonb_build_object('payment_id', v_pid, 'method', v_tender.method,
                                                       'amount', v_tender.amount);
    END LOOP;

    PERFORM public._audit('PAYMENT_RECEIVE', 'BILL', p_bill_id, NULL,
                          jsonb_build_object('receipt_no', v_receipt.receipt_no, 'total', v_total, 'payments', v_payments),
                          NULL, p_correlation_id, false, v_total, NULL,
                          (SELECT string_agg(DISTINCT x.method, ',') FROM jsonb_to_recordset(p_tenders) AS x(method text)));
    RETURN jsonb_build_object('receipt_id', v_receipt.id, 'receipt_no', v_receipt.receipt_no, 'total_amount', v_total,
                              'payments', v_payments);
END;
$$;

REVOKE ALL ON FUNCTION public._payment_receive_core(uuid, jsonb, uuid, uuid, date)
    FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.payment_receive(uuid, jsonb, text);

CREATE FUNCTION public.payment_receive(
    p_bill_id          uuid,
    p_tenders          jsonb,
    p_idempotency_key  text,
    p_received_on      date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem    record;
    v_receipt jsonb;
    v_corr    uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('payment_receive', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 't', p_tenders, 'on', p_received_on)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    PERFORM 1 FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._bill_recalculate(p_bill_id);
    v_receipt := public._payment_receive_core(p_bill_id, p_tenders, v_idem.key_id, v_corr, p_received_on);
    PERFORM public._bill_settle(p_bill_id);
    RETURN public._idempotency_finish(v_idem.key_id, v_receipt || jsonb_build_object('bill',
        (SELECT to_jsonb(b) FROM public.bills b WHERE b.id = p_bill_id)));
END;
$$;

REVOKE ALL ON FUNCTION public.payment_receive(uuid, jsonb, text, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.payment_receive(uuid, jsonb, text, date) TO authenticated;