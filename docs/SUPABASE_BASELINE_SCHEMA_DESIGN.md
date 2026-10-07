# SUPABASE CONSOLIDATED BASELINE — SCHEMA DESIGN

**สถานะ:** SQL ที่ `supabase/baseline/00_baseline.sql` ทำตามกฎ Master v4.3 แล้ว (ยังไม่ apply บน Supabase Cloud) — รายละเอียด v4.3 (PIN ล็อก/กู้คืน, คืนก่อนกำหนด, VAT/ส่วนลด, Refund ผูก Payment) อยู่ใน Master หมวด 36.1 และตัว SQL — หมวด V42 คือแบบปัจจุบัน; หมวด 1–12 เป็นแบบ v4.1 เดิม ถ้าขัดกันให้ยึด V42 และตัว SQL
**อ้างอิงกฎ:** `docs/PROJECT_RULES_MASTER_CURRENT.md` **v4.2.0** (กฎชนะเอกสารนี้และ implementation เดิมเสมอ)
**วันที่:** 2026-10-02 (ปรับหัวเอกสารและเพิ่มหมวด V42 เมื่อ 2026-10-04)
**ขอบเขต:** baseline สำหรับ Supabase Cloud — ส่วน Auth/Profile ลงแล้วจาก `supabase/auth-only/01_auth_profiles.sql` ต้องข้ามเมื่อ apply baseline / migration เก่าถูกลบออกจากโปรเจกต์แล้ว

ห้ามโดยไม่มีคำสั่งเจ้าของระบบ: apply ตารางธุรกิจบน Supabase Cloud, deploy

---

## V42. สิ่งที่เปลี่ยนตามกฎ v4.2 (แก้ใน SQL แล้ว 2026-10-04 — ทดสอบด้วย supabase/tests/run_local.sh)

หมวดนี้มีอำนาจเหนือหมวด 1–12 ด้านล่าง ถ้าขัดกันให้ใช้หมวดนี้

### V42.1 ตัดออก
| ของเดิมใน baseline | เหตุผล (Master v4.2) |
|---|---|
| `rental_contracts`, `rental_contract_versions`, `contract_templates`, RPC `contract_*`, คอลัมน์ `bills.rental_contract_id` / `rental_contract_version_id` และเงื่อนไข "ต้องมีสัญญาก่อน confirm" | สัญญาเป็นเอกสารลูกค้า บิลไม่ผูกสัญญา (§6) |
| `deposit_holdings`, `deposit_movements`, RPC `deposit_receive/apply/refund/reverse` | มัดจำผูกบิลเช่า ระบบไม่หัก/คืนอัตโนมัติ (§18) |
| `cash_sessions`, `cash_movements`, RPC `cash_session_open`, `cash_in_out`, `close_cash_session`, พารามิเตอร์ `p_cash_session_id` และ error `CASH_SESSION_REQUIRED` | ไม่มีกะ เงินสดเป็นช่องทางหนึ่ง (§24) |
| `approval_requests`, RPC `refund_decide`, `expense_decide`, `lost_approve`, `write_off_approve` (แบบอนุมัติ), `stock_count_approve` (แบบอนุมัติ), `rental_continuation_request/reject` และสถานะ REQUESTED/PENDING ที่รออนุมัติ | Free-style ไม่มีขั้นอนุมัติ (§4.4) |
| `permission_catalog` / `user_permissions` แบบราย Action (รวม 8 รหัสในหมวด 4.I) และ `has_permission(code)` | สิทธิ์ระดับเมนู + PIN (§4.2) |
| `store_settings.policies.require_separate_approver`, `stock_adjust_approval_qty` | ไม่มีการอนุมัติ |
| `profiles` / `is_active_member` / `is_owner` / signup trigger ในหมวด 4.A | **ลงแล้ว** บน Cloud จาก `auth-only` — baseline ต้องข้าม ห้ามสร้างซ้ำ |

### V42.2 เพิ่ม
| ของใหม่ | รายละเอียด (Master v4.2) |
|---|---|
| `user_menu_access` | (`user_id` FK profiles R, `menu_code`) PK คู่ — OWNER เข้าได้ทุกเมนูโดย role; helper `has_menu(code)` ใช้ใน RLS/RPC; รายการ `menu_code` ตาม Master §37 ข้อ 9 |
| `user_pins` | (`user_id` PK FK profiles R, `pin_hash`, `pin_salt` หรือ crypt/bcrypt, `failed_attempts`, `locked_until`, `updated_at`) — ไม่มี policy ให้ client อ่าน; RPC `set_pin`, `verify_pin` (SECURITY DEFINER) และ helper `_require_pin(p_pin)` ที่ RPC เสี่ยงเรียกใน transaction เดียวกัน — ห้ามเก็บ/log เลข PIN |
| `units` | รายการหน่วยนับ (`id`, `name` UNIQUE, `active`) — `products.unit_id` FK แทน `products.unit` ข้อความ |
| ฟิลด์ `products` | `is_accessory`, `is_rent_chargeable` (ติดตามสต็อกแต่ไม่คิดค่าเช่า), `requires_return`, `default_damage_fee`, `default_loss_fee` (≥ 0) — ไม่มีรูป ไม่มีจำนวนต่อชุด |
| `customer_documents` | (`id`, `customer_id` FK R, `doc_type`, `template_code`/`template_version` สำหรับสัญญา, `signature_svg`/`signature_json`, `storage_path` สำหรับภาพบัตร/ทะเบียนบ้าน, `created_by`, `created_at`, `status`) ห้าม hard delete + Storage bucket แบบ private ที่ policy ตรวจสิทธิ์เมนูลูกค้า |
| มัดจำของบิล | คอลัมน์ `bills.deposit_amount` (≥ 0, ไม่รวมใน `grand_total`) + ข้อมูลผู้รับ/เวลา — การบันทึกผลคืน/หักรอ Master §37 ข้อ 5 |
| `other_income_entries` | (`amount` > 0, `category`, `channel`, `note`, `created_by`) + RPC `other_income_create` — ห้ามใช้แทนการขายสินค้า |
| RPC `convert_damaged_stock` | ตัด DAMAGED ของ A + รับเข้า B + stock movements 2 ฝั่งที่อ้างอิงกัน + PIN + audit ใน transaction เดียว |
| คอลัมน์ audit | `pin_verified`, `amount`, `quantity`, `channel`, `result`, `device_session` ใน `audit_logs` |

### V42.3 เปลี่ยน
| ของเดิม | เป็น |
|---|---|
| RPC เสี่ยง (refund, void/cancel ที่ยืนยันแล้ว, stock_adjust, ของหาย/write-off, expense, แก้ราคา/override ราคา, correction/adjust, ลด/ยกเว้นค่าเสียหาย) ตรวจด้วย permission code | ตรวจ `has_menu(...)` + `_require_pin(p_pin)` + reason + audit (Master §4.4) |
| `refunds` REQUESTED → APPROVED → PAID | สร้างแล้วจ่ายใน RPC เดียว (PIN) |
| `expense_entries` PENDING → APPROVED | บันทึกแล้วมีผลทันที (PIN) |
| `stock_counts` อนุมัติ | ยืนยันผลนับด้วย PIN |
| `incident_cases` LOST อนุมัติ | บันทึก LOST ด้วย PIN; ค่าสูญหายเติมจาก `default_loss_fee` แก้ได้ |
| `charges` ค่าเสียหาย | เติมจาก `default_damage_fee`; ถ้ายอดต่างจากที่เสนอต้องผ่าน PIN |
| การเช่าต่อ | ไม่มีขั้นขอ/อนุมัติ; บิลลูกไม่ผูกสัญญา; `continuation_approved_*` → ผู้ทำรายการ |
| `payments` | ไม่มี `cash_session_id`; เก็บ channel + ผู้รับเงิน |

### V42.4 การทดสอบ
- ผลทดสอบในหมวด 12 เป็นของแบบ v4.1 และสคริปต์อยู่นอกโปรเจกต์ — **ห้ามใช้อ้างอิงว่ารองรับกฎ v4.2**
- หลังแก้ SQL ตาม V42 ต้องเขียนชุดทดสอบใหม่ไว้ในโปรเจกต์ แล้วรันบนฐานข้อมูลทิ้งได้ในเครื่องก่อน

---

## 0. สรุปสั้น

- Baseline ใหม่มี **49 ตาราง** ใน 8 กลุ่ม ทุกตารางใช้ UUID PK, FK ทุกเส้นเป็น `ON DELETE RESTRICT`, ไม่มี `CASCADE` เลย
- **Client (role `authenticated`) ได้แค่ `SELECT`** บนตารางธุรกิจทั้งหมด งานเขียนทุกอย่างผ่าน RPC ที่ตรวจ ACTIVE member + permission ราย action + lock + idempotency + audit ใน transaction เดียว ยกเว้น `profiles` (แก้ชื่อของตัวเอง)
- `anon` ไม่ได้สิทธิ์ใด ๆ ทั้งตารางและฟังก์ชัน
- Logic สิทธิ์/สมาชิกจาก `20261002000001_action_permissions_rls_lockdown.sql` ย้ายมาเกือบทั้งหมด พร้อมแก้ 3 จุด (race ของ `bootstrap_owner`, `require_permission` แบบ fail-closed, `is_approved` เป็น generated column)
- พบ **security blocker ใน chain เดิม 8 ข้อ** (หมวด 1) — ทั้งหมดถูกปิดโดยการออกแบบ baseline แต่ **โค้ดฝั่ง app ยังเขียนตารางตรงอยู่** ต้องย้ายไปเรียก RPC ก่อนใช้ baseline จริง

---

## 1. ผลตรวจ 4 จุดก่อนสร้าง baseline

### 1.1 `bootstrap_owner()` (`20261002000001` บรรทัด 504–540)

| คำถาม | ผล | หลักฐาน |
|---|---|---|
| SECURITY DEFINER | ใช่ | บรรทัด 507 |
| `SET search_path` ปลอดภัย | ใช่ — `public, pg_temp` (pg_temp อยู่ท้าย) และอ้างตารางแบบมี schema ทุกที่ | บรรทัด 508 |
| revoke EXECUTE จาก PUBLIC/anon | ใช่ — revoke จาก `PUBLIC, anon, authenticated` แล้ว grant ให้ `service_role` เท่านั้น | บรรทัด 539–540 |
| authenticated USER เรียกเองได้ไหม | **ไม่ได้** — ถูกตัดที่ระดับ GRANT ก่อนถึงตัวฟังก์ชัน | บรรทัด 539 |
| กัน OWNER ซ้ำ | ปฏิเสธเมื่อมีแถว `role = 'OWNER'` อยู่แล้ว (`OWNER_ALREADY_EXISTS`) | บรรทัด 513–516 |
| กัน OWNER คนสุดท้าย | bootstrap ไม่ลดสิทธิ์ใคร — การกันอยู่ที่ `owner_set_member_status` / `owner_set_member_role` (`LAST_OWNER`, `CANNOT_CHANGE_SELF`) | บรรทัด 324–342, 386–410 |

**ช่องโหว่ที่เหลือ (แก้ใน baseline):**
1. **Race ตอนยังไม่มี OWNER** — `PERFORM 1 FROM profiles WHERE role='OWNER' FOR UPDATE` ไม่ lock อะไรเลยเมื่อไม่มีแถว ถ้ารัน bootstrap 2 ครั้งพร้อมกันอาจได้ OWNER 2 คน → baseline ใช้ `pg_advisory_xact_lock(hashtext('pos.owner_membership'))` ทั้งใน bootstrap และ owner RPC ทุกตัว
2. ไม่มีการตรวจผู้เรียกในตัวฟังก์ชัน (พึ่ง GRANT อย่างเดียว) → baseline เพิ่ม `IF auth.uid() IS NOT NULL THEN RAISE 42501` (service_role/SQL editor ไม่มี uid) เป็นชั้นที่สอง
3. Default privileges ของ Supabase ให้ EXECUTE กับ `anon`/`authenticated` อัตโนมัติทุกฟังก์ชันใหม่ → baseline เริ่มไฟล์ด้วย `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;` แล้ว grant ทีละฟังก์ชัน

### 1.2 RPC ที่เป็น SECURITY DEFINER ทั้งหมดใน chain เดิม

| ฟังก์ชัน | ไฟล์ | auth.uid() | ACTIVE member | permission | search_path | grants | ผล |
|---|---|---|---|---|---|---|---|
| `handle_new_auth_user_profile` (trigger) | `20261002000001`:63 | n/a | สร้างเป็น PENDING | n/a | ✓ | revoke ครบ | **reuse** |
| `is_active_member` / `is_owner` / `has_permission` | `20261002000001`:194–254 | ✓ | ✓ | ✓ | ✓ | authenticated, service_role | **reuse** |
| `write_member_audit` | `20261002000001`:260 | stamp จาก uid | n/a | internal | ✓ | service_role only | reuse (รวมเป็น `_audit`) |
| `owner_set_member_status/role/permissions` | `20261002000001`:301–501 | ✓ | ✓ (ผ่าน is_owner) | OWNER | ✓ | authenticated | **reuse** + advisory lock |
| `bootstrap_owner` | `20261002000001`:504 | — | — | service_role | ✓ | service_role only | reuse + แก้ตาม 1.1 |
| `process_split_payment_rpc` (8 args wrapper) | `20260924000007`:20 | ✓ (ไม่รับ anon) | **✗** | **✗ ไม่ตรวจ `payment.receive`** | ✓ | authenticated | **discard — CRITICAL** |
| `process_split_payment_rpc_secure` (core) | `20260924000001`:44 | ✓ | **✗** | **✗** | ✓ | service_role | discard |
| `process_split_payment_rpc` (ต้นฉบับ) | `20260919000002`:126, 411 | ✗ | ✗ | ✗ | **ไม่มี** | **grant anon** | discard |
| `process_payment_refund_rpc` | `20260923000001`:9 | ✓ | **✗** | **✗ ไม่ตรวจ `refund.create`/`refund.approve`** | ✓ | authenticated | **discard — CRITICAL** |
| `record_stock_movement_atomic` | `20260929000001`:88 | ✓ | ผ่าน RLS | **✗** | ✓ | authenticated | SECURITY **INVOKER** — discard |

**สาเหตุหลัก:** RPC เงินเป็น SECURITY DEFINER จึงข้าม RLS ทั้งหมด แต่ตรวจแค่ "มี uid" → ผู้ใช้ที่สมัครแล้วยัง **PENDING** หรือถูก **SUSPENDED** ก็รับเงิน/คืนเงินได้ และ USER ที่ไม่มีสิทธิ์ `payment.receive` / `refund.create` ก็ทำได้ (lockdown migration ตั้งใจไม่แตะส่วนนี้ — ดูหัวไฟล์บรรทัด 26–31)

**กฎ baseline สำหรับ SECURITY DEFINER ทุกตัว:**
1. `SET search_path = ''` (ว่าง) และอ้างชื่อแบบ `public.x`, `auth.uid()` ทุกที่ — เข้มกว่า `public, pg_temp`
2. บรรทัดแรกของ body: `PERFORM public._require_permission('<code>');` — raise `42501` ถ้าไม่ใช่ ACTIVE member, ไม่มีสิทธิ์ หรือ **code ไม่มีใน catalog** (fail-closed กันพิมพ์ผิด)
3. ผู้ทำ (`created_by`, `actor_id`) มาจาก `auth.uid()` เสมอ ห้ามรับจาก parameter (รวมทาง service_role)
4. Idempotency ผ่าน `public._idempotency_begin(action, key, request_hash)` ที่ `INSERT ... ON CONFLICT (actor_id, action, idempotency_key)` + lock แถว ก่อนงานจริง (actor = `auth.uid()`)
5. `REVOKE ALL ... FROM PUBLIC, anon` แล้ว `GRANT EXECUTE ... TO authenticated` เฉพาะ RPC สาธารณะ; ฟังก์ชันขึ้นต้น `_` (internal) ไม่ grant ให้ client เลย

### 1.3 Finance / Stock direct writes (ต้องปิดและย้ายเข้า RPC)

| ตาราง | ช่องทางเขียนตรงตอนนี้ | ปัญหา | ใน baseline |
|---|---|---|---|
| `bills` | `features/bills/api/bill-repository.ts:143` `upsert(fullBillToDbBill(bill))` — policy `bills_update` อนุญาต ACTIVE member ทุกคน (`20261002000001`:746) | แก้ `paid_amount`, `payment_status`, ยอดรวม, วันเช่า ได้ตรง ๆ ข้ามการรับเงิน/การเช่าต่อ | client SELECT อย่างเดียว; เขียนผ่าน `bill_save_draft`, `bill_confirm`, `bill_cancel`, `bill_void`, `bill_correct`; ยอดเงินเป็น derived ที่ RPC คำนวณ |
| `bills` delete | `bill-repository.ts:159` `.delete()` | ตอนนี้ถูก RLS ปฏิเสธแล้ว แต่ UI ยังมีทางเรียก | ไม่มี DELETE grant; UI ต้องเปลี่ยนเป็น cancel/void |
| `statement_transactions` | `features/finance/api/finance-repository.ts:112–116` insert — policy `statement_transactions_insert` = ACTIVE member (`20261002000001`:771) | ใครก็สร้างรายรับ/รายจ่ายปลอมในบัญชีได้ | แยกเป็น `payments`, `refunds`, `finance_ledger_entries`, `expense_entries`, `cash_movements` — ทั้งหมด RPC-only |
| payment / refund | RPC ข้างบน | ไม่ตรวจสิทธิ์/สถานะสมาชิก | `payment_receive`, `payment_void`, `refund_create`, `refund_approve` |
| `stock_movements` | `features/products/api/product-repository.ts` (`insertStockMovementToSupabase` ~บรรทัด 300) + `record_stock_movement_atomic` (INVOKER) — policy insert ตรวจแค่ actor (`20261002000001`:698) | ACTIVE member ใส่ `RECEIVE`/`ADJUSTMENT` เพิ่มสต็อกเองได้ไม่ต้องมี `stock.adjust`; การคำนวณ available อ่านผ่าน RLS ของผู้เรียก | client SELECT อย่างเดียว; Stock Movement เกิดจาก RPC ของเหตุการณ์จริงเท่านั้น (`delivery_create`, `return_receive`, `stock_adjust`, `stock_receive`...) + `stock_balances` lock + `CHECK >= 0` |
| `products.stock_quantity` | `product-repository.ts:212` upsert + trigger อนุญาตเมื่อมี `stock.adjust` (`20261002000001`:669) | ขัด Master §7 "ห้ามแก้ Stock Quantity ตรง ๆ" | ตัดคอลัมน์ทิ้ง — จำนวนมาจาก `stock_balances` |
| `products` delete | `product-repository.ts:221` | ถูก RLS ปฏิเสธแล้ว แต่ UI ยังเรียก | ไม่มี DELETE; ใช้ `active = false` |
| `audit_logs` | `features/audits/services/audit-storage.ts:300` insert จาก client | client เขียน event ปลอม/ยัดข้อมูลได้ (actor ถูก stamp แล้ว แต่เนื้อหายังปลอมได้) | ไม่มี INSERT grant; audit เขียนโดย RPC เท่านั้น; event ฝั่ง UI (พิมพ์/แชร์) ผ่าน `document_reference_log` |

### 1.4 FK / ประวัติ

- Chain เดิมมี CASCADE บนข้อมูลการเงิน/ประวัติ: `payment_batches.bill_id` (`20260919000002`:45), `statement_transactions.batch_id`/`bill_id` (:60, :71), `bill_items.bill_id` (`20260924000003`:19), `quotation_items.quotation_id` (`20260924000002`:45), `profiles.id → auth.users` (`20260912000001`:6), `permissions.user_id` (`20260924000001`:429) — lockdown แปลงเป็น RESTRICT แล้ว (ยกเว้น `permissions` ที่ถูก drop)
- **ยังเหลือ CASCADE ที่ lockdown ไม่ได้แปลง:** `job_assignments.job_id`, `job_assignments.employee_id` (`20260924000004`:30–31) — ไม่อยู่ใน Master baseline (ดูหมวด 8) จึงไม่ย้ายมา
- FK เดิมหลายเส้นไม่ระบุ ON DELETE (= NO ACTION) ใช้ได้ แต่ baseline ระบุ `RESTRICT` ชัดทุกเส้นเพื่อให้อ่านแล้วรู้เจตนา
- **Baseline: ไม่มี `ON DELETE CASCADE` และไม่มี `ON DELETE SET NULL` แม้แต่เส้นเดียว** + client ไม่มี DELETE grant บนตารางใดเลย + ตาราง ledger มี trigger `_forbid_update_delete` กันแม้แต่ฟังก์ชันภายในแก้ทับ
- Audit เป็น polymorphic (`entity_type`, `entity_id`) ไม่มี FK ตาม Master §3.3

---

## 2. หลักร่วมของ baseline

| เรื่อง | กติกา |
|---|---|
| PK | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` ทุกตาราง (ยกเว้น `permission_catalog.code`, ตาราง junction ใช้ composite PK) |
| เวลา | `timestamptz` ทั้งหมด; วันที่ทางธุรกิจคำนวณด้วย `store_settings.timezone` (Master §16, §17.4, §37 ข้อ 17) |
| เงิน | `numeric(14,2)`; CHECK `>= 0` หรือ `> 0` ตามความหมาย |
| จำนวน | `numeric(12,3)` (รองรับหน่วยเมตร/กก.) CHECK `> 0`; สินค้ารายชิ้น (`product_units`) จำนวนต่อแถว = 1 |
| สถานะ | `text` + `CHECK (status IN (...))` ตามค่าใน Master §9 (ไม่ใช้ PG enum เพื่อเพิ่มค่าได้ง่ายใน migration ถัดไป) |
| Audit columns | ทุกตาราง: `created_at timestamptz NOT NULL DEFAULT now()`, `created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT` (ยกเว้น catalog/system) |
| Document number | คอลัมน์ `*_no text` แยกจาก `id`, UNIQUE, ว่างได้ตอน DRAFT, ออกเลขใน transaction ผ่าน `_next_document_no(doc_type)` ที่ lock `document_sequences` |
| Delete | ไม่มี DELETE grant ให้ client ทุกตาราง; entity ใช้ `active`/status; ledger ใช้ reversal |
| RLS | `ENABLE ROW LEVEL SECURITY` ทุกตาราง; policy มีแต่ `SELECT` (ยกเว้น `profiles` UPDATE ของตัวเอง) |
| Grants | `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;` แล้ว `GRANT SELECT` รายตาราง |
| Derived | ค่าที่ cache ไว้ (เช่น `bills.paid_amount`) เขียนได้โดย RPC เท่านั้น และมีฟังก์ชัน `reconcile_*` คำนวณจาก ledger เทียบได้ (Master §2.4, §34) |

ย่อในตารางข้างล่าง: **PK** = `id uuid`, **AUD** = `created_at`, `created_by`, **R** = `ON DELETE RESTRICT`, **SoT** = source of truth, **DRV** = derived/cache, **APPEND** = append-only (trigger กัน UPDATE/DELETE)

---

## 3. Helper functions (internal)

| ฟังก์ชัน | ประเภท | หน้าที่ |
|---|---|---|
| `is_active_member()` | DEFINER, STABLE, grant authenticated | reuse จาก lockdown |
| `is_owner()` | DEFINER, STABLE, grant authenticated | reuse |
| `has_permission(code)` | DEFINER, STABLE, grant authenticated | reuse — ใช้ใน RLS (คืน false ไม่ raise) |
| `_require_permission(code)` | DEFINER, ไม่ grant client | raise 42501 ถ้าไม่ ACTIVE / ไม่มีสิทธิ์ / code ไม่อยู่ใน catalog |
| `_audit(action, entity_type, entity_id, before, after, reason, correlation_id)` | DEFINER, internal | เขียน `audit_logs` actor = `auth.uid()` |
| `_idempotency_begin(action, key, hash)` / `_idempotency_finish(id, response)` | internal | คืนผลเดิมถ้า actor+key+hash ซ้ำ, raise ถ้า key ซ้ำแต่ hash ต่าง; ผู้ใช้ต่างคนใช้ key เดียวกันได้โดยไม่ชนกัน |
| `_next_document_no(doc_type)` | internal | lock `document_sequences` FOR UPDATE, ไม่ recycle |
| `_stock_move(product_id, unit_id, from_state, to_state, qty, source_type, source_id, correlation_id)` | internal | lock `stock_balances` ทั้งสองฝั่ง, ตรวจ ≥ 0, insert movement คู่ |
| `_forbid_update_delete()` | trigger | ใช้กับตาราง APPEND |
| `_bill_recalculate(bill_id)` | internal | คำนวณ paid/refund/balance/status/obligation ใหม่จาก ledger |
| `_bill_try_close(bill_id)` | internal | `financial_resolved AND merchandise_resolved AND exception_resolved` → CLOSED (Master §21.2) |
| `_line_obligation(line_id)` | internal, STABLE | คืน delivered / carried_in / resolved / carried_forward / `obligation_held_here` ตาม Master §14.1 |
| `_deposit_available(holding_id)` | internal, STABLE | Σ RECEIVE − Σ APPLY − Σ REFUND ± REVERSAL |
| `handle_new_auth_user_profile()` | trigger on `auth.users` | reuse — สมัครแล้วเป็น PENDING |
| `set_updated_at()` | trigger | ตารางที่มี `updated_at` |

---

## 4. ตาราง baseline

### 4.A Identity / Permission / Control

#### `profiles` — SoT ของสมาชิก
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK, FK → `auth.users(id)` **R** |
| email | text | YES | |
| username | text | NO | UNIQUE (`lower(username)`) |
| first_name, last_name | text | YES | client แก้ได้ (ของตัวเอง) |
| display_name | text | YES | client แก้ได้ |
| avatar_url | text | YES | client แก้ได้ |
| role | text | NO | DEFAULT 'USER', CHECK IN ('OWNER','USER') |
| status | text | NO | DEFAULT 'PENDING', CHECK IN ('PENDING','ACTIVE','SUSPENDED') |
| is_approved | boolean | NO | `GENERATED ALWAYS AS (status = 'ACTIVE') STORED` — คงไว้เพื่อโค้ด app เดิม (`features/auth/*`) |
| status_changed_at, status_changed_by | timestamptz / uuid | YES | FK profiles **R** |
| created_at, updated_at | timestamptz | NO | |

- Index: `profiles_username_lower_uidx`, `(role, status)`
- Delete: ห้าม (FK จาก auth.users เป็น RESTRICT → ลบ auth user ไม่ได้ถ้ามี profile; ปิดใช้ด้วย SUSPENDED)
- RLS: SELECT `id = auth.uid() OR has_permission('security.manage_roles')`; UPDATE เฉพาะแถวตัวเอง + column grant (`first_name, last_name, display_name, avatar_url`)
- เปลี่ยน role/status ผ่าน RPC เท่านั้น
- ตัด `user_id` (generated ซ้ำกับ id) และ `full_name`, `business_id` legacy

#### `permission_catalog` — SoT ของรหัสสิทธิ์
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| code | text | NO | PK |
| group_name | text | NO | |
| label_th | text | NO | |
| is_risky | boolean | NO | DEFAULT false — ใช้แสดง/บังคับ reason (Master §4.4) |
| created_at | timestamptz | NO | |

- Seed: 36 รหัสจาก lockdown (Master §4.3) + รหัสเสนอเพิ่มในหมวด 4.I (LOCKED 2026-10-02)
- RLS: SELECT `is_active_member()` (เดิมให้ทุก authenticated รวม PENDING — แคบลง)
- เขียน: migration เท่านั้น

#### `user_permissions` — SoT ของสิทธิ์ราย USER
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| user_id | uuid | NO | FK profiles **R** |
| permission_code | text | NO | FK permission_catalog **R** |
| granted_by | uuid | NO | FK profiles **R** |
| granted_at | timestamptz | NO | |

- PK `(user_id, permission_code)`; index `(permission_code)`
- Delete: เกิดได้เฉพาะใน `owner_set_member_permissions` (ประวัติอยู่ใน audit before/after) — client ไม่มี DELETE
- RLS: SELECT `user_id = auth.uid() OR has_permission('security.manage_roles')`

#### `audit_logs` — SoT, APPEND
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| actor_id | uuid | YES | FK profiles **R**; NULL = system/service_role |
| action | text | NO | |
| entity_type | text | NO | polymorphic ไม่มี FK |
| entity_id | uuid | YES | |
| before_data, after_data | jsonb | YES | |
| reason | text | YES | |
| device | text | YES | workstation/device id |
| correlation_id | uuid | NO | |
| created_at | timestamptz | NO | |

- Index: `(entity_type, entity_id, created_at)`, `(actor_id, created_at)`, `(correlation_id)`, `(created_at)`
- RLS: SELECT `has_permission('audit.view')`; ไม่มี INSERT grant (เขียนผ่าน `_audit`)
- Trigger `_forbid_update_delete` (แม้แต่ owner ของ DB ใน session ปกติ); retention ตาม Master §37 ข้อ 15

#### `idempotency_keys` — SoT ของการกันส่งซ้ำ
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| action | text | NO | ชื่อ RPC |
| idempotency_key | text | NO | จาก client |
| request_hash | text | NO | |
| actor_id | uuid | NO | FK profiles **R** |
| status | text | NO | CHECK IN ('IN_PROGRESS','COMPLETED') |
| response | jsonb | YES | |
| created_at, completed_at | timestamptz | | |

- UNIQUE `(actor_id, action, idempotency_key)` — key แยกตามผู้ใช้ ผู้ใช้คนอื่น replay หรือบล็อก key ของกันไม่ได้
- RLS: ไม่มี policy สำหรับ client (ไม่ grant SELECT)
- Delete: งานล้าง (cron, service_role) ลบ key อายุ > N วันได้ — ไม่ใช่ข้อมูลธุรกิจ

#### `document_sequences` — SoT ของเลขเอกสาร
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| doc_type | text | NO | CHECK IN ('QUOTATION','RESERVATION','BILL','CONTRACT','RECEIPT','REFUND','CREDIT_NOTE','APPOINTMENT','STOCK_ADJUSTMENT','CASH_SESSION','INVENTORY_COUNT','DELIVERY','RETURN') |
| period_key | text | NO | เช่น '2026' หรือ '2026-10' ตาม reset policy |
| prefix | text | NO | |
| last_no | bigint | NO | CHECK ≥ 0 |
| updated_at | timestamptz | NO | |

- PK `(doc_type, period_key)`; lock FOR UPDATE ใน `_next_document_no`; ไม่มีการลดค่า (trigger กัน `last_no` ลดลง)
- RLS: ไม่ grant client

#### `store_settings` — SoT ของค่า Policy (Master §37) — แถวเดียว
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK + UNIQUE index บน `(true)` ให้มีแถวเดียว |
| company_name, tax_id, address, phone, logo_url | text | YES | |
| timezone | text | NO | DEFAULT 'Asia/Bangkok' (ค่าเดียวทั้งระบบ) |
| vat_enabled | boolean | NO | สวิตช์เดียวกับ POS (Master §8.4) |
| vat_rate | numeric(5,2) | NO | CHECK 0–100 |
| vat_mode | text | NO | CHECK IN ('INCLUSIVE','EXCLUSIVE') |
| doc_number_formats | jsonb | NO | Master §37 ข้อ 1 |
| policies | jsonb | NO | early return, reservation expiry, approval thresholds, credit, cash variance, notification timing ฯลฯ |
| updated_at, updated_by | | NO | |

- RLS: SELECT `is_active_member()`; เขียนผ่าน `settings_update` (OWNER) + audit
- แทน `system_settings` เดิม; ตัด `lateFeeMode` ทิ้ง (Master §16)

#### `approval_requests` — SoT ของคำขออนุมัติที่รออยู่ (Master §4.4)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| action_code | text | NO | FK permission_catalog **R** (สิทธิ์ที่ผู้อนุมัติต้องมี) |
| entity_type | text | NO | |
| entity_id | uuid | YES | |
| payload | jsonb | NO | สิ่งที่ขอ (เช่น line+qty ของการเช่าต่อ) |
| reason | text | NO | |
| status | text | NO | CHECK IN ('PENDING','APPROVED','REJECTED','CANCELLED') |
| decided_by | uuid | YES | FK profiles **R** |
| decided_at | timestamptz | YES | |
| decision_note | text | YES | |
| created_at, created_by | | NO | |

- CHECK: `status = 'PENDING'` ⇔ `decided_by IS NULL`
- Index: `(status, action_code)`, `(entity_type, entity_id)`
- RLS: SELECT `created_by = auth.uid() OR has_permission(action_code)`

### 4.B Master data

#### `customers` — SoT
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| customer_code | text | YES | UNIQUE |
| name | text | NO | |
| phone | text | NO | Master §5 ขั้นต่ำ |
| address | text | NO | |
| customer_type | text | YES | CHECK IN ('INDIVIDUAL','COMPANY') |
| tax_id, email, contact_person, billing_address, delivery_address | text | YES | |
| tags | text[] | NO | DEFAULT '{}' |
| credit_note, risk_note, document_reference, note | text | YES | |
| credit_enabled | boolean | NO | DEFAULT false (Master §23) |
| credit_limit | numeric(14,2) | NO | DEFAULT 0, ≥ 0 |
| payment_terms_days | integer | NO | DEFAULT 0, ≥ 0 |
| account_status | text | NO | CHECK IN ('NORMAL','CREDIT_BLOCKED') |
| active | boolean | NO | DEFAULT true |
| last_activity_at | timestamptz | YES | DRV |
| created_at, created_by, updated_at, updated_by | | | |

- Index: `(lower(name))`, `(phone)`, `(active)`, trigram บน name/phone (สำหรับตรวจซ้ำ, ถ้าเปิด `pg_trgm`)
- Derived ไม่เก็บ: `current_balance`, `available_credit`, `overdue_balance` → view `customer_balances_v`
- Delete: ห้าม → `active = false`
- RLS: SELECT `has_permission('customer.view')`
- เขียน: `customer_create`, `customer_update`, `customer_set_active` (`customer.edit`) + audit before/after

#### `product_categories` — SoT
id PK · `name` text NOT NULL UNIQUE · `active` bool · AUD
RLS: SELECT `is_active_member()` · เขียน `product.edit` ผ่าน RPC · Delete: ห้าม → inactive

#### `products` — SoT (ไม่มีจำนวนสต็อก)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| sku | text | NO | UNIQUE |
| name | text | NO | |
| category_id | uuid | YES | FK product_categories **R** |
| item_type | text | NO | CHECK IN ('QUANTITY','SERIALIZED') |
| unit | text | NO | หน่วยนับ (ชิ้น/ชุด/เมตร) |
| calculation_type | text | NO | CHECK IN ('PER_UNIT','PER_DAY','PER_PERIOD') |
| sale_price | numeric(14,2) | YES | ≥ 0 |
| rental_price | numeric(14,2) | YES | ≥ 0 |
| reorder_point | numeric(12,3) | NO | DEFAULT 0, ≥ 0 |
| can_sell, can_rent | boolean | NO | CHECK `(NOT can_sell OR sale_price IS NOT NULL) AND (NOT can_rent OR rental_price IS NOT NULL)` |
| active | boolean | NO | |
| AUD + updated_at, updated_by | | | |

- Index: `sku` unique, `(active, category_id)`, `(lower(name))`
- **ตัด `stock_quantity` ทิ้ง** (Master §7, §11.2) — จำนวนอยู่ที่ `stock_balances`
- **ย้าย `cost_price` ไป `product_costs`** — RLS ซ่อนคอลัมน์ไม่ได้ ถ้าเก็บในตารางเดียวกัน คนที่มี `product.view` จะเห็นต้นทุนด้วย
- Delete: ห้าม → `active = false`
- RLS: SELECT `has_permission('product.view')`
- เขียน: `product_create` (`product.edit`, สร้าง initial stock movement ด้วย), `product_update` (`product.edit`; เปลี่ยนราคา ต้องมี `product.edit_price`), `product_set_active`

#### `product_costs` — SoT ของต้นทุน
`product_id` uuid PK + FK products **R** · `cost_price` numeric(14,2) NOT NULL ≥ 0 · `updated_at`, `updated_by`
RLS: SELECT `has_permission('product.view_cost')` · เขียน `product_set_cost` (`product.edit_cost`) + audit before/after

#### `product_units` — SoT ของสินค้ารายชิ้น (Master §7.1)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| product_id | uuid | NO | FK products **R** |
| serial_no | text | NO | UNIQUE `(product_id, serial_no)` |
| unit_state | text | NO | CHECK IN ('IN_STOCK','RENTED_OUT','SOLD','INSPECTION','REPAIR','DAMAGED','LOST','WRITTEN_OFF','INACTIVE') — สถานะของชิ้นนั้น (ยอดจำนวนอยู่ที่ `stock_balances`) |
| condition | text | NO | CHECK IN Master §9 Item Condition |
| active | boolean | NO | |
| AUD | | | |

- CHECK trigger: `products.item_type = 'SERIALIZED'`
- Index: `(product_id, stock_state)`
- Delete: ห้าม → `active = false` / `WRITTEN_OFF`
- RLS: SELECT `has_permission('product.view') OR has_permission('stock.view')`

### 4.C Rental Contract (Master §6)

#### `contract_templates` — SoT
id PK · `name` text NOT NULL · `body` text NOT NULL · `active` bool · AUD
RLS: SELECT `is_active_member()` · เขียนผ่าน RPC (`contract.new_version`) · Delete: ห้าม → inactive
(แทน `tpl_rental_contract` ที่ hard-code ในโค้ด)

#### `rental_contracts` — SoT
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| contract_no | text | NO | UNIQUE (ชุดเลข CONTRACT แยกจาก BILL) — ออกเลขตอนสร้าง (สัญญาไม่มี draft) |
| customer_id | uuid | NO | FK customers **R** |
| status | text | NO | CHECK IN ('ACTIVE','ENDED','VOID') |
| ended_at, ended_by, end_reason | | YES | |
| voided_at, voided_by, void_reason | | YES | |
| AUD | | | |

- CHECK: `status='ENDED'` ⇔ ended_* ครบ; `status='VOID'` ⇔ voided_* ครบ
- Index: `(customer_id, status)`
- Delete: ห้าม
- RLS: SELECT `is_active_member()`
- เขียน: `contract_create`, `contract_end` (ตรวจ §6.4), `contract_void`

#### `rental_contract_versions` — SoT, APPEND (immutable)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| rental_contract_id | uuid | NO | FK rental_contracts **R** |
| version_no | integer | NO | UNIQUE `(rental_contract_id, version_no)`, > 0 |
| template_id | uuid | YES | FK contract_templates **R** |
| terms_snapshot | jsonb | NO | ข้อความ/เงื่อนไขที่ใช้พิมพ์ซ้ำได้ |
| effective_from | timestamptz | NO | UNIQUE `(rental_contract_id, effective_from)` |
| AUD | | | |

- Index: `(rental_contract_id, effective_from DESC)` สำหรับหา version ที่มีผล ณ เวลาออกบิล
- RLS: SELECT `is_active_member()`
- เขียน: `contract_create` (version 1), `contract_new_version`

### 4.D Commercial: Quotation / Reservation / Bill

#### `quotations` — SoT
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| quotation_no | text | YES | UNIQUE; ออกเลขเมื่อ SENT |
| customer_id | uuid | YES | FK customers **R** |
| status | text | NO | CHECK IN ('DRAFT','SENT','ACCEPTED','EXPIRED','REJECTED','CONVERTED') |
| valid_until | timestamptz | YES | |
| subtotal, discount_total, vat_amount, grand_total | numeric(14,2) | NO | DRV จาก items (เขียนโดย RPC) |
| pricing_snapshot | jsonb | NO | VAT/discount policy ที่ใช้ |
| converted_bill_id | uuid | YES | FK bills **R** |
| note | text | YES | |
| AUD + updated_at, updated_by | | | |

- CHECK: `status = 'CONVERTED'` ⇔ `converted_bill_id IS NOT NULL`
- Index: `(customer_id)`, `(status, valid_until)`
- Delete: ห้าม → REJECTED/EXPIRED; Quotation **ไม่กันสต็อก** (Master §10)
- RLS: SELECT `is_active_member()`

#### `quotation_items` — SoT
id PK · `quotation_id` FK quotations **R** NOT NULL · `line_no` int (UNIQUE ต่อ quotation) · `product_id` FK products **R** NOT NULL · `line_mode` CHECK IN ('SALE','RENTAL') · `quantity` > 0 · `unit_price` ≥ 0 · `rental_calculation_type`, `period_count`, `rental_start_at`, `rental_end_at` (ต้องมีเมื่อ RENTAL) · `discount_amount` ≥ 0 · `line_total` DRV · AUD
- เขียนได้เฉพาะตอน quotation = DRAFT (ตรวจใน RPC + trigger) — แก้ draft = แทนที่รายการใน RPC เดียว (ลบ item ของ **draft** ได้เพราะยังไม่มีธุรกรรม; หลัง SENT ห้าม)
- RLS: SELECT `is_active_member()`

#### `reservations` — SoT (Master §10)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| reservation_no | text | YES | UNIQUE |
| source_type | text | NO | CHECK IN ('QUOTATION','BILL') |
| quotation_id | uuid | YES | FK quotations **R** |
| bill_line_id | uuid | YES | FK bill_lines **R** |
| product_id | uuid | NO | FK products **R** |
| product_unit_id | uuid | YES | FK product_units **R** |
| reservation_type | text | NO | CHECK IN ('SALE','RENTAL') |
| quantity | numeric(12,3) | NO | > 0 |
| status | text | NO | CHECK IN ('PENDING','ACTIVE','EXPIRED','CANCELLED','CONVERTED') |
| expires_at | timestamptz | NO | Master: ต้องมี Expiry |
| released_at, released_by, release_reason | | YES | |
| AUD | | | |

- CHECK: ต้องมี source FK ตรงกับ `source_type`
- Index: `(status, expires_at)` (งาน expire), `(product_id, status)`, `(bill_line_id)`
- สร้าง stock movement AVAILABLE → RESERVED; release ทำกลับ
- RLS: SELECT `is_active_member()`

#### `bills` — SoT (หัวบิล) + DRV (ยอดเงิน/สถานะที่ cache)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| bill_no | text | YES | UNIQUE; ว่างได้เฉพาะ DRAFT |
| status | text | NO | CHECK IN ('DRAFT','CONFIRMED','ACTIVE','CLOSED','CANCELLED','VOID') |
| customer_id | uuid | YES | FK customers **R**; ต้องมีเมื่อมี RENTAL line (ตรวจใน `bill_confirm`) |
| rental_contract_id | uuid | YES | FK rental_contracts **R** |
| rental_contract_version_id | uuid | YES | FK rental_contract_versions **R** |
| quotation_id | uuid | YES | FK quotations **R** |
| parent_bill_id | uuid | YES | FK bills **R** — บิลก่อนหน้าทันที |
| original_bill_id | uuid | YES | FK bills **R** — บิลแรกของสาย |
| continuation_start_mode | text | YES | CHECK IN ('FROM_PREVIOUS_END','FROM_APPROVAL') |
| continuation_reason | text | YES | |
| continuation_approved_by | uuid | YES | FK profiles **R** |
| continuation_approved_at | timestamptz | YES | |
| pricing_snapshot | jsonb | NO | vat_enabled, vat_rate, vat_mode, discount policy ณ เวลา confirm |
| sale_subtotal, rental_subtotal | numeric(14,2) | NO | DRV จาก lines |
| bill_discount_type | text | YES | CHECK IN ('FIXED','PERCENT') |
| bill_discount_value | numeric(14,2) | NO | ≥ 0 |
| delivery_fee, installation_fee, service_fee | numeric(14,2) | NO | ≥ 0 (Master: ห้ามซ่อนใน unit price) |
| taxable_amount, vat_amount, grand_total | numeric(14,2) | NO | DRV |
| paid_amount, refunded_amount, adjustment_net, charge_total, deposit_applied, balance_due | numeric(14,2) | NO | **DRV** — เขียนโดย `_bill_recalculate` เท่านั้น |
| payment_status | text | NO | DRV, CHECK IN ('UNPAID','PARTIALLY_PAID','PAID','PARTIALLY_REFUNDED','REFUNDED') |
| is_credit_bill | boolean | NO | DEFAULT false |
| due_date | date | YES | AR |
| confirmed_at, confirmed_by | | YES | |
| closed_at | timestamptz | YES | |
| cancelled_at/by, cancel_reason | | YES | |
| voided_at/by, void_reason | | YES | |
| note | text | YES | |
| AUD + updated_at | | | |

CHECK:
- `(parent_bill_id IS NULL) = (original_bill_id IS NULL)` (Master §17.2)
- `parent_bill_id <> id`
- `(rental_contract_id IS NULL) = (rental_contract_version_id IS NULL)`
- `status = 'DRAFT' OR bill_no IS NOT NULL`
- `continuation_start_mode IS NULL OR parent_bill_id IS NOT NULL`
- Trigger: version เป็นของ contract นั้น; contract เป็นของ customer เดียวกัน; บิลลูกใช้ contract เดียวกับบิลแม่
- **ไม่มี** `EXTENDED`, `held_deposit_amount`, `deposits` JSONB, `is_deposit`, `late_fee*` (Master §35)

Index: `(customer_id, status)`, `(rental_contract_id)`, `(parent_bill_id)`, `(original_bill_id)`, `(status, payment_status)`, `(created_at)`
Delete: ห้าม → CANCELLED/VOID (เลขที่ออกแล้วถือว่าใช้แล้ว)
RLS: SELECT `is_active_member()` (POS ต้องเห็นบิล; ยอดการเงินละเอียดอยู่ในตาราง finance ที่คุมด้วย `finance.view`)

#### `bill_lines` — SoT (+ ยอด obligation ที่ cache)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| bill_id | uuid | NO | FK bills **R** |
| line_no | integer | NO | UNIQUE `(bill_id, line_no)` |
| product_id | uuid | NO | FK products **R** |
| line_mode | text | NO | CHECK IN ('SALE','RENTAL') — ห้ามแก้หลัง confirm (trigger) |
| ordered_qty | numeric(12,3) | NO | > 0 |
| unit_price | numeric(14,2) | NO | ≥ 0 (SALE = ราคาขาย, RENTAL = rental_rate) |
| price_overridden | boolean | NO | ถ้า true ต้องมี audit + สิทธิ์ `product.edit_price` |
| line_discount_type | text | YES | FIXED/PERCENT |
| line_discount_value | numeric(14,2) | NO | ≥ 0 |
| extended_amount | numeric(14,2) | NO | DRV |
| rental_calculation_type | text | YES | CHECK IN ('PER_DAY','PER_PERIOD') |
| period_type | text | YES | |
| period_count | numeric(12,3) | YES | > 0 |
| rental_start_at, rental_end_at | timestamptz | YES | `rental_end_at > rental_start_at` |
| allocated_qty, delivered_qty, backorder_qty, cancelled_qty | numeric(12,3) | NO | DRV ≥ 0 (Master §11.3) |
| carried_in_qty, physical_returned_qty, approved_lost_qty, approved_disposition_qty, carried_forward_qty | numeric(12,3) | NO | DRV ≥ 0 |
| obligation_held_here | numeric(12,3) | NO | DRV, **CHECK ≥ 0** (Master §28.4) |
| return_status, rental_status, fulfillment_status | text | NO | DRV ตาม Master §9 |
| actual_return_at | timestamptz | YES | DRV (Master §15 — แยกจาก planned end) |
| overdue_reviewed_at, overdue_reviewed_by | | YES | การตรวจค่าใช้จ่ายเพิ่มกรณีเกินกำหนด (exception) |
| AUD | | | |

CHECK:
- `line_mode = 'RENTAL'` ⇒ rental_* ครบ; `line_mode = 'SALE'` ⇒ rental_* เป็น NULL
- `delivered_qty + cancelled_qty <= ordered_qty`
- Trigger: product ต้อง `can_sell`/`can_rent` ตาม mode และ `active` (ตอน confirm)
- Trigger: หลังบิล CONFIRMED ห้ามแก้ product_id / line_mode / ordered_qty / unit_price / rental_start_at / rental_end_at (Master §17.1, §19.3) — แก้ได้เฉพาะคอลัมน์ DRV ผ่าน RPC

Index: `(bill_id)`, `(product_id)`, `(line_mode, rental_status)`, `(rental_end_at) WHERE obligation_held_here > 0` (งาน overdue)
Delete: ห้ามหลัง confirm; ใน DRAFT แก้ทั้งชุดผ่าน `bill_save_draft`
RLS: SELECT `is_active_member()`
หมายเหตุ: Master §8.1 พูดถึง "Rental Details" — รวมไว้ใน line พร้อม CHECK เพื่อให้ตรวจได้ในแถวเดียว (ไม่ต้อง join) สามารถแยกเป็นตาราง 1:1 ภายหลังได้โดยไม่กระทบกฎ

#### `bill_adjustments` — SoT, APPEND (Master §19.2)
id PK · `bill_id` FK bills **R** · `bill_line_id` FK bill_lines **R** NULL · `adjustment_type` CHECK IN ('CREDIT','DEBIT') · `amount` > 0 · `before_data`, `after_data` jsonb · `reason` NOT NULL · `approved_by` FK profiles **R** NULL · `reverses_adjustment_id` FK bill_adjustments **R** UNIQUE NULL · `correlation_id` · AUD
Index `(bill_id)` · RLS: SELECT `has_permission('finance.view')` · เขียน `bill_adjust` (`bill.correct`)

### 4.E Fulfillment / Return / Rental continuation

#### `deliveries` — SoT
id PK · `delivery_no` UNIQUE · `bill_id` FK bills **R** · `delivered_at` timestamptz NOT NULL · `delivered_by` FK profiles **R** · `appointment_id` FK appointments **R** NULL · `note` · `correlation_id` · AUD
Index `(bill_id)` · APPEND (แก้ผิด = reversal delivery ใหม่) · RLS: SELECT `is_active_member()`

#### `delivery_lines` — SoT, APPEND
id PK · `delivery_id` FK deliveries **R** · `bill_line_id` FK bill_lines **R** · `product_unit_id` FK product_units **R** NULL · `quantity` > 0 · `reverses_delivery_line_id` FK delivery_lines **R** UNIQUE NULL · AUD
CHECK: มี `product_unit_id` ⇒ quantity = 1; trigger ตรวจ `bill_line_id` อยู่ในบิลเดียวกับ delivery และไม่ส่งเกิน `ordered_qty − cancelled_qty`
Index `(bill_line_id)`, `(product_unit_id)` · RLS: SELECT `is_active_member()`

#### `returns` — SoT
id PK · `return_no` UNIQUE · `bill_id` FK bills **R** · `returned_at` NOT NULL · `received_by` FK profiles **R** · `note` · `correlation_id` · AUD
Index `(bill_id)` · APPEND · RLS: SELECT `is_active_member()`

#### `return_lines` — SoT, APPEND
id PK · `return_id` FK returns **R** · `bill_line_id` FK bill_lines **R** · `product_unit_id` FK product_units **R** NULL · `quantity` > 0 · `condition` CHECK IN Master §9 Item Condition (NOT NULL) · `to_stock_state` CHECK IN ('AVAILABLE','INSPECTION','REPAIR','DAMAGED') · `reverses_return_line_id` UNIQUE NULL · AUD
CHECK: `condition <> 'NORMAL'` ⇒ `to_stock_state <> 'AVAILABLE'` (ของชำรุดห้ามเข้า Available ตรง); มี unit ⇒ quantity = 1; condition `LOST` ไม่อนุญาตในตารางนี้ (Lost ≠ Returned)
Index `(bill_line_id)` · RLS: SELECT `is_active_member()`

#### `rental_carry_forwards` — SoT, APPEND (Master §17.3)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| from_bill_id | uuid | NO | FK bills **R** |
| from_line_id | uuid | NO | FK bill_lines **R** |
| to_bill_id | uuid | NO | FK bills **R** |
| to_line_id | uuid | NO | FK bill_lines **R** |
| product_id | uuid | NO | FK products **R** |
| quantity | numeric(12,3) | NO | > 0 |
| approval_request_id | uuid | YES | FK approval_requests **R** |
| approved_by | uuid | NO | FK profiles **R** |
| reason | text | NO | |
| correlation_id | uuid | NO | |
| AUD | | | |

- CHECK `from_bill_id <> to_bill_id`; trigger: `to_bill.parent_bill_id = from_bill_id`, product ตรงกันทั้งสอง line, line ทั้งสองเป็น RENTAL
- Index `(from_line_id)`, `(to_line_id)`, `(from_bill_id)`, `(to_bill_id)`
- **ไม่สร้าง stock movement / delivery / return / deposit movement**
- RLS: SELECT `is_active_member()`

#### `rental_carry_forward_units` — SoT, APPEND
`carry_forward_id` FK rental_carry_forwards **R** · `product_unit_id` FK product_units **R** · PK `(carry_forward_id, product_unit_id)` · AUD
Trigger (deferred constraint ตอน commit): จำนวนแถว = `quantity` ของ carry forward
RLS: SELECT `is_active_member()`

#### `rental_carry_forward_reversals` — SoT, APPEND
id PK · `carry_forward_id` FK **R** **UNIQUE** (กลับเต็มจำนวนต่อ record) · `reason` NOT NULL · `approved_by` FK profiles **R** · `correlation_id` · AUD
RLS: SELECT `is_active_member()`

#### `incident_cases` — SoT ของ Damage / Missing / Lost (Master §14.3–14.4)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| bill_id | uuid | NO | FK bills **R** |
| bill_line_id | uuid | NO | FK bill_lines **R** |
| return_line_id | uuid | YES | FK return_lines **R** (damage ที่พบตอนคืน) |
| product_unit_id | uuid | YES | FK product_units **R** |
| incident_type | text | NO | CHECK IN ('DAMAGE','MISSING','LOST') |
| quantity | numeric(12,3) | NO | > 0 |
| status | text | NO | CHECK IN ('OPEN','UNDER_INSPECTION','ASSESSED','APPROVED','REJECTED','FOUND','RESOLVED') |
| assessment | jsonb | YES | ซ่อมได้/ถาวร, repair cost, basis |
| lost_charge_basis | text | YES | Master §14.4 |
| missing_case_id | uuid | YES | FK incident_cases **R** — LOST ต้องมาจาก MISSING |
| approved_by, approved_at, reason | | YES | |
| AUD + updated_at | | | |

- CHECK: `incident_type = 'LOST'` ⇒ `missing_case_id IS NOT NULL` (ต้องผ่าน MISSING ก่อน)
- Index `(bill_id, status)`, `(bill_line_id)`
- Delete: ห้าม — สถานะเปลี่ยนผ่าน RPC พร้อม audit
- RLS: SELECT `is_active_member()`

#### `write_offs` — SoT, APPEND
id PK · `incident_case_id` FK **R** NULL · `charge_id` FK charges **R** NULL · `bill_id` FK bills **R** · `amount` > 0 · `reason` NOT NULL · `approved_by` FK profiles **R** NOT NULL · `correlation_id` · AUD
CHECK: มี incident หรือ charge อย่างน้อยหนึ่ง · RLS: SELECT `has_permission('finance.view')`
ห้าม Lost → Write-off อัตโนมัติ (สร้างได้จาก RPC `write_off_approve` เท่านั้น)

### 4.F Finance (Master §13, §18–§24)

#### `payment_receipts` — SoT ของการรับเงิน 1 ครั้ง (แทน `payment_batches`)
id PK · `receipt_no` UNIQUE NOT NULL · `bill_id` FK bills **R** · `total_amount` > 0 · `received_at` NOT NULL · `received_by` FK profiles **R** · `cash_session_id` FK cash_sessions **R** NULL · `idempotency_key_id` FK idempotency_keys **R** UNIQUE · `correlation_id` · AUD
Index `(bill_id)`, `(received_at)` · APPEND · RLS: SELECT `has_permission('finance.view') OR has_permission('payment.receive')`

#### `payments` — SoT (1 แถว = 1 ช่องทาง 1 ครั้ง)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| receipt_id | uuid | NO | FK payment_receipts **R** |
| bill_id | uuid | NO | FK bills **R** |
| method | text | NO | CHECK IN ('CASH','TRANSFER','CARD','QR','OTHER') |
| amount | numeric(14,2) | NO | > 0 |
| reference | text | YES | เลขอ้างอิงโอน/บัตร |
| status | text | NO | CHECK IN ('PENDING','COMPLETED','VOIDED','REVERSED','REFUNDED') |
| voided_at, voided_by, void_reason | | YES | |
| received_at | timestamptz | NO | |
| AUD | | | |

- Trigger: ห้ามแก้ `amount`, `method`, `bill_id`, `receipt_id`; สถานะเปลี่ยนได้เฉพาะ PENDING→COMPLETED, COMPLETED→VOIDED/REFUNDED (Master §13 ห้ามแก้ยอดเพื่อทำ refund)
- Index `(bill_id, status)`, `(receipt_id)`
- RLS: SELECT `has_permission('finance.view') OR has_permission('payment.receive')`

#### `refunds` — SoT
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| refund_no | text | YES | UNIQUE; ออกเลขเมื่อ APPROVED/PAID |
| bill_id | uuid | NO | FK bills **R** |
| payment_id | uuid | YES | FK payments **R** (ช่องทางเดิม) |
| amount | numeric(14,2) | NO | > 0 |
| method | text | NO | CHECK เหมือน payments |
| status | text | NO | CHECK IN ('REQUESTED','APPROVED','PAID','REJECTED','REVERSED') |
| reason | text | NO | |
| approved_by, approved_at | | YES | CHECK `approved_by <> created_by` เมื่อ policy SoD เปิด (ตรวจใน RPC) |
| paid_at, paid_by | | YES | |
| cash_movement_id | uuid | YES | FK cash_movements **R** |
| correlation_id | uuid | NO | |
| AUD | | | |

- RPC ตรวจ `amount ≤ refundable` (Σ completed payment − Σ refund ที่ไม่ rejected) โดย lock บิล
- Index `(bill_id, status)`, `(payment_id)`
- RLS: SELECT `has_permission('finance.view') OR has_permission('refund.create') OR has_permission('refund.approve')`

#### `charges` — SoT (Master §19.1)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| bill_id | uuid | NO | FK bills **R** (บิลที่เป็นเหตุ) |
| bill_line_id | uuid | YES | FK bill_lines **R** |
| incident_case_id | uuid | YES | FK incident_cases **R** |
| charge_type | text | NO | CHECK IN ('DAMAGE','LOST','ADDITIONAL_OVERDUE','SERVICE','OTHER') |
| amount | numeric(14,2) | NO | > 0 |
| basis | jsonb | YES | สูตร/ฐานที่ใช้ |
| covered_period_start, covered_period_end | timestamptz | YES | สำหรับ ADDITIONAL_OVERDUE — exclusion constraint กันคิดซ้ำช่วงเดียวกันต่อ line |
| status | text | NO | CHECK IN ('PENDING','CONFIRMED','CANCELLED','REVERSED') |
| confirmed_by, confirmed_at | | YES | |
| reason | text | NO | |
| correlation_id | uuid | NO | |
| AUD | | | |

- EXCLUDE USING gist `(bill_line_id WITH =, tstzrange(covered_period_start, covered_period_end) WITH &&) WHERE (charge_type = 'ADDITIONAL_OVERDUE' AND status IN ('PENDING','CONFIRMED'))` (ต้องเปิด `btree_gist`) + RPC ตรวจไม่ทับช่วงที่บิลลูกคิดแบบ `FROM_PREVIOUS_END` (Master §16, §17.4.1)
- **ห้ามสร้างอัตโนมัติ** — มีแต่ RPC ที่ผู้ใช้กด
- Index `(bill_id, status)`
- RLS: SELECT `is_active_member()` (POS ต้องเห็นยอดที่ต้องเก็บ)

#### `deposit_holdings` — SoT ของบัญชีมัดจำต่อสัญญา (Master §18.2)
id PK · `rental_contract_id` FK rental_contracts **R** **UNIQUE** · `available_amount` numeric(14,2) **DRV, CHECK ≥ 0** · AUD
ต้อง lock FOR UPDATE ทุกครั้งที่สร้าง movement · RLS: SELECT `has_permission('finance.view') OR has_permission('deposit.receive') OR has_permission('deposit.apply') OR has_permission('deposit.refund')`

#### `deposit_movements` — SoT, APPEND
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| holding_id | uuid | NO | FK deposit_holdings **R** |
| movement_type | text | NO | CHECK IN ('RECEIVE','APPLY','REFUND','REVERSAL') |
| amount | numeric(14,2) | NO | > 0 |
| bill_id | uuid | YES | FK bills **R** — ต้องมีเมื่อ RECEIVE/APPLY |
| charge_id | uuid | YES | FK charges **R** (APPLY ที่ชำระ charge เฉพาะ) |
| cash_movement_id | uuid | YES | FK cash_movements **R** — เฉพาะ RECEIVE/REFUND |
| method | text | YES | ช่องทางเงินจริง (RECEIVE/REFUND) |
| reverses_movement_id | uuid | YES | FK deposit_movements **R** **UNIQUE** |
| reason | text | NO | |
| approved_by | uuid | YES | FK profiles **R** |
| correlation_id | uuid | NO | |
| AUD | | | |

CHECK:
- `movement_type IN ('RECEIVE','APPLY')` ⇒ `bill_id IS NOT NULL`
- `movement_type = 'APPLY'` ⇒ `cash_movement_id IS NULL`
- `movement_type = 'REVERSAL'` ⇔ `reverses_movement_id IS NOT NULL`
- Trigger: bill/charge อยู่ใต้ contract เดียวกับ holding
Index `(holding_id, created_at)`, `(bill_id)`
RLS: เหมือน `deposit_holdings`
หมายเหตุ: Deposit ไม่อยู่ใน `bills.grand_total` และไม่ลง `finance_ledger_entries` เป็นรายได้ (Master §8.4, §22)

#### `finance_ledger_entries` — SoT, APPEND (Revenue/Income/Expense ledger, Master §22)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| entry_type | text | NO | CHECK IN ('REVENUE','REFUND','EXPENSE','WRITE_OFF','REVERSAL') |
| revenue_class | text | YES | CHECK IN ('SALE','RENTAL','DELIVERY_FEE','SERVICE_FEE','DAMAGE','LOST','ADDITIONAL','OTHER') |
| amount | numeric(14,2) | NO | > 0 |
| direction | smallint | NO | CHECK IN (1,-1) |
| bill_id, bill_line_id | uuid | YES | FK **R** |
| source_type | text | NO | 'BILL_CONFIRM','CHARGE_CONFIRM','REFUND','EXPENSE','WRITE_OFF','ADJUSTMENT' |
| source_id | uuid | NO | |
| reverses_entry_id | uuid | YES | FK finance_ledger_entries **R** UNIQUE |
| occurred_at | timestamptz | NO | |
| correlation_id | uuid | NO | |
| AUD | | | |

Index `(occurred_at)`, `(bill_id)`, `(source_type, source_id)` · RLS: SELECT `has_permission('finance.view')`
แทน `statement_transactions` เดิม (ที่ผสม payment + ledger + expense ไว้ตารางเดียว ขัด Master §22)

#### `expense_entries` — SoT
id PK · `expense_no` UNIQUE NULL · `category` CHECK IN ('PURCHASE','REPAIR','SHIPPING','LABOR','FUEL','EQUIPMENT','GENERAL') · `amount` > 0 · `paid_method` · `status` CHECK IN ('PENDING','APPROVED','REJECTED','VOIDED') · `approved_by/at` · `void_reason` · `cash_movement_id` FK **R** NULL · `note` · AUD
RLS: SELECT `has_permission('finance.view') OR created_by = auth.uid()` · เขียน `expense_create` (`finance.expense_create`), `expense_approve` (`finance.expense_approve`)

#### `cash_sessions` — SoT (Master §24)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| session_no | text | NO | UNIQUE |
| opened_by | uuid | NO | FK profiles **R** |
| opened_at | timestamptz | NO | |
| opening_cash | numeric(14,2) | NO | ≥ 0 |
| status | text | NO | CHECK IN ('OPEN','CLOSED','CLOSED_WITH_VARIANCE') |
| expected_cash | numeric(14,2) | YES | DRV ตอนปิด |
| actual_cash | numeric(14,2) | YES | |
| variance | numeric(14,2) | YES | = actual − expected |
| variance_reason | text | YES | ต้องมีเมื่อ variance ≠ 0 |
| variance_approved_by | uuid | YES | FK profiles **R** |
| closed_by, closed_at | | YES | |
| AUD | | | |

- Partial UNIQUE: เปิดได้ 1 session ต่อเครื่อง/ลิ้นชัก (`(drawer_id) WHERE status='OPEN'` — เพิ่มคอลัมน์ `drawer_id text NOT NULL DEFAULT 'MAIN'`)
- CHECK: `status='CLOSED_WITH_VARIANCE'` ⇒ variance_reason + approved_by ไม่ว่าง
- RLS: SELECT `has_permission('finance.view') OR opened_by = auth.uid()`

#### `cash_movements` — SoT, APPEND
id PK · `cash_session_id` FK **R** NOT NULL · `movement_type` CHECK IN ('CASH_SALE','CASH_REFUND','DEPOSIT_RECEIVE','DEPOSIT_REFUND','CASH_IN','CASH_OUT','EXPENSE','REVERSAL') · `amount` > 0 · `direction` smallint (1/−1) · `source_type`, `source_id` · `reverses_movement_id` UNIQUE NULL · `reason` · `correlation_id` · AUD
Index `(cash_session_id)` · RLS: เหมือน `cash_sessions`
หมายเหตุ: ใช้กับเงินสดเท่านั้น; เงินโอน/บัตรอยู่ที่ `payments`/`refunds` ตาม method

### 4.G Stock (Master §11)

#### `stock_movements` — SoT, APPEND
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| product_id | uuid | NO | FK products **R** |
| product_unit_id | uuid | YES | FK product_units **R** |
| stock_state | text | NO | CHECK IN Master §11.1 + 'SOLD' (สถานะปลายทางของ SALE) |
| quantity_delta | numeric(12,3) | NO | ≠ 0 |
| movement_type | text | NO | CHECK IN ('INITIAL','RECEIVE','RESERVE','RELEASE','DELIVER_SALE','DELIVER_RENTAL','RETURN','INSPECT','REPAIR','DAMAGE','LOST','WRITE_OFF','ADJUSTMENT','REVERSAL') |
| source_type | text | NO | 'BILL_LINE','DELIVERY_LINE','RETURN_LINE','RESERVATION','STOCK_COUNT','ADJUSTMENT','INCIDENT','PRODUCT_CREATE' |
| source_id | uuid | NO | |
| reason | text | YES | ต้องมีเมื่อ ADJUSTMENT |
| reverses_movement_id | uuid | YES | FK stock_movements **R** UNIQUE |
| correlation_id | uuid | NO | การย้ายสถานะ = 2 แถว (−จากสถานะเดิม, +สถานะใหม่) correlation เดียวกัน |
| AUD | | | |

Index `(product_id, stock_state)`, `(source_type, source_id)`, `(correlation_id)`, `(created_at)`
RLS: SELECT `has_permission('stock.view')` (ไม่ต้องเปิดให้ทุก member แล้ว เพราะ RPC เป็น DEFINER อ่านเองได้)
ไม่มี INSERT ให้ client

#### `stock_balances` — DRV (cache ที่บังคับใช้)
`product_id` FK products **R** · `stock_state` text · PK `(product_id, stock_state)` · `quantity` numeric(12,3) **CHECK ≥ 0** · `updated_at`
- เขียนโดย `_stock_move` เท่านั้นใน transaction เดียวกับ movement; lock FOR UPDATE → กัน oversell / over-rent
- `reconcile_stock_balances()` เทียบกับ Σ `stock_movements` (Master §2.4)
- RLS: SELECT `has_permission('stock.view') OR has_permission('product.view')` (POS ต้องเห็น available)

#### `stock_counts` — SoT (Master §11.4)
id PK · `count_no` UNIQUE · `status` CHECK IN ('OPEN','COUNTED','REVIEWED','APPROVED','CANCELLED') · `snapshot_at` · `approved_by/at` · `note` · AUD
RLS: SELECT `has_permission('stock.view')`

#### `stock_count_lines` — SoT
id PK · `stock_count_id` FK **R** · `product_id` FK **R** · `product_unit_id` FK **R** NULL · `stock_state` · `snapshot_qty` ≥ 0 · `counted_qty` ≥ 0 NULL · `discrepancy` DRV · `reason` · `adjustment_movement_id` FK stock_movements **R** NULL · AUD
UNIQUE `(stock_count_id, product_id, stock_state, product_unit_id)` · RLS: SELECT `has_permission('stock.view')`

### 4.H Operations

#### `appointments` — SoT (Master §26)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| appointment_no | text | YES | UNIQUE |
| appointment_type | text | NO | CHECK IN ('PICKUP','DELIVERY','RETURN','INSTALLATION','PAYMENT','FOLLOW_UP','INSPECTION','REPAIR','GENERAL') |
| customer_id | uuid | YES | FK customers **R** |
| bill_id | uuid | YES | FK bills **R** |
| related_entity_type, related_entity_id | text / uuid | YES | |
| title | text | NO | |
| description, location, contact_name, contact_phone | text | YES | |
| start_datetime, end_datetime | timestamptz | NO | CHECK end ≥ start |
| assigned_user_id | uuid | YES | FK profiles **R** |
| priority | text | NO | CHECK IN ('LOW','NORMAL','HIGH','URGENT') |
| status | text | NO | CHECK IN Master §9 Appointment |
| reminder_before_minutes | integer | YES | ≥ 0 |
| cancel_reason, cancelled_by, cancelled_at | | YES | |
| AUD + updated_at | | | |

Index `(start_datetime)`, `(assigned_user_id, start_datetime)`, `(customer_id)`, `(bill_id)`
Delete: ห้าม → CANCELLED · RLS: SELECT `is_active_member()`

#### `appointment_history` — SoT, APPEND
id PK · `appointment_id` FK **R** · `change_type` CHECK IN ('RESCHEDULE','STATUS','ASSIGN') · `original_start_datetime`, `new_start_datetime` · `before_data`, `after_data` · `reason` · AUD
RLS: SELECT `is_active_member()`

#### `notifications` — ไม่ใช่ SoT (pointer ไปยัง entity จริง, Master §27)
| คอลัมน์ | ชนิด | null | หมายเหตุ |
|---|---|---|---|
| id | uuid | NO | PK |
| event_key | text | NO | UNIQUE `(event_key, recipient_user_id)` — กันซ้ำ |
| event_type | text | NO | เช่น RENTAL_OVERDUE, LOW_STOCK |
| severity | text | NO | CHECK IN ('INFO','WARNING','CRITICAL') |
| recipient_user_id | uuid | YES | FK profiles **R** |
| recipient_permission | text | YES | FK permission_catalog **R** — ส่งให้ทุกคนที่มีสิทธิ์นี้ |
| entity_type, entity_id | text / uuid | NO | |
| title, body | text | NO | |
| status | text | NO | CHECK IN ('UNREAD','READ','HANDLED','DISMISSED','EXPIRED') |
| read_at, handled_at, handled_by | | YES | |
| expires_at | timestamptz | YES | |
| created_at | timestamptz | NO | (created_by ว่างได้ = ระบบ) |

- CHECK: มี recipient_user_id หรือ recipient_permission อย่างน้อยหนึ่ง
- Index `(recipient_user_id, status)`, `(recipient_permission, status)`, `(entity_type, entity_id)`
- RLS: SELECT `recipient_user_id = auth.uid() OR has_permission(recipient_permission) OR is_owner()`
- เขียน: ระบบ (RPC/cron) สร้าง; ผู้ใช้เปลี่ยนสถานะผ่าน `notification_mark` — CRITICAL dismiss ได้เฉพาะผู้มีสิทธิ์ (Master §27)
- Delete: งานล้าง EXPIRED ตาม retention (service_role) — ไม่ใช่ประวัติธุรกิจ

#### `document_references` — SoT, APPEND (Master §25: บันทึกทุกการพิมพ์/บันทึก/แชร์)
id PK · `document_type` · `entity_type`, `entity_id` · `document_no` · `action` CHECK IN ('PRINT','SAVE_PDF','SHARE','EMAIL') · `format` CHECK IN ('A4','80MM','PDF') · `copy_number` int · `data_snapshot_hash` · AUD
RLS: SELECT `is_active_member()` · เขียน `document_reference_log` (ACTIVE member)

### 4.I Permission codes เพิ่ม (2026-10-02 — **ถูกแทนด้วยสิทธิ์ระดับเมนู + PIN ใน v4.2** ดูหมวด V42)

Master §4.3 ไม่มีรหัสสำหรับ action เหล่านี้ แต่ RPC ต้องมีรหัสให้ตรวจ ค่าเริ่มต้นที่เลือก: **เพิ่มเข้า catalog แล้วให้ OWNER เลือกให้ USER เอง** (แทนที่จะล็อกเป็น OWNER-only ซึ่งจะทำให้พนักงานขายของไม่ได้)

| รหัสเสนอ | ใช้กับ |
|---|---|
| `bill.create` | บันทึก draft / ยืนยันบิล (checkout) |
| `delivery.create` | ส่งมอบสินค้า |
| `quotation.edit` | สร้าง/แก้/ส่งใบเสนอราคา, จอง |
| `appointment.edit` | สร้าง/เลื่อน/ยกเลิกนัด |
| `cash.session_manage` | เปิด/ปิดกะ, cash in/out |
| `cash.variance_approve` | อนุมัติปิดกะที่มีส่วนต่าง |
| `finance.write_off_approve` | อนุมัติ write-off |
| `settings.manage` | แก้ store_settings (หรือคง OWNER-only) |

---

## 5. RLS / Grant สรุป

| กลุ่ม | SELECT | INSERT/UPDATE/DELETE จาก client |
|---|---|---|
| profiles | ตัวเอง หรือ `security.manage_roles` | UPDATE ชื่อ/รูปของตัวเองเท่านั้น |
| permission_catalog, store_settings, product_categories, contract_templates | ACTIVE member | ไม่มี |
| user_permissions | ตัวเอง หรือ `security.manage_roles` | ไม่มี |
| customers | `customer.view` | ไม่มี |
| products, product_units | `product.view` (+ `stock.view` สำหรับ units) | ไม่มี |
| product_costs | `product.view_cost` | ไม่มี |
| contracts, versions, quotations, reservations, bills, bill_lines, deliveries, returns, carry forwards, incident_cases, charges, appointments, document_references | ACTIVE member | ไม่มี |
| payments, payment_receipts | `finance.view` หรือ `payment.receive` | ไม่มี |
| refunds | `finance.view` / `refund.create` / `refund.approve` | ไม่มี |
| deposit_* | `finance.view` / `deposit.*` | ไม่มี |
| finance_ledger_entries, bill_adjustments, write_offs | `finance.view` | ไม่มี |
| expense_entries | `finance.view` หรือผู้สร้าง | ไม่มี |
| cash_sessions, cash_movements | `finance.view` หรือผู้เปิดกะ | ไม่มี |
| stock_movements, stock_counts(+lines) | `stock.view` | ไม่มี |
| stock_balances | `stock.view` หรือ `product.view` | ไม่มี |
| audit_logs | `audit.view` | ไม่มี |
| approval_requests | ผู้ขอ หรือผู้มีสิทธิ์ของ action นั้น | ไม่มี |
| notifications | ผู้รับ / ผู้มีสิทธิ์ที่กำหนด / OWNER | ไม่มี (ผ่าน `notification_mark`) |
| idempotency_keys, document_sequences | ไม่มี | ไม่มี |

- `anon`: ไม่มีสิทธิ์ใด ๆ ทุกตารางและทุกฟังก์ชัน
- PENDING / SUSPENDED: เห็นแค่ profile ของตัวเอง (ทุก policy อื่นผ่าน `is_active_member()` หรือ `has_permission()` ซึ่งตรวจ ACTIVE)
- Realtime: publish เฉพาะตารางที่ UI ต้อง subscribe (bills, bill_lines, notifications, stock_balances) — RLS ใช้กับ realtime ด้วย

---

## 6. RPC ที่ต้องมี

ทุกตัว: SECURITY DEFINER, `search_path = ''`, `_require_permission` บรรทัดแรก, actor = `auth.uid()`, idempotency key สำหรับงานเงิน/สต็อก, lock ตามคอลัมน์ "Lock", audit, grant `authenticated` เท่านั้น

| RPC | Permission | Lock | หมายเหตุ |
|---|---|---|---|
| `owner_set_member_status` / `owner_set_member_role` / `owner_set_member_permissions` | OWNER (`security.manage_roles`) | advisory `pos.owner_membership` + profile | reuse |
| `bootstrap_owner` | service_role เท่านั้น | advisory | reuse + แก้ race |
| `settings_update` | OWNER / `settings.manage` | store_settings | |
| `customer_create` / `customer_update` / `customer_set_active` | `customer.edit` | customer | ตรวจซ้ำ ชื่อ/เบอร์ |
| `product_create` | `product.edit` (+ `product.edit_price`, `product.edit_cost` ถ้าใส่ราคา/ทุน) | — | สร้าง INITIAL movement |
| `product_update` / `product_set_active` / `product_set_cost` | `product.edit` / `product.edit_price` / `product.edit_cost` | product | audit before/after |
| `product_unit_register` | `product.edit` | product | |
| `contract_create` | `contract.create` | customer | version 1 + deposit holding |
| `contract_new_version` | `contract.new_version` | contract | |
| `contract_end` | `contract.end` | contract + holding + bills | ตรวจ §6.4 |
| `contract_void` | `contract.void` | contract | |
| `quotation_save_draft` / `quotation_send` / `quotation_set_status` | `quotation.edit` | quotation | |
| `reservation_create` / `reservation_release` / `reservations_expire` (cron) | `quotation.edit` / ระบบ | stock_balances | |
| `bill_save_draft` | `bill.create` | bill | แทน upsert ตรงจาก client |
| `bill_confirm` (checkout) | `bill.create` (+ `product.edit_price` ถ้า override) | bill, lines, stock_balances, sequence | Atomic ตาม Master §8.5 ห้าม commit บาง line |
| `bill_cancel` / `bill_void` | `bill.cancel` / `bill.void` | bill + stock | release reservation, ห้ามคืนเงินอัตโนมัติ |
| `bill_correct` | `bill.correct` | bill | ห้ามยืดช่วงเช่า/เพิ่ม delivered |
| `bill_adjust` | `bill.correct` | bill | credit/debit adjustment |
| `delivery_create` | `delivery.create` | line, stock_balances, unit | Rental line → ACTIVE |
| `return_receive` | `rental.return` | line, stock_balances | `qty ≤ obligation_held_here` |
| `incident_open` / `incident_assess` | `rental.return` / `rental.damage_assess` | line | |
| `lost_approve` (`approve_lost`) | `rental.lost_approve` | line, incident | ต้องผ่าน MISSING |
| `charge_create` / `charge_confirm` | `rental.damage_charge` / `rental.additional_charge_confirm` | bill, line | ห้ามสร้างอัตโนมัติ, กันช่วงซ้ำ |
| `overdue_review` | `rental.additional_charge_confirm` | line | ปิด exception "เกินกำหนดยังไม่ตรวจ" |
| `rental_continuation_request` / `create_rental_continuation` | `rental.continue` (+ ผู้อนุมัติ) | from_line(s) | บิลลูก + carry forward, ไม่มี stock movement |
| `reverse_carry_forward` | `rental.continue` | lines ทั้งสองฝั่ง | ตรวจ §17.7 |
| `payment_receive` (`receive_payment`) | `payment.receive` | bill, cash_session | split tenders, idempotency |
| `payment_void` | `payment.void` | bill, payment | |
| `refund_create` / `refund_approve` / `refund_pay` (`refund_payment`) | `refund.create` / `refund.approve` | bill | ≤ refundable |
| `deposit_receive` | `deposit.receive` | holding | + cash movement |
| `deposit_apply` | `deposit.apply` | holding, bill/charge | ห้ามอัตโนมัติ |
| `deposit_refund` | `deposit.refund` | holding | partial / full (§18.5) |
| `deposit_reverse` | `deposit.refund` | holding | REVERSAL |
| `write_off_approve` | `finance.write_off_approve` | bill, incident/charge | |
| `close_bill` (`_bill_try_close` + RPC เรียกเอง) | ระบบ / `bill.create` | bill | Master §21.2 |
| `stock_receive` / `stock_adjust` | `stock.adjust` (+ `stock.approve_adjustment` ตาม threshold) | stock_balances | reason required |
| `stock_count_open` / `stock_count_record` / `stock_count_approve` | `stock.count` / `stock.approve_adjustment` | count | adjustment มาจาก discrepancy เท่านั้น |
| `cash_session_open` / `cash_in_out` / `close_cash_session` | `cash.session_manage` (+ `cash.variance_approve`) | session | |
| `expense_create` / `expense_approve` / `expense_void` | `finance.expense_create` / `finance.expense_approve` | expense | |
| `appointment_save` / `appointment_reschedule` / `appointment_cancel` | `appointment.edit` | appointment | history + audit |
| `notification_mark` | ผู้รับ | notification | |
| `document_reference_log` | ACTIVE member | — | แทนการ insert audit จาก client |
| `reconcile_bill(bill_id)` / `reconcile_stock_balances()` | OWNER / service_role | — | ตรวจ cache กับ ledger |

---

## 7. สิ่งที่ reuse จาก `20261002000001_action_permissions_rls_lockdown.sql`

| ส่วน | บรรทัด | สถานะใน baseline |
|---|---|---|
| Signup trigger ให้เป็น PENDING, ไม่อ่าน role จาก metadata | 63–122 | ใช้ตามเดิม (ตัด `ON CONFLICT DO UPDATE email` ออกได้) |
| CHECK status PENDING/ACTIVE/SUSPENDED | 49–59 | ใช้; `is_approved` กลายเป็น generated column |
| `permission_catalog` + seed 36 รหัส | 131–177 | ใช้ + เพิ่ม `is_risky` + รหัสเสนอหมวด 4.I |
| `user_permissions` (FK RESTRICT) | 179–185 | ใช้ตามเดิม |
| `is_active_member` / `is_owner` / `has_permission` + grants | 194–254 | ใช้ตามเดิม (เปลี่ยน search_path เป็น `''`) |
| `owner_set_member_status/role/permissions` (reason, LAST_OWNER, CANNOT_CHANGE_SELF, audit) | 301–501 | ใช้ + advisory lock |
| `bootstrap_owner` | 504–540 | ใช้ + แก้ race + ตรวจ uid IS NULL |
| Audit actor มาจากเซิร์ฟเวอร์ | 782–802 | หลักการเดียวกัน แต่ baseline ไม่ให้ client insert เลย |
| Pattern `(SELECT public.fn())` ใน policy (initplan cache) | ทั้งไฟล์ | ใช้ |
| ห้าม DELETE บน entity ที่มีประวัติ | 630–828 | ขยายเป็นทุกตาราง |
| REVOKE ALL จาก PUBLIC/anon/authenticated แล้ว grant กลับ | 573–581 | ใช้แบบ schema-wide |

**ไม่ย้ายมา:** policy UPDATE `products`/`bills`/`bill_items` แบบ ACTIVE member และ INSERT ตรงบน `stock_movements`/`statement_transactions`/`audit_logs` (เป็นทางชั่วคราวเพื่อให้โค้ด app เดิมยังทำงาน), trigger `enforce_product_update_permissions` (ไม่จำเป็นเมื่อเขียนผ่าน RPC), section G (baseline ไม่มี CASCADE ตั้งแต่ต้น)

## 8. สิ่งที่ discard จาก 19 migration เดิม

| เรื่อง | ไฟล์ | เหตุผล |
|---|---|---|
| ID เป็น `TEXT` ทุกตารางธุรกิจ | 20260919000002, 20260924000001–000004 | Master §3.1 ต้อง UUID |
| `ON DELETE CASCADE` บนบิล/การเงิน/profile | 20260912000001:6, 20260919000002:45/60/71, 20260924000002:45, 20260924000003:19, 20260924000004:30–31 | Master §3.3 |
| `process_split_payment_rpc` ทุกเวอร์ชัน + `_secure` | 20260919000002, 20260924000001, 20260924000007 | ไม่ตรวจ ACTIVE/permission; ต้นฉบับ grant anon |
| `process_payment_refund_rpc` | 20260922000001, 20260923000001, 20260928000001 | ไม่ตรวจ ACTIVE/permission; ทาง service_role รับ actor จาก parameter |
| `record_stock_movement_atomic` (INVOKER) | 20260929000001 | คำนวณ available ผ่าน RLS ผู้เรียก, ไม่ตรวจ `stock.adjust`, ไม่มี state bucket |
| `payment_batches` + `statement_transactions` | 20260919000002 | ผสม payment/ledger/expense ในตารางเดียว — แทนด้วยหมวด 4.F |
| `products.stock_quantity`, `cost_price` ในตาราง products | 20260924000001, 20260925000002 | Master §7 / ซ่อนต้นทุนด้วย RLS ไม่ได้ |
| คอลัมน์ deposit ระดับบิล (`held_deposit_amount`, `deposits` JSONB, `is_deposit`) | 20260924000003, 20260926000001 | Master §18 deposit ระดับ contract |
| `EXTENDED` / `EXTENSION` / `-EXT` lineage | 20260924000003, 20260926000001 | Master §17 ใช้ carry forward |
| `lateFeeMode` / late fee settings | 20260924000005, 20260929000001 | Master §16 ห้ามคิดอัตโนมัติ |
| ตาราง `permissions` (boolean หยาบ) | 20260924000001:427 | แทนด้วย catalog + user_permissions |
| `handle_new_user` (ไม่มี search_path, auto-approve) | 20260912000001 | แทนด้วย `handle_new_auth_user_profile` |
| `profiles.user_id` generated, `full_name` | 20260923150637 | ซ้ำซ้อน/legacy |
| `employees`, `jobs`, `job_assignments` | 20260924000004 | ไม่อยู่ใน Master — งานมอบหมายใช้ `appointments.assigned_user_id`; ถ้ายังต้องใช้ ให้ทำ migration แยกหลัง baseline |
| `ai_social_drafts`, `system_secrets` | 20260924000005–000006 | นอก Master POS — ถ้ายังต้องใช้ ย้ายเป็น migration เสริม (secrets ต้อง service_role only เหมือนเดิม) |
| ข้อมูลสินค้าใน migration | 20260925000003 | Seed ข้อมูลจริง (43 รายการ) ต้องแยกเป็น seed script ที่ตรวจแล้ว ไม่อยู่ใน schema migration |
| Realtime publication แบบกว้าง | 20260929000002 | เลือกเฉพาะตารางในหมวด 5 |

---

## 9. Security blocker ที่ยังเหลือ

ใน baseline design เองไม่มี blocker ค้าง แต่ก่อนใช้ baseline จริงยังติดเรื่องเหล่านี้:

| # | เรื่อง | ระดับ | ต้องทำ |
|---|---|---|---|
| 1 | โค้ด app ยังเขียนตารางตรง: `bill-repository.ts:143` (upsert บิล), `:159` (delete), `finance-repository.ts:112` (insert ledger), `product-repository.ts:212`/`:221` (upsert/delete สินค้า), `insertStockMovementToSupabase`, `audit-storage.ts:300` | สูง | ย้ายไปเรียก RPC ในหมวด 6 — ถ้า apply baseline ก่อน หน้าจอเหล่านี้จะ error ทันที (ปลอดภัย แต่ใช้งานไม่ได้) |
| 2 | ถ้ามีใครรัน chain เดิมไปแล้วที่ไหน: payment/refund RPC ให้ PENDING/SUSPENDED และ USER ไร้สิทธิ์ รับ/คืนเงินได้ | สูง (ใน chain เดิม) | อย่า apply chain เดิมที่ Production; Production ยังว่าง (Master §34) |
| 3 | ~~รหัสสิทธิ์เสนอเพิ่ม 8 รหัส~~ | — | ปิดแล้ว: LOCKED 2026-10-02 |
| 4 | SoD (ผู้อนุมัติ ≠ ผู้สร้าง) และ Approval Threshold ยังเป็น policy ว่าง (Master §37 ข้อ 9) | กลาง | กำหนดค่าใน `store_settings.policies` ก่อนเปิดใช้ refund/write-off |
| 5 | Auth settings ฝั่ง Supabase Dashboard (ปิด/เปิด email signup, email confirm, JWT expiry, leaked password protection) ไม่อยู่ใน SQL | กลาง | checklist ตอนตั้งโปรเจกต์ |
| 6 | Extensions ที่ต้องเปิด: `pgcrypto` (gen_random_uuid มีใน PG13+ อยู่แล้ว), `btree_gist` (exclusion constraint ของ charge), `pg_trgm` (ตรวจลูกค้าซ้ำ, optional), `pg_cron` (expire reservation / notification) | ต่ำ | ระบุใน baseline |

---

## 10. ความพร้อมสำหรับ fresh DB test

| รายการ | สถานะ |
|---|---|
| รายชื่อตาราง + คอลัมน์ + PK/FK/CHECK/UNIQUE/index + delete policy + RLS + SoT/DRV | **พร้อม** (เอกสารนี้) |
| Helper + RPC signature + permission + lock | **พร้อมระดับ design** |
| Baseline SQL | เขียนแล้ว `supabase/baseline/00_baseline.sql` — ผ่าน static check, ยังไม่ได้รันบน DB |
| Seed (`permission_catalog`, `document_sequences`, `store_settings`, สินค้า 43 รายการ) | ยังไม่เขียน |
| Test plan บน DB เปล่า | ร่างด้านล่าง |

ลำดับที่แนะนำ:
1. เขียน `supabase/baseline/00_baseline.sql` (ไม่ใส่ใน `supabase/migrations/` จนกว่าจะเลิกใช้ chain เดิม) แบ่งเป็น: extensions → default privileges → tables → constraints/triggers → helpers → RLS/grants → RPC → seed catalog
2. รันบน DB เปล่าที่ไม่ใช่ Production (`supabase start` บนเครื่อง หรือ Supabase branch ชั่วคราว)
3. ทดสอบ (pgTAP หรือ vitest ผ่าน supabase-js ด้วย user จริง 4 แบบ: anon, PENDING, USER ไม่มีสิทธิ์, USER มีสิทธิ์, OWNER):
   - anon/PENDING อ่านตารางธุรกิจไม่ได้, เรียก RPC ไม่ได้
   - client INSERT/UPDATE/DELETE ทุกตารางธุรกิจ → permission denied
   - `bootstrap_owner` 2 ครั้งพร้อมกัน → ได้ OWNER คนเดียว
   - LAST_OWNER / CANNOT_CHANGE_SELF
   - payment ซ้ำ idempotency key เดิม → ผลเดิม, hash ต่าง → error
   - ผู้ใช้ 2 คนใช้ idempotency key เดียวกัน → แยกกัน ไม่ replay ผลของอีกคน
   - checkout 2 session แย่งสต็อกชิ้นสุดท้าย → สำเร็จ 1 ล้ม 1, `stock_balances` ไม่ติดลบ
   - return เกิน `obligation_held_here` → error
   - carry forward 2 บิลลูกจากบิลแม่เดียวรวมเกินภาระ → error
   - deposit apply/refund เกิน available → error
   - ลบบิลที่มี payment ด้วย service_role → RESTRICT error
   - UPDATE/DELETE `audit_logs`, `stock_movements`, `deposit_movements` → error แม้ใน RPC
4. ย้ายโค้ด app ไปเรียก RPC (blocker #1) แล้วรัน `pnpm run test / typecheck / lint`
5. ค่อยพิจารณา apply ที่ Production หลังเจ้าของระบบอนุมัติ

---

## 11. ส่วนที่ SQL (`supabase/baseline/00_baseline.sql`) ต่างจากเอกสารออกแบบข้างบน

| เรื่อง | ใน SQL | เหตุผล |
|---|---|---|
| `product_units` | ใช้ `unit_state` (IN_STOCK, RENTED_OUT, SOLD, …) แทน `stock_state` | ยอดจำนวนอยู่ที่ `stock_balances` อยู่แล้ว ถ้าผูกสถานะชิ้นกับยอดรวมจะไม่ตรงกันตอนจองระดับจำนวน |
| `reservations` | ใช้กับใบเสนอราคาเท่านั้น; มี `converted_bill_id` | ตอน checkout จองสต็อกที่ `bill_lines.allocated_qty` โดยตรง ไม่ต้องมีแถวจองซ้ำ |
| `bills` / `bill_lines` | เพิ่ม DRV `bill_discount_amount`, `write_off_total`, `base_amount`, `line_discount_amount` | ให้ตรวจสูตร §8.4 ย้อนหลังได้ |
| `delivery_lines` / `return_lines` | ไม่มีคอลัมน์ reversal | baseline ยังไม่รองรับ "คืนสินค้าขาย" — `bill_void` จะปฏิเสธบิลที่ส่งมอบสินค้าขายไปแล้ว (`SALE_ALREADY_DELIVERED`) |
| `stock_counts` | สถานะ OPEN / COUNTED / APPROVED / CANCELLED; นับเฉพาะ AVAILABLE ของสินค้าแบบจำนวน | สินค้ารายชิ้นตรวจด้วย serial ผ่าน `stock_adjust` |
| `refunds` | REQUESTED → APPROVED (`refund_decide`) → PAID (`refund_pay`) | แยกการอนุมัติออกจากการจ่ายเงินจริง |
| `finance_ledger_entries` | มี `entry_type = 'VAT'` และ class `VAT_INCLUDED` | แถว REVENUE + VAT รวมกันเท่ากับ `grand_total` ทั้งแบบ VAT ในและนอก |
| สิทธิ์จัดการสมาชิก | OWNER เท่านั้น; `security.manage_roles` สงวนไว้ | กัน USER ยกระดับสิทธิ์ตัวเอง |
| ค่า policy ที่ SQL อ่าน | `store_settings.policies`: `allow_backorder`, `allow_overpayment`, `require_separate_approver`, `max_discount_percent`, `stock_adjust_approval_qty` | ค่าเริ่มต้น: ไม่รับ backorder, ไม่รับเงินเกิน, ไม่บังคับผู้อนุมัติคนละคน, ไม่จำกัดส่วนลด, ไม่มีเกณฑ์อนุมัติการปรับสต็อก |

---

## 12. Fresh DB test (local เท่านั้น) — 2026-10-02 · **ประวัติของแบบ v4.1 — ห้ามใช้อ้างอิงกับ v4.2 (หมวด V42.4)**

**สภาพแวดล้อม:** container ทิ้งได้ `pos-baseline-db` จาก image `public.ecr.aws/supabase/postgres:17.6.1.155` (มี schema `auth`, role `anon` / `authenticated` / `service_role` แบบ Supabase) bind ที่ `127.0.0.1:54432` เท่านั้น ไม่มีการเชื่อม remote, ไม่ replay 19 migration เดิม, สร้างใหม่จากฐานเปล่าทุกรอบ เรียก client ด้วย `SET ROLE authenticated` + `request.jwt.claim.sub` แบบเดียวกับ PostgREST

**ผล build:** 49 tables, 130 functions (74 RPC ที่ client เรียกได้, 3 RPC ระบบสำหรับ service_role, 3 helper ของ RLS, 48 helper ภายใน, 15 trigger function, 1 signup trigger), 168 FK (RESTRICT ทั้งหมด), 171 CHECK, 29 UNIQUE, 1 EXCLUDE, 163 index, 72 trigger, 48 policy, 1 view; `plpgsql_check` ไม่พบ error/warning

**ผลทดสอบ:** 318 ข้อ ผ่าน 318 (รวม race 3 แบบ: bootstrap_owner พร้อมกัน, checkout แย่งสต็อกชิ้นสุดท้าย, ส่งชำระเงินซ้ำด้วย key เดียวกันพร้อมกัน)

**ข้อผิดพลาดที่พบและแก้ใน `00_baseline.sql`:**

| # | พบจาก | ปัญหา | แก้ |
|---|---|---|---|
| 1 | plpgsql_check | `_line_belongs_to_header` อ้าง `NEW.return_id` / `NEW.delivery_id` ตรง ๆ ทั้งที่ใช้ร่วม 4 ตาราง | อ่านผ่าน `to_jsonb(NEW)` |
| 2 | test NOTIFY | `notification_mark`: ถ้า `recipient_user_id` เป็น NULL เงื่อนไขกลายเป็น NULL ทำให้คนที่ไม่ใช่ผู้รับ mark ได้ | `COALESCE(... , false)` |
| 3 | test GRANTS | service_role ได้ EXECUTE helper ภายใน (`_stock_move` ฯลฯ) จาก default privileges ของ Supabase | REVOKE จาก service_role ด้วย แล้ว grant เฉพาะ bootstrap / งาน cron / reconcile |
