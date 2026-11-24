-- Rule tests for supabase/migrations/20261121110000_line_catalog_v1.sql (owner 2026-11-21):
-- nothing is in the LINE product list until the owner ticks it; a switched-off product never shows; the price only
-- when the owner allows it; a person never gets cost, stock, SKU or fees; only the owner ticks; only the webhook reads.
-- Runs after 67_line_people_registration.sql.
\set ON_ERROR_STOP 1

-- test data made directly (as the database owner): two categories, four products
INSERT INTO public.product_categories (id, name, created_by)
VALUES ('00000000-0000-4000-8000-0000000c0a01', 'หมวดทดสอบ ไลน์ ก', t.u('owner')),
       ('00000000-0000-4000-8000-0000000c0a02', 'หมวดทดสอบ ไลน์ ข', t.u('owner'));
INSERT INTO public.products (id, sku, name, category_id, unit_id, can_rent, rental_price, can_sell, sale_price, calculation_type, created_by)
SELECT v.id::uuid, v.sku, v.name, v.cat::uuid, (SELECT id FROM public.units ORDER BY created_at LIMIT 1), v.can_rent, v.rent, v.can_sell, v.sale, v.calc, t.u('owner')
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000b0a01', 'LCAT-A1', 'ไม้แบบทดสอบ A1', '00000000-0000-4000-8000-0000000c0a01', true,  12.50::numeric, false, NULL::numeric, 'PER_DAY'),
    ('00000000-0000-4000-8000-0000000b0a02', 'LCAT-A2', 'ไม้แบบทดสอบ A2', '00000000-0000-4000-8000-0000000c0a01', false, NULL::numeric, true,  300::numeric,  'PER_UNIT'),
    ('00000000-0000-4000-8000-0000000b0a03', 'LCAT-A3', 'ไม้แบบทดสอบ A3', '00000000-0000-4000-8000-0000000c0a01', true,  8::numeric,    true,  90::numeric,   'PER_UNIT'),
    ('00000000-0000-4000-8000-0000000b0b01', 'LCAT-B1', 'นั่งร้านทดสอบ B1', '00000000-0000-4000-8000-0000000c0a02', true,  40::numeric,   false, NULL::numeric, 'PER_PERIOD')
  ) AS v(id, sku, name, cat, can_rent, rent, can_sell, sale, calc);
INSERT INTO public.product_costs (product_id, cost_price, updated_by)
SELECT id, 5, t.u('owner') FROM public.products WHERE sku LIKE 'LCAT-%';

-- 1. nothing is shown by default
SELECT t.check('CATALOG', 'a new category and product are hidden from LINE',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_catalog_categories()) c WHERE c ->> 'name' LIKE 'หมวดทดสอบ ไลน์%'));
SELECT t.check('CATALOG', 'a product that was not ticked has no name to read',
    public.line_catalog_item('00000000-0000-4000-8000-0000000b0a01') IS NULL);
SELECT t.check('CATALOG', 'a category that was not ticked has no page', public.line_catalog_items('00000000-0000-4000-8000-0000000c0a01') IS NULL);

-- 2. only the owner ticks; the app roles cannot read the list; nobody signed out reads anything
SELECT t.err('CATALOG', 'a member who is not the owner cannot tick', 'cashier',
    $q$select public.line_catalog_set('CATEGORY', '00000000-0000-4000-8000-0000000c0a01', true)$q$, 'OWNER only');
SELECT t.err('CATALOG', 'a member cannot read the owner list', 'cashier', $q$select public.line_catalog_admin()$q$, 'OWNER only');
SELECT t.err('CATALOG', 'a signed-in browser cannot read the LINE list', 'owner', $q$select public.line_catalog_categories()$q$, 'permission denied');
SELECT t.err('CATALOG', '... nor one category', 'owner', $q$select public.line_catalog_items('00000000-0000-4000-8000-0000000c0a01')$q$, 'permission denied');
SELECT t.err('CATALOG', '... nor one product', 'owner', $q$select public.line_catalog_item('00000000-0000-4000-8000-0000000b0a01')$q$, 'permission denied');
SELECT t.err('CATALOG', 'nobody signed out can tick', 'owner', $q$select public.line_catalog_set('CATEGORY', '00000000-0000-4000-8000-0000000c0a01', true)$q$, 'permission denied', 'anon');
SELECT t.err('CATALOG', 'a wrong kind is refused', 'owner', $q$select public.line_catalog_set('EVERYTHING', '00000000-0000-4000-8000-0000000c0a01', true)$q$, 'LINE_CATALOG_INVALID');
SELECT t.err('CATALOG', 'a missing id is refused', 'owner', $q$select public.line_catalog_set('PRODUCT', '00000000-0000-4000-8000-00000000dead', true)$q$, 'LINE_CATALOG_NOT_FOUND');

-- 3. ticking a category alone shows nothing (no product ticked); then the products
SELECT t.ok('CATALOG', 'the owner ticks category A', 'owner', $q$select public.line_catalog_set('CATEGORY', '00000000-0000-4000-8000-0000000c0a01', true, 2)$q$);
SELECT t.check('CATALOG', 'a ticked category with no ticked product is not offered',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_catalog_categories()) c WHERE c ->> 'name' = 'หมวดทดสอบ ไลน์ ก'));
SELECT t.ok('CATALOG', 'the owner ticks product A1 and A2', 'owner', $q$select public.line_catalog_set('PRODUCT', '00000000-0000-4000-8000-0000000b0a01', true)$q$);
SELECT t.ok('CATALOG', '... A2', 'owner', $q$select public.line_catalog_set('PRODUCT', '00000000-0000-4000-8000-0000000b0a02', true)$q$);
SELECT t.check('CATALOG', 'now category A is offered, with 2 products',
    (SELECT (c ->> 'count')::int = 2 FROM jsonb_array_elements(public.line_catalog_categories()) c WHERE c ->> 'name' = 'หมวดทดสอบ ไลน์ ก'));
SELECT t.check('CATALOG', 'the page lists the two products by name and unit, without any price (switch is off)',
    (SELECT (r ->> 'total')::int = 2 AND (r ->> 'show_price') = 'false'
            AND jsonb_array_length(r -> 'items') = 2
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'items') i WHERE i ? 'rental_price' OR i ? 'sale_price' OR i ? 'per')
       FROM (SELECT public.line_catalog_items('00000000-0000-4000-8000-0000000c0a01') AS r) x));

-- 4. a person never gets more than id / name / unit / price
SELECT t.check('CATALOG', 'an item carries only id, name, unit (never sku, cost, stock, fees, flags)',
    (SELECT bool_and(k.key IN ('id', 'name', 'unit', 'rental_price', 'sale_price', 'per'))
       FROM jsonb_array_elements(public.line_catalog_items('00000000-0000-4000-8000-0000000c0a01') -> 'items') i, jsonb_each(i) k));
SELECT t.check('CATALOG', 'the one-product answer has only id and name',
    (SELECT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k) = ARRAY['id', 'name']
       FROM (SELECT public.line_catalog_item('00000000-0000-4000-8000-0000000b0a01') AS r) x));

-- 5. the price only when the owner allows it, and only the price the product can have
UPDATE public.store_settings SET policies = jsonb_set(coalesce(policies, '{}'::jsonb), '{line,catalog}', '{"showPrice":true}'::jsonb, true);
SELECT t.ok('CATALOG', 'the owner ticks A3 (rent and sale)', 'owner', $q$select public.line_catalog_set('PRODUCT', '00000000-0000-4000-8000-0000000b0a03', true)$q$);
SELECT t.check('CATALOG', 'prices on: rental only for a rental product, sale only for a sale product, both for both',
    (SELECT bool_and(CASE i ->> 'name'
                       WHEN 'ไม้แบบทดสอบ A1' THEN (i ->> 'rental_price')::numeric = 12.5 AND NOT (i ? 'sale_price') AND i ->> 'per' = 'PER_DAY'
                       WHEN 'ไม้แบบทดสอบ A2' THEN (i ->> 'sale_price')::numeric = 300 AND NOT (i ? 'rental_price')
                       WHEN 'ไม้แบบทดสอบ A3' THEN (i ->> 'rental_price')::numeric = 8 AND (i ->> 'sale_price')::numeric = 90
                       ELSE false END)
       FROM jsonb_array_elements(public.line_catalog_items('00000000-0000-4000-8000-0000000c0a01') -> 'items') i));
SELECT t.err_admin('CATALOG', 'an unknown catalog key is refused',
    $q$update public.store_settings set policies = jsonb_set(coalesce(policies, '{}'::jsonb), '{line,catalog}', '{"hello":true}'::jsonb, true)$q$,
    'INVALID_POLICY: line.catalog.hello');
SELECT t.err_admin('CATALOG', 'a non-boolean showPrice is refused',
    $q$update public.store_settings set policies = jsonb_set(coalesce(policies, '{}'::jsonb), '{line,catalog}', '{"showPrice":"yes"}'::jsonb, true)$q$,
    'INVALID_POLICY: line.catalog.showPrice');
UPDATE public.store_settings SET policies = policies #- '{line,catalog}';
SELECT t.check('CATALOG', 'price switch removed: hidden again',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_catalog_items('00000000-0000-4000-8000-0000000c0a01') -> 'items') i WHERE i ? 'rental_price' OR i ? 'sale_price'));

-- 6. a product the shop switched off disappears even though it is ticked; an unticked one stays out
UPDATE public.products SET active = false WHERE id = '00000000-0000-4000-8000-0000000b0a02';
SELECT t.check('CATALOG', 'a switched-off product leaves the list (and has no name to read)',
    (public.line_catalog_items('00000000-0000-4000-8000-0000000c0a01') ->> 'total')::int = 2
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_catalog_items('00000000-0000-4000-8000-0000000c0a01') -> 'items') i WHERE i ->> 'name' = 'ไม้แบบทดสอบ A2'));
SELECT t.check('CATALOG', '... one-product answer is null for it', public.line_catalog_item('00000000-0000-4000-8000-0000000b0a02') IS NULL);
UPDATE public.products SET active = true WHERE id = '00000000-0000-4000-8000-0000000b0a02';

-- 7. a product ticked in a category the owner did not tick stays out; the whole category at once; order
SELECT t.ok('CATALOG', 'the owner ticks product B1 only', 'owner', $q$select public.line_catalog_set('PRODUCT', '00000000-0000-4000-8000-0000000b0b01', true)$q$);
SELECT t.check('CATALOG', 'category B is not ticked: not offered, product B1 has no name to read',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_catalog_categories()) c WHERE c ->> 'name' = 'หมวดทดสอบ ไลน์ ข')
    AND public.line_catalog_item('00000000-0000-4000-8000-0000000b0b01') IS NULL);
SELECT t.ok('CATALOG', 'the owner ticks category B in first place', 'owner', $q$select public.line_catalog_set('CATEGORY', '00000000-0000-4000-8000-0000000c0a02', true, 1)$q$);
SELECT t.check('CATALOG', 'categories come in the owner''s order (B = 1 before A = 2)',
    (SELECT array_position(array_agg(c ->> 'name' ORDER BY ord), 'หมวดทดสอบ ไลน์ ข') < array_position(array_agg(c ->> 'name' ORDER BY ord), 'หมวดทดสอบ ไลน์ ก')
       FROM jsonb_array_elements(public.line_catalog_categories()) WITH ORDINALITY AS t2(c, ord)
      WHERE c ->> 'name' LIKE 'หมวดทดสอบ ไลน์%'));
SELECT t.check('CATALOG', 'the whole category un-ticked at once: every product of A leaves the list',
    (t.ok('CATALOG', 'untick all of A', 'owner', $q$select public.line_catalog_set('CATEGORY_PRODUCTS', '00000000-0000-4000-8000-0000000c0a01', false)$q$) ->> 'rows')::int = 3);
SELECT t.check('CATALOG', '... and category A is no longer offered (it has nothing to show)',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_catalog_categories()) c WHERE c ->> 'name' = 'หมวดทดสอบ ไลน์ ก'));

-- 8. a product without a category cannot be ticked
INSERT INTO public.products (id, sku, name, category_id, unit_id, can_sell, sale_price, created_by)
SELECT '00000000-0000-4000-8000-0000000b0c01', 'LCAT-C1', 'ไม่มีหมวด ทดสอบ', NULL, (SELECT id FROM public.units ORDER BY created_at LIMIT 1), true, 10, t.u('owner');
SELECT t.err('CATALOG', 'a product with no category has nowhere to be shown', 'owner',
    $q$select public.line_catalog_set('PRODUCT', '00000000-0000-4000-8000-0000000b0c01', true)$q$, 'LINE_CATALOG_NOT_FOUND');

-- 9. pages of ten, and the owner's list (owner only) carries the ticks
INSERT INTO public.products (sku, name, category_id, unit_id, can_sell, sale_price, line_listed, created_by)
SELECT 'LCAT-P' || n, 'รายการหน้าทดสอบ ' || lpad(n::text, 2, '0'), '00000000-0000-4000-8000-0000000c0a02', (SELECT id FROM public.units ORDER BY created_at LIMIT 1), true, 1, true, t.u('owner')
  FROM generate_series(1, 12) AS n;
SELECT t.check('CATALOG', 'a page is ten products; the next page has the rest; the total is the same',
    (SELECT jsonb_array_length(a -> 'items') = 10 AND (a ->> 'total')::int = 13 AND jsonb_array_length(b -> 'items') = 3
       FROM (SELECT public.line_catalog_items('00000000-0000-4000-8000-0000000c0a02', 0) AS a, public.line_catalog_items('00000000-0000-4000-8000-0000000c0a02', 10) AS b) x));
SELECT t.check('CATALOG', 'the owner list has every category with its products and the ticks',
    (SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'categories') c WHERE c ->> 'name' = 'หมวดทดสอบ ไลน์ ข' AND (c ->> 'line_listed')::boolean AND jsonb_array_length(c -> 'products') = 13)
       FROM (SELECT t.exec_as(t.u('owner'), 'authenticated', 'select public.line_catalog_admin()') AS r) x));
SELECT t.check('CATALOG', 'the owner list carries no cost',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.exec_as(t.u('owner'), 'authenticated', 'select public.line_catalog_admin()') -> 'categories') c,
                              jsonb_array_elements(c -> 'products') p, jsonb_object_keys(p) k WHERE k ILIKE '%cost%'));
SELECT t.check('CATALOG', 'the ticks are in the audit trail',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'LINE_CATALOG_SET'));
