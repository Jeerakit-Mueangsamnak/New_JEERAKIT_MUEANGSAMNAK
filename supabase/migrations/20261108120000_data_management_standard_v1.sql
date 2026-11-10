-- Data management standard v1 (owner 2026-11-08, Data_Management_Standards_Thai.txt).
-- Three levels for data that is no longer wanted:
--   ระงับ (suspend)   master data that was used: switched off, history stays (existing *_set_active / *_save).
--   ยกเลิก (void)     a confirmed bill: stays with its number, money and stock reversed (bill_cancel / bill_void).
--   ลบ (hard delete)  only what was never used: deleted for real after a dependency check.
-- Owner decisions:
--   1. Cancelling / voiding a confirmed bill needs a typed reason (bills only).
--   3. A member who is not the OWNER may cancel / void only a bill they made, on the day it was confirmed
--      (Asia/Bangkok); any other bill needs the OWNER.
--   4. A draft bill (no number, no stock, no money) is deleted for real; a member deletes only their own drafts.
--   5. A product, customer, category or unit that was never used is deleted for real; one that was used is
--      refused with <TAG>_IN_USE: <number of documents>, and the app offers to suspend it instead.
-- Every change is written to audit_logs (_audit), deletes included.

-- ----------------------------------------------------------------------------
-- 1. No-delete guards: let through only the one row a delete function names.
--    app.hard_delete_row = '<table>:<id>' is set (transaction-local) by the functions below;
--    product_delete keeps its own product-wide flag (app.deleting_product).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._deleting_this_row(p_table text, p_old jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT coalesce(current_setting('app.hard_delete_row', true), '') <> ''
     AND current_setting('app.hard_delete_row', true) = p_table || ':' || coalesce(p_old->>'id', '')
$$;

CREATE OR REPLACE FUNCTION public._forbid_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    IF public._deleting_this_product(TG_TABLE_NAME, to_jsonb(OLD))
       OR public._deleting_this_row(TG_TABLE_NAME, to_jsonb(OLD)) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'NO_HARD_DELETE: deleting from %.% is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public._deleting_this_row(text, jsonb) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Products: a used product is refused (not archived); the app offers ระงับ instead.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_delete(p_product_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_old  jsonb;
    v_used integer;
    v_reason text := coalesce(nullif(btrim(p_reason), ''), 'ลบสินค้า');
BEGIN
    PERFORM public._require_menu('products');
    SELECT to_jsonb(p) INTO v_old FROM public.products p WHERE p.id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- The number shown is the documents that hold the product (bills, quotations); reservations,
    -- carry-forwards and serial units also block the delete (counted only when no document does).
    v_used := (SELECT count(DISTINCT bill_id) FROM public.bill_lines WHERE product_id = p_product_id)
            + (SELECT count(DISTINCT quotation_id) FROM public.quotation_items WHERE product_id = p_product_id);
    IF v_used = 0 THEN
        v_used := (SELECT count(*) FROM public.reservations WHERE product_id = p_product_id)
                + (SELECT count(*) FROM public.rental_carry_forwards WHERE product_id = p_product_id)
                + (SELECT count(*) FROM public.product_units WHERE product_id = p_product_id);
    END IF;
    IF v_used > 0 THEN
        RAISE EXCEPTION 'PRODUCT_IN_USE: %', v_used USING ERRCODE = 'P0001';
    END IF;

    PERFORM set_config('app.deleting_product', p_product_id::text, true);
    DELETE FROM public.stock_count_lines WHERE product_id = p_product_id;
    -- A reversal points at the movement it reverses: delete the ones nothing points at, until none are left.
    LOOP
        DELETE FROM public.stock_movements m
         WHERE m.product_id = p_product_id
           AND NOT EXISTS (SELECT 1 FROM public.stock_movements r WHERE r.reverses_movement_id = m.id);
        EXIT WHEN NOT FOUND;
    END LOOP;
    DELETE FROM public.stock_balances WHERE product_id = p_product_id;
    DELETE FROM public.product_costs WHERE product_id = p_product_id;
    DELETE FROM public.products WHERE id = p_product_id;
    PERFORM set_config('app.deleting_product', '', true);

    PERFORM public._audit('PRODUCT_DELETE', 'PRODUCT', p_product_id, v_old, NULL, v_reason, NULL);
    RETURN jsonb_build_object('product_id', p_product_id, 'deleted', true);
END;
$function$;

-- archived_at (20261107120000) is no longer used: a used product is suspended (active = false) instead.
ALTER TABLE public.products DROP COLUMN IF EXISTS archived_at;

-- ----------------------------------------------------------------------------
-- 3. Customers, categories, units: delete when never used.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_delete(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_old  jsonb;
    v_used integer;
BEGIN
    PERFORM public._require_menu('customers');
    SELECT to_jsonb(c) INTO v_old FROM public.customers c WHERE c.id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_used := (SELECT count(*) FROM public.bills WHERE customer_id = p_customer_id)
            + (SELECT count(*) FROM public.quotations WHERE customer_id = p_customer_id)
            + (SELECT count(*) FROM public.appointments WHERE customer_id = p_customer_id)
            + (SELECT count(*) FROM public.customer_documents WHERE customer_id = p_customer_id)
            + (SELECT count(*) FROM public.line_contacts WHERE customer_id = p_customer_id OR register_customer_id = p_customer_id)
            + (SELECT count(*) FROM public.line_link_codes WHERE customer_id = p_customer_id);
    IF v_used > 0 THEN
        RAISE EXCEPTION 'CUSTOMER_IN_USE: %', v_used USING ERRCODE = 'P0001';
    END IF;
    PERFORM set_config('app.hard_delete_row', 'customers:' || p_customer_id::text, true);
    DELETE FROM public.customers WHERE id = p_customer_id;
    PERFORM set_config('app.hard_delete_row', '', true);
    PERFORM public._audit('CUSTOMER_DELETE', 'CUSTOMER', p_customer_id, v_old, NULL, 'ลบลูกค้า', NULL);
    RETURN jsonb_build_object('customer_id', p_customer_id, 'deleted', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.product_category_delete(p_category_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_old  jsonb;
    v_used integer;
BEGIN
    PERFORM public._require_menu('products');
    SELECT to_jsonb(c) INTO v_old FROM public.product_categories c WHERE c.id = p_category_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CATEGORY_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_used := (SELECT count(*) FROM public.products WHERE category_id = p_category_id);
    IF v_used > 0 THEN
        RAISE EXCEPTION 'CATEGORY_IN_USE: %', v_used USING ERRCODE = 'P0001';
    END IF;
    PERFORM set_config('app.hard_delete_row', 'product_categories:' || p_category_id::text, true);
    DELETE FROM public.product_categories WHERE id = p_category_id;
    PERFORM set_config('app.hard_delete_row', '', true);
    PERFORM public._audit('CATEGORY_DELETE', 'PRODUCT_CATEGORY', p_category_id, v_old, NULL, 'ลบหมวดหมู่', NULL);
    RETURN jsonb_build_object('category_id', p_category_id, 'deleted', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.unit_delete(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_old  jsonb;
    v_used integer;
BEGIN
    PERFORM public._require_menu('products');
    SELECT to_jsonb(u) INTO v_old FROM public.units u WHERE u.id = p_unit_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'UNIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_used := (SELECT count(*) FROM public.products WHERE unit_id = p_unit_id);
    IF v_used > 0 THEN
        RAISE EXCEPTION 'UNIT_IN_USE: %', v_used USING ERRCODE = 'P0001';
    END IF;
    PERFORM set_config('app.hard_delete_row', 'units:' || p_unit_id::text, true);
    DELETE FROM public.units WHERE id = p_unit_id;
    PERFORM set_config('app.hard_delete_row', '', true);
    PERFORM public._audit('UNIT_DELETE', 'UNIT', p_unit_id, v_old, NULL, 'ลบหน่วยนับ', NULL);
    RETURN jsonb_build_object('unit_id', p_unit_id, 'deleted', true);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Draft bills: deleted for real (no number, no stock, no money). A member deletes only their own drafts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bill_draft_delete(p_bill_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_bill public.bills%ROWTYPE;
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_bill.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'BILL_NOT_DRAFT' USING ERRCODE = '23514';
    END IF;
    IF NOT public.is_owner() AND v_bill.created_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'BILL_DRAFT_NOT_YOURS' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.appointments WHERE bill_id = p_bill_id)
       OR EXISTS (SELECT 1 FROM public.line_tasks WHERE bill_id = p_bill_id) THEN
        RAISE EXCEPTION 'BILL_DRAFT_LINKED: an appointment or LINE task points at this draft' USING ERRCODE = '23514';
    END IF;
    DELETE FROM public.bill_lines WHERE bill_id = p_bill_id;
    PERFORM set_config('app.hard_delete_row', 'bills:' || p_bill_id::text, true);
    DELETE FROM public.bills WHERE id = p_bill_id;
    PERFORM set_config('app.hard_delete_row', '', true);
    PERFORM public._audit('BILL_DRAFT_DELETE', 'BILL', p_bill_id, to_jsonb(v_bill), NULL, 'ลบบิลร่าง', NULL,
                          false, v_bill.grand_total);
    RETURN jsonb_build_object('bill_id', p_bill_id, 'deleted', true);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. Cancelling / voiding a confirmed bill: typed reason + who may do it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bill_void_check(p_bill public.bills, p_reason text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    IF nullif(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_owner()
       AND (p_bill.created_by IS DISTINCT FROM auth.uid()
            OR p_bill.confirmed_at IS NULL
            OR (p_bill.confirmed_at AT TIME ZONE 'Asia/Bangkok')::date <> (now() AT TIME ZONE 'Asia/Bangkok')::date) THEN
        RAISE EXCEPTION 'BILL_VOID_OWNER_ONLY: another member''s bill or a bill from another day' USING ERRCODE = '42501';
    END IF;
    RETURN btrim(p_reason);
END;
$function$;

REVOKE ALL ON FUNCTION public._bill_void_check(public.bills, text) FROM PUBLIC, anon, authenticated;

-- Body = 20261007131509_member_action_grants.sql + the checks above; a draft is deleted with bill_draft_delete.
CREATE OR REPLACE FUNCTION public.bill_cancel(p_bill_id uuid, p_reason text, p_pin_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill   public.bills%ROWTYPE;
    v_reason text;
    v_corr   uuid := gen_random_uuid();
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_bill.status = 'DRAFT' THEN
        RAISE EXCEPTION 'BILL_IS_DRAFT: use bill_draft_delete' USING ERRCODE = '23514';
    END IF;
    IF v_bill.status <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'BILL_NOT_CANCELLABLE: %', v_bill.status USING ERRCODE = '23514';
    END IF;
    -- Cancelling a CONFIRMED bill is the same right as Void.
    PERFORM public._require_action('BILL_VOID');
    PERFORM public._require_pin(p_pin_token, 'BILL_CANCEL');
    v_reason := public._bill_void_check(v_bill, p_reason);
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

    UPDATE public.bills SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason
     WHERE id = p_bill_id;
    PERFORM public._bill_recalculate(p_bill_id);
    PERFORM public._audit('BILL_CANCEL', 'BILL', p_bill_id, jsonb_build_object('status', v_bill.status),
                          jsonb_build_object('status', 'CANCELLED'), v_reason, v_corr, true, v_bill.grand_total);
    RETURN jsonb_build_object('bill_id', p_bill_id, 'status', 'CANCELLED');
END;
$$;

-- Body = 20261008001228_bill_void_reverse_write_offs.sql + the checks above.
CREATE OR REPLACE FUNCTION public.bill_void(p_bill_id uuid, p_reason text, p_pin_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill   public.bills%ROWTYPE;
    v_reason text;
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
    v_reason := public._bill_void_check(v_bill, p_reason);
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
    FOR v_id IN SELECT id FROM public.write_offs WHERE bill_id = p_bill_id ORDER BY created_at, id LOOP
        PERFORM public._ledger_reverse_source('WRITE_OFF', v_id, v_corr);
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

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.customer_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_category_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unit_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bill_draft_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_category_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unit_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bill_draft_delete(uuid) TO authenticated;
