-- Owner 2026-11-02: every product may belong to one "รายการ" (list item) inside its category,
-- e.g. category แบบคาน → รายการ แบบคาน40. The POS shows a หมวดหมู่ dropdown and a รายการ dropdown.
-- Adds products.list_item and lets product_create / product_update write it. Nothing else changes;
-- existing products keep list_item = NULL until someone picks one.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS list_item text;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_list_item_check;
ALTER TABLE public.products ADD CONSTRAINT products_list_item_check
    CHECK (list_item IS NULL OR (btrim(list_item) <> '' AND length(list_item) <= 100));

CREATE OR REPLACE FUNCTION public.product_create(
    p_data               jsonb,
    p_cost_price         numeric DEFAULT NULL,
    p_initial_qty        numeric DEFAULT 0,
    p_confirm_duplicate  boolean DEFAULT false,
    p_pin_token          uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_new     public.products%ROWTYPE;
    v_corr    uuid := gen_random_uuid();
    v_allowed text[] := ARRAY['sku', 'name', 'category_id', 'item_type', 'unit_id', 'calculation_type', 'sale_price',
                              'rental_price', 'reorder_point', 'can_sell', 'can_rent', 'is_accessory',
                              'is_rent_chargeable', 'requires_return', 'default_damage_fee', 'default_loss_fee',
                              'list_item'];
BEGIN
    PERFORM public._require_menu('products');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS' USING ERRCODE = '22023';
    END IF;
    v_new := jsonb_populate_record(NULL::public.products, p_data);
    IF COALESCE(p_initial_qty, 0) < 0 THEN
        RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_initial_qty, 0) > 0 AND COALESCE(v_new.item_type, 'QUANTITY') = 'SERIALIZED' THEN
        RAISE EXCEPTION 'SERIALIZED_STOCK_VIA_UNITS: use product_unit_register' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.units u WHERE u.id = v_new.unit_id AND u.active) THEN
        RAISE EXCEPTION 'UNIT_REQUIRED: pick an active unit' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.products p WHERE lower(btrim(p.name)) = lower(btrim(v_new.name)))
       AND NOT COALESCE(p_confirm_duplicate, false) THEN
        RAISE EXCEPTION 'DUPLICATE_PRODUCT_NAME' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.products (sku, name, category_id, item_type, unit_id, calculation_type, sale_price, rental_price,
                                 reorder_point, can_sell, can_rent, is_accessory, is_rent_chargeable, requires_return,
                                 default_damage_fee, default_loss_fee, list_item, created_by)
    VALUES (btrim(v_new.sku), btrim(v_new.name), v_new.category_id, COALESCE(v_new.item_type, 'QUANTITY'), v_new.unit_id,
            COALESCE(v_new.calculation_type, 'PER_UNIT'), v_new.sale_price, v_new.rental_price,
            COALESCE(v_new.reorder_point, 0), COALESCE(v_new.can_sell, false), COALESCE(v_new.can_rent, false),
            COALESCE(v_new.is_accessory, false), COALESCE(v_new.is_rent_chargeable, true),
            COALESCE(v_new.requires_return, true), COALESCE(v_new.default_damage_fee, 0),
            COALESCE(v_new.default_loss_fee, 0), NULLIF(btrim(v_new.list_item), ''), auth.uid())
    RETURNING * INTO v_new;

    IF p_cost_price IS NOT NULL THEN
        INSERT INTO public.product_costs (product_id, cost_price, updated_by) VALUES (v_new.id, p_cost_price, auth.uid());
    END IF;
    IF COALESCE(p_initial_qty, 0) > 0 THEN
        PERFORM public._require_pin(p_pin_token, 'STOCK_RECEIVE');
        PERFORM public._stock_move(v_new.id, NULL, 'AVAILABLE', p_initial_qty, 'INITIAL', 'PRODUCT', v_new.id,
                                   NULL, 'initial stock', v_corr);
    END IF;

    PERFORM public._audit('PRODUCT_CREATE', 'PRODUCT', v_new.id, NULL,
                          to_jsonb(v_new) || jsonb_build_object('initial_qty', p_initial_qty, 'cost_set', p_cost_price IS NOT NULL),
                          NULL, v_corr, false, NULL, NULLIF(p_initial_qty, 0));
    RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.product_update(p_product_id uuid, p_data jsonb, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old     public.products%ROWTYPE;
    v_new     public.products%ROWTYPE;
    v_allowed text[] := ARRAY['sku', 'name', 'category_id', 'item_type', 'unit_id', 'calculation_type',
                              'reorder_point', 'can_sell', 'can_rent', 'is_accessory', 'is_rent_chargeable',
                              'requires_return', 'default_damage_fee', 'default_loss_fee', 'list_item'];
BEGIN
    PERFORM public._require_menu('products');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_data, '{}'::jsonb)) k WHERE k <> ALL (v_allowed)) THEN
        RAISE EXCEPTION 'UNKNOWN_FIELDS: prices use product_set_price, cost uses product_set_cost' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_old FROM public.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_new := jsonb_populate_record(v_old, p_data);
    IF v_new.item_type <> v_old.item_type AND EXISTS (SELECT 1 FROM public.stock_movements WHERE product_id = p_product_id) THEN
        RAISE EXCEPTION 'ITEM_TYPE_LOCKED: product has stock history' USING ERRCODE = '23514';
    END IF;
    IF v_new.unit_id IS DISTINCT FROM v_old.unit_id
       AND NOT EXISTS (SELECT 1 FROM public.units u WHERE u.id = v_new.unit_id AND u.active) THEN
        RAISE EXCEPTION 'UNIT_REQUIRED: pick an active unit' USING ERRCODE = '22023';
    END IF;

    UPDATE public.products
       SET sku = btrim(v_new.sku), name = btrim(v_new.name), category_id = v_new.category_id,
           item_type = v_new.item_type, unit_id = v_new.unit_id, calculation_type = v_new.calculation_type,
           reorder_point = v_new.reorder_point, can_sell = v_new.can_sell, can_rent = v_new.can_rent,
           is_accessory = v_new.is_accessory, is_rent_chargeable = v_new.is_rent_chargeable,
           requires_return = v_new.requires_return, default_damage_fee = v_new.default_damage_fee,
           default_loss_fee = v_new.default_loss_fee, list_item = NULLIF(btrim(v_new.list_item), ''),
           updated_by = auth.uid()
     WHERE id = p_product_id
    RETURNING * INTO v_new;

    PERFORM public._audit('PRODUCT_UPDATE', 'PRODUCT', p_product_id, to_jsonb(v_old), to_jsonb(v_new), p_reason, NULL);
    RETURN to_jsonb(v_new);
END;
$$;
