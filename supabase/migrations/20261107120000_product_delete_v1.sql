-- product_delete v1 (owner 2026-11-07: "ลบจริง"; owner 2026-11-08: a used product is hidden, old bills still show it).
-- A product that was never on a bill or quotation (and has no reservation, carry-forward or serial unit)
-- is deleted for real, together with its own stock history (movements, balances, costs, stock-count lines).
-- A product that was used is not deleted: it is switched off and marked archived_at, so it leaves every
-- screen (products page, POS, quotations, appointments) while old bills and quotations still show its
-- name and code. A used product still out with a customer or reserved is refused until it comes back.
--
-- The no-delete guards stay on every table. They let a DELETE through only inside product_delete:
-- it sets the transaction-local flag app.deleting_product to the product id, and a guard passes a row
-- only when that row belongs to that product (its product_id, or the products row itself).

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE OR REPLACE FUNCTION public._deleting_this_product(p_table text, p_old jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT coalesce(current_setting('app.deleting_product', true), '') <> ''
     AND current_setting('app.deleting_product', true)
         = coalesce(p_old->>'product_id', CASE WHEN p_table = 'products' THEN p_old->>'id' END)
$$;

CREATE OR REPLACE FUNCTION public._forbid_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    IF public._deleting_this_product(TG_TABLE_NAME, to_jsonb(OLD)) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'NO_HARD_DELETE: deleting from %.% is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$function$;

CREATE OR REPLACE FUNCTION public._forbid_update_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
IF TG_OP = 'DELETE' AND public._deleting_this_product(TG_TABLE_NAME, to_jsonb(OLD)) THEN
RETURN OLD;
END IF;
RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
USING ERRCODE = '42501';
END;
$function$;

CREATE OR REPLACE FUNCTION public.product_delete(p_product_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
v_old jsonb;
v_reason text := coalesce(nullif(btrim(p_reason), ''), 'ลบสินค้า');
BEGIN
PERFORM public._require_menu('products');
SELECT to_jsonb(p) INTO v_old FROM public.products p WHERE p.id = p_product_id FOR UPDATE;
IF NOT FOUND THEN
RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
END IF;
IF EXISTS (SELECT 1 FROM public.bill_lines WHERE product_id = p_product_id)
OR EXISTS (SELECT 1 FROM public.quotation_items WHERE product_id = p_product_id)
OR EXISTS (SELECT 1 FROM public.reservations WHERE product_id = p_product_id)
OR EXISTS (SELECT 1 FROM public.rental_carry_forwards WHERE product_id = p_product_id)
OR EXISTS (SELECT 1 FROM public.product_units WHERE product_id = p_product_id) THEN
IF EXISTS (SELECT 1 FROM public.stock_balances
           WHERE product_id = p_product_id
             AND stock_state IN ('RESERVED', 'RENTED_OUT', 'DELIVERY_PENDING', 'RETURN_PENDING')
             AND quantity > 0) THEN
RAISE EXCEPTION 'PRODUCT_OUT_WITH_CUSTOMER: product is reserved or not yet returned' USING ERRCODE = 'P0001';
END IF;
UPDATE public.products
SET active = false, archived_at = coalesce(archived_at, now()), updated_by = auth.uid()
WHERE id = p_product_id;
PERFORM public._audit('PRODUCT_ARCHIVE', 'PRODUCT', p_product_id, v_old,
jsonb_build_object('active', false, 'archived', true), v_reason, NULL);
RETURN jsonb_build_object('product_id', p_product_id, 'deleted', false, 'archived', true);
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

REVOKE ALL ON FUNCTION public.product_delete(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_delete(uuid, text) TO authenticated;
