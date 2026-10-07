-- 43 real products from 011_seed_production_master_products (1).sql (owner decision 2026-10-03/04).
-- Name + rental price only; stock starts at 0 and is counted in later (no stock movement here).
-- Units (owner 2026-10-04): แบบคาน แผ่น, แบบเสา ต้น, นั่งร้าน ชุด, น็อต ตัว, ครอบ ตัว, ข้อต่อ ชุด, กากบาท คู่.
-- BK-023 stays "แบบคาน 40x3.76" price 80 exactly as in the source file.
-- Pricing: NORMAL (per round) → PER_PERIOD, DAILY → PER_DAY. Accessories are tracked but not
-- rent-charged (is_rent_chargeable = false) and must be returned. Default damage / loss fees
-- are 0 because the source file has none; set them per product later.
-- Run as postgres / service_role AFTER the baseline and after an OWNER exists. Idempotent.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'OWNER' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'OWNER_REQUIRED: bootstrap the owner before loading products';
    END IF;
END $$;

CREATE TEMP TABLE seed_owner ON COMMIT DROP AS
SELECT id FROM public.profiles WHERE role = 'OWNER' AND status = 'ACTIVE' ORDER BY created_at LIMIT 1;

INSERT INTO public.units (name, sort_order, created_by)
SELECT u.name, u.ord, (SELECT id FROM seed_owner)
  FROM (VALUES ('แผ่น', 1), ('ต้น', 2), ('ชุด', 3), ('ตัว', 4), ('คู่', 5)) AS u(name, ord)
 WHERE NOT EXISTS (SELECT 1 FROM public.units x WHERE lower(x.name) = lower(u.name));

INSERT INTO public.product_categories (name, created_by)
SELECT c.name, (SELECT id FROM seed_owner)
  FROM (VALUES ('แบบคาน'), ('แบบเสา'), ('นั่งร้าน/อุปกรณ์'), ('อุปกรณ์เสริม')) AS c(name)
 WHERE NOT EXISTS (SELECT 1 FROM public.product_categories x WHERE lower(x.name) = lower(c.name));

INSERT INTO public.products (sku, name, category_id, item_type, unit_id, calculation_type, rental_price,
                             can_sell, can_rent, is_accessory, is_rent_chargeable, requires_return, created_by)
SELECT p.sku, p.name,
       (SELECT id FROM public.product_categories WHERE name = p.category),
       'QUANTITY',
       (SELECT id FROM public.units WHERE name = p.unit),
       p.calc, p.price, false, true, p.is_accessory, p.chargeable, p.requires_return,
       (SELECT id FROM seed_owner)
  FROM (VALUES
    ('BK-001', 'แบบคาน 40x0.50', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 10.00, false, true, true),
    ('BK-002', 'แบบคาน 40x0.70', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 14.00, false, true, true),
    ('BK-003', 'แบบคาน 40x0.75', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 15.00, false, true, true),
    ('BK-004', 'แบบคาน 40x0.80', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 16.00, false, true, true),
    ('BK-005', 'แบบคาน 40x1.00', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 20.00, false, true, true),
    ('BK-006', 'แบบคาน 40x1.20', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 24.00, false, true, true),
    ('BK-007', 'แบบคาน 40x1.25', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 25.00, false, true, true),
    ('BK-008', 'แบบคาน 40x1.30', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 26.00, false, true, true),
    ('BK-009', 'แบบคาน 40x1.50', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 30.00, false, true, true),
    ('BK-010', 'แบบคาน 40x1.60', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 32.00, false, true, true),
    ('BK-011', 'แบบคาน 40x1.75', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 35.00, false, true, true),
    ('BK-012', 'แบบคาน 40x1.80', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 36.00, false, true, true),
    ('BK-013', 'แบบคาน 40x2.00', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 40.00, false, true, true),
    ('BK-014', 'แบบคาน 40x2.20', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 44.00, false, true, true),
    ('BK-015', 'แบบคาน 40x2.25', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 45.00, false, true, true),
    ('BK-016', 'แบบคาน 40x2.50', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 50.00, false, true, true),
    ('BK-017', 'แบบคาน 40x2.75', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 55.00, false, true, true),
    ('BK-018', 'แบบคาน 40x3.00', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 60.00, false, true, true),
    ('BK-019', 'แบบคาน 40x3.25', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 65.00, false, true, true),
    ('BK-020', 'แบบคาน 40x3.50', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 70.00, false, true, true),
    ('BK-021', 'แบบคาน 40x3.60', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 72.00, false, true, true),
    ('BK-022', 'แบบคาน 40x3.75', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 75.00, false, true, true),
    ('BK-023', 'แบบคาน 40x3.76', 'แบบคาน', 'แผ่น', 'PER_PERIOD', 80.00, false, true, true),
    ('BS-001', 'แบบเสา 15x15x2.00', 'แบบเสา', 'ต้น', 'PER_PERIOD', 80.00, false, true, true),
    ('BS-002', 'แบบเสา 15x15x3.00', 'แบบเสา', 'ต้น', 'PER_PERIOD', 100.00, false, true, true),
    ('BS-003', 'แบบเสา 20x20x1.00', 'แบบเสา', 'ต้น', 'PER_PERIOD', 60.00, false, true, true),
    ('BS-004', 'แบบเสา 20x20x1.50', 'แบบเสา', 'ต้น', 'PER_PERIOD', 80.00, false, true, true),
    ('BS-005', 'แบบเสา 20x20x2.00', 'แบบเสา', 'ต้น', 'PER_PERIOD', 90.00, false, true, true),
    ('BS-006', 'แบบเสา 20x20x3.00', 'แบบเสา', 'ต้น', 'PER_PERIOD', 100.00, false, true, true),
    ('BS-007', 'แบบเสา 20x20x3.50', 'แบบเสา', 'ต้น', 'PER_PERIOD', 150.00, false, true, true),
    ('BS-008', 'แบบเสา 25x25x1.50', 'แบบเสา', 'ต้น', 'PER_PERIOD', 90.00, false, true, true),
    ('BS-009', 'แบบเสา 25x25x2.00', 'แบบเสา', 'ต้น', 'PER_PERIOD', 100.00, false, true, true),
    ('BS-010', 'แบบเสา 25x25x3.00', 'แบบเสา', 'ต้น', 'PER_PERIOD', 160.00, false, true, true),
    ('NR-001', 'นั่งร้าน 1.70(ชุด)', 'นั่งร้าน/อุปกรณ์', 'ชุด', 'PER_DAY', 15.00, false, true, true),
    ('NR-002', 'ล้อ 6นิ้ว', 'นั่งร้าน/อุปกรณ์', 'ชุด', 'PER_DAY', 20.00, false, true, true),
    ('NR-003', 'ล้อ 8นิ้ว', 'นั่งร้าน/อุปกรณ์', 'ชุด', 'PER_DAY', 20.00, false, true, true),
    ('NR-004', 'ขาปรับระดับ', 'นั่งร้าน/อุปกรณ์', 'ชุด', 'PER_DAY', 20.00, false, true, true),
    ('ACC-NUT-0410', 'น็อต 4/10"', 'อุปกรณ์เสริม', 'ตัว', 'PER_DAY', 0.00, true, false, true),
    ('ACC-NUT-0414', 'น็อต 4/14"', 'อุปกรณ์เสริม', 'ตัว', 'PER_DAY', 0.00, true, false, true),
    ('ACC-NUT-0401', 'น็อต 4/1"', 'อุปกรณ์เสริม', 'ตัว', 'PER_DAY', 0.00, true, false, true),
    ('ACC-CROSS', 'กากบาท', 'อุปกรณ์เสริม', 'คู่', 'PER_DAY', 0.00, true, false, true),
    ('ACC-CAP', 'ครอบนั่งร้าน', 'อุปกรณ์เสริม', 'ตัว', 'PER_DAY', 0.00, true, false, true),
    ('ACC-JOINT', 'ข้อต่อ', 'อุปกรณ์เสริม', 'ชุด', 'PER_DAY', 0.00, true, false, true)
  ) AS p(sku, name, category, unit, calc, price, is_accessory, chargeable, requires_return)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, after_data, reason, correlation_id)
SELECT NULL, 'PRODUCT_SEED', 'PRODUCT', NULL,
       jsonb_build_object('products', (SELECT count(*) FROM public.products)), 'initial 43 products', gen_random_uuid();

COMMIT;
