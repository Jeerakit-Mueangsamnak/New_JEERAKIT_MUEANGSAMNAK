-- ============================================================================
-- LINE product list for anyone who adds the OA (owner 2026-11-21, phase 3)
--
-- Nothing is shown by default. The OWNER ticks which categories and which products appear in LINE
-- (products.line_listed, product_categories.line_listed); a product the shop switched off (active = false) never
-- appears even if ticked. The price is hidden until policies.line.catalog.showPrice is switched on.
-- What a person in LINE can read is only: category name, product name (the size is in the name), unit and, when
-- the owner allows it, the sale / rental price. Never cost, stock, SKU, fees or anything else.
-- The product list is read through service_role functions called by the webhook; a signed-in browser cannot
-- call them, and the owner changes the ticks through line_catalog_set only.
-- ============================================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS line_listed boolean NOT NULL DEFAULT false;
ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS line_listed boolean NOT NULL DEFAULT false;
ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS line_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS products_line_listed_idx ON public.products (category_id) WHERE line_listed AND active;

-- ----------------------------------------------------------------------------
-- 1. What the person can read (service_role only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.line_catalog_categories()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._line_require_server();
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'count', n.cnt) ORDER BY c.line_order, lower(c.name))
          FROM public.product_categories c
          JOIN LATERAL (SELECT count(*) AS cnt FROM public.products p
                         WHERE p.category_id = c.id AND p.line_listed AND p.active) n ON n.cnt > 0
         WHERE c.line_listed AND c.active), '[]'::jsonb);
END;
$$;

-- One page (10) of a category: { category, show_price, total, items[] } or null when the category is not shown.
CREATE OR REPLACE FUNCTION public.line_catalog_items(p_category uuid, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cat   public.product_categories%ROWTYPE;
    v_price boolean := COALESCE((public._policy('line', '{}'::jsonb) -> 'catalog' ->> 'showPrice')::boolean, false);
    v_off   integer := greatest(COALESCE(p_offset, 0), 0);
BEGIN
    PERFORM public._line_require_server();
    SELECT * INTO v_cat FROM public.product_categories WHERE id = p_category AND line_listed AND active;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    RETURN jsonb_build_object(
        'category', jsonb_build_object('id', v_cat.id, 'name', v_cat.name),
        'show_price', v_price,
        'total', (SELECT count(*) FROM public.products p WHERE p.category_id = v_cat.id AND p.line_listed AND p.active),
        'items', COALESCE((
            SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                       'id', x.id, 'name', x.name, 'unit', x.unit,
                       'rental_price', CASE WHEN v_price AND x.can_rent THEN x.rental_price END,
                       'sale_price',   CASE WHEN v_price AND x.can_sell THEN x.sale_price END,
                       'per',          CASE WHEN v_price AND x.can_rent THEN x.calculation_type END)) ORDER BY x.name)
              FROM (SELECT p.id, p.name, u.name AS unit, p.can_rent, p.can_sell, p.rental_price, p.sale_price, p.calculation_type
                      FROM public.products p LEFT JOIN public.units u ON u.id = p.unit_id
                     WHERE p.category_id = v_cat.id AND p.line_listed AND p.active
                     ORDER BY p.name LIMIT 10 OFFSET v_off) x), '[]'::jsonb));
END;
$$;

-- The name of ONE shown product (for the shop's chat line "สอบถามราคา: …"); null for anything not shown.
CREATE OR REPLACE FUNCTION public.line_catalog_item(p_product uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._line_require_server();
    RETURN (SELECT jsonb_build_object('id', p.id, 'name', p.name)
              FROM public.products p JOIN public.product_categories c ON c.id = p.category_id
             WHERE p.id = p_product AND p.line_listed AND p.active AND c.line_listed AND c.active);
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. The owner's ticks (authenticated, OWNER only)
-- ----------------------------------------------------------------------------
-- Every category with its products, as the owner needs them to choose (the owner already sees prices; no cost).
CREATE OR REPLACE FUNCTION public.line_catalog_admin()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_owner();
    RETURN jsonb_build_object(
        'show_price', COALESCE((public._policy('line', '{}'::jsonb) -> 'catalog' ->> 'showPrice')::boolean, false),
        'categories', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', c.id, 'name', c.name, 'active', c.active, 'line_listed', c.line_listed, 'line_order', c.line_order,
                       'products', COALESCE((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'id', p.id, 'name', p.name, 'active', p.active, 'line_listed', p.line_listed,
                                      'can_sell', p.can_sell, 'can_rent', p.can_rent, 'sale_price', p.sale_price, 'rental_price', p.rental_price,
                                      'unit', u.name) ORDER BY p.name)
                             FROM public.products p LEFT JOIN public.units u ON u.id = p.unit_id
                            WHERE p.category_id = c.id), '[]'::jsonb)) ORDER BY c.line_order, lower(c.name))
              FROM public.product_categories c), '[]'::jsonb));
END;
$$;

-- p_kind: CATEGORY (tick one category, optionally its order), PRODUCT (tick one product),
--         CATEGORY_PRODUCTS (tick or untick every product of one category at once)
CREATE OR REPLACE FUNCTION public.line_catalog_set(p_kind text, p_id uuid, p_listed boolean, p_order integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_n integer := 0;
BEGIN
    PERFORM public._require_owner();
    IF p_listed IS NULL OR p_kind NOT IN ('CATEGORY', 'PRODUCT', 'CATEGORY_PRODUCTS') THEN
        RAISE EXCEPTION 'LINE_CATALOG_INVALID' USING ERRCODE = '22023';
    END IF;
    IF p_order IS NOT NULL AND p_order NOT BETWEEN 0 AND 9999 THEN
        RAISE EXCEPTION 'LINE_CATALOG_INVALID' USING ERRCODE = '22023';
    END IF;
    IF p_kind = 'CATEGORY' THEN
        UPDATE public.product_categories SET line_listed = p_listed, line_order = COALESCE(p_order, line_order), updated_at = now()
         WHERE id = p_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
    ELSIF p_kind = 'PRODUCT' THEN
        -- a product with no category has nowhere to be shown
        UPDATE public.products SET line_listed = p_listed WHERE id = p_id AND category_id IS NOT NULL;
        GET DIAGNOSTICS v_n = ROW_COUNT;
    ELSE
        UPDATE public.products SET line_listed = p_listed WHERE category_id = p_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'LINE_CATALOG_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public._audit_line(auth.uid(), 'LINE_CATALOG_SET', 'LINE_CATALOG', p_id,
                               jsonb_build_object('kind', p_kind, 'listed', p_listed, 'order', p_order, 'rows', v_n));
    RETURN jsonb_build_object('kind', p_kind, 'id', p_id, 'listed', p_listed, 'rows', v_n);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
    public.line_catalog_categories(),
    public.line_catalog_items(uuid, integer),
    public.line_catalog_item(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.line_catalog_categories(),
    public.line_catalog_items(uuid, integer),
    public.line_catalog_item(uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.line_catalog_admin(), public.line_catalog_set(text, uuid, boolean, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.line_catalog_admin(), public.line_catalog_set(text, uuid, boolean, integer) TO authenticated;
