-- Owner 2026-11-11: money taken for a bill is cut in this order, and the bill history says what each
-- amount paid.
--   บิลเช่าอย่างเดียว : ค่าขนส่ง → เงินมัดจำ → ค่าเช่า → what is not paid stays owed (ยอดค้างชำระ)
--   บิลผสม (ขาย+เช่า) : ค่าสินค้าขาย → ค่าขนส่ง → เงินมัดจำ → ค่าเช่า → what is not paid stays owed
-- (ค่าขนส่ง = delivery + installation + service fees. Discount and VAT are shared over ค่าสินค้าขาย /
--  ค่าเช่า / ค่าขนส่ง in proportion; fines / adjustments added later come after ค่าเช่า.)
--
--  1. bills.deposit_unpaid: the part of deposit_amount not received yet. A bill confirmed from now on
--     starts with its whole deposit unpaid; bills already confirmed keep 0 = the deposit was received
--     (as before). The unpaid deposit is part of balance_due, so it shows as ยอดค้างชำระ.
--  2. _payment_take: every payment at the counter (bill_confirm) or later (payment_receive) is split in
--     the order above. The bill part is recorded as before (_payment_receive_core: receipt + payments);
--     the deposit part lowers deposit_unpaid. Each payment writes one bill_payment_allocations row.
--  3. Only the deposit actually received can pay charges (bill_deposit_apply) or be given back
--     (bill_deposit_refund); a correction of deposit_amount keeps deposit_unpaid within it.
--  4. payment_void: when every payment of a receipt is voided, its deposit part is owed again.
-- No existing row changes value: the new column defaults to 0 and the new table starts empty.

ALTER TABLE public.bills
    ADD COLUMN deposit_unpaid numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.bills
    ADD CONSTRAINT bills_deposit_unpaid_check CHECK (deposit_unpaid >= 0 AND deposit_unpaid <= deposit_amount);

CREATE TABLE public.bill_payment_allocations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id           uuid NOT NULL REFERENCES public.bills (id),
    receipt_id        uuid REFERENCES public.payment_receipts (id),
    total_amount      numeric(14,2) NOT NULL CHECK (total_amount > 0),
    sale_amount       numeric(14,2) NOT NULL DEFAULT 0 CHECK (sale_amount >= 0),
    shipping_amount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
    deposit_amount    numeric(14,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
    rental_amount     numeric(14,2) NOT NULL DEFAULT 0 CHECK (rental_amount >= 0),
    other_amount      numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_amount >= 0),
    outstanding_after numeric(14,2) NOT NULL DEFAULT 0,
    tenders           jsonb NOT NULL,
    deposit_tenders   jsonb NOT NULL DEFAULT '[]'::jsonb,
    received_on       date NOT NULL,
    voided_at         timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid DEFAULT auth.uid(),
    CONSTRAINT bill_payment_allocations_sum_check CHECK (
        sale_amount + shipping_amount + deposit_amount + rental_amount + other_amount = total_amount)
);
CREATE INDEX bill_payment_allocations_bill_idx ON public.bill_payment_allocations (bill_id, created_at);
CREATE INDEX bill_payment_allocations_receipt_idx ON public.bill_payment_allocations (receipt_id);

ALTER TABLE public.bill_payment_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bill_payment_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bill_payment_allocations TO authenticated;
-- Read like payments; written only by the SECURITY DEFINER functions below.
CREATE POLICY bill_payment_allocations_select ON public.bill_payment_allocations
    FOR SELECT TO authenticated
    USING ((SELECT public.has_menu('bills')) OR (SELECT public.has_menu('pos')) OR (SELECT public.has_menu('finance')));

-- ─── balance: the unpaid deposit is owed too ───────────────────────────────────
-- Unchanged from 20261008001158 except: + deposit_unpaid in the balance, and deposit money received
-- (no payments row) counts as "money received" for the payment status / CONFIRMED → ACTIVE.
CREATE OR REPLACE FUNCTION public._bill_recalculate(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill       public.bills%ROWTYPE;
    v_line_id    uuid;
    v_paid       numeric(14,2);
    v_refunded   numeric(14,2);
    v_adj        numeric(14,2);
    v_charges    numeric(14,2);
    v_write_off  numeric(14,2);
    v_dep_paid   numeric(14,2);
    v_due        numeric(14,2);
    v_balance    numeric(14,2);
    v_status     text;
BEGIN
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    FOR v_line_id IN SELECT id FROM public.bill_lines WHERE bill_id = p_bill_id ORDER BY line_no LOOP
        PERFORM public._line_recalculate(v_line_id);
    END LOOP;

    SELECT COALESCE(sum(amount), 0) INTO v_paid
      FROM public.payments WHERE bill_id = p_bill_id AND status IN ('COMPLETED', 'REFUNDED');
    SELECT COALESCE(sum(amount), 0) INTO v_refunded
      FROM public.refunds WHERE bill_id = p_bill_id AND status = 'PAID';
    SELECT COALESCE(sum(CASE adjustment_type WHEN 'DEBIT' THEN amount ELSE -amount END), 0) INTO v_adj
      FROM public.bill_adjustments WHERE bill_id = p_bill_id;
    SELECT COALESCE(sum(amount), 0) INTO v_charges
      FROM public.charges WHERE bill_id = p_bill_id AND status = 'CONFIRMED';
    SELECT COALESCE(sum(amount), 0) INTO v_write_off FROM public.write_offs WHERE bill_id = p_bill_id;
    SELECT COALESCE(sum(deposit_amount), 0) INTO v_dep_paid
      FROM public.bill_payment_allocations WHERE bill_id = p_bill_id AND voided_at IS NULL;

    IF v_bill.status IN ('CANCELLED', 'VOID') THEN
        -- No receivable any more (revenue, charges and adjustments were reversed or never posted).
        -- Money still held is owed back: balance_due < 0 drives the refund suggestion (Master §20).
        v_due := 0;
        v_balance := -(v_paid - v_refunded);
    ELSE
        v_due := v_bill.grand_total + v_charges + v_adj;
        v_balance := v_due - (v_paid - v_refunded) - v_write_off + v_bill.deposit_unpaid;
    END IF;
    v_status := CASE
        WHEN v_bill.status IN ('CANCELLED', 'VOID') AND v_paid = 0 THEN 'UNPAID'   -- as before: never shown PAID
        WHEN v_refunded > 0 AND v_paid - v_refunded <= 0 THEN 'REFUNDED'
        WHEN v_refunded > 0 THEN 'PARTIALLY_REFUNDED'
        WHEN v_balance <= 0 AND (v_paid > 0 OR v_dep_paid > 0 OR v_due <= 0) THEN 'PAID'
        WHEN v_paid = 0 AND v_dep_paid = 0 THEN 'UNPAID'
        ELSE 'PARTIALLY_PAID' END;

    UPDATE public.bills
       SET paid_amount = v_paid,
           refunded_amount = v_refunded,
           adjustment_net = v_adj,
           charge_total = v_charges,
           write_off_total = v_write_off,
           balance_due = v_balance,
           payment_status = v_status,
           status = CASE
               WHEN status = 'CONFIRMED' AND (v_paid > 0 OR v_dep_paid > 0 OR EXISTS (
                        SELECT 1 FROM public.bill_lines l
                         WHERE l.bill_id = p_bill_id AND (l.delivered_qty > 0 OR l.carried_in_qty > 0)))
               THEN 'ACTIVE' ELSE status END
     WHERE id = p_bill_id;
END;
$$;

-- ─── one payment, cut in the owner's order ─────────────────────────────────────
-- The caller has locked the bill and run _bill_recalculate (bill_confirm, payment_receive).
CREATE OR REPLACE FUNCTION public._payment_take(
    p_bill_id         uuid,
    p_tenders         jsonb,
    p_key_id          uuid,
    p_correlation_id  uuid,
    p_received_on     date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill          public.bills%ROWTYPE;
    v_tender        record;
    v_total         numeric(14,2) := 0;
    v_sub           numeric(14,2);
    v_fees          numeric(14,2);
    v_net           numeric(14,2);
    v_sale_part     numeric(14,2) := 0;
    v_fee_part      numeric(14,2) := 0;
    v_covered       numeric(14,2);
    v_left          numeric(14,2);
    x_sale          numeric(14,2);
    x_fee           numeric(14,2);
    x_dep           numeric(14,2);
    x_rent          numeric(14,2);
    x_other         numeric(14,2);
    v_buckets       numeric(14,2)[];
    v_bucket        int := 1;
    v_amount        numeric(14,2);
    v_take          numeric(14,2);
    v_parts         jsonb := '[]'::jsonb;   -- {bucket, method, amount, reference, ord}
    v_ord           int := 0;
    v_bill_tenders  jsonb;
    v_dep_tenders   jsonb;
    v_receipt       jsonb;
    v_allocation    jsonb;
BEGIN
    -- Same checks, in the same order, as _payment_receive_core
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

    -- Shares of grand_total: ค่าขนส่ง by the fees, the rest split between sale and rental lines.
    v_sub := v_bill.sale_subtotal + v_bill.rental_subtotal;
    v_fees := v_bill.delivery_fee + v_bill.installation_fee + v_bill.service_fee;
    v_net := v_sub - v_bill.bill_discount_amount + v_fees;
    IF v_net > 0 THEN
        v_fee_part := round(v_bill.grand_total * v_fees / v_net, 2);
        IF v_sub > 0 THEN
            v_sale_part := round((v_bill.grand_total - v_fee_part) * v_bill.sale_subtotal / v_sub, 2);
        END IF;
    END IF;

    -- What earlier payments already covered of the bill (they were cut in the same order).
    v_covered := greatest(0, v_bill.paid_amount - v_bill.refunded_amount + v_bill.write_off_total);
    v_left := v_total;
    x_sale := least(v_left, greatest(0, v_sale_part - v_covered));
    v_left := v_left - x_sale;
    x_fee := least(v_left, greatest(0, v_sale_part + v_fee_part - greatest(v_covered, v_sale_part)));
    v_left := v_left - x_fee;
    x_dep := least(v_left, v_bill.deposit_unpaid);
    v_left := v_left - x_dep;
    x_rent := least(v_left, greatest(0, v_bill.grand_total - greatest(v_covered, v_sale_part + v_fee_part)));
    v_left := v_left - x_rent;
    x_other := v_left;   -- fines / adjustments (or more than owed, when the shop allows it)

    -- The methods, in the order taken, fill: bill (sale + shipping) → deposit → bill (rental + other).
    v_buckets := ARRAY[x_sale + x_fee, x_dep, x_rent + x_other];
    FOR v_tender IN SELECT * FROM jsonb_to_recordset(p_tenders) AS x(method text, amount numeric, reference text) LOOP
        v_amount := v_tender.amount;
        WHILE v_amount > 0 AND v_bucket <= 3 LOOP
            v_take := least(v_amount, v_buckets[v_bucket]);
            IF v_take > 0 THEN
                v_ord := v_ord + 1;
                v_parts := v_parts || jsonb_build_object('bucket', v_bucket, 'method', v_tender.method,
                    'amount', v_take, 'reference', v_tender.reference, 'ord', v_ord);
                v_buckets[v_bucket] := v_buckets[v_bucket] - v_take;
                v_amount := v_amount - v_take;
            END IF;
            IF v_buckets[v_bucket] <= 0 THEN
                v_bucket := v_bucket + 1;
            END IF;
        END LOOP;
    END LOOP;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('method', s.method, 'amount', s.amount, 'reference', s.reference)
                              ORDER BY s.ord), '[]'::jsonb)
      INTO v_bill_tenders
      FROM (SELECT p ->> 'method' AS method, p ->> 'reference' AS reference,
                   sum((p ->> 'amount')::numeric) AS amount, min((p ->> 'ord')::int) AS ord
              FROM jsonb_array_elements(v_parts) AS p
             WHERE (p ->> 'bucket')::int <> 2
             GROUP BY 1, 2) s;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('method', s.method, 'amount', s.amount) ORDER BY s.ord), '[]'::jsonb)
      INTO v_dep_tenders
      FROM (SELECT p ->> 'method' AS method, sum((p ->> 'amount')::numeric) AS amount,
                   min((p ->> 'ord')::int) AS ord
              FROM jsonb_array_elements(v_parts) AS p
             WHERE (p ->> 'bucket')::int = 2
             GROUP BY 1) s;

    IF jsonb_array_length(v_bill_tenders) > 0 THEN
        v_receipt := public._payment_receive_core(p_bill_id, v_bill_tenders, p_key_id, p_correlation_id, p_received_on);
    END IF;
    IF x_dep > 0 THEN
        UPDATE public.bills SET deposit_unpaid = deposit_unpaid - x_dep WHERE id = p_bill_id;
    END IF;

    v_allocation := jsonb_build_object('sale', x_sale, 'shipping', x_fee, 'deposit', x_dep, 'rental', x_rent,
                                       'other', x_other, 'outstanding_after', greatest(0, v_bill.balance_due - v_total));
    INSERT INTO public.bill_payment_allocations (bill_id, receipt_id, total_amount, sale_amount, shipping_amount,
        deposit_amount, rental_amount, other_amount, outstanding_after, tenders, deposit_tenders, received_on)
    VALUES (p_bill_id, (v_receipt ->> 'receipt_id')::uuid, v_total, x_sale, x_fee, x_dep, x_rent, x_other,
            greatest(0, v_bill.balance_due - v_total), p_tenders, v_dep_tenders,
            COALESCE(p_received_on, public._local_date(now())));
    PERFORM public._audit('PAYMENT_ALLOCATE', 'BILL', p_bill_id, NULL,
                          v_allocation || jsonb_build_object('receipt_no', v_receipt ->> 'receipt_no',
                                                             'deposit_tenders', v_dep_tenders),
                          NULL, p_correlation_id, false, v_total, NULL,
                          (SELECT string_agg(DISTINCT x.method, ',') FROM jsonb_to_recordset(p_tenders) AS x(method text)));

    RETURN COALESCE(v_receipt, jsonb_build_object('receipt_id', NULL, 'receipt_no', NULL, 'payments', '[]'::jsonb))
        || jsonb_build_object('total_amount', v_total, 'allocation', v_allocation);
END;
$$;

REVOKE ALL ON FUNCTION public._payment_take(uuid, jsonb, uuid, uuid, date)
    FROM PUBLIC, anon, authenticated, service_role;

-- ─── payment_receive: same as 20261016125110, the money goes through _payment_take ──
CREATE OR REPLACE FUNCTION public.payment_receive(
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
    v_receipt := public._payment_take(p_bill_id, p_tenders, v_idem.key_id, v_corr, p_received_on);
    PERFORM public._bill_settle(p_bill_id);
    RETURN public._idempotency_finish(v_idem.key_id, v_receipt || jsonb_build_object('bill',
        (SELECT to_jsonb(b) FROM public.bills b WHERE b.id = p_bill_id)));
END;
$$;

-- ─── bill_confirm: as on Cloud, plus the deposit starts unpaid and the money goes through _payment_take ──
CREATE OR REPLACE FUNCTION public.bill_confirm(p_bill_id uuid, p_idempotency_key text, p_tenders jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem        record;
    v_bill        public.bills%ROWTYPE;
    v_line        public.bill_lines%ROWTYPE;
    v_product     public.products%ROWTYPE;
    v_customer    public.customers%ROWTYPE;
    v_has_rental  boolean;
    v_avail       numeric;
    v_alloc       numeric;
    v_backorder   boolean := (public._policy('allow_backorder', 'false'::jsonb))::text::boolean;
    v_outstanding numeric;
    v_res         record;
    v_receipt     jsonb;
    v_corr        uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('bill_confirm', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 't', p_tenders)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'BILL_NOT_DRAFT' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id) THEN
        RAISE EXCEPTION 'BILL_EMPTY' USING ERRCODE = '23514';
    END IF;
    v_has_rental := EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND line_mode = 'RENTAL');
    IF v_bill.customer_id IS NOT NULL THEN
        SELECT * INTO v_customer FROM public.customers WHERE id = v_bill.customer_id FOR SHARE;
        IF NOT v_customer.active THEN
            RAISE EXCEPTION 'CUSTOMER_INACTIVE' USING ERRCODE = '23514';
        END IF;
    ELSIF v_has_rental OR v_bill.is_credit_bill THEN
        RAISE EXCEPTION 'CUSTOMER_REQUIRED' USING ERRCODE = '23514';
    END IF;
    FOR v_line IN SELECT * FROM public.bill_lines WHERE bill_id = p_bill_id ORDER BY line_no LOOP
        SELECT * INTO v_product FROM public.products WHERE id = v_line.product_id FOR SHARE;
        IF NOT v_product.active THEN
            RAISE EXCEPTION 'PRODUCT_INACTIVE: %', v_product.sku USING ERRCODE = '23514';
        END IF;
        IF (v_line.line_mode = 'SALE' AND NOT v_product.can_sell) OR (v_line.line_mode = 'RENTAL' AND NOT v_product.can_rent) THEN
            RAISE EXCEPTION 'PRODUCT_CAPABILITY: % cannot %', v_product.sku, v_line.line_mode USING ERRCODE = '23514';
        END IF;
    END LOOP;
    PERFORM public._bill_compute_totals(p_bill_id);
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    IF v_bill.is_credit_bill THEN
        IF NOT v_customer.credit_enabled OR v_customer.account_status <> 'NORMAL' THEN
            RAISE EXCEPTION 'CREDIT_NOT_ALLOWED' USING ERRCODE = '23514';
        END IF;
        SELECT COALESCE(sum(balance_due), 0) INTO v_outstanding
          FROM public.bills WHERE customer_id = v_bill.customer_id AND status IN ('CONFIRMED', 'ACTIVE');
        IF v_outstanding + v_bill.grand_total > v_customer.credit_limit THEN
            RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED' USING ERRCODE = '23514';
        END IF;
    END IF;
    UPDATE public.bills
       SET status = 'CONFIRMED', bill_no = public._next_document_no('BILL'), confirmed_at = now(),
           confirmed_by = auth.uid(),
           -- The deposit is owed until money for it is taken (owner 2026-11-11)
           deposit_unpaid = deposit_amount,
           due_date = COALESCE(due_date, CASE WHEN is_credit_bill
                                              THEN public._local_date(now()) + v_customer.payment_terms_days END)
     WHERE id = p_bill_id;
    IF v_bill.quotation_id IS NOT NULL THEN
        PERFORM 1 FROM public.quotations WHERE id = v_bill.quotation_id AND status IN ('SENT', 'ACCEPTED') FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'QUOTATION_NOT_CONVERTIBLE' USING ERRCODE = '23514';
        END IF;
        FOR v_res IN SELECT * FROM public.reservations WHERE quotation_id = v_bill.quotation_id AND status = 'ACTIVE'
                      ORDER BY product_id FOR UPDATE LOOP
            PERFORM public._stock_move(v_res.product_id, 'RESERVED', 'AVAILABLE', v_res.quantity, 'RELEASE',
                                       'RESERVATION', v_res.id, NULL, 'converted to bill', v_corr);
            UPDATE public.reservations
               SET status = 'CONVERTED', converted_bill_id = p_bill_id, released_at = now(), released_by = auth.uid(),
                   release_reason = 'converted to bill'
             WHERE id = v_res.id;
        END LOOP;
        UPDATE public.quotations SET status = 'CONVERTED', converted_bill_id = p_bill_id, updated_by = auth.uid()
         WHERE id = v_bill.quotation_id;
    END IF;
    FOR v_line IN SELECT * FROM public.bill_lines WHERE bill_id = p_bill_id ORDER BY product_id, line_no LOOP
        SELECT quantity INTO v_avail FROM public.stock_balances
         WHERE product_id = v_line.product_id AND stock_state = 'AVAILABLE' FOR UPDATE;
        v_alloc := least(COALESCE(v_avail, 0), v_line.ordered_qty);
        IF v_alloc < v_line.ordered_qty AND NOT v_backorder THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: line %, available %, ordered %', v_line.line_no, COALESCE(v_avail, 0),
                v_line.ordered_qty USING ERRCODE = '23514';
        END IF;
        IF v_alloc > 0 THEN
            PERFORM public._stock_move(v_line.product_id, 'AVAILABLE', 'RESERVED', v_alloc, 'RESERVE', 'BILL_LINE',
                                       v_line.id, NULL, NULL, v_corr);
        END IF;
        UPDATE public.bill_lines SET allocated_qty = v_alloc, backorder_qty = v_line.ordered_qty - v_alloc
         WHERE id = v_line.id;
    END LOOP;
    PERFORM public._bill_post_revenue(p_bill_id, v_corr);
    PERFORM public._bill_recalculate(p_bill_id);
    IF COALESCE(CASE WHEN jsonb_typeof(p_tenders) = 'array' THEN jsonb_array_length(p_tenders) END, 0) > 0 THEN
        v_receipt := public._payment_take(p_bill_id, p_tenders, v_idem.key_id, v_corr, NULL);
    END IF;
    PERFORM public._bill_settle(p_bill_id);
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    PERFORM public._audit('BILL_CONFIRM', 'BILL', p_bill_id, NULL, to_jsonb(v_bill), NULL, v_corr);
    RETURN public._idempotency_finish(v_idem.key_id,
        jsonb_build_object('bill', to_jsonb(v_bill), 'receipt', v_receipt));
END;
$$;

-- ─── only the deposit actually received can pay charges / be given back ────────
-- Same as 20261105223245 except the two checks (deposit received, what the bill itself owes).
CREATE OR REPLACE FUNCTION public.bill_deposit_apply(
    p_bill_id          uuid,
    p_amount           numeric,
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
    v_bill    public.bills%ROWTYPE;
    v_receipt jsonb;
    v_corr    uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('bill_deposit_apply', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 'a', p_amount, 'on', p_received_on)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    PERFORM 1 FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._bill_recalculate(p_bill_id);
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 2) <> p_amount THEN
        RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
    END IF;
    IF p_amount > v_bill.deposit_amount - v_bill.deposit_unpaid THEN
        RAISE EXCEPTION 'DEPOSIT_EXCEEDED: deposit received %', v_bill.deposit_amount - v_bill.deposit_unpaid
            USING ERRCODE = '23514';
    END IF;
    IF p_amount > v_bill.balance_due - v_bill.deposit_unpaid THEN
        RAISE EXCEPTION 'OVERPAYMENT: balance due %, received %', v_bill.balance_due - v_bill.deposit_unpaid, p_amount
            USING ERRCODE = '23514';
    END IF;

    v_receipt := public._payment_receive_core(p_bill_id,
        jsonb_build_array(jsonb_build_object('method', 'OTHER', 'amount', p_amount, 'reference', 'หักจากมัดจำ')),
        v_idem.key_id, v_corr, p_received_on);
    UPDATE public.bills
       SET deposit_amount = deposit_amount - p_amount,
           deposit_note = concat_ws(' | ', NULLIF(btrim(COALESCE(deposit_note, '')), ''),
                                    'หักค่าบริการจากมัดจำ ' || to_char(p_amount, 'FM999,999,990.00') || ' บาท ('
                                    || public._local_date(now()) || ')')
     WHERE id = p_bill_id;
    PERFORM public._audit('DEPOSIT_APPLY', 'BILL', p_bill_id,
                          jsonb_build_object('deposit_amount', v_bill.deposit_amount),
                          jsonb_build_object('deposit_amount', v_bill.deposit_amount - p_amount,
                                             'receipt_no', v_receipt ->> 'receipt_no'),
                          NULL, v_corr, false, p_amount, NULL, 'DEPOSIT');
    PERFORM public._bill_settle(p_bill_id);
    RETURN public._idempotency_finish(v_idem.key_id, v_receipt || jsonb_build_object('bill',
        (SELECT to_jsonb(b) FROM public.bills b WHERE b.id = p_bill_id)));
END;
$$;

CREATE OR REPLACE FUNCTION public.bill_deposit_refund(
    p_bill_id          uuid,
    p_amount           numeric,
    p_method           text,
    p_idempotency_key  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem record;
    v_bill public.bills%ROWTYPE;
    v_corr uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_idem FROM public._idempotency_begin('bill_deposit_refund', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 'a', p_amount, 'm', p_method)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_bill.status IN ('DRAFT', 'CANCELLED', 'VOID') THEN
        RAISE EXCEPTION 'BILL_NOT_REFUNDABLE: %', v_bill.status USING ERRCODE = '23514';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 2) <> p_amount THEN
        RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
    END IF;
    IF p_amount > v_bill.deposit_amount - v_bill.deposit_unpaid THEN
        RAISE EXCEPTION 'DEPOSIT_EXCEEDED: deposit received %', v_bill.deposit_amount - v_bill.deposit_unpaid
            USING ERRCODE = '23514';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('CASH', 'TRANSFER', 'QR', 'OTHER') THEN
        RAISE EXCEPTION 'INVALID_METHOD: %', p_method USING ERRCODE = '22023';
    END IF;

    UPDATE public.bills
       SET deposit_amount = deposit_amount - p_amount,
           deposit_note = concat_ws(' | ', NULLIF(btrim(COALESCE(deposit_note, '')), ''),
                                    'คืนมัดจำ ' || to_char(p_amount, 'FM999,999,990.00') || ' บาท ('
                                    || CASE p_method WHEN 'CASH' THEN 'เงินสด' WHEN 'QR' THEN 'QR Code'
                                            WHEN 'TRANSFER' THEN 'โอนเงิน' ELSE 'อื่น ๆ' END
                                    || ' ' || public._local_date(now()) || ')')
     WHERE id = p_bill_id;
    PERFORM public._audit('DEPOSIT_REFUND', 'BILL', p_bill_id,
                          jsonb_build_object('deposit_amount', v_bill.deposit_amount),
                          jsonb_build_object('deposit_amount', v_bill.deposit_amount - p_amount, 'method', p_method),
                          NULL, v_corr, false, p_amount, NULL, p_method);
    PERFORM public._bill_settle(p_bill_id);
    RETURN public._idempotency_finish(v_idem.key_id, jsonb_build_object(
        'refunded', p_amount, 'method', p_method,
        'bill', (SELECT to_jsonb(b) FROM public.bills b WHERE b.id = p_bill_id)));
END;
$$;

-- ─── bill_correct: as on Cloud; a lower deposit_amount takes the unpaid part down with it ──
CREATE OR REPLACE FUNCTION public.bill_correct(p_bill_id uuid, p_data jsonb, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old    public.bills%ROWTYPE;
    v_new    public.bills%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM public._require_pin(p_pin_token, 'BILL_CORRECT');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k
                WHERE k <> ALL (ARRAY['note', 'due_date', 'deposit_amount', 'deposit_note'])) THEN
        RAISE EXCEPTION 'CORRECTION_FIELD_NOT_ALLOWED: amounts, dates of rental and quantities use adjustment / continuation'
            USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_old FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_old.status = 'DRAFT' THEN
        RAISE EXCEPTION 'BILL_NOT_CORRECTABLE' USING ERRCODE = '23514';
    END IF;
    v_new := jsonb_populate_record(v_old, p_data);
    IF v_new.deposit_amount IS NULL OR v_new.deposit_amount < 0 THEN
        RAISE EXCEPTION 'INVALID_DEPOSIT' USING ERRCODE = '22023';
    END IF;
    UPDATE public.bills SET note = v_new.note, due_date = v_new.due_date, deposit_amount = v_new.deposit_amount,
                            deposit_unpaid = least(deposit_unpaid, v_new.deposit_amount),
                            deposit_note = v_new.deposit_note
     WHERE id = p_bill_id RETURNING * INTO v_new;
    IF v_new.deposit_unpaid <> v_old.deposit_unpaid THEN
        PERFORM public._bill_settle(p_bill_id);
        SELECT * INTO v_new FROM public.bills WHERE id = p_bill_id;
    END IF;
    PERFORM public._audit('BILL_CORRECT', 'BILL', p_bill_id,
                          jsonb_build_object('note', v_old.note, 'due_date', v_old.due_date,
                                             'deposit_amount', v_old.deposit_amount, 'deposit_note', v_old.deposit_note),
                          jsonb_build_object('note', v_new.note, 'due_date', v_new.due_date,
                                             'deposit_amount', v_new.deposit_amount, 'deposit_note', v_new.deposit_note),
                          v_reason, NULL, true);
    RETURN to_jsonb(v_new);
END;
$$;

-- ─── payment_void: as on Cloud; when a receipt has no money left, its deposit part is owed again ──
CREATE OR REPLACE FUNCTION public.payment_void(p_payment_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pay     public.payments%ROWTYPE;
    v_bill    public.bills%ROWTYPE;
    v_reason  text := public._require_reason(p_reason);
    v_corr    uuid := gen_random_uuid();
    v_refunds numeric;
    v_dep     numeric(14,2);
BEGIN
    PERFORM public._require_menu('bills', 'finance');
    PERFORM public._require_pin(p_pin_token, 'PAYMENT_VOID');
    SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_bill FROM public.bills WHERE id = v_pay.bill_id FOR UPDATE;
    SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
    IF v_pay.status <> 'COMPLETED' THEN
        RAISE EXCEPTION 'PAYMENT_NOT_COMPLETED' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.refunds WHERE payment_id = p_payment_id AND status = 'PAID') THEN
        RAISE EXCEPTION 'PAYMENT_HAS_REFUNDS' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_refunds
      FROM public.refunds WHERE bill_id = v_pay.bill_id AND status = 'PAID';
    IF v_bill.paid_amount - v_pay.amount < v_refunds THEN
        RAISE EXCEPTION 'VOID_WOULD_LEAVE_REFUNDS_UNCOVERED' USING ERRCODE = '23514';
    END IF;
    UPDATE public.payments SET status = 'VOIDED', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
     WHERE id = p_payment_id;
    IF v_pay.receipt_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.payments WHERE receipt_id = v_pay.receipt_id AND status = 'COMPLETED') THEN
        UPDATE public.bill_payment_allocations SET voided_at = now()
         WHERE receipt_id = v_pay.receipt_id AND voided_at IS NULL
        RETURNING deposit_amount INTO v_dep;
        IF COALESCE(v_dep, 0) > 0 THEN
            UPDATE public.bills SET deposit_unpaid = least(deposit_amount, deposit_unpaid + v_dep) WHERE id = v_pay.bill_id;
        END IF;
    END IF;
    PERFORM public._bill_settle(v_pay.bill_id);
    PERFORM public._audit('PAYMENT_VOID', 'PAYMENT', p_payment_id, to_jsonb(v_pay),
                          jsonb_build_object('status', 'VOIDED', 'deposit_owed_again', COALESCE(v_dep, 0)),
                          v_reason, v_corr, true, v_pay.amount, NULL, v_pay.method);
    RETURN jsonb_build_object('payment_id', p_payment_id, 'status', 'VOIDED');
END;
$$;
