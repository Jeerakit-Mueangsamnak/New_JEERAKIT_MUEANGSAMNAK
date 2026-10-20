-- Migration 011: Production Master Data & 43 Product Catalog Bootstrap Function
-- Provides an idempotent, runtime-safe procedure to initialize a new business with master data and standard products without hardcoding runtime UUIDs.

CREATE OR REPLACE FUNCTION public.bootstrap_business_master_data(
  p_business_id UUID,
  p_owner_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_cat_beam UUID;
  v_cat_column UUID;
  v_cat_scaffold UUID;
  v_cat_acc UUID;

  v_unit_sheet UUID;
  v_unit_pole UUID;
  v_unit_set UUID;
  v_unit_piece UUID;
  v_unit_item UUID;
  v_unit_unit UUID;
  v_unit_meter UUID;

  v_rt_normal UUID;
  v_rt_daily UUID;
  v_rt_weekly UUID;
  v_rt_monthly UUID;
  v_rt_custom UUID;

  v_prod_id UUID;
BEGIN
  -- 1. Initialize Master Categories
  INSERT INTO public.product_categories (business_id, owner_id, name, description, sort_order)
  VALUES (p_business_id, p_owner_id, 'แบบคาน', 'แบบเหล็กหล่อคาน', 1)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_cat_beam FROM public.product_categories WHERE business_id = p_business_id AND name = 'แบบคาน' LIMIT 1;

  INSERT INTO public.product_categories (business_id, owner_id, name, description, sort_order)
  VALUES (p_business_id, p_owner_id, 'แบบเสา', 'แบบเหล็กหล่อเสา', 2)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_cat_column FROM public.product_categories WHERE business_id = p_business_id AND name = 'แบบเสา' LIMIT 1;

  INSERT INTO public.product_categories (business_id, owner_id, name, description, sort_order)
  VALUES (p_business_id, p_owner_id, 'นั่งร้าน/อุปกรณ์', 'ชุดนั่งร้านและอุปกรณ์ปรับระดับ', 3)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_cat_scaffold FROM public.product_categories WHERE business_id = p_business_id AND name = 'นั่งร้าน/อุปกรณ์' LIMIT 1;

  INSERT INTO public.product_categories (business_id, owner_id, name, description, sort_order)
  VALUES (p_business_id, p_owner_id, 'อุปกรณ์เสริม', 'น็อต กากบาท ครอบ และข้อต่อ', 4)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_cat_acc FROM public.product_categories WHERE business_id = p_business_id AND name = 'อุปกรณ์เสริม' LIMIT 1;

  -- 2. Initialize Master Units
  INSERT INTO public.units (business_id, owner_id, name, sort_order) VALUES (p_business_id, p_owner_id, 'แผ่น', 1) ON CONFLICT DO NOTHING;
  SELECT id INTO v_unit_sheet FROM public.units WHERE business_id = p_business_id AND name = 'แผ่น' LIMIT 1;

  INSERT INTO public.units (business_id, owner_id, name, sort_order) VALUES (p_business_id, p_owner_id, 'ต้น', 2) ON CONFLICT DO NOTHING;
  SELECT id INTO v_unit_pole FROM public.units WHERE business_id = p_business_id AND name = 'ต้น' LIMIT 1;

  INSERT INTO public.units (business_id, owner_id, name, sort_order) VALUES (p_business_id, p_owner_id, 'ชุด', 3) ON CONFLICT DO NOTHING;
  SELECT id INTO v_unit_set FROM public.units WHERE business_id = p_business_id AND name = 'ชุด' LIMIT 1;

  INSERT INTO public.units (business_id, owner_id, name, sort_order) VALUES (p_business_id, p_owner_id, 'ชิ้น', 4) ON CONFLICT DO NOTHING;
  SELECT id INTO v_unit_piece FROM public.units WHERE business_id = p_business_id AND name = 'ชิ้น' LIMIT 1;

  INSERT INTO public.units (business_id, owner_id, name, sort_order) VALUES (p_business_id, p_owner_id, 'ตัว', 5) ON CONFLICT DO NOTHING;
  SELECT id INTO v_unit_item FROM public.units WHERE business_id = p_business_id AND name = 'ตัว' LIMIT 1;

  INSERT INTO public.units (business_id, owner_id, name, sort_order) VALUES (p_business_id, p_owner_id, 'อัน', 6) ON CONFLICT DO NOTHING;
  SELECT id INTO v_unit_unit FROM public.units WHERE business_id = p_business_id AND name = 'อัน' LIMIT 1;

  INSERT INTO public.units (business_id, owner_id, name, sort_order) VALUES (p_business_id, p_owner_id, 'เมตร', 7) ON CONFLICT DO NOTHING;
  SELECT id INTO v_unit_meter FROM public.units WHERE business_id = p_business_id AND name = 'เมตร' LIMIT 1;

  -- 3. Initialize Rental Types
  INSERT INTO public.rental_types (business_id, code, name, calculation_formula, sort_order)
  VALUES (p_business_id, 'NORMAL', 'รอบ', 'จำนวนสินค้า × ราคาเช่าต่อรอบ', 1) ON CONFLICT DO NOTHING;
  SELECT id INTO v_rt_normal FROM public.rental_types WHERE business_id = p_business_id AND code = 'NORMAL' LIMIT 1;

  INSERT INTO public.rental_types (business_id, code, name, calculation_formula, sort_order)
  VALUES (p_business_id, 'DAILY', 'วัน', 'จำนวนสินค้า × ราคาเช่าต่อวัน × จำนวนวัน', 2) ON CONFLICT DO NOTHING;
  SELECT id INTO v_rt_daily FROM public.rental_types WHERE business_id = p_business_id AND code = 'DAILY' LIMIT 1;

  INSERT INTO public.rental_types (business_id, code, name, calculation_formula, sort_order)
  VALUES (p_business_id, 'WEEKLY', 'สัปดาห์', 'จำนวนสินค้า × ราคาเช่าต่อสัปดาห์ × จำนวนสัปดาห์', 3) ON CONFLICT DO NOTHING;
  SELECT id INTO v_rt_weekly FROM public.rental_types WHERE business_id = p_business_id AND code = 'WEEKLY' LIMIT 1;

  INSERT INTO public.rental_types (business_id, code, name, calculation_formula, sort_order)
  VALUES (p_business_id, 'MONTHLY', 'เดือน', 'จำนวนสินค้า × ราคาเช่าต่อเดือน × จำนวนเดือน', 4) ON CONFLICT DO NOTHING;
  SELECT id INTO v_rt_monthly FROM public.rental_types WHERE business_id = p_business_id AND code = 'MONTHLY' LIMIT 1;

  INSERT INTO public.rental_types (business_id, code, name, calculation_formula, sort_order)
  VALUES (p_business_id, 'CUSTOM', 'กำหนดเอง', 'กำหนดเอง', 5) ON CONFLICT DO NOTHING;
  SELECT id INTO v_rt_custom FROM public.rental_types WHERE business_id = p_business_id AND code = 'CUSTOM' LIMIT 1;

  -- 4. Initialize Appointment Types
  INSERT INTO public.appointment_types (business_id, code, name, sort_order) VALUES
    (p_business_id, 'DELIVERY', '🚚 นัดส่งสินค้า', 1),
    (p_business_id, 'RETURN', '🔄 นัดรับคืนสินค้า', 2),
    (p_business_id, 'PAYMENT', '💰 นัดชำระเงิน', 3),
    (p_business_id, 'CONTRACT', '📝 นัดทำสัญญา', 4),
    (p_business_id, 'QUOTATION', '📊 นัดติดตามใบเสนอราคา', 5),
    (p_business_id, 'INSPECTION', '🔍 นัดตรวจสินค้า', 6),
    (p_business_id, 'GENERAL', '📌 นัดหมายทั่วไป', 7)
  ON CONFLICT DO NOTHING;

  -- 5. Seed 43 Catalog Products (23 แบบคาน, 10 แบบเสา, 4 นั่งร้าน/อุปกรณ์, 6 อุปกรณ์เสริม)
  -- 5.1 หมวดหมู่: แบบคาน (23 รายการ)
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-001', 'แบบคาน 40x0.50', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 10, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-002', 'แบบคาน 40x0.70', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 14, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-003', 'แบบคาน 40x0.75', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 15, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-004', 'แบบคาน 40x0.80', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 16, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-005', 'แบบคาน 40x1.00', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 20, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-006', 'แบบคาน 40x1.20', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 24, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-007', 'แบบคาน 40x1.25', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 25, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-008', 'แบบคาน 40x1.30', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 26, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-009', 'แบบคาน 40x1.50', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 30, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-010', 'แบบคาน 40x1.60', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 32, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-011', 'แบบคาน 40x1.75', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 35, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-012', 'แบบคาน 40x1.80', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 36, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-013', 'แบบคาน 40x2.00', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 40, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-014', 'แบบคาน 40x2.20', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 44, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-015', 'แบบคาน 40x2.25', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 45, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-016', 'แบบคาน 40x2.50', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 50, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-017', 'แบบคาน 40x2.75', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 55, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-018', 'แบบคาน 40x3.00', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 60, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-019', 'แบบคาน 40x3.25', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 65, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-020', 'แบบคาน 40x3.50', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 70, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-021', 'แบบคาน 40x3.60', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 72, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-022', 'แบบคาน 40x3.75', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 75, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BK-023', 'แบบคาน 40x3.76', v_cat_beam, v_unit_sheet, 'NORMAL', v_rt_normal, 80, 0, false, true, true, 1);

  -- 5.2 หมวดหมู่: แบบเสา (10 รายการ)
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BS-001', 'แบบเสา 15x15x2.00', v_cat_column, v_unit_pole, 'NORMAL', v_rt_normal, 80, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BS-002', 'แบบเสา 15x15x3.00', v_cat_column, v_unit_pole, 'NORMAL', v_rt_normal, 100, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BS-003', 'แบบเสา 20x20x1.00', v_cat_column, v_unit_pole, 'NORMAL', v_rt_normal, 60, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BS-004', 'แบบเสา 20x20x1.50', v_cat_column, v_unit_pole, 'NORMAL', v_rt_normal, 80, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BS-005', 'แบบเสา 20x20x2.00', v_cat_column, v_unit_pole, 'NORMAL', v_rt_normal, 90, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BS-006', 'แบบเสา 20x20x3.00', v_cat_column, v_unit_pole, 'NORMAL', v_rt_normal, 100, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BS-007', 'แบบเสา 20x20x3.50', v_cat_column, v_unit_pole, 'NORMAL', v_rt_normal, 150, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BS-008', 'แบบเสา 25x25x1.50', v_cat_column, v_unit_pole, 'NORMAL', v_rt_normal, 90, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BS-009', 'แบบเสา 25x25x2.00', v_cat_column, v_unit_pole, 'NORMAL', v_rt_normal, 100, 0, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'BS-010', 'แบบเสา 25x25x3.00', v_cat_column, v_unit_pole, 'NORMAL', v_rt_normal, 160, 0, false, true, true, 1);

  -- 5.3 หมวดหมู่: นั่งร้าน/อุปกรณ์ (4 รายการ)
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'NR-001', 'นั่งร้าน 1.70(ชุด)', v_cat_scaffold, v_unit_set, 'DAILY', v_rt_daily, 0, 15, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'NR-002', 'ล้อ 6นิ้ว', v_cat_scaffold, v_unit_set, 'DAILY', v_rt_daily, 0, 20, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'NR-003', 'ล้อ 8นิ้ว', v_cat_scaffold, v_unit_set, 'DAILY', v_rt_daily, 0, 20, false, true, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'NR-004', 'ขาปรับระดับ', v_cat_scaffold, v_unit_set, 'DAILY', v_rt_daily, 0, 20, false, true, true, 1);

  -- 5.4 หมวดหมู่: อุปกรณ์เสริม (6 รายการ - ไม่คิดค่าเช่า, ติดตามสต็อกและการรับคืน)
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'ACC-NUT-0410', 'น็อต 4/10"', v_cat_acc, v_unit_item, 'DAILY', v_rt_daily, 0, 0, true, false, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'ACC-NUT-0414', 'น็อต 4/14"', v_cat_acc, v_unit_item, 'DAILY', v_rt_daily, 0, 0, true, false, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'ACC-NUT-0401', 'น็อต 4/1"', v_cat_acc, v_unit_item, 'DAILY', v_rt_daily, 0, 0, true, false, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'ACC-CROSS', 'กากบาท', v_cat_acc, v_unit_unit, 'DAILY', v_rt_daily, 0, 0, true, false, true, 2);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'ACC-CAP', 'ครอบนั่งร้าน', v_cat_acc, v_unit_unit, 'DAILY', v_rt_daily, 0, 0, true, false, true, 1);
  PERFORM public.fn_seed_single_product(p_business_id, p_owner_id, 'ACC-JOINT', 'ข้อต่อ', v_cat_acc, v_unit_unit, 'DAILY', v_rt_daily, 0, 0, true, false, true, 4);

END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Helper to seed single product + initial zero stock balance
CREATE OR REPLACE FUNCTION public.fn_seed_single_product(
  p_business_id UUID,
  p_owner_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_cat_id UUID,
  p_unit_id UUID,
  p_rental_type TEXT,
  p_rental_type_id UUID,
  p_normal_price NUMERIC,
  p_daily_price NUMERIC,
  p_is_accessory BOOLEAN,
  p_is_chargeable BOOLEAN,
  p_requires_return BOOLEAN,
  p_default_qty_per_set INT
)
RETURNS VOID AS $$
DECLARE
  v_pid UUID;
BEGIN
  INSERT INTO public.products (
    business_id,
    owner_id,
    product_code,
    product_name,
    category_id,
    unit_id,
    rental_type,
    rental_type_id,
    normal_price,
    daily_price,
    is_accessory,
    is_chargeable,
    requires_return,
    default_qty_per_set,
    total_quantity,
    minimum_quantity,
    is_active
  ) VALUES (
    p_business_id,
    p_owner_id,
    p_code,
    p_name,
    p_cat_id,
    p_unit_id,
    p_rental_type,
    p_rental_type_id,
    p_normal_price,
    p_daily_price,
    p_is_accessory,
    p_is_chargeable,
    p_requires_return,
    p_default_qty_per_set,
    0,
    0,
    true
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_pid;

  IF v_pid IS NULL THEN
    SELECT id INTO v_pid FROM public.products WHERE (business_id = p_business_id OR (business_id IS NULL AND p_business_id IS NULL)) AND product_code = p_code LIMIT 1;
  END IF;

  IF v_pid IS NOT NULL THEN
    INSERT INTO public.stock_balances (product_id, business_id, owner_id, available_qty, rented_qty, damaged_qty, lost_qty, reserved_qty)
    VALUES (v_pid, p_business_id, p_owner_id, 0, 0, 0, 0, 0)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
