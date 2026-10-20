-- ============================================================================
-- Member action grants (2026-10-07) — LOCAL MIGRATION, NOT APPLIED TO CLOUD.
-- A USER may run these risky actions only when the OWNER granted them, on top of the
-- menu check and the user's own PIN (order: menu -> action -> PIN). Default = DENY.
-- The OWNER always may. Grants are changed only through owner_set_member_actions
-- (OWNER only, never for an OWNER, reason required, audited).
--   PRODUCT_PRICE_CHANGE  product_set_price
--   STOCK_ADJUST          stock_adjust, convert_damaged_stock
--   BILL_VOID             bill_void, bill_cancel of a CONFIRMED bill
--   REFUND                refund_pay
--   EXPENSE               expense_create, expense_void
--   WRITE_OFF             write_off_record
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.member_action_grants (
    user_id      uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    action_code  text NOT NULL,
    granted_by   uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    granted_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, action_code),
    CONSTRAINT member_action_grants_code_check CHECK (action_code IN
        ('PRODUCT_PRICE_CHANGE', 'STOCK_ADJUST', 'BILL_VOID', 'REFUND', 'EXPENSE', 'WRITE_OFF')),
    CONSTRAINT member_action_grants_not_self CHECK (granted_by <> user_id)
);

-- Only a USER can hold a grant, and only an ACTIVE OWNER can give it.
CREATE OR REPLACE FUNCTION public._member_action_grants_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.role = 'USER') THEN
        RAISE EXCEPTION 'GRANT_TARGET_MUST_BE_USER' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.granted_by AND p.role = 'OWNER' AND p.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'GRANTOR_MUST_BE_OWNER' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_member_action_grants_guard ON public.member_action_grants;
CREATE TRIGGER trg_member_action_grants_guard BEFORE INSERT OR UPDATE ON public.member_action_grants
    FOR EACH ROW EXECUTE FUNCTION public._member_action_grants_guard();

-- Reads: a member sees their own grants, the OWNER sees all. No direct writes (RPC only).
ALTER TABLE public.member_action_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS member_action_grants_select ON public.member_action_grants;
CREATE POLICY member_action_grants_select ON public.member_action_grants
    FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_owner()));
REVOKE ALL ON public.member_action_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.member_action_grants TO authenticated;
GRANT ALL ON public.member_action_grants TO service_role;

-- OWNER passes; a USER needs the grant (the caller already passed the menu check).
CREATE OR REPLACE FUNCTION public._require_action(p_code text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF public.is_owner() THEN
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.member_action_grants g
                    JOIN public.profiles p ON p.id = g.user_id
                   WHERE g.user_id = auth.uid() AND g.action_code = p_code AND p.role = 'USER') THEN
        RAISE EXCEPTION 'ACTION_NOT_GRANTED: %', p_code USING ERRCODE = '42501';
    END IF;
END;
$$;

-- Replaces the USER's action set (same shape as owner_set_member_menus).
CREATE OR REPLACE FUNCTION public.owner_set_member_actions(p_user_id uuid, p_actions text[], p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target  public.profiles%ROWTYPE;
    v_reason  text := public._require_reason(p_reason);
    v_codes   text[];
    v_bad     text[];
    v_before  text[];
BEGIN
    PERFORM public._require_owner();

    SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_target.role = 'OWNER' THEN
        RAISE EXCEPTION 'OWNER_HAS_ALL_ACTIONS' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(array_agg(DISTINCT c ORDER BY c), ARRAY[]::text[]) INTO v_codes
      FROM unnest(COALESCE(p_actions, ARRAY[]::text[])) AS c WHERE c IS NOT NULL;
    SELECT array_agg(c) INTO v_bad
      FROM unnest(v_codes) AS c
     WHERE c NOT IN ('PRODUCT_PRICE_CHANGE', 'STOCK_ADJUST', 'BILL_VOID', 'REFUND', 'EXPENSE', 'WRITE_OFF');
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'UNKNOWN_ACTION: %', array_to_string(v_bad, ', ') USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(array_agg(action_code ORDER BY action_code), ARRAY[]::text[]) INTO v_before
      FROM public.member_action_grants WHERE user_id = p_user_id;

    DELETE FROM public.member_action_grants WHERE user_id = p_user_id AND NOT (action_code = ANY (v_codes));
    INSERT INTO public.member_action_grants (user_id, action_code, granted_by)
    SELECT p_user_id, c, auth.uid() FROM unnest(v_codes) AS c
    ON CONFLICT (user_id, action_code) DO NOTHING;

    PERFORM public._audit('MEMBER_ACTIONS_CHANGE', 'MEMBER', p_user_id,
                          jsonb_build_object('actions', to_jsonb(v_before)),
                          jsonb_build_object('actions', to_jsonb(v_codes)), v_reason, NULL);
    RETURN jsonb_build_object('user_id', p_user_id, 'actions', to_jsonb(v_codes));
END;
$$;

-- ----------------------------------------------------------------------------
-- The 6 actions: menu -> action grant -> PIN (bodies otherwise unchanged)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_set_price(
    p_product_id    uuid,
    p_sale_price    numeric,
    p_rental_price  numeric,
    p_reason        text,
    p_pin_token     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old    public.products%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
BEGIN
    PERFORM public._require_menu('products');
    PERFORM public._require_action('PRODUCT_PRICE_CHANGE');
    PERFORM public._require_pin(p_pin_token, 'PRODUCT_PRICE_CHANGE');
    SELECT * INTO v_old FROM public.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.products SET sale_price = p_sale_price, rental_price = p_rental_price, updated_by = auth.uid()
     WHERE id = p_product_id;
    PERFORM public._audit('PRODUCT_PRICE_CHANGE', 'PRODUCT', p_product_id,
                          jsonb_build_object('sale_price', v_old.sale_price, 'rental_price', v_old.rental_price),
                          jsonb_build_object('sale_price', p_sale_price, 'rental_price', p_rental_price), v_reason, NULL,
                          true);
    RETURN jsonb_build_object('product_id', p_product_id, 'sale_price', p_sale_price, 'rental_price', p_rental_price);
END;
$$;

CREATE OR REPLACE FUNCTION public.stock_adjust(
    p_product_id       uuid,
    p_from_state       text,
    p_to_state         text,
    p_quantity         numeric,
    p_reason           text,
    p_idempotency_key  text,
    p_pin_token        uuid,
    p_unit_id          uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem    record;
    v_reason  text := public._require_reason(p_reason);
    v_product public.products%ROWTYPE;
    v_type    text;
    v_doc_no  text;
    v_allowed text[] := ARRAY['AVAILABLE', 'INSPECTION', 'REPAIR', 'DAMAGED', 'LOST', 'WRITTEN_OFF', 'INACTIVE'];
    v_corr    uuid := gen_random_uuid();
    v_src     uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('products');
    PERFORM public._require_action('STOCK_ADJUST');
    SELECT * INTO v_idem FROM public._idempotency_begin('stock_adjust', p_idempotency_key,
        md5(jsonb_build_object('p', p_product_id, 'f', p_from_state, 't', p_to_state, 'q', p_quantity, 'u', p_unit_id)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    IF (p_from_state IS NOT NULL AND p_from_state <> ALL (v_allowed))
       OR (p_to_state IS NOT NULL AND p_to_state <> ALL (v_allowed))
       OR p_from_state IS NOT DISTINCT FROM p_to_state THEN
        RAISE EXCEPTION 'STATE_NOT_ADJUSTABLE' USING ERRCODE = '22023';
    END IF;
    IF p_from_state IN ('DAMAGED', 'LOST', 'WRITTEN_OFF') AND p_to_state = 'AVAILABLE' THEN
        RAISE EXCEPTION 'DAMAGED_OR_LOST_CANNOT_GO_STRAIGHT_TO_AVAILABLE: go through INSPECTION or REPAIR'
            USING ERRCODE = '23514';
    END IF;
    PERFORM public._require_pin(p_pin_token, 'STOCK_ADJUST');

    SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_product.item_type = 'SERIALIZED' THEN
        IF p_unit_id IS NULL OR p_quantity <> 1 OR p_from_state IS NULL OR p_to_state IS NULL THEN
            RAISE EXCEPTION 'SERIALIZED_ADJUST_NEEDS_ONE_UNIT_AND_BOTH_STATES' USING ERRCODE = '22023';
        END IF;
        PERFORM public._unit_transition(p_unit_id, p_product_id, ARRAY[public._unit_state_for(p_from_state)],
                                        public._unit_state_for(p_to_state));
    ELSIF p_unit_id IS NOT NULL THEN
        RAISE EXCEPTION 'UNITS_NOT_ALLOWED_FOR_QUANTITY_PRODUCT' USING ERRCODE = '22023';
    END IF;

    v_type := CASE
        WHEN p_to_state = 'WRITTEN_OFF' THEN 'WRITE_OFF'
        WHEN p_from_state = 'INSPECTION' AND p_to_state IS NOT NULL THEN 'INSPECT'
        WHEN p_to_state = 'REPAIR' OR p_from_state = 'REPAIR' THEN 'REPAIR'
        WHEN p_to_state = 'DAMAGED' THEN 'DAMAGE'
        ELSE 'ADJUSTMENT' END;
    v_doc_no := public._next_document_no('STOCK_ADJUSTMENT');
    PERFORM public._stock_move(p_product_id, p_from_state, p_to_state, p_quantity, v_type, 'ADJUSTMENT', v_src, p_unit_id,
                               v_doc_no || ': ' || v_reason, v_corr);
    PERFORM public._audit('STOCK_ADJUST', 'PRODUCT', p_product_id, jsonb_build_object('from_state', p_from_state),
                          jsonb_build_object('to_state', p_to_state, 'quantity', p_quantity, 'document_no', v_doc_no,
                                             'unit_id', p_unit_id), v_reason, v_corr, true, NULL, p_quantity);
    RETURN public._idempotency_finish(v_idem.key_id, jsonb_build_object('document_no', v_doc_no, 'correlation_id', v_corr));
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_damaged_stock(
    p_from_product_id  uuid,
    p_to_product_id    uuid,
    p_from_quantity    numeric,
    p_to_quantity      numeric,
    p_reason           text,
    p_idempotency_key  text,
    p_pin_token        uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem    record;
    v_reason  text := public._require_reason(p_reason);
    v_doc_no  text;
    v_corr    uuid := gen_random_uuid();
    v_src     uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('products');
    PERFORM public._require_action('STOCK_ADJUST');
    SELECT * INTO v_idem FROM public._idempotency_begin('convert_damaged_stock', p_idempotency_key,
        md5(jsonb_build_object('f', p_from_product_id, 't', p_to_product_id, 'fq', p_from_quantity,
                               'tq', p_to_quantity)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    PERFORM public._require_pin(p_pin_token, 'STOCK_CONVERT');
    IF p_from_product_id = p_to_product_id THEN
        RAISE EXCEPTION 'CONVERT_SAME_PRODUCT' USING ERRCODE = '22023';
    END IF;
    IF p_from_quantity IS NULL OR p_from_quantity <= 0 OR p_to_quantity IS NULL OR p_to_quantity <= 0 THEN
        RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.products
         WHERE id IN (p_from_product_id, p_to_product_id) AND item_type = 'QUANTITY') <> 2 THEN
        RAISE EXCEPTION 'CONVERT_QUANTITY_PRODUCTS_ONLY' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_to_product_id AND active) THEN
        RAISE EXCEPTION 'TARGET_PRODUCT_INACTIVE' USING ERRCODE = '23514';
    END IF;

    v_doc_no := public._next_document_no('STOCK_ADJUSTMENT');
    -- Lock in product order so two conversions cannot deadlock.
    IF p_from_product_id < p_to_product_id THEN
        PERFORM public._stock_move(p_from_product_id, 'DAMAGED', NULL, p_from_quantity, 'CONVERT_OUT', 'CONVERSION',
                                   v_src, NULL, v_doc_no || ': ' || v_reason, v_corr);
        PERFORM public._stock_move(p_to_product_id, NULL, 'AVAILABLE', p_to_quantity, 'CONVERT_IN', 'CONVERSION',
                                   v_src, NULL, v_doc_no || ': ' || v_reason, v_corr);
    ELSE
        PERFORM public._stock_move(p_to_product_id, NULL, 'AVAILABLE', p_to_quantity, 'CONVERT_IN', 'CONVERSION',
                                   v_src, NULL, v_doc_no || ': ' || v_reason, v_corr);
        PERFORM public._stock_move(p_from_product_id, 'DAMAGED', NULL, p_from_quantity, 'CONVERT_OUT', 'CONVERSION',
                                   v_src, NULL, v_doc_no || ': ' || v_reason, v_corr);
    END IF;
    PERFORM public._audit('STOCK_CONVERT', 'PRODUCT', p_from_product_id,
                          jsonb_build_object('from_product_id', p_from_product_id, 'from_quantity', p_from_quantity),
                          jsonb_build_object('to_product_id', p_to_product_id, 'to_quantity', p_to_quantity,
                                             'document_no', v_doc_no), v_reason, v_corr, true, NULL, p_from_quantity);
    RETURN public._idempotency_finish(v_idem.key_id, jsonb_build_object('document_no', v_doc_no, 'correlation_id', v_corr));
END;
$$;

CREATE OR REPLACE FUNCTION public.bill_void(p_bill_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill   public.bills%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
    v_id     uuid;
BEGIN
    PERFORM public._require_menu('bills');
    PERFORM public._require_action('BILL_VOID');
    PERFORM public._require_pin(p_pin_token, 'BILL_VOID');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_VOIDABLE' USING ERRCODE = '23514';
    END IF;
    PERFORM public._bill_recalculate(p_bill_id);

    IF EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND line_mode = 'RENTAL' AND obligation_held_here > 0) THEN
        RAISE EXCEPTION 'ITEMS_STILL_WITH_CUSTOMER: receive the return first' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND line_mode = 'SALE' AND delivered_qty > 0) THEN
        RAISE EXCEPTION 'SALE_ALREADY_DELIVERED: sale returns are not supported by this baseline' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rental_carry_forwards cf
                WHERE (cf.from_bill_id = p_bill_id OR cf.to_bill_id = p_bill_id)
                  AND NOT EXISTS (SELECT 1 FROM public.rental_carry_forward_reversals r WHERE r.carry_forward_id = cf.id)) THEN
        RAISE EXCEPTION 'CARRY_FORWARD_ACTIVE: reverse_carry_forward first' USING ERRCODE = '23514';
    END IF;

    FOR v_id IN SELECT id FROM public.charges WHERE bill_id = p_bill_id AND status = 'CONFIRMED' FOR UPDATE LOOP
        PERFORM public._ledger_reverse_source('CHARGE', v_id, v_corr);
        UPDATE public.charges SET status = 'REVERSED', cancelled_by = auth.uid(), cancelled_at = now(),
                                  cancel_reason = v_reason WHERE id = v_id;
    END LOOP;
    UPDATE public.charges SET status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
     WHERE bill_id = p_bill_id AND status = 'PENDING';
    FOR v_id IN SELECT id FROM public.bill_adjustments WHERE bill_id = p_bill_id LOOP
        PERFORM public._ledger_reverse_source('ADJUSTMENT', v_id, v_corr);
    END LOOP;
    PERFORM public._bill_release_allocation(p_bill_id, v_corr);
    PERFORM public._ledger_reverse_source('BILL_CONFIRM', p_bill_id, v_corr);

    UPDATE public.bills SET status = 'VOID', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
     WHERE id = p_bill_id;
    PERFORM public._bill_recalculate(p_bill_id);
    PERFORM public._audit('BILL_VOID', 'BILL', p_bill_id, jsonb_build_object('status', v_bill.status),
                          jsonb_build_object('status', 'VOID'), v_reason, v_corr, true, v_bill.grand_total);
    RETURN jsonb_build_object('bill_id', p_bill_id, 'status', 'VOID');
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_pay(
    p_bill_id          uuid,
    p_amount           numeric,
    p_method           text,
    p_reason           text,
    p_idempotency_key  text,
    p_pin_token        uuid,
    p_payment_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idem        record;
    v_bill        public.bills%ROWTYPE;
    v_pay         public.payments%ROWTYPE;
    v_reason      text := public._require_reason(p_reason);
    v_refundable  numeric;
    v_refund      public.refunds%ROWTYPE;
    v_corr        uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('bills', 'finance');
    PERFORM public._require_action('REFUND');
    SELECT * INTO v_idem FROM public._idempotency_begin('refund_pay', p_idempotency_key,
        md5(jsonb_build_object('b', p_bill_id, 'a', p_amount, 'm', p_method, 'p', p_payment_id)::text));
    IF v_idem.replay IS NOT NULL THEN
        RETURN v_idem.replay;
    END IF;
    PERFORM public._require_pin(p_pin_token, 'REFUND');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status = 'DRAFT' THEN
        RAISE EXCEPTION 'BILL_NOT_REFUNDABLE' USING ERRCODE = '23514';
    END IF;
    PERFORM public._bill_recalculate(p_bill_id);
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
    END IF;
    v_refundable := v_bill.paid_amount - v_bill.refunded_amount;
    IF p_amount > v_refundable THEN
        RAISE EXCEPTION 'REFUND_EXCEEDS_REFUNDABLE: refundable %', v_refundable USING ERRCODE = '23514';
    END IF;
    IF p_payment_id IS NULL THEN
        RAISE EXCEPTION 'PAYMENT_REQUIRED: a refund must point to the payment it returns' USING ERRCODE = '22023';
    ELSE
        SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id AND bill_id = p_bill_id AND status = 'COMPLETED';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PAYMENT_NOT_REFUNDABLE' USING ERRCODE = '23514';
        END IF;
        IF p_amount > v_pay.amount - (SELECT COALESCE(sum(amount), 0) FROM public.refunds
                                       WHERE payment_id = p_payment_id AND status = 'PAID') THEN
            RAISE EXCEPTION 'REFUND_EXCEEDS_PAYMENT' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF COALESCE(p_method, v_pay.method) IS NULL THEN
        RAISE EXCEPTION 'METHOD_REQUIRED' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.refunds (refund_no, bill_id, payment_id, amount, method, reason, paid_by, correlation_id, created_by)
    VALUES (public._next_document_no('REFUND'), p_bill_id, p_payment_id, p_amount, COALESCE(p_method, v_pay.method),
            v_reason, auth.uid(), v_corr, auth.uid())
    RETURNING * INTO v_refund;
    PERFORM public._ledger('REFUND', NULL, v_refund.amount, (-1)::smallint, p_bill_id, NULL, 'REFUND',
                           v_refund.id, v_corr);
    PERFORM public._bill_settle(p_bill_id);
    PERFORM public._audit('REFUND_PAY', 'REFUND', v_refund.id, jsonb_build_object('paid_amount', v_bill.paid_amount,
                          'refunded_amount', v_bill.refunded_amount), to_jsonb(v_refund), v_reason, v_corr,
                          true, v_refund.amount, NULL, v_refund.method);
    RETURN public._idempotency_finish(v_idem.key_id, to_jsonb(v_refund));
END;
$$;

CREATE OR REPLACE FUNCTION public.expense_create(
    p_category     text,
    p_amount       numeric,
    p_paid_method  text,
    p_note         text,
    p_pin_token    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_e    public.expense_entries%ROWTYPE;
    v_corr uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('finance');
    PERFORM public._require_action('EXPENSE');
    PERFORM public._require_pin(p_pin_token, 'EXPENSE_CREATE');
    INSERT INTO public.expense_entries (expense_no, category, amount, paid_method, note, created_by)
    VALUES (public._next_document_no('EXPENSE'), p_category, p_amount, p_paid_method, p_note, auth.uid())
    RETURNING * INTO v_e;
    PERFORM public._ledger('EXPENSE', NULL, v_e.amount, (-1)::smallint, NULL, NULL, 'EXPENSE', v_e.id, v_corr);
    PERFORM public._audit('EXPENSE_CREATE', 'EXPENSE', v_e.id, NULL, to_jsonb(v_e), p_note, v_corr,
                          true, v_e.amount, NULL, v_e.paid_method);
    RETURN to_jsonb(v_e);
END;
$$;

CREATE OR REPLACE FUNCTION public.expense_void(p_expense_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_e      public.expense_entries%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('finance');
    PERFORM public._require_action('EXPENSE');
    PERFORM public._require_pin(p_pin_token, 'EXPENSE_VOID');
    SELECT * INTO v_e FROM public.expense_entries WHERE id = p_expense_id FOR UPDATE;
    IF NOT FOUND OR v_e.status <> 'RECORDED' THEN
        RAISE EXCEPTION 'EXPENSE_NOT_VOIDABLE' USING ERRCODE = '23514';
    END IF;
    PERFORM public._ledger_reverse_source('EXPENSE', p_expense_id, v_corr);
    UPDATE public.expense_entries SET status = 'VOIDED', voided_by = auth.uid(), voided_at = now(), void_reason = v_reason
     WHERE id = p_expense_id;
    PERFORM public._audit('EXPENSE_VOID', 'EXPENSE', p_expense_id, jsonb_build_object('status', v_e.status),
                          jsonb_build_object('status', 'VOIDED'), v_reason, v_corr, true, v_e.amount, NULL, v_e.paid_method);
    RETURN jsonb_build_object('expense_id', p_expense_id, 'status', 'VOIDED');
END;
$$;

CREATE OR REPLACE FUNCTION public.write_off_record(
    p_bill_id           uuid,
    p_amount            numeric,
    p_reason            text,
    p_pin_token         uuid,
    p_incident_case_id  uuid DEFAULT NULL,
    p_charge_id         uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill   public.bills%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_wo     public.write_offs%ROWTYPE;
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('bills', 'finance');
    PERFORM public._require_action('WRITE_OFF');
    PERFORM public._require_pin(p_pin_token, 'WRITE_OFF');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND OR v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_OPEN' USING ERRCODE = '23514';
    END IF;
    PERFORM public._bill_recalculate(p_bill_id);
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_bill.balance_due THEN
        RAISE EXCEPTION 'WRITE_OFF_EXCEEDS_BALANCE' USING ERRCODE = '23514';
    END IF;
    IF p_charge_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.charges WHERE id = p_charge_id AND bill_id = p_bill_id AND status = 'CONFIRMED') THEN
        RAISE EXCEPTION 'CHARGE_NOT_CONFIRMED_ON_BILL' USING ERRCODE = '23514';
    END IF;
    IF p_incident_case_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.incident_cases WHERE id = p_incident_case_id AND bill_id = p_bill_id) THEN
        RAISE EXCEPTION 'INCIDENT_NOT_IN_BILL' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.write_offs (bill_id, incident_case_id, charge_id, amount, reason, correlation_id, created_by)
    VALUES (p_bill_id, p_incident_case_id, p_charge_id, p_amount, v_reason, v_corr, auth.uid())
    RETURNING * INTO v_wo;
    PERFORM public._ledger('WRITE_OFF', NULL, p_amount, (-1)::smallint, p_bill_id, NULL, 'WRITE_OFF', v_wo.id, v_corr);
    PERFORM public._bill_settle(p_bill_id);
    PERFORM public._audit('WRITE_OFF', 'BILL', p_bill_id, jsonb_build_object('balance_due', v_bill.balance_due),
                          to_jsonb(v_wo), v_reason, v_corr, true, p_amount);
    RETURN to_jsonb(v_wo);
END;
$$;

CREATE OR REPLACE FUNCTION public.bill_cancel(p_bill_id uuid, p_reason text, p_pin_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill   public.bills%ROWTYPE;
    v_reason text := public._require_reason(p_reason);
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_bill.status = 'CONFIRMED' THEN
        -- Cancelling a CONFIRMED bill is the same right as Void (a DRAFT cancels freely).
        PERFORM public._require_action('BILL_VOID');
        PERFORM public._require_pin(p_pin_token, 'BILL_CANCEL');
        IF EXISTS (SELECT 1 FROM public.payments WHERE bill_id = p_bill_id AND status IN ('COMPLETED', 'PENDING'))
           OR EXISTS (SELECT 1 FROM public.bill_lines WHERE bill_id = p_bill_id AND (delivered_qty > 0 OR carried_in_qty > 0))
           OR EXISTS (SELECT 1 FROM public.charges WHERE bill_id = p_bill_id AND status = 'CONFIRMED') THEN
            RAISE EXCEPTION 'BILL_HAS_TRANSACTIONS: use bill_void' USING ERRCODE = '23514';
        END IF;
        PERFORM public._bill_release_allocation(p_bill_id, v_corr);
        PERFORM public._ledger_reverse_source('BILL_CONFIRM', p_bill_id, v_corr);
        UPDATE public.charges SET status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(),
                                  cancel_reason = v_reason
         WHERE bill_id = p_bill_id AND status = 'PENDING';
    ELSIF v_bill.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'BILL_NOT_CANCELLABLE: %', v_bill.status USING ERRCODE = '23514';
    END IF;

    UPDATE public.bills SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason
     WHERE id = p_bill_id;
    IF v_bill.status = 'CONFIRMED' THEN
        PERFORM public._bill_recalculate(p_bill_id);
    END IF;
    PERFORM public._audit('BILL_CANCEL', 'BILL', p_bill_id, jsonb_build_object('status', v_bill.status),
                          jsonb_build_object('status', 'CANCELLED'), v_reason, v_corr, v_bill.status = 'CONFIRMED',
                          v_bill.grand_total);
    RETURN jsonb_build_object('bill_id', p_bill_id, 'status', 'CANCELLED');
END;
$$;

-- ----------------------------------------------------------------------------
-- Grants (internal "_" helpers stay private, as in the baseline)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._require_action(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._member_action_grants_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.owner_set_member_actions(uuid, text[], text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.owner_set_member_actions(uuid, text[], text) TO authenticated;
