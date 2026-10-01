# PROJECT RULES MASTER (CURRENT)

**STATUS:** CURRENT — Master Rules ของระบบ POS ขาย + เช่า + สต็อก + ลูกค้า + นัดหมาย + การเงิน + การควบคุม
**Architecture Business Rules:** LOCKED
**Version:** 4.1.0
**Last Updated:** 2026-10-01
**ฐานเนื้อหา:** `POS_MASTER_ALL_IN_ONE_COMPLETE_SPEC_TH.txt` (Master Spec) + คำตัดสินของเจ้าของระบบ + Architecture Decisions ที่ล็อกแล้ว
**แทนที่:** ร่างเดิมทั้งหมดของไฟล์นี้ และ `docs/archive/PROJECT_RULES_MASTER_v2.3.0.md` (เก็บไว้เป็น Reference เท่านั้น)

---

## 0. Source of Truth / Authority

### 0.1 ลำดับอำนาจ

เมื่อข้อความจากแหล่งต่าง ๆ ขัดกัน ให้ใช้ลำดับนี้ (ข้อบนชนะข้อล่าง):

| ลำดับ | แหล่ง | สถานะ |
|---|---|---|
| 1 | คำตัดสินล่าสุดของเจ้าของระบบ | กำหนดกฎ |
| 2 | Architecture Decisions ที่ล็อกแล้ว (รวมอยู่ในไฟล์นี้) | กำหนดกฎ |
| 3 | `POS_MASTER_ALL_IN_ONE_COMPLETE_SPEC_TH.txt` ส่วน A–AD (Master Spec) | กำหนดกฎ เว้นแต่ถูก Override โดยข้อ 1–2 |
| 4 | กฎเก่า (`docs/archive/*`) และภาคผนวก AE (ข้อมูลดิบ) ของ Master Spec | Reference เท่านั้น |
| 5 | โค้ด / Migration / Database ปัจจุบัน | Implementation เดิม ใช้ตรวจสอบเท่านั้น **ไม่ใช่ตัวกำหนดกฎ** |

### 0.2 วิธีใช้ไฟล์นี้

- ไฟล์นี้คือ **Master Rules** ที่รวมข้อ 1–3 แล้ว และแก้ conflict ที่รู้ผลแล้วเรียบร้อย
- ถ้าไฟล์นี้กับ Master Spec ขัดกัน ให้ถือไฟล์นี้ (เพราะไฟล์นี้บันทึกคำตัดสินข้อ 1–2 ไว้แล้ว)
- Architecture Business Rules = **LOCKED** (หมวด 36) — ค่า Policy/Configuration ที่ยังไม่กำหนดอยู่ในหมวด 37 ห้าม hard-code ค่าตามการเดา ให้ทำเป็นค่าตั้งค่า
- โค้ดที่ขัดกับไฟล์นี้ ถือเป็น Implementation Gap ที่ต้องแก้ ไม่ใช่เหตุผลให้แก้กฎ

---

## 1. คำศัพท์และความหมายที่ล็อกแล้ว

| คำ | ความหมาย |
|---|---|
| **Rental Contract (สัญญาเช่า)** | Entity สัญญาเช่าที่ผูกกับ Customer มีเลขสัญญาของตัวเอง มีหลาย Version ได้ |
| **Contract Version** | ข้อกำหนดของสัญญา ณ ช่วงเวลาหนึ่ง แก้ไม่ได้ (immutable) |
| **Bill (บิล)** | เอกสาร/ธุรกรรมการขาย-เช่า เป็นหัวบิลกลางที่มี Line แบบ SALE และ RENTAL — **Bill ไม่ใช่ Contract** |
| **การเช่าต่อ (Rental Continuation)** | ลูกค้าขอเช่าของต่อจากช่วงเดิม → สร้าง **บิลเช่าใหม่** สำหรับช่วงถัดไป อ้างอิงบิลเดิม — **ไม่ใช่การต่อหรือแก้ Contract** |
| **Carry Forward (การส่งต่อภาระ)** | การบันทึกว่าของที่ยังอยู่กับลูกค้าจาก Line ของบิลเดิม ถูกติดตามต่อที่ Line ของบิลใหม่ |
| **Renewal / ต่ออายุ** (คำใน Master Spec และภาคผนวก) | ให้อ่านเป็น "การเช่าต่อ" ตามนิยามข้างบนเสมอ ห้ามตีความเป็นการต่อ Contract |
| **Deposit (เงินมัดจำ)** | หนี้สิน (Liability) ระดับ Rental Contract ไม่ใช่รายได้ |
| **Correction** | การแก้ข้อมูลที่บันทึกผิดจริง ตามสิทธิ์ พร้อม Audit — ไม่ใช่เครื่องมือยืดระยะเวลาเช่า |
| **Adjustment / Reversal / Compensating Entry** | รายการใหม่ที่ใช้แก้ผลของรายการเดิม โดยไม่แก้หรือลบรายการเดิม |

**คำที่ห้ามใช้** ในเอกสาร UI และข้อความระบบ เมื่อหมายถึงการเช่าต่อ: "ต่อสัญญา", "ต่ออายุสัญญา", "บิลต่อสัญญา", "แก้สัญญาเดิม" — ให้ใช้ "เช่าต่อ" / "บิลเช่าต่อ" / "สร้างบิลเช่าต่อ"

---

## 2. หลักสถาปัตยกรรมกลาง

1. **หัวบิลเป็นกลาง** — บิลเดียวมีทั้ง SALE และ RENTAL ได้ โหมดอยู่ที่ระดับ Line สินค้าเดียวกันอยู่ได้ทั้ง SALE และ RENTAL คนละ Line
2. **ข้อมูลต้นฉบับไม่ถูกแก้ทับจนสูญเสียประวัติ** — เหตุการณ์ใหม่ = Record ใหม่
   - Payment ใหม่ = Record ใหม่
   - Return ใหม่ = Record ใหม่
   - Refund ใหม่ = Record ใหม่
   - การเช่าต่อ = บิลใหม่ + Carry Forward Record ใหม่
   - Deposit เคลื่อนไหว = Deposit Movement ใหม่
   - Cancel / Void / Correction = Reversal / Compensating Entry
3. **สถานะแยกหลายมิติ** — Bill, Payment, Return, Rental, Fulfillment, Item Condition, Contract, Appointment, Notification (หมวด 9)
4. **สถานะปัจจุบันคำนวณจากข้อมูลจริง** (Derived) — ค่า cache ได้ แต่ถ้าไม่ตรงกัน ให้ประวัติธุรกรรมเป็นฐานในการ reconcile
5. **Stock และ Finance มี Ledger/Movement ของตัวเอง** — Deposit มี Ledger แยกจาก Income/Expense
6. **งานที่แก้หลายตารางต้อง Atomic** — BEGIN → Validate → Lock → Insert/Update → Audit → COMMIT; ผิดพลาด → ROLLBACK ทั้งเหตุการณ์
7. **Notification ไม่ใช่ Source of Truth** — เป็นตัวชี้ไปยัง Entity จริง
8. **Entity ที่มีประวัติห้าม Hard Delete** — ใช้ active/inactive หรือสถานะ
9. **Permission ตรวจระดับ Action** — ไม่อิง Role อย่างเดียว
10. **Audit สำคัญแก้/ลบไม่ได้โดยผู้ใช้ปกติ**
11. **Close Bill ต้องตรวจ** `financial_resolved AND merchandise_resolved AND exception_resolved`
12. **ป้องกัน Double Submit / Duplicate Transaction** ด้วย idempotency key
13. **ทุก Record มี** `created_at`, `created_by` และข้อมูล Audit ที่จำเป็น

กฎสำคัญที่สุด:
> ข้อมูลต้นฉบับไม่ถูกแก้ทับจนสูญเสียประวัติ — เหตุการณ์ใหม่สร้าง Record ใหม่ — สถานะปัจจุบันคำนวณจากข้อมูลจริง — Stock, Finance และ Deposit มี Ledger — ทุก Action เสี่ยงผ่าน Permission + Transaction + Audit

---

## 3. Identity, Document Number และความคงทนของข้อมูล

### 3.1 Internal ID
- ทุกตาราง ใช้ **UUID** เป็น Primary Key และ Foreign Key ภายใน อย่างสม่ำเสมอ
- ห้ามยึดชนิด `TEXT` ของ schema เดิมเป็นมาตรฐาน
- ห้ามใช้เลขเอกสารเป็น Primary Key

### 3.2 Document Number
- Document Number มีไว้สำหรับผู้ใช้และเอกสารพิมพ์ **แยกจาก Internal ID**
- Unique ตาม Document Type และแต่ละชนิดใช้ **ชุดเลขของตัวเอง**
- เอกสารที่มีเลข: Quotation, Reservation, Bill, **Rental Contract**, Receipt / Payment Receipt, Refund, Credit Note, Appointment, Stock Adjustment, Cash Session, Inventory Count
- **Contract Number แยกชุดจาก Bill Number**
- Draft ยังไม่ออกเลข Final — ออกเลขเมื่อ Confirm/Post ภายใน Transaction ที่ Lock Sequence
- เลขที่ออกแล้วห้ามนำกลับมาใช้ (No Recycle) — เอกสารที่ Void แล้วถือว่าใช้เลขแล้ว
- Transaction ล้มเหลวหลังขอเลข: ยอมให้เลขขาดช่วงได้ แต่ห้ามใช้ซ้ำ
- เลข Final ห้ามแก้

ตัวอย่างรูปแบบ (รูปแบบจริงตั้งค่าได้ — ดูหมวด 37): `QT-2026-000001`, `BL-2026-000001`, `RC-2026-000001`, `RF-2026-000001`, `CN-2026-000001`, `AP-2026-000001`

### 3.3 การลบและ Foreign Key
- Business Entity ที่มีประวัติ (Customer, Product, Contract, Bill, Payment, Refund, Deposit Movement, Stock Movement, Audit ฯลฯ) **ห้าม Hard Delete**
- **ห้าม `ON DELETE CASCADE`** จาก Bill (หรือ Entity หลักอื่น) ไปทำลาย Payment / Refund / Deposit / Ledger / Stock Movement / Audit
- ใช้ `ON DELETE RESTRICT` หรือ `NO ACTION` ตามความเหมาะสม
- Audit เป็น polymorphic (`entity_type` + `entity_id`) ไม่ต้องมี FK และห้ามลบ
- Draft ที่ยังไม่มีธุรกรรมใด ๆ ยกเลิกได้ด้วยสถานะ ไม่ต้องลบ

---

## 4. User / Role / Permission / Approval

### 4.1 Role
- Role หลักมีเพียง **`OWNER`** และ **`USER`**
- `OWNER` มีสิทธิ์ทั้งหมด และเป็นผู้กำหนดสิทธิ์ของ `USER`
- `USER` ได้สิทธิ์ตาม **Permission ราย Action** ที่ OWNER กำหนด
- MANAGER / CASHIER / STOCK / FINANCE ใน Master Spec **ไม่ใช้เป็น Role** — ให้อ่านเป็น "หน้าที่งาน" ที่ควบคุมด้วย Permission ราย Action (หมวด 4.3)

### 4.2 หลักการตรวจสิทธิ์
- ห้ามตรวจแค่ `role == OWNER` ในงานธุรกิจ — ตรวจ Permission ที่ Action เสมอ (OWNER ได้ทุก Permission)
- ตรวจสิทธิ์ที่ฝั่ง Server/RPC ไม่พึ่ง UI อย่างเดียว

### 4.3 Permission (ชุดตั้งต้น)

รหัสจาก Master Spec:

| กลุ่ม | รหัส |
|---|---|
| Product | `product.view`, `product.edit`, `product.edit_price`, `product.view_cost`, `product.edit_cost` |
| Stock | `stock.view`, `stock.adjust`, `stock.count`, `stock.approve_adjustment` |
| Customer | `customer.view`, `customer.edit` |
| Payment / Refund | `payment.receive`, `payment.void`, `refund.create`, `refund.approve` |
| Bill | `bill.cancel`, `bill.void` |
| Rental | `rental.return`, `rental.damage_assess`, `rental.damage_charge`, `rental.lost_approve` |
| Finance | `finance.view`, `finance.expense_create`, `finance.expense_approve` |
| Control | `audit.view`, `security.manage_roles` |

รหัสที่เพิ่มตาม Architecture Decisions:

| รหัส | Action |
|---|---|
| **`rental.continue`** | สร้างบิลเช่าต่อ / Carry Forward (ชื่อล็อกแล้ว — แทนชื่อเดิม `rental.extend`) |
| `contract.create`, `contract.new_version`, `contract.end`, `contract.void` | จัดการ Rental Contract |
| `deposit.receive`, `deposit.apply`, `deposit.refund` | Deposit Movements |
| `bill.correct` | Correction |
| `rental.additional_charge_confirm` | ยืนยันค่าใช้จ่ายเพิ่มกรณีเกินกำหนด |

> ชื่อรหัสในตารางที่สอง (ยกเว้น `rental.continue`) ปรับได้ตอนออกแบบ schema แต่ต้องคง Action แยกกันตามตาราง

### 4.4 Approval
- Action เสี่ยงต้องมี: เหตุผล + ผู้ทำ + ผู้อนุมัติ (ถ้ามี) + Audit
- Action เสี่ยงอย่างน้อย: Refund, Cancel/Void, Lost, Write-off, Stock Adjustment, Price Override, Damage Charge Override, Credit Override, Cash Variance, Correction, การเช่าต่อ, ค่าใช้จ่ายเพิ่มกรณีเกินกำหนด, Contract End/Void, Deposit Apply/Refund, เปลี่ยนสิทธิ์
- ผู้อนุมัติคนละคนกับผู้สร้างได้ เมื่อต้องการ Separation of Duties
- เกณฑ์ว่าเรื่องใดต้องอนุมัติเมื่อไร (Approval Threshold) — ดูหมวด 37

---

## 5. Customer

- บิลที่มี **RENTAL Line อย่างน้อย 1 รายการ ต้องมี Customer** (รวม Mixed Bill)
- บิลที่มีเฉพาะ SALE เป็น Walk-in ได้
- ข้อมูลขั้นต่ำ: ชื่อ, เบอร์โทร, ที่อยู่
- ข้อมูลเสริม: `customer_type`, `tax_id`, `email`, `contact_person`, `billing_address`, `delivery_address`, tags, `credit_note`, `risk_note`, `document_reference`, `last_activity_at`, `note`
- ตรวจข้อมูลซ้ำ (ชื่อ/เบอร์ใกล้เคียง) → ให้เลือกใช้ลูกค้าเดิม หรือยืนยันสร้างใหม่
- ประวัติลูกค้า: Contract, Bill, Quotation, Appointment, Payment, Refund, Rental, Return, ของค้าง, ยอดค้าง, Deposit, Damage/Lost, Notes
- ห้าม Hard Delete ลูกค้าที่มีประวัติ — ใช้ `active = false`
- ทุกการแก้ไขลูกค้าต้อง Audit

---

## 6. Rental Contract และ Contract Version

### 6.1 โครงสร้าง
- ความสัมพันธ์: **Customer → Rental Contract → Bills**
- Contract 1 ฉบับ มีหลาย Bill ได้ / Bill เช่า 1 ใบ ใช้ Contract เดียว
- ลูกค้า 1 คน มี Contract ที่ `ACTIVE` พร้อมกันได้หลายฉบับ (เช่น หลายงาน/หลายโครงการ)
- ไม่ผูก Contract ที่ระดับ Rental Line (ช่อง `rental_contract_id` ใน `RENTAL_LINE_DETAILS` ของ Master Spec ถูก Override — ผูกที่ Bill)

**`rental_contracts`** — ตัวตนของสัญญา
- `id` (UUID), `contract_no` (Unique, ชุดเลขของสัญญา), `customer_id`
- `status`: `ACTIVE` / `ENDED` / `VOID`
- `created_at`, `created_by`
- `ended_at`, `ended_by`, `end_reason`
- `voided_at`, `voided_by`, `void_reason`

**`rental_contract_versions`** — ข้อกำหนดของสัญญา (immutable)
- `id`, `rental_contract_id`, `version_no` (Unique ต่อ Contract)
- `terms_snapshot`, `template_id`, `effective_from` (`timestamptz`)
- `created_at`, `created_by`

### 6.2 กฎ
- Contract ID และ Contract Number **คงเดิมตลอดอายุสัญญา**
- เปลี่ยนเงื่อนไข = สร้าง **Version ใหม่** — ห้ามแก้ Version เก่า
- Contract **ไม่มีวันหมดอายุตามรอบของ Bill** — วันคืนสินค้าอยู่ที่ Rental Bill/Line
- **การเช่าต่อไม่ทำให้เกิดการต่อ Contract และไม่สร้าง Contract Version ใหม่โดยอัตโนมัติ**
- เนื้อหาสัญญาที่พิมพ์ต้องสร้างซ้ำได้จาก `terms_snapshot` ของ Version ที่ใช้

### 6.3 การผูกกับ Bill
- Bill เก็บ **`rental_contract_id`** และ **`rental_contract_version_id`** ที่ใช้ตอนออกบิล
- บิลที่มี RENTAL Line ต้อง **เลือกหรือสร้าง Contract ก่อน Confirm** (Draft ยังว่างได้)
- Contract ต้อง `ACTIVE` และเป็นของ Customer เดียวกับ Bill
- Version ต้องเป็นของ Contract นั้น และเป็น Version ที่มีผล ณ เวลาออกบิล

### 6.4 สถานะและการสิ้นสุด
- **`ENDED`**: ทำได้เมื่อ
  - ไม่มี Bill ภายใต้ Contract ที่ยังไม่ปิด
  - ไม่มีภาระสินค้าค้าง (Σ `obligation_held_here` = 0)
  - Deposit Liability ของ Contract = 0
  - ระบบ validate ครบแล้ว ผู้มีสิทธิ์ `contract.end` ยืนยัน + Audit
- **`VOID`**: ใช้ได้เฉพาะเมื่อยังไม่มีธุรกรรมจริงที่ต้องรักษา หรือหลังทำ Reversal/Compensating Entry ของธุรกรรมที่เกี่ยวข้องถูกต้องครบแล้ว — ผู้มีสิทธิ์ `contract.void` + เหตุผล + Audit
- ห้าม Hard Delete Contract และ Contract Version

---

## 7. Product

- ข้อมูล: `sku`, `name`, `category`, `item_type`, `calculation_type`, `unit`, `sale_price`, `rental_price`, `cost_price`, `reorder_point`, `active`, `can_sell`, `can_rent`
- **Product Capability**: SALE ต้อง `can_sell = true` / RENTAL ต้อง `can_rent = true`
- สูตร:
  - SALE = ราคาขาย × จำนวน
  - RENTAL ต่อครั้ง/ต่อรอบ = ราคาเช่าต่อครั้ง × จำนวน × จำนวนรอบ
  - RENTAL รายวัน = ราคาเช่าต่อวัน × จำนวน × จำนวนวัน
- แก้ราคา → ต้องมีสิทธิ์ `product.edit_price` / แก้ต้นทุน → `product.edit_cost` — Audit Before/After ทุกครั้ง
- **ห้ามแก้ Stock Quantity ตรง ๆ** — ใช้ Stock Movement / Adjustment
- สร้างสินค้าใหม่: ตรวจ SKU/ชื่อซ้ำ → สร้าง Product → Initial Stock Movement → Audit
- ปิดใช้งาน `active = false`: ไม่แสดงใน POS รายการใหม่ แต่ยังเปิดบิลเก่าและรายงานได้ — สินค้า inactive ห้ามใช้ในรายการใหม่
- ราคา/จำนวนห้ามติดลบ

### 7.1 สินค้าติดตามรายชิ้น (Serialized Rental Unit)
- ของมูลค่าสูง / ต้องรู้ Serial / ต้องติดตามสภาพรายชิ้น: Product → Rental Unit → Serial Number (`product_units`)
- การส่งมอบ การรับคืน และ **Carry Forward** ของสินค้ารายชิ้น ต้องทำที่ระดับ Unit/Serial
- ของจำนวนมากใช้ Quantity-Based Inventory

---

## 8. Bill และ Line

### 8.1 โครงสร้าง
- Bill เป็นหัวบิลกลาง — Bill Item แต่ละรายการมี `line_mode` = `SALE` | `RENTAL`
- RENTAL Line มีรายละเอียดเช่า: `rental_rate`, `rental_calculation_type`, `period_type`, `period_count`, `rental_start_at`, `rental_end_at` (`timestamptz`)
- SALE และ RENTAL **ห้าม merge** แม้เป็น `product_id` เดียวกัน (ความหมาย สูตรราคา Stock Lifecycle ภาระการคืน และการจัดประเภทรายได้ต่างกัน)
- Payment รับรวมที่ระดับ Bill ได้ แต่ Revenue และ Stock Lifecycle แยกตาม Line
- หลัง Checkout แต่ละ Line เดิน Lifecycle ของตัวเอง

### 8.2 ความสัมพันธ์ของบิลเช่า
- Bill เก็บ `customer_id`, `rental_contract_id`, `rental_contract_version_id` (หมวด 6.3)
- Bill Lineage (หมวด 17): `parent_bill_id` = บิลก่อนหน้าทันที / `original_bill_id` = บิลแรกสุดของสาย

### 8.3 POS Mode
- UI มีปุ่ม [เช่า] [ขาย] เป็น `current_mode` สำหรับสินค้าที่จะเพิ่ม "ต่อจากนี้" — ไม่เปลี่ยน Line เดิมอัตโนมัติ
- Current Mode ต้องแสดงชัดเสมอ และทุก Row ใน Cart ต้องมี Badge SALE / RENTAL
- เปลี่ยนโหมดของ Line ใน Cart (ก่อนยืนยัน): ตรวจ Capability → เปลี่ยน pricing rule → (RENTAL) ขอ Period → Recalculate → เปลี่ยน Reservation Type
- หลังยืนยันบิล ห้ามแก้ `line_mode` แบบไม่มีประวัติ — ใช้ Cancel/Correction/Reversal ตามกฎ

### 8.4 สูตรคำนวณ
- `sale_subtotal` = Σ extended_amount ของ SALE
- `rental_subtotal` = Σ extended_amount ของ RENTAL
- ลำดับคำนวณ: Item Base Amount → Line Discount → Line Net → Bill Discount → Shipping/Service Fee → Taxable Base → VAT → Grand Total
- Discount: รองรับ Line/Bill และ Fixed/Percentage — มีเพดานตาม Policy และสิทธิ์ Override
- VAT: `vat_enabled`, `vat_rate`, inclusive/exclusive, taxable amount, vat amount — **สวิตช์ VAT ที่ POS และ Settings ต้องเป็น state เดียวกัน**
- ค่าบริการแยกเป็น `delivery_fee`, `installation_fee`, `service_fee` — ห้ามซ่อนใน Unit Price
- Deposit **ไม่รวม** ใน Grand Total ของรายได้ (บันทึกเป็น Deposit Movement ระดับ Contract — หมวด 18)

### 8.5 Checkout (Atomic)
BEGIN → Validate Bill → Validate Customer (+ Contract ถ้ามี RENTAL) → Validate Product Capability → Lock Stock → Validate Stock → Create Bill → Bill Items → Rental Details → Stock Movements (ตามกฎ Reservation/Delivery) → Payment (ถ้ามี) → Finance Ledger → Audit → COMMIT
- Line ใดผิด ห้าม Checkout — **ห้าม Commit เพียงบาง Line**

---

## 9. สถานะ (แยกมิติ)

| มิติ | ค่า |
|---|---|
| Bill Status | `DRAFT`, `CONFIRMED`, `ACTIVE`, `CLOSED`, `CANCELLED`, `VOID` |
| Payment Status (ระดับบิล) | `UNPAID`, `PARTIALLY_PAID`, `PAID`, `PARTIALLY_REFUNDED`, `REFUNDED` |
| Payment Record Status | `PENDING`, `COMPLETED`, `VOIDED`, `REVERSED`, `REFUNDED` |
| Return Status (ระดับ Line) | `NOT_RETURNED`, `PARTIALLY_RETURNED`, `RETURNED` |
| Rental Status (ระดับ Line) | `SCHEDULED`, `ACTIVE`, `OVERDUE`, `RETURNED`, `RESOLVED`, `CLOSED` |
| Fulfillment Status (ระดับ Line) | เช่น `RESERVED`, `DELIVERED`, `RENTED_OUT`, `BACKORDER` |
| Item Condition | `NORMAL`, `MINOR_DAMAGE`, `REPAIRABLE`, `MAJOR_DAMAGE`, `TOTAL_LOSS`, `LOST` (สถานะงาน: `UNDER_INSPECTION`, `UNDER_REPAIR`, `WRITTEN_OFF`) |
| Contract Status | `ACTIVE`, `ENDED`, `VOID` |
| Quotation | `DRAFT`, `SENT`, `ACCEPTED`, `EXPIRED`, `REJECTED`, `CONVERTED` |
| Reservation | `PENDING`, `ACTIVE`, `EXPIRED`, `CANCELLED`, `CONVERTED` |
| Appointment | `DRAFT`, `SCHEDULED`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`, `RESCHEDULED` |
| Notification | `UNREAD`, `READ`, `HANDLED`, `DISMISSED`, `EXPIRED` |
| Cash Session | `OPEN`, `CLOSED`, `CLOSED_WITH_VARIANCE` |

กฎ:
- **ไม่มี `EXTENDED` เป็น Business Status** — การมีบิลเช่าต่อเป็น Derived Relation/Flag (`has_continuation`) จากข้อมูล Carry Forward จริง
- สถานะหลายมิติเกิดพร้อมกันได้ เช่น Bill `ACTIVE` + Payment `PARTIALLY_PAID` + Return `PARTIALLY_RETURNED`
- Line ที่ `obligation_held_here = 0` เพราะส่งต่อไปบิลใหม่ แสดงผลเป็น "ส่งต่อไปบิล …" (derived) — **ไม่ใช่ `RETURNED`**
- สถานะเปลี่ยนตามเงื่อนไขจากข้อมูล ห้ามผู้ใช้เปลี่ยนเองโดยไม่มีเงื่อนไข

---

## 10. Quotation → Reservation → Bill

- Quotation **ไม่กัน Stock** — Quotation ≠ Sale
- Reservation: Reserved เพิ่ม, Available ลด, On Hand เท่าเดิม — Reservation ≠ Delivery
- Reservation ต้องมี Expiry — ถึง Expiry โดยไม่ Confirm → Release Reservation
- Convert เป็น Bill/Order → Lock ข้อมูลสำคัญ → Fulfillment
- Sale Delivery ลด On Hand / Rental Delivery เพิ่ม Rented Out

---

## 11. Stock

### 11.1 Stock State
`AVAILABLE`, `RESERVED`, `RENTED_OUT`, `DELIVERY_PENDING`, `RETURN_PENDING`, `INSPECTION`, `REPAIR`, `DAMAGED`, `LOST`, `INACTIVE`

Lifecycle:
- SALE: `AVAILABLE → RESERVED → SOLD/DELIVERED`
- RENTAL: `AVAILABLE → RESERVED → RENTED_OUT → RETURN_PENDING → INSPECTION` แล้ว
  - NORMAL → `AVAILABLE`
  - DAMAGED → `REPAIR`
  - LOST → `LOST` / Write-off

### 11.2 กฎ
- ทุกการเปลี่ยนจำนวนหรือสถานะ Stock ต้องเป็น **Stock Movement** (`product_id`, `source_type`, `source_id`, `movement_type`, `quantity_delta`, `stock_state`)
- ห้าม Client แก้ Inventory ตรง
- Stock ห้ามติดลบ เว้นแต่มีกฎที่อนุมัติไว้ชัด
- ใช้ Lock/Concurrency Control ป้องกัน Oversell / Over-rent
- ของชำรุดห้ามเข้า Available โดยตรง / ของหายห้ามเพิ่ม Stock
- **Carry Forward ของการเช่าต่อ ไม่สร้าง Stock Movement** (ของไม่ได้เคลื่อนจริง)

### 11.3 Backorder / Partial Delivery
- เก็บ `ordered_qty`, `allocated_qty`, `fulfilled_qty`, `delivered_qty`, `backorder_qty`, `cancelled_qty`
- Partial Delivery ต้องมี Delivery Record แยก — Backorder ห้ามนับว่า Delivered — Line ต้องเก็บ Ordered Quantity เดิม
- นโยบาย (รอทั้งหมด / ส่งบางส่วน) — หมวด 37

### 11.4 Physical Count
- สร้าง Stock Count → Snapshot → นับจริง → Count Lines → Discrepancy → Review → Approval → Stock Adjustment → Ledger + Audit
- ห้ามตั้ง `quantity` ตามที่นับได้โดยตรง — Adjustment ต้องมาจาก Discrepancy และต้องมีเหตุผล

---

## 12. Delivery / Fulfillment

- การส่งมอบคือเหตุการณ์ Delivery จริง (Delivery + Delivery Lines) ที่สร้าง Stock Movement
- การสร้างบิล การชำระเงิน หรือการถึงวันเริ่มเช่า **ไม่ถือเป็นการส่งมอบ**
- หลังส่งมอบ RENTAL Line → Rental Status `ACTIVE`
- สินค้ารายชิ้นต้องระบุ Unit ที่ส่งมอบ

---

## 13. Payment

- สูตร:
  - `paid_amount` = Σ valid payments
  - `balance_due` = `bill_total − paid_amount − credit_adjustments + debit_adjustments`
  - สถานะ: paid = 0 → `UNPAID` / 0 < paid < total → `PARTIALLY_PAID` / paid ≥ total → `PAID`
- ช่องทาง: `CASH`, `TRANSFER`, `CARD`, `QR`, `OTHER`
- รองรับ Split Payment และหลาย Payment ต่อบิล — **แต่ละช่องทางแต่ละครั้งเป็น Record แยก**
- Flow: Validate → BEGIN → Insert Payment ใหม่ → Finance Ledger → Cash Movement (ถ้าเงินสด) → Audit → Recalculate → COMMIT
- Validation: `amount > 0`, idempotency, permission, balance valid, method valid, บันทึกผู้รับเงิน/เวลา/สถานะ/reference
- ห้าม: รวมหลาย Payment เป็น Record เดียว, แก้ยอด Payment เก่าเพื่อทำ Refund, Delete Payment
- Payment ผิด → Void/Reversal แล้วสร้าง Payment ใหม่
- รับเงินเกินยอดได้เฉพาะเมื่อมีกฎรองรับ

---

## 14. Return, Damage, Lost

### 14.1 สูตรภาระสินค้า (ระดับ Line)

| ค่า | สูตร / ความหมาย |
|---|---|
| `delivered_qty` | ส่งมอบจริงของ Line นี้ |
| `carried_in_qty` | Σ Carry Forward ที่เข้ามาที่ Line นี้ (ไม่นับที่ถูก Reverse) |
| `physical_returned_qty` | Σ ของที่กลับมาจริง |
| `approved_lost_qty` | Σ ของที่ยืนยันว่าหายและผ่านอนุมัติ |
| `approved_disposition_qty` | Σ disposition ที่อนุมัติ (เฉพาะสูญหาย/ตัดจำหน่าย) |
| `resolved_qty` | `physical_returned_qty + approved_lost_qty + approved_disposition_qty` |
| `remaining_obligation` | `delivered_qty + carried_in_qty − resolved_qty` — **ค่าประวัติ** ตามเหตุการณ์ของ Line นี้ |
| `carried_forward_qty` | Σ Carry Forward ที่ออกจาก Line นี้ไปบิลลูก (ไม่นับที่ถูก Reverse) |
| `obligation_held_here` | `remaining_obligation − carried_forward_qty` — **จำนวนที่บิลนี้ยังต้องติดตามเอง** (ต้อง ≥ 0) |

- `resolved_qty` **ไม่รวม** Carry Forward — **ห้ามใช้ disposition เพื่อทำให้ภาระเป็น 0 จากการเช่าต่อ**
- ยอด "ของที่ยังอยู่กับลูกค้า" ระดับลูกค้า/Contract ใช้ **Σ `obligation_held_here`** เท่านั้น (ห้ามรวม `remaining_obligation` เพราะนับซ้ำตามสายบิล)
- Return Status: returned = 0 → `NOT_RETURNED` / บางส่วน → `PARTIALLY_RETURNED` / ครบ → `RETURNED`

### 14.2 รับคืน (บางส่วนหลายรอบ)
- รับคืนได้ที่ Line ที่มี `obligation_held_here > 0`
- Validation: `qty > 0`, `qty ≤ obligation_held_here`, สินค้าเป็นของ Line นั้น, ต้องระบุ Condition, ผู้รับคืน, เวลา, ห้ามคืนของที่ไม่เคยส่ง, ห้ามคืนคนละ Bill Item
- สินค้ารายชิ้นต้องระบุ Unit ที่คืน
- คืนหลายรายการในรอบเดียวได้ แต่แยก Return Line ตามสินค้า/Condition
- Atomic: Lock Line → อ่านภาระ → Validate → Return Transaction → Return Lines → Stock Movements → Audit → Recalculate → COMMIT
- ห้ามแก้จำนวนใน Line ต้นฉบับเมื่อมีการคืน

### 14.3 Damage
- Return ≠ Available ทันที — ของชำรุดเข้า Inspection/Quarantine
- Flow: รับคืน → ตรวจสภาพ → Damage Case → ประเมิน (ซ่อมได้ → Repair Queue + Repair Cost / เสียหายถาวร → Replacement) → Damage Charge (ยืนยันโดยผู้มีสิทธิ์ `rental.damage_charge`) → ชำระด้วยเงินหรือ Deposit Apply → Audit
- งานซ่อมภายในร้านไม่ขวางการปิดบิลเมื่อ Charge ถูกกำหนดและเคลียร์แล้ว

### 14.4 Lost
- **Lost ≠ Returned** — ของหายไม่เพิ่ม Stock และห้าม mark returned
- Flow: พบจำนวนขาด → `MISSING` → ตรวจสอบ → พบ = รับคืนปกติ / ไม่พบ = ขออนุมัติ LOST (`rental.lost_approve`) → Lost Charge → ชำระด้วยเงินหรือ Deposit Apply → ปรับทะเบียนสินค้า → Audit
- ต้องผ่าน `MISSING` ก่อน LOST
- Lost Charge Basis (ราคาทดแทน/ขาย/ทุน/ค่าเสื่อม/% ตามอายุ/Flat Fee/Replacement Value ตาม Contract Version) — เก็บ basis, amount, approved_by, reason, timestamp
- **Write-off**: ใช้เมื่อร้านยอมรับภาระขาดทุน/เรียกเก็บไม่ได้ ต้องมีผู้อนุมัติ — ห้าม Lost → Write-off อัตโนมัติ (ลำดับ: Lost → Charge → Collection/Deposit → Approval → Write-off)

---

## 15. คืนก่อนกำหนด (Early Return)

- เก็บ **Planned End** และ **Actual Return** แยกกัน — ห้ามแก้ Planned End ให้เท่ากับ Actual Return
- Actual Return ห้ามก่อน Delivery
- คิดค่าเช่าตาม **Early Return Policy** (คิดเต็มตามเดิม หรือคิดตามวันใช้จริง) — ค่า Policy ดูหมวด 37
- ชำระแล้วและจ่ายเกิน + Policy อนุญาต → Refund (Record ใหม่)
- ยังไม่ชำระ/ชำระบางส่วน → Settlement (หมวด 21): > 0 รับเพิ่ม / = 0 เคลียร์ / < 0 Refund
- Refund ห้ามเกินยอดที่มีสิทธิ์คืน

---

## 16. เกินกำหนด (Overdue)

- เงื่อนไข: `current_time > rental_end_at` **และ** `obligation_held_here > 0` **และ** ไม่มีการเช่าต่อที่อนุมัติสำหรับภาระนั้น → Rental Status `OVERDUE`
- **ระบบแจ้งเตือนและให้ผู้ใช้ตรวจสอบเท่านั้น**
- **ห้ามสร้าง Late Fee / Charge / ค่าเช่าเพิ่มอัตโนมัติ** ไม่ว่ากรณีใด
- ระบบแสดงระยะเวลาเกินกำหนดเป็นข้อมูลประกอบได้ — ถ้าแสดงยอดประมาณ ต้องระบุชัดว่า **ไม่ใช่ยอดเรียกเก็บ** และไม่บันทึกเป็นยอดค้าง/รายได้
- **หากมีค่าใช้จ่ายเพิ่ม** ผู้มีสิทธิ์ (`rental.additional_charge_confirm`) ต้องตรวจและกดยืนยันก่อน จึงบันทึกเป็น Charge Record แยก (ไม่แก้ยอดบิลเดิม) พร้อมเหตุผล ผู้ยืนยัน เวลา และ Audit
- ห้ามคิดค่าใช้จ่ายซ้ำช่วงเดียวกัน — รวมถึงช่วงที่ถูกคิดเป็นค่าเช่าในบิลลูกแบบย้อนหลังแล้ว (หมวด 17.4.1)
- เทียบเวลาใช้ **timezone ของร้าน**
- **เลยกำหนด ≠ เช่าต่อ** — ห้ามเช่าต่ออัตโนมัติ รวมถึงเมื่อเลยกำหนด
- การเช่าต่อหลังเลยกำหนด: ผู้มีสิทธิ์เลือกวิธีเริ่มบิลลูกเองทุกครั้ง (หมวด 17.4.1)
  - เลือกเริ่ม ณ เวลาที่อนุมัติ → ช่วงตั้งแต่ `rental_end_at` เดิมถึงเวลาอนุมัติ **ยังเป็น OVERDUE ของบิลเดิม** และใช้กฎหมวดนี้ทั้งหมด
  - เลือกเริ่มย้อนหลัง → ช่วงนั้นเป็น Rental Period ของบิลลูก ไม่ถือเป็นช่วงเกินกำหนดที่ต้องตรวจค่าใช้จ่ายเพิ่มที่บิลเดิม
- การคืนเกินกำหนดที่พนักงานยังไม่ตรวจเรื่องค่าใช้จ่ายเพิ่ม ถือเป็น Exception ค้าง (หมวด 21)

---

## 17. การเช่าต่อ (Rental Continuation) และ Carry Forward

### 17.1 หลักการ
- ลูกค้าเช่าต่อ → **สร้างบิลเช่าใหม่** สำหรับช่วงถัดไป
- บิลใหม่อ้างอิงบิลเดิม เพื่อดูประวัติย้อนหลังได้
- **ห้ามแก้วันที่ / ยอด / รายการ / จำนวน ของบิลเดิมเพื่อยืดช่วงเช่า** — บิลเดิมเก็บข้อมูลเดิมไว้
- **ห้าม Fake Return / Fake Delivery / Fake Stock Movement**
- ของที่ยังอยู่กับลูกค้าถูกติดตามต่อที่บิลใหม่ผ่าน Carry Forward
- ต้องผ่านการอนุมัติ และผู้ทำต้องมีสิทธิ์ **`rental.continue`**
- **ห้ามเช่าต่ออัตโนมัติ**
- การเช่าต่อไม่ใช่การต่อ Contract และไม่สร้าง Contract Version ใหม่

### 17.2 Bill Lineage
- `parent_bill_id` = บิลก่อนหน้าทันที
- `original_bill_id` = บิลแรกสุดของสาย (`= parent.original_bill_id ?? parent.id`)
- ตัวอย่าง A → B → C: `B.parent = A`, `B.original = A`, `C.parent = B`, `C.original = A`
- ทั้งสองค่าว่างพร้อมกัน หรือมีค่าพร้อมกัน
- บิลลูกใช้ **`rental_contract_id` เดียวกับบิลแม่** และใช้ Contract Version ที่มีผล ณ เวลาออกบิลลูก
- บิลแม่ 1 ใบ มีบิลลูกได้หลายใบ — **ห้ามรวมการเช่าต่อจากหลายบิลแม่เป็นบิลเดียว** (เวอร์ชันนี้)
- `has_continuation` ของบิล = มี Carry Forward (ที่ไม่ถูก Reverse) ออกจากบิลนั้น

### 17.3 `rental_carry_forwards` (Source of Truth ของ Line/จำนวนที่ส่งต่อ)
- `id`, `from_bill_id`, `from_line_id`, `to_bill_id`, `to_line_id`, `product_id`, `quantity` (> 0)
- `approved_by`, `reason`, `created_by`, `created_at`, `correlation_id`
- Append-only — ห้ามแก้/ลบ
- กฎ:
  - `to_bill.parent_bill_id = from_bill_id`
  - สินค้าเดียวกันทั้งสอง Line
  - Lock Line ต้นทาง แล้วตรวจ `quantity ≤ obligation_held_here` ณ เวลาบันทึก — คุมผลรวมเมื่อมีบิลลูกหลายใบ
- **`rental_carry_forward_units`** (สินค้ารายชิ้น): `carry_forward_id`, `product_unit_id` — จำนวนแถว = `quantity` และ Unit ต้องอยู่ในความรับผิดชอบของ Line ต้นทาง
- **`rental_carry_forward_reversals`**: `carry_forward_id` (Unique — กลับรายการเต็มจำนวนต่อ Record), `reason`, `approved_by`, `created_by`, `created_at`, `correlation_id`

### 17.4 วันเริ่มของรอบเช่าต่อ (ห้ามซ้อนรอบเดิม)
- เก็บช่วงเช่าเป็น `timestamptz` — สูตรรายวันคำนวณตาม **timezone ของร้าน** โดยนับวันแรกเป็นวันที่ 1 (Inclusive)
- **รายวัน**: เริ่มวันถัดจากวันสิ้นสุดรอบเดิม — รอบเดิม 1–5 → รอบใหม่เริ่ม 6
- **ต่อครั้ง/ต่อรอบ**: **ผู้ใช้กำหนดรอบถัดไปเองตอนสร้างการเช่าต่อ** — ระบบตรวจแค่ว่าไม่ซ้อนรอบเดิม ห้ามเดาเอง
- ห้ามใช้กฎ +1 วันแบบเดียวกันกับทุก calculation type

#### 17.4.1 เช่าต่อหลังเลยกำหนด (อนุมัติหลัง `rental_end_at` เดิม)
ผู้มีสิทธิ์ต้อง **เลือกเองทุกครั้ง** ตอนอนุมัติ — **ห้ามระบบเลือกให้** และห้ามเช่าต่ออัตโนมัติ

| ทางเลือก | ค่าใน `continuation_start_mode` | ผล |
|---|---|---|
| 1. เริ่มย้อนหลัง | `FROM_PREVIOUS_END` | บิลลูกเริ่มถัดจาก `rental_end_at` เดิม (รายวัน: วันถัดไป / ต่อครั้ง-ต่อรอบ: รอบถัดไปที่ผู้ใช้กำหนด) — ช่วงย้อนหลังเป็น **Rental Period ของบิลลูก** คิดตามราคาที่ผู้มีสิทธิ์ยืนยัน — **ห้ามสร้าง Charge เกินกำหนดซ้ำกับช่วงเดียวกัน** |
| 2. เริ่ม ณ เวลาที่อนุมัติ | `FROM_APPROVAL` | บิลลูกเริ่มที่วันที่/เวลาที่อนุมัติ — ช่วงก่อนอนุมัติ **ยังเป็น OVERDUE ของบิลเดิม** และใช้กฎหมวด 16 |

บันทึกที่บิลลูก (ทุกการเช่าต่อหลังเลยกำหนด):
- `continuation_start_mode`, `continuation_reason`, `continuation_approved_by`, `continuation_approved_at`
- Audit (ผู้ทำ, ผู้อนุมัติ, ทางเลือก, เหตุผล, ช่วงเวลาที่มีผล)

การเช่าต่อที่อนุมัติก่อนหรือ ณ `rental_end_at` เดิม ใช้กฎวันเริ่มปกติด้านบน (ไม่ต้องเลือกทางเลือก)

### 17.5 Flow สร้างการเช่าต่อ
1. ผู้มีสิทธิ์ `rental.continue` เลือกบิลแม่ → เลือก Line และจำนวน (หรือ Unit สำหรับสินค้ารายชิ้น)
2. ขออนุมัติ — ถ้าอนุมัติหลัง `rental_end_at` เดิม ผู้อนุมัติต้องเลือกวิธีเริ่มตามหมวด 17.4.1 พร้อมเหตุผล
3. Transaction เดียว:
   - Lock Line ต้นทาง
   - ตรวจ `quantity ≤ obligation_held_here`
   - สร้างบิลลูก (Contract เดียวกัน + Version ที่มีผล, `parent_bill_id`, `original_bill_id`)
   - สร้าง Line ของบิลลูก (ราคาและช่วงเช่าใหม่)
   - สร้าง `rental_carry_forwards` (+ `rental_carry_forward_units`)
   - Audit
4. ไม่แก้บิลแม่ ไม่มี Stock Movement ไม่มี Return/Delivery ปลอม ไม่มี Deposit Movement
5. ราคาและการชำระของช่วงใหม่อยู่ที่บิลลูก — สินค้าใหม่ที่เพิ่มในบิลลูกต้องส่งมอบจริงตามปกติ
6. สาย B → C ใช้ Flow เดียวกัน

### 17.6 รับคืนหลังการเช่าต่อ
- รับคืนที่บิลที่ `obligation_held_here > 0` (ปลายสายที่ถือของอยู่)
- Return/Stock Movement อ้างอิงบิลนั้น และย้อนดูการส่งมอบเดิมได้ผ่านสาย Carry Forward

### 17.7 ยกเลิกการเช่าต่อ
1. ถ้าบิลลูกมี Payment / Charge / Refund แล้ว ต้อง Reverse/Settle ตามกฎก่อน
2. ถ้าบิลลูกมีการรับคืน สูญหาย หรือส่งมอบจริงแล้ว ต้องกลับรายการเหล่านั้นตามกฎก่อน (Carry Forward ถูก Reverse ได้เมื่อจำนวนนั้นยังอยู่ใน `obligation_held_here` ของบิลลูก)
3. สร้าง `rental_carry_forward_reversals` ครบทุก Record — `obligation_held_here` กลับไปที่บิลแม่เองตามสูตร
4. บิลลูกเป็น `CANCELLED` หรือ `VOID` ตามกฎหมวด 20 + Audit — **ห้ามลบ**

---

## 18. Deposit (ระดับ Rental Contract)

### 18.1 หลักการ
- Deposit เป็น **Liability ระดับ Rental Contract** — ไม่ใช่ Revenue และไม่ใช่ยอดของบิล
- ใช้ **Deposit Holding + Deposit Movements**
- ห้ามแก้ Payment/Deposit Transaction เก่า — แก้ผิดด้วย `REVERSAL`
- Movement ต้องอ้างอิง Bill ที่เป็นเหตุได้ (`RECEIVE` / `APPLY` ต้องมีบิลเสมอ — `REFUND` อ้างอิงบิลที่เกี่ยวข้องเมื่อมี)
- การเช่าต่อ A → B → C **ไม่ต้องโอนมัดจำระหว่างบิล** (อยู่ใต้ Contract เดียวกัน)
- เปลี่ยน Contract Version **ไม่ต้องย้ายมัดจำ** (Holding ผูกกับ `rental_contract_id`)
- Deposit ยังคงเป็น **Liability จนกว่าจะ `REFUND` หรือ `APPLY` อย่างถูกต้อง**

### 18.2 โครงสร้าง
**`deposit_holdings`**: `id`, `rental_contract_id` (Unique) — ต้อง Lock Holding ทุกครั้งที่บันทึก Movement

**Deposit Available** (คำนวณจาก Movements ห้ามติดลบ):
`Σ RECEIVE − Σ APPLY − Σ REFUND` (ปรับด้วย `REVERSAL` ของรายการที่ถูกกลับ)

**`deposit_movements`** (Append-only):
- `id`, `holding_id`, `movement_type`, `amount` (> 0)
- `bill_id` — บิลที่เป็นเหตุ / บิลเป้าหมายของ `APPLY` (ต้องอยู่ใต้ Contract เดียวกัน)
- `charge_id` — Charge เป้าหมาย (สำหรับ `APPLY` ที่ชำระ Charge เฉพาะรายการ)
- `cash_movement_id` — การรับ/จ่ายเงินจริง (สำหรับ `RECEIVE` / `REFUND` เท่านั้น)
- `reverses_movement_id`
- `reason`, `approved_by`, `created_by`, `created_at`, `correlation_id`

| `movement_type` | ความหมาย | เงินจริงเข้า/ออก |
|---|---|---|
| `RECEIVE` | รับมัดจำ (อ้างอิงบิลที่ขอมัดจำ) | เข้า — สร้าง Cash/Bank Movement |
| `APPLY` | ใช้มัดจำชำระยอดที่ต้องชำระของบิลใต้ Contract เดียวกัน (Settlement) | ไม่มี — ไม่ใช่รายรับ/รายจ่าย |
| `REFUND` | คืนมัดจำ (บางส่วนหรือทั้งหมด) | ออก — สร้าง Cash/Bank Movement |
| `REVERSAL` | กลับรายการที่บันทึกผิด | ตามรายการที่กลับ |

### 18.3 `APPLY` — ใช้มัดจำชำระยอด
- นำไปชำระ **ยอดที่ต้องชำระใด ๆ ภายใต้ Rental Contract เดียวกัน** ได้ (ยอดค้างของบิล หรือ Charge รายการใดก็ได้) — ไม่จำกัดเฉพาะ Damage/Lost หรือ Charge บางประเภท
- **ห้าม `APPLY` อัตโนมัติ**
- ผู้มีสิทธิ์ `deposit.apply` ต้อง: เลือกรายการเป้าหมาย → ระบุ amount → ยืนยัน → ระบุ Reason → Audit
- `amount > 0` และ **`amount ≤ Deposit Available`** และไม่เกินยอดค้างของรายการเป้าหมาย
- `APPLY` เป็น Settlement — รายได้ของ Charge รับรู้เมื่อ Charge ถูกยืนยัน/earned ตามกฎรายได้ ไม่ใช่ตอน `APPLY`
- Deposit Available ไม่พอ → ส่วนที่เหลือยังเป็นยอดที่ลูกค้าต้องชำระที่รายการนั้น

### 18.4 `REFUND` บางส่วนระหว่าง Contract `ACTIVE`
- **อนุญาต**
- ต้องมี Permission `deposit.refund` / Approval ตามกฎ
- `0 < amount ≤ Deposit Available` — ห้ามคืนจำนวนที่ถูก `APPLY` หรือใช้ไปแล้ว
- สร้าง Deposit `REFUND` Movement ใหม่ + Cash/Bank Movement ตามเงินจริงที่ออก + Audit
- การคืนที่ทำให้ Deposit Available เหลือ 0 ถือเป็น **Full/Final Refund** และต้องผ่านเงื่อนไขหมวด 18.5
- ยอดมัดจำขั้นต่ำที่ต้องคงไว้เพื่อค้ำของที่ยังอยู่กับลูกค้า **ไม่ hard-code** — เป็น Configurable Policy ถ้าร้านต้องการใช้ (หมวด 37)

### 18.5 `REFUND` ทั้งหมด (Full/Final)
คืนได้เมื่อครบทุกข้อ:
- Σ `obligation_held_here` ของ Contract = 0
- ไม่มีสินค้า/Unit ค้างกับลูกค้า
- ไม่มียอดค้างชำระภายใต้ Contract
- ไม่มี Charge ที่ pending / ยังไม่ยืนยัน / ยังไม่ชำระ
- ไม่มี Damage / Lost / Refund / Exception ที่ยังไม่ resolve

ต้องมี Permission/Approval, สร้าง `REFUND` Movement + Cash/Bank Movement + Audit เช่นเดียวกับหมวด 18.4

### 18.6 กฎร่วม
- Audit ทุก Movement: ยอด, บิล/Charge เป้าหมาย, ผู้ทำ, ผู้อนุมัติ, เวลา, เหตุผล
- **Deposit ที่ยังถืออยู่ไม่ทำให้ Bill ต้องค้างเปิด** — Deposit Liability ต้องเป็น 0 ก่อน Contract `ENDED` (หมวด 6.4)
- จำนวนมัดจำที่ต้องเรียกเก็บ (Deposit Calculation) — หมวด 37

---

## 19. Charges, Adjustments และ Correction

### 19.1 Charges
- ค่าใช้จ่ายที่เกิดหลังออกบิล (Damage, Lost, ค่าใช้จ่ายเพิ่มกรณีเกินกำหนด, Service อื่น) บันทึกเป็น **Charge Record แยก** ที่บิลซึ่งเป็นเหตุ — ไม่แก้ยอดบิลเดิม
- Charge ต้องยืนยันโดยผู้มีสิทธิ์ก่อนนับเป็นยอดค้างชำระและรายได้
- Charge ที่ยังไม่ยืนยัน/ยังไม่กำหนด ถือเป็น Exception ค้าง

### 19.2 Adjustments
- ปรับยอดระหว่างเช่าหรือหลังยืนยันใช้ Credit/Debit Adjustment ที่เก็บ Before / After / ผู้ทำ / เวลา / เหตุผล
- ยอดล่าสุดที่ยืนยันแล้วเป็นยอดที่ต้องชำระ

### 19.3 Correction
- ใช้แก้ข้อมูลที่ **บันทึกผิดจริง** เท่านั้น — ผู้มีสิทธิ์ `bill.correct` + Reason + Audit Before/After
- **ห้ามใช้ Correction เพื่อ:**
  - ยืดระยะเวลาเช่าจริง (ต้องใช้การเช่าต่อ)
  - เพิ่มจำนวนที่ส่งมอบแล้ว
  - เปลี่ยนยอดย้อนหลังเพื่อแทนการเช่าต่อ
  - แก้ขัดกับ Carry Forward ที่มีอยู่
- ถ้ากระทบธุรกรรมเงินหรือ Stock ที่เกิดจริงแล้ว ใช้ Adjustment / Reversal / Compensating Entry
- ตรวจที่ Service/RPC (UI เป็นเพียงด่านแรก)

---

## 20. Cancel / Void / Refund / Reversal

- **Cancel** = ยกเลิกก่อนธุรกรรมสมบูรณ์ / **Void** = ยกเลิกรายการที่ยืนยันแล้วตามกฎ / **Refund** = คืนเงินหลังรับเงินจริง / **Reversal** = รายการกลับทิศ

| สถานะ | การจัดการ |
|---|---|
| Draft | Cancel ได้ ไม่มีผลต่อ Stock/Finance |
| Confirmed ยังไม่ส่งมอบ/ยังไม่ชำระ | Cancel หรือ Void ตามสิทธิ์ (`bill.cancel` / `bill.void`) → Release Reservation |
| มีธุรกรรม/ส่งมอบแล้ว | Void + Reversal ของ Stock/Finance ตามจำเป็น |
| มีเงินรับแล้ว | Refund Record (`refund.create` / `refund.approve`) — **ห้ามคืนเงินอัตโนมัติตอนยกเลิก** |
| ของเช่ายังอยู่กับลูกค้า | ห้ามคืน Stock อัตโนมัติ ต้องรับคืนจริง |
| Closed | ห้ามแก้ต้นฉบับ ใช้ Adjustment/Refund Transaction |

- Flow: Request → ตรวจสถานะ → ตรวจสิทธิ์ → Approval (ถ้าต้อง) → Reversal/Refund → ย้อน Stock/Finance ถ้าจำเป็น → Audit
- Refund: `amount > 0`, ≤ refundable amount, ต้องมีเหตุผล, สิทธิ์/อนุมัติ, เชื่อมกับ Payment/Bill, สร้าง Ledger ฝั่งเงินออก + Cash Movement ถ้าคืนสด
- Refund ช่องทางเดิมเป็นค่าเริ่มต้น ผู้มีสิทธิ์เลือกช่องทางอื่นได้
- `net_paid = valid_paid − valid_refund`
- ห้าม Delete Payment / ห้ามลดค่า Payment เดิมแทน Refund / เก็บ Reason และ Approver เสมอ
- ห้ามลบบิล — เลขเอกสารของบิลที่ Void ถือว่าใช้แล้ว

---

## 21. Settlement และการปิดบิล

### 21.1 Settlement (ระดับบิล)
- `final_amount_due` = `actual_rental_charge + damage_charge + lost_charge + confirmed_additional_charges + other_authorized_charges − discounts − credits` (Charge ที่ยืนยันแล้วเท่านั้น)
- `settlement_balance` = `final_amount_due − net_paid − deposit_applied_to_this_bill`
- > 0 ลูกค้าต้องชำระ / = 0 เคลียร์ / < 0 ร้านต้อง Refund
- ค่าเช่าของช่วงเช่าต่ออยู่ที่บิลลูก ไม่รวมในบิลแม่

### 21.2 เงื่อนไขปิดบิล
`CAN_CLOSE = financial_resolved AND merchandise_resolved AND exception_resolved`

- **merchandise_resolved**: ทุก RENTAL Line `obligation_held_here = 0` (คืนจริง / สูญหายที่อนุมัติ / disposition ที่อนุมัติ / Carry Forward ไปบิลลูกอย่างถูกต้องครบ) และทุก SALE Line ส่งมอบครบหรือยกเลิกส่วนที่เหลือ
- **financial_resolved**: `balance_due = 0` ของบิลนี้ (รวมการชำระด้วย Deposit `APPLY`) หรือมี Write-off ที่อนุมัติแล้ว และไม่มี Refund Due/Pending, ไม่มี Payment ค้างสถานะ
- **exception_resolved**: ไม่มี Missing ที่ยังไม่อนุมัติ, Damage/Lost Case ที่ยังไม่ resolve, Charge ที่ยังไม่กำหนด/ยืนยัน, การเกินกำหนดที่ยังไม่ตรวจ, Return/Stock Movement ค้างครึ่งทาง
- **Deposit ไม่อยู่ในเงื่อนไขปิดบิล** (Deposit เป็นของ Contract)
- ครบทุกเงื่อนไข → ระบบปิดบิลอัตโนมัติ (`CLOSED`)
- งานซ่อมภายในร้านไม่ขวางการปิดบิล
- บิลที่ปิดแล้วออกจากงานค้าง แต่ค้นได้จากประวัติ — ห้ามลบ

| ตัวอย่าง | ผล |
|---|---|
| จ่ายครบ + ของยังคืนไม่ครบ | ACTIVE |
| ของครบ + เงินยังไม่ครบ | ACTIVE |
| ของครบ + ชำรุดแต่ยังไม่กำหนด/ไม่เก็บค่าเสียหาย | ACTIVE |
| ของครบ + ชำรุดและเก็บค่าเสียหายแล้ว + เงินครบ | CLOSED |
| ของหายที่อนุมัติแล้ว + Charge เคลียร์ + ครบทุกอย่าง | CLOSED |
| มี Refund ค้าง | ACTIVE |
| คืนเกินกำหนดครบแล้ว แต่ยังไม่ตรวจเรื่องค่าใช้จ่ายเพิ่ม | ACTIVE |
| ส่งต่อของทั้งหมดไปบิลลูกแล้ว + เงินของบิลเดิมเคลียร์ + ไม่มี Exception | CLOSED (บิลลูกติดตามของต่อ) |
| เช่ากล้อง 2 ตัว ส่งต่อ 1 ตัว คืนจริง 1 ตัว + เงินเคลียร์ | CLOSED |
| ของครบ + เงินครบ + มัดจำของ Contract ยังถืออยู่ | CLOSED (มัดจำไม่ขวางบิล) |

---

## 22. Finance Ledger, Revenue, Income/Expense

- คำที่ห้ามใช้แทนกัน: Payment, Refund, Income, Expense, Cash Movement, Finance Ledger, Deposit Movement
- Stock และ Finance มี Ledger ของตัวเอง — **Deposit Ledger แยกจาก Income/Expense**
  - `RECEIVE` / `REFUND` ที่มีเงินจริงเข้าออก → สร้าง Cash/Bank Movement
  - Allocation/Application ภายใน Contract (`APPLY`) ไม่ใช่รายรับ/รายจ่าย
- Revenue Classification แยกตาม Mode (Sale Revenue / Rental Revenue) แม้รับเงินรวมที่บิล
- รายได้ของ Charge รับรู้เมื่อ Charge ถูกยืนยัน/earned
- รายรับ: Rental Revenue, Sale Revenue, Delivery Fee, Damage Charge, ค่าใช้จ่ายเพิ่มที่ยืนยันแล้ว, Service Fee, Other Income
- รายจ่าย (`expense_entries`): ซื้อสินค้า, ค่าซ่อม, ค่าขนส่ง, ค่าแรง, ค่าน้ำมัน, ค่าอุปกรณ์, ค่าใช้จ่ายทั่วไป — `amount > 0`, ต้องมี category และผู้สร้าง, รายการใหญ่ต้อง approval ถ้ากำหนด
- Refund ไม่นับเป็น Expense ปกติ
- รายการผิด → Void/Reversal แล้วสร้างใหม่

---

## 23. Customer Credit / AR

- ข้อมูล: `credit_enabled`, `credit_limit`, `current_balance`, `available_credit`, `payment_terms_days`, `overdue_balance`, `account_status`
- Flow: เปิดบิลเครดิต → Credit Enabled? → Current + New ≤ Limit? (ไม่ผ่าน → Block หรือ Approval) → AR → Invoice → Due Date → ชำระ → Overdue → Notification/Credit Block ตาม Policy
- หนี้ผูกกับแต่ละบิล
- ค่า Credit Limit / Credit Block Rule — หมวด 37

---

## 24. Cash Session / ปิดกะ / ปิดวัน

- OPEN SHIFT → Opening Cash → Cash Sale / Refund / Cash In / Cash Out (ทุกครั้งเป็น Cash Movement) → Expected Cash → Count Actual → `Variance = Actual − Expected`
- Variance = 0 → `CLOSED` / ≠ 0 → Reason + Approval + Audit → `CLOSED_WITH_VARIANCE`
- หลังปิด: Till → Safe → Bank Deposit
- Cash Movement ของ Deposit (`RECEIVE`/`REFUND` เงินสด) นับใน Expected Cash
- เวลาตัดวันบัญชี / ผู้ปิดกะ / เกณฑ์ Variance — หมวด 37

---

## 25. เอกสารพิมพ์

- รูปแบบ: A4, 80mm, PDF, Email/Shareable PDF, สำเนา
- **Document Data แยกจาก Renderer** — Renderer อ่านค่าที่คำนวณแล้วเท่านั้น ห้ามมี Business Logic ซ้ำใน Renderer
- เอกสารย้อนหลังต้องสร้างซ้ำได้จากข้อมูลเดิม
- ข้อมูลที่ควรมี: Logo, Company, Tax ID, Address, Phone, Document Number, Customer, Items, Sale/Rental Mode, Rental Period, Discount, VAT, Shipping, Deposit (แสดงแยกจากรายได้), Grand Total, Payment Summary, Signature, QR, Footer, Copy Number
- **เอกสารสัญญาเช่า** ใช้ `contract_no` และ `terms_snapshot` ของ Contract Version — ไม่ใช้เลขบิลแทนเลขสัญญา
- บันทึก Document Reference ทุกครั้งที่ Print/Save/Share

---

## 26. Appointment

- ประเภท: `PICKUP`, `DELIVERY`, `RETURN`, `INSTALLATION`, `PAYMENT`, `FOLLOW_UP`, `INSPECTION`, `REPAIR`, `GENERAL`
- ข้อมูล: `appointment_type`, `customer_id`, `bill_id`, `related_entity_type/id`, `title`, `description`, `start_datetime`, `end_datetime`, `location`, `contact_name/phone`, `assigned_user_id`, `priority`, `status`, `reminder_before_minutes`
- Flow: สร้าง → ประเภท → ลูกค้า → Bill/Entity → วันเวลา → ผู้รับผิดชอบ → สถานที่ → Reminder → ตรวจ Conflict → Create → Audit → Reminder → Execute → Complete/Reschedule/No-show
- เลื่อนนัด: เก็บ `original_start_datetime`, `new_start_datetime`, `reschedule_reason`, `rescheduled_by`, `rescheduled_at` + Appointment History
- ยกเลิก: `cancel_reason`, `cancelled_by`, `cancelled_at` — ห้ามลบนัด
- Validation: ห้าม end < start, ห้ามเวลาไม่ครบ, งานที่ต้องมอบหมายต้องมี `assigned_user_id`, เตือน Conflict

---

## 27. Notification

- Severity: `INFO`, `WARNING`, `CRITICAL`
- Flow: Event → Rule → เข้าเงื่อนไข? → Severity → Recipient → Channel → Notification → Read → Action → Handled → Audit
- **Notification ≠ Business State** — อ่านแล้วไม่ได้แปลว่าปัญหาถูกแก้ และห้ามเปลี่ยนสถานะธุรกิจอัตโนมัติ — `HANDLED` ได้หลัง Action สำเร็จ
- Critical ห้ามถูกซ่อนโดยผู้ไม่มีสิทธิ์
- กันซ้ำด้วย `event_key` / idempotency key
- ผู้รับกำหนดตาม **ผู้ใช้ที่มอบหมาย / Permission ที่เกี่ยวข้อง / OWNER** (ไม่ใช้ Role MANAGER/CASHIER/STOCK/FINANCE)
- ตัวอย่าง Event: Rental Due Soon, Rental Due, Rental Overdue, Return ไม่ครบ, Bill ค้างชำระ, Low Stock (Available ≤ Reorder Point), Out of Stock, Over Reserved, Damage, Lost, Repair Pending, Refund Requested, Cash Variance, Transaction Failed, Sync Failed, Approval Pending, Appointment Due, Price/Cost Missing, Inactive Product Used, Stock Mismatch
- Rental Overdue แจ้งเตือนเท่านั้น (หมวด 16)
- เวลาแจ้งเตือน — หมวด 37

---

## 28. Security / RLS / Server-side / Transaction

### 28.1 3 Layers
1. **RLS** — ใครอ่าน/เขียน row ไหนได้
2. **Permission** — ใครทำ Action ไหนได้
3. **RPC / Server Transaction** — งานสำคัญทำฝั่ง Server

### 28.2 Action ที่ต้องผ่าน Server/RPC
`confirm_bill`, `receive_payment`, `refund_payment`, `cancel_bill`, `void_bill`, `deliver`, `receive_return`, `approve_lost`, `confirm_charge`, `stock_adjust`, `close_bill`, `close_cash_session`, `create_rental_continuation`, `reverse_carry_forward`, `deposit_receive`, `deposit_apply`, `deposit_refund`, `contract_create`, `contract_new_version`, `contract_end`, `contract_void`, `correct_bill`

### 28.3 ห้าม Client ทำตรง
- `UPDATE inventory SET qty = …`
- `UPDATE payments SET amount = …`
- `DELETE` ธุรกรรมใด ๆ

### 28.4 Transaction / Locking
- Atomic ทุกเหตุการณ์สำคัญ — Lock แถวที่เกี่ยวข้อง (Bill/Line/Inventory/Deposit Holding/Sequence)
- ป้องกัน Double Submit ด้วย idempotency key
- ห้ามให้ Stock, Balance, Deposit Holding หรือ `obligation_held_here` กลายเป็นค่าที่ไม่สมเหตุผล (ติดลบ/เกินจริง)

---

## 29. Audit

- Audit Event: `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `before_data`, `after_data`, `reason`, `device/workstation`, `timestamp`, `correlation_id`
- ต้อง Audit อย่างน้อย: Bill Create/Confirm, เพิ่ม/เปลี่ยน Line (Mode, ราคา, จำนวน, Rental Period), Delivery, Payment, Refund, Cancel, Void, Price Override, Stock Adjustment, Count Adjustment, Customer Edit, Product Edit, Damage, Lost, Write-off, Approval, Charge Confirm, Correction, การเช่าต่อ/Carry Forward/Reversal, Contract Create/New Version/End/Void, Deposit Movements, Cash Close, Expense, Permission Change, Appointment Cancel/Reschedule
- ผู้ใช้ปกติห้ามแก้/ลบ Audit — Export/Report ได้ตามสิทธิ์ `audit.view`
- Retention Policy — หมวด 37

---

## 30. Backup / Restore

- Production DB → Automated Backup → Retention → Integrity Check → Periodic Restore Test → บันทึกผล
- Backup ที่ไม่เคย Restore Test ยังไม่ถือว่ากู้คืนได้
- Frequency, Retention, PITR, Offsite Copy, Encryption, Restore Test Frequency, RPO, RTO — หมวด 37

---

## 31. Reporting

| หมวด | รายการ |
|---|---|
| Sales | ยอดขาย, จำนวนบิล, Average Bill, Sale Revenue, Discount, VAT, Refund, Mixed Bills |
| Rental | Rental Revenue, Active Rentals, Due Soon, Overdue, Returned, Partial Return, Damage, Lost, Utilization, Continuation (การเช่าต่อ) |
| Inventory | On Hand, Available, Reserved, Rented Out, Repair, Damaged, Lost, Adjustment, Stock Discrepancy, Stock Movement per Mode |
| Finance | Cash, Transfer, Card, QR, Revenue (per Mode), Expense, Refund, Outstanding Receivable, **Deposit Liability**, **Deposit Movements** |
| Contract | Contracts ACTIVE/ENDED/VOID, Bills ต่อ Contract, ของค้างต่อ Contract (Σ `obligation_held_here`), Deposit ต่อ Contract |
| Customer | Purchase/Rental History, Outstanding, Overdue History, Damage/Lost History, Credit Usage |
| Operations | Appointment, Delivery, Return, Employee Activity, Approval Pending, Notification Pending |

- รายงาน Deposit ต้องแยกจาก Revenue/Income/Expense

---

## 32. Validation สรุป

| เรื่อง | กฎ |
|---|---|
| Document | เลข Unique ต่อชนิด, ห้าม Recycle, เลข Final ห้ามแก้ |
| Tax/Discount | ส่วนลดไม่เกิน Policy, VAT rate valid, ลำดับคำนวณแน่นอน |
| Sale | `can_sell`, `qty > 0`, `sale_price ≥ 0`, Stock พอ |
| Rental | `can_rent`, `qty > 0`, `rental_rate ≥ 0`, `period_count > 0`, `start_at`/`end_at` ต้องมี, `end_at > start_at`, ต้องมี Customer และ Contract ก่อน Confirm |
| Mixed Bill | Validate ทุก Line ก่อน Commit, ห้าม Commit บาง Line |
| Payment | `amount > 0`, idempotency, permission, balance valid, method valid |
| Return | `qty > 0`, `qty ≤ obligation_held_here`, ของเป็นของ Line นั้น, Condition required |
| Continuation | สิทธิ์ `rental.continue` + อนุมัติ, `quantity ≤ obligation_held_here`, parent เดียว, Contract เดียวกัน, วันเริ่มไม่ซ้อนรอบเดิม, Serial ครบสำหรับของรายชิ้น |
| Deposit | ห้ามนับเป็น Revenue, Deposit Available ห้ามติดลบ, `APPLY` ต้องเลือกเป้าหมาย + amount + ยืนยัน + Reason (ห้ามอัตโนมัติ), `APPLY`/`REFUND` ≤ Deposit Available, เป้าหมายต้องอยู่ใต้ Contract เดียวกัน, Full/Final Refund ต้องผ่านเงื่อนไขหมวด 18.5 |
| Continuation หลังเลยกำหนด | ผู้อนุมัติต้องเลือก `continuation_start_mode` เอง + Reason + Audit, เลือกย้อนหลังห้ามมี Charge เกินกำหนดซ้ำช่วงเดียวกัน |
| Overdue | timezone ร้าน, ห้ามสร้าง Charge อัตโนมัติ, ห้ามคิดซ้ำช่วงเดียวกัน, ห้ามเช่าต่ออัตโนมัติ |
| Correction | ห้ามยืดช่วงเช่าของ Line ที่ส่งมอบแล้ว, ห้ามเพิ่ม delivered, ห้ามแทนการเช่าต่อ |
| Refund | ≤ refundable amount, reason, permission/approval |
| Stock | ไม่ติดลบเว้นแต่มีกฎ, Lock, Adjustment ต้องมี reason, damaged ห้ามเข้า Available ตรง, lost ห้ามเพิ่ม Stock |
| Reservation | ต้องมี Expiry, Release เมื่อหมดอายุ |
| Backorder | ห้ามนับเป็น Delivered, Partial Delivery ต้องมี Record |
| Stock Count | Adjustment ต้องมาจาก Discrepancy, ต้อง Audit |
| Credit | ตรวจ Limit, ตรวจ Overdue |
| Cash Close | Expected vs Actual, Variance ต้องบันทึก |
| Contract | ENDED เมื่อไม่มีบิลค้าง/ของค้าง/Deposit = 0, VOID เฉพาะไม่มีธุรกรรมหรือ Reverse ครบแล้ว, Version immutable |

---

## 33. Domain หลักของระบบ

1. **Master Data** — Customer, Product, Product Unit, Tax, Discount, Role, Permission
2. **Contract** — Rental Contract, Contract Version
3. **Commercial** — Quotation, Reservation, Order, Bill, Receipt
4. **Rental** — Rental Terms, Rental Delivery, Return, Overdue, Continuation/Carry Forward, Damage, Lost, Settlement
5. **Inventory** — Reservation, Allocation, Backorder, Fulfillment, Delivery, Stock Movement, Count, Adjustment, Serialized Rental Unit
6. **Finance** — Payment, Refund, Charge, Adjustment, Ledger, Deposit Holding/Movements, AR/Credit, Expense, Cash Session
7. **Operations** — Appointment, Notification, Approval
8. **Control** — Audit, Security, RLS, RPC, Backup
9. **Reporting** — Sales, Rental, Stock, Finance, Contract, Customer, Operations

---

## 34. แนวทางฐานข้อมูล (Database Direction)

- Production Supabase ปัจจุบัน **ว่าง** (ไม่มีตารางและไม่มี migration ที่ apply แล้ว)
- หลัง Master Rules นี้ล็อก ให้วาง **Consolidated Baseline Schema ใหม่** ตามไฟล์นี้ — ไม่ยึด 19 migration เดิมใน `supabase/migrations/` เป็นลำดับที่จะ apply
- Baseline ต้องสอดคล้องหมวด 3 (UUID, Document Number แยก, ห้าม CASCADE ไปข้อมูลการเงิน/ประวัติ), หมวด 6, 14, 17, 18
- ค่า Derived (paid_amount, balance_due, returned_qty, obligation ฯลฯ) cache ได้ แต่ต้องมีแหล่งจริงจาก Transaction Records

---

## 35. Implementation Gap ที่รู้แล้ว (Reference — ไม่ใช่กฎ)

สิ่งที่พบในโค้ด/Schema เดิม และขัดกับไฟล์นี้ ต้องแก้ตอน implement:

| พบใน Implementation เดิม | กฎที่ถูกต้อง |
|---|---|
| `rentalStatus = 'EXTENDED'` และโหมด `EXTENSION` | `EXTENDED`/`EXTENSION` เป็น legacy — ใช้ Carry Forward + Derived Flag (หมวด 9, 17) |
| บิล `-EXT` ตั้ง `parent_bill_id = original_bill_id = บิลที่ถูกต่อ` เสมอ | `original_bill_id` = บิลแรกสุดของสาย (หมวด 17.2) |
| ไม่มี Carry Forward ระดับ Line/Quantity | ใช้ `rental_carry_forwards` (หมวด 17.3) |
| โหมด CORRECTION เขียนทับวันเริ่ม/วันคืนและยอดของบิล | Correction ห้ามยืดช่วงเช่า/ห้ามแทนการเช่าต่อ (หมวด 19.3) |
| Settings มี `lateFeeMode` / คำนวณ `lateFeeTotal` | ห้ามคิดค่าเกินกำหนดอัตโนมัติ (หมวด 16) |
| Deposit เก็บที่บิล (`held_deposit_amount`, `deposits` JSONB, `is_deposit`) | Deposit ระดับ Contract (หมวด 18) |
| ไม่มี Entity Rental Contract (มีแค่เทมเพลต `tpl_rental_contract`) | Rental Contract + Version (หมวด 6) |
| ID เป็น `TEXT`, FK การเงินใช้ `ON DELETE CASCADE` | UUID + RESTRICT/NO ACTION (หมวด 3) |
| `permissions.role` + boolean หยาบ | OWNER/USER + Permission ราย Action (หมวด 4) |
| ข้อความระบบ/UI ใช้คำว่า "ต่อสัญญา" และเรียกบิลว่า "สัญญา" | ใช้คำตามหมวด 1 |
| ชุดเลขเอกสาร "บิลเช่า / สัญญาเช่า" ใช้ร่วมกัน | Contract Number แยกชุด (หมวด 3.2) |

---

## 36. OPEN DECISIONS

**ไม่มี OPEN Business/Architecture Decision คงเหลือ — Architecture Business Rules = LOCKED (2026-10-01)**

| เรื่องที่ปิดแล้ว | กฎอยู่ที่ |
|---|---|
| เช่าต่อหลังเลยกำหนด — ผู้มีสิทธิ์เลือกวิธีเริ่มบิลลูกเองทุกครั้ง | หมวด 16, 17.4.1 |
| Deposit Policy — `APPLY` ได้ทุกยอดใต้ Contract เดียวกัน / คืนบางส่วนระหว่าง `ACTIVE` ได้ / เงื่อนไข Full/Final Refund | หมวด 18.3–18.5 |

การเปลี่ยนกฎที่ LOCKED ต้องมาจากคำตัดสินใหม่ของเจ้าของระบบ และต้องปรับไฟล์นี้ก่อน implement
ค่า Policy/Configuration ในหมวด 37 ไม่ถือเป็น Architecture Blocker

---

## 37. Policy ที่ยังไม่กำหนดค่า (ตั้งค่าได้ — ไม่ใช่ Architecture Blocker)

Master Spec ระบุว่าต้องเลือกค่าเอง (ส่วนที่ถูก Override แล้วถูกตัดออก):

1. รูปแบบเลขเอกสารแต่ละชนิด (รวม Contract) และรอบ Reset (รายปี/รายเดือน)
2. Layout A4 / 80mm และข้อความท้ายเอกสาร
3. Discount order (ก่อน/หลัง VAT), เพดานส่วนลด, ผู้แก้/ผู้ Override
4. VAT inclusive/exclusive และ Shipping tax treatment
5. Deposit Calculation (จำนวนมัดจำที่เรียกเก็บต่อ Contract/บิล) และยอดมัดจำขั้นต่ำที่ต้องคงไว้ค้ำของระหว่าง Partial Refund (ถ้าร้านต้องการใช้)
6. Early Return Policy (คิดเต็ม / คิดตามวันใช้จริง)
7. Grace period และเวลาแจ้งเตือน Due Soon / Due / Overdue (ใช้เพื่อแจ้งเตือนเท่านั้น)
8. Damage Charge Formula และ Lost Charge Formula (ค่าตั้งต้นให้ผู้มีสิทธิ์ยืนยัน)
9. Approval Threshold ของแต่ละ Action เสี่ยง
10. Reservation Expiry
11. Partial Delivery Policy
12. Credit Limit และ Credit Block Rule
13. Notification Timing / Channel
14. Backup Frequency / Retention / RPO / RTO / Restore Test
15. Audit Retention
16. Day Close Time และ Cash Variance Threshold
17. Timezone ของร้าน (ค่าเดียวที่ใช้ทั้งระบบ)

---

## ภาคผนวก — REFERENCE / SOURCE MATERIAL

> **สถานะ: REFERENCE เท่านั้น** — ถ้าข้อความในแหล่งต่อไปนี้ขัดกับ Master Rules ด้านบน ให้ Master Rules มีอำนาจเหนือกว่าเสมอ

### แหล่งข้อมูลดิบ
ภาคผนวก AE ของ `POS_MASTER_ALL_IN_ONE_COMPLETE_SPEC_TH.txt` (ไม่คัดลอกมาไว้ในไฟล์นี้ เพื่อไม่ให้มีข้อความที่ขัดกับกฎปรากฏซ้ำ):

| Source | หัวข้อ | บรรทัดโดยประมาณในไฟล์ Spec |
|---|---|---|
| SOURCE 1 | Appointment / Notification / Product / Customer / Finance Workflow | 1313–2680 |
| SOURCE 2 | Partial Return / Partial Payment Workflow | 2684–3897 |
| SOURCE 3 | Early Return / Overdue / Refund / Damage / Lost Workflow | 3901–5113 |
| SOURCE 4 | Mixed Sale + Rental Bill / Mode Separation | 5117–6143 |
| SOURCE 5 | Master Spec Completion 17 Areas | 6147–7627 |

กฎเก่า: `docs/archive/PROJECT_RULES_MASTER_v2.3.0.md`, `docs/archive/AUDIT_MASTER_V23_IMPLEMENTATION.md`

### ข้อความใน Source Material ที่ถูก Override (อย่านำไปใช้)

| ข้อความในต้นฉบับ | ถูก Override โดย |
|---|---|
| Role `OWNER / MANAGER / CASHIER / STOCK / FINANCE` และการส่งงาน "ส่ง Manager" | OWNER / USER + Permission ราย Action (หมวด 4) |
| คำนวณ Late Fee / Late Penalty / สร้าง Charge เมื่อ Overdue / "ค่าปรับคงอยู่" / Late Policy (`late_fee_type`, `late_fee_amount`, `late_fee_percent`, min/max) | แจ้งเตือนเท่านั้น ห้ามสร้าง Charge อัตโนมัติ ค่าใช้จ่ายเพิ่มต้องยืนยันโดยผู้มีสิทธิ์ (หมวด 16) |
| `renewal_charge` และ `late_penalty` ในสูตร `final_amount_due` | ค่าเช่าช่วงเช่าต่ออยู่ที่บิลลูก / ใช้ `confirmed_additional_charges` (หมวด 21.1) |
| Renewal / ต่ออายุ / RENEWALS ใต้ Rental Bill | การเช่าต่อ = บิลใหม่ + Carry Forward (หมวด 17) |
| ชื่อเชื่อม `renewal_of`, `parent_rental_id`, `previous_rental_id` | `parent_bill_id`, `original_bill_id`, `rental_carry_forwards` (หมวด 17) |
| `rental_contract_id` ใน `RENTAL_LINE_DETAILS` | Contract ผูกที่ Bill (`rental_contract_id` + `rental_contract_version_id`) (หมวด 6.3) |
| Deposit อยู่ใต้ Rental Bill / "Deposit ถูกคืน/หัก/เคลียร์แล้ว" เป็นเงื่อนไขปิดบิล | Deposit ระดับ Contract และไม่ขวางการปิดบิล (หมวด 18, 21) |
| "หัก Deposit" อัตโนมัติใน Flow ชำรุด/สูญหาย | `APPLY` ต้องยืนยันโดยผู้มีสิทธิ์ (หมวด 18.3) |
| Notification ผู้รับ "CASHIER + OWNER", "STOCK + MANAGER", "MANAGER/OWNER" | ผู้รับตามการมอบหมาย/Permission/OWNER (หมวด 27) |
| "ใช้ยอดตามสัญญาเดิม" ใน Flow คืนก่อนกำหนด | อ่านว่า "ยอดตามบิลเดิม" — บิลไม่ใช่สัญญา (หมวด 1, 15) |
| Internal ID "UUID หรือ Internal Key" | UUID (หมวด 3.1) |
