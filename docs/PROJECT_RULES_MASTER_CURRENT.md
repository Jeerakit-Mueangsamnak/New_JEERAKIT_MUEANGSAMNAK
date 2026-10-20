# PROJECT RULES MASTER (CURRENT)

**STATUS:** CURRENT — Master Rules ของระบบ POS ขาย + เช่า + สต็อก + ลูกค้า + นัดหมาย + การเงิน + การควบคุม
**Architecture Business Rules:** LOCKED
**Version:** 4.3.1
**Last Updated:** 2026-10-04
**ฐานเนื้อหา:** `POS_MASTER_ALL_IN_ONE_COMPLETE_SPEC_TH.txt` (Master Spec) + คำตัดสินของเจ้าของระบบ + Architecture Decisions ที่ล็อกแล้ว
**แทนที่:** v4.1.0 และร่าง/กฎเก่าทั้งหมด — ไฟล์นี้เป็น **กฎหนึ่งเดียว** ของโปรเจกต์ (สิ่งที่เปลี่ยนใน v4.2 สรุปไว้หมวด 36)

---

## 0. Source of Truth / Authority

### 0.1 ลำดับอำนาจ

เมื่อข้อความจากแหล่งต่าง ๆ ขัดกัน ให้ใช้ลำดับนี้ (ข้อบนชนะข้อล่าง):

| ลำดับ | แหล่ง | สถานะ |
|---|---|---|
| 1 | คำตัดสินล่าสุดของเจ้าของระบบ | กำหนดกฎ |
| 2 | Architecture Decisions ที่ล็อกแล้ว (รวมอยู่ในไฟล์นี้) | กำหนดกฎ |
| 3 | `POS_MASTER_ALL_IN_ONE_COMPLETE_SPEC_TH.txt` ส่วน A–AD (Master Spec — ต้นฉบับอยู่ที่ `Desktop\ฉบับสมบูรณ์\` ไม่อยู่ในโปรเจกต์) | กำหนดกฎ เว้นแต่ถูก Override โดยข้อ 1–2 |
| 4 | ภาคผนวก AE (ข้อมูลดิบ) ของ Master Spec | Reference เท่านั้น |
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
| **เอกสารลูกค้า (Customer Document)** | เอกสารที่เก็บไว้กับลูกค้า เช่น สัญญาเช่า สำเนาบัตรประชาชน ทะเบียนบ้าน — **ผูกกับลูกค้า ไม่ผูกกับบิล** (หมวด 6) |
| **สัญญาเช่า (Rental Contract)** | เอกสารลูกค้าประเภทหนึ่ง สร้าง/จัดการจากเมนูจัดการเอกสาร — **บิลเช่าไม่ต้องเลือกหรือผูกสัญญา** |
| **Bill (บิล)** | เอกสาร/ธุรกรรมการขาย-เช่า เป็นหัวบิลกลางที่มี Line แบบ SALE และ RENTAL — **Bill ไม่ใช่สัญญา** |
| **การเช่าต่อ (Rental Continuation)** | ลูกค้าขอเช่าของต่อจากช่วงเดิม → สร้าง **บิลเช่าใหม่** สำหรับช่วงถัดไป อ้างอิงบิลเดิม — **ไม่ใช่การต่อหรือแก้สัญญา** |
| **Carry Forward (การส่งต่อภาระ)** | การบันทึกว่าของที่ยังอยู่กับลูกค้าจาก Line ของบิลเดิม ถูกติดตามต่อที่ Line ของบิลใหม่ |
| **Renewal / ต่ออายุ** (คำใน Master Spec และภาคผนวก) | ให้อ่านเป็น "การเช่าต่อ" ตามนิยามข้างบนเสมอ ห้ามตีความเป็นการต่อสัญญา |
| **Deposit (เงินมัดจำ)** | ยอดมัดจำที่ผูกกับ **บิลเช่าครั้งนั้น** ไม่ใช่รายได้ — ระบบเก็บไว้ตรวจสอบย้อนหลัง การคืน/หักเงินจริงทำที่หน้าร้าน (หมวด 18) |
| **PIN** | รหัสของผู้ใช้แต่ละคน (1 คน 1 PIN ผูกกับบัญชี) ใช้ปลดล็อกหน้าจอและยืนยันรายการเสี่ยง (หมวด 4.3) |
| **รายการเสี่ยง** | งานที่ทำให้เงิน สต็อก หรือประวัติธุรกรรมเปลี่ยนแบบผิดปกติ — ต้องใส่ PIN + Audit (หมวด 4.4) |
| **Correction** | การแก้ข้อมูลที่บันทึกผิดจริง ยืนยันด้วย PIN พร้อม Audit — ไม่ใช่เครื่องมือยืดระยะเวลาเช่า |
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
   - Cancel / Void / Correction = Reversal / Compensating Entry
3. **สถานะแยกหลายมิติ** — Bill, Payment, Return, Rental, Fulfillment, Item Condition, Appointment, Notification (หมวด 9)
4. **สถานะปัจจุบันคำนวณจากข้อมูลจริง** (Derived) — ค่า cache ได้ แต่ถ้าไม่ตรงกัน ให้ประวัติธุรกรรมเป็นฐานในการ reconcile
5. **Stock และ Finance มี Ledger/Movement ของตัวเอง** — Deposit แยกจาก Income/Expense ไม่นับเป็นรายได้
6. **งานที่แก้หลายตารางต้อง Atomic** — BEGIN → Validate → Lock → Insert/Update → Audit → COMMIT; ผิดพลาด → ROLLBACK ทั้งเหตุการณ์
7. **Notification ไม่ใช่ Source of Truth** — เป็นตัวชี้ไปยัง Entity จริง
8. **Entity ที่มีประวัติห้าม Hard Delete** — ใช้ active/inactive หรือสถานะ
9. **สิทธิ์ตรวจระดับเมนู + รายการเสี่ยงยืนยันด้วย PIN** — ตรวจที่ฝั่ง Server ไม่พึ่ง UI อย่างเดียว (หมวด 4)
10. **ทำงานแบบ Free-style** — ไม่มีขั้นขออนุมัติในระบบ (Request → Pending → Approve) ผู้ใช้ที่มีสิทธิ์ทำได้ทันที แต่ทุกการกระทำสำคัญต้องมี Audit
11. **Audit แก้/ลบไม่ได้** (ทั้งผู้ใช้และระบบ)
12. **Close Bill ต้องตรวจ** `financial_resolved AND merchandise_resolved AND exception_resolved`
13. **ป้องกัน Double Submit / Duplicate Transaction** ด้วย idempotency key
14. **ทุก Record มี** `created_at`, `created_by` และข้อมูล Audit ที่จำเป็น
15. **ออนไลน์เท่านั้น** — เงิน/สต็อกต้องผ่าน DB Transaction + Locking ถ้าเน็ตหลุดให้หยุดธุรกรรม ไม่มีโหมด Offline/Sync ภายหลัง

กฎสำคัญที่สุด:
> ข้อมูลต้นฉบับไม่ถูกแก้ทับจนสูญเสียประวัติ — เหตุการณ์ใหม่สร้าง Record ใหม่ — สถานะปัจจุบันคำนวณจากข้อมูลจริง — Stock และ Finance มี Ledger — ทุกรายการเสี่ยงผ่าน PIN + Transaction + Audit

---

## 3. Identity, Document Number และความคงทนของข้อมูล

### 3.1 Internal ID
- ทุกตาราง ใช้ **UUID** เป็น Primary Key และ Foreign Key ภายใน อย่างสม่ำเสมอ
- ห้ามยึดชนิด `TEXT` ของ schema เดิมเป็นมาตรฐาน
- ห้ามใช้เลขเอกสารเป็น Primary Key

### 3.2 Document Number
- Document Number มีไว้สำหรับผู้ใช้และเอกสารพิมพ์ **แยกจาก Internal ID**
- Unique ตาม Document Type และแต่ละชนิดใช้ **ชุดเลขของตัวเอง**
- เอกสารที่มีเลข: Quotation, Reservation, Bill, Receipt / Payment Receipt, Refund, Credit Note, Appointment, Stock Adjustment, Inventory Count (เลขของสัญญาเช่า/เอกสารลูกค้า — หมวด 37)
- Draft ยังไม่ออกเลข Final — ออกเลขเมื่อ Confirm/Post ภายใน Transaction ที่ Lock Sequence
- เลขที่ออกแล้วห้ามนำกลับมาใช้ (No Recycle) — เอกสารที่ Void แล้วถือว่าใช้เลขแล้ว
- Transaction ล้มเหลวหลังขอเลข: ยอมให้เลขขาดช่วงได้ แต่ห้ามใช้ซ้ำ
- เลข Final ห้ามแก้

ตัวอย่างรูปแบบ (รูปแบบจริงตั้งค่าได้ — ดูหมวด 37): `QT-2026-000001`, `BL-2026-000001`, `RF-2026-000001`, `CN-2026-000001`, `AP-2026-000001`

### 3.3 การลบและ Foreign Key
- Business Entity ที่มีประวัติ (Customer, Customer Document, Product, Bill, Payment, Refund, Stock Movement, Audit ฯลฯ) **ห้าม Hard Delete**
- **ห้าม `ON DELETE CASCADE`** จาก Bill (หรือ Entity หลักอื่น) ไปทำลาย Payment / Refund / Ledger / Stock Movement / Audit
- ใช้ `ON DELETE RESTRICT` หรือ `NO ACTION` ตามความเหมาะสม
- Audit เป็น polymorphic (`entity_type` + `entity_id`) ไม่ต้องมี FK และห้ามลบ
- Draft ที่ยังไม่มีธุรกรรมใด ๆ ยกเลิกได้ด้วยสถานะ ไม่ต้องลบ

---

## 4. User / Role / สิทธิ์เมนู / PIN

### 4.1 Role และสถานะบัญชี
- Role หลักมีเพียง **`OWNER`** และ **`USER`**
- `OWNER` ทำได้ทุกเมนู และเป็นผู้กำหนดสิทธิ์เมนูของ `USER`
- บัญชีมีสถานะ `PENDING` (สมัครใหม่) / `ACTIVE` / `SUSPENDED` — **เฉพาะ `ACTIVE` เท่านั้นที่ใช้งานระบบได้** (Login สำเร็จแต่สถานะอื่นต้องถูกปฏิเสธ และถูกตัดออกทันทีแม้ล็อกอินค้างอยู่)
- สมัครใหม่เป็น `USER` + `PENDING` เสมอ — ห้ามอ่าน Role/สถานะจากข้อมูลที่ผู้สมัครส่งมา
- MANAGER / CASHIER / STOCK / FINANCE ใน Master Spec **ไม่ใช้เป็น Role**
- บัญชีเจ้าของร้านไม่ผูกกับบุคคลแบบตายตัวในโค้ด — เปลี่ยนเจ้าของร้านได้ด้วยการตั้งบัญชีใหม่เป็น OWNER และระงับบัญชีเดิม

### 4.2 สิทธิ์เข้าถึงเมนู
- ผู้ใช้แต่ละคนถูกกำหนด **เมนูที่เข้าได้** ตามหน้าที่ เช่น POS, บิล, ลูกค้า, สินค้า, การเงิน, รายงาน (รายการเมนูจริง — หมวด 37)
- USER ใหม่ไม่ได้สิทธิ์เมนูใด ๆ อัตโนมัติ — OWNER เป็นผู้ให้
- ภายในเมนูที่ได้สิทธิ์ ผู้ใช้ทำงานได้ทันที **ไม่มีขั้นขออนุมัติ** (หมวด 4.4)
- ตรวจสิทธิ์ที่ฝั่ง Server/RPC ด้วย ไม่ใช่แค่ซ่อนเมนูใน UI
- OWNER เข้าได้ทุกเมนู / USER เข้าได้เฉพาะเมนูที่ OWNER เปิดให้เป็นรายคน — รวม **ตั้งค่าระบบ, รายงาน, การเงิน** (เปิด/ปิดให้รายคนได้)
- **จัดการสิทธิ์ผู้ใช้ = OWNER เท่านั้น** / **Audit = OWNER อ่านอย่างเดียว** — ห้ามแก้ ห้ามลบ (หมวด 29)
- ชุดสิทธิ์ราย Action เดิม (เช่น `refund.approve`, `stock.approve_adjustment`, `rental.lost_approve` และ 8 รหัสที่เพิ่มเมื่อ 2026-10-02) **ถูกแทนด้วยสิทธิ์ระดับเมนู + PIN**

### 4.3 PIN
- **1 ผู้ใช้ = 1 PIN** ผูกกับบัญชีของผู้ใช้นั้นในฐานข้อมูล — ไม่ใช้ร่วมกัน (OWNER ใช้ PIN ของ OWNER, นิดใช้ PIN ของนิด)
- ผู้ใช้ตั้ง PIN เองในเมนูตั้งค่า PIN — ใช้ PIN เดิมได้ทุกเครื่อง (iPad/PC) หลังล็อกอิน
- (2026-10-04) **PIN ไม่บังคับตอนสมัครหรือล็อกอินครั้งแรก**: สมัคร → ล็อกอิน → ใช้งานตามสิทธิ์ทันที → ตั้ง PIN ภายหลังที่ ตั้งค่า › ความปลอดภัย (`/settings/security` เปิดได้ทุกบัญชี) ซึ่งแสดง 2 การ์ด: PIN ล็อก/ปลดล็อกหน้าจอ และ PIN ยืนยันรายการเสี่ยง (เฉพาะผู้ที่มีเมนูที่มีรายการเสี่ยง) — เป็น PIN ชุดเดียวกัน; ยังไม่ตั้ง PIN = ไม่ล็อกหน้าจอ และเมื่อกดรายการที่ต้องใช้ PIN ระบบแจ้ง "ยังไม่ได้ตั้ง PIN" ให้ตั้งแล้วทำรายการเดิมต่อ; ระบบไม่สร้าง PIN ให้อัตโนมัติ
- **ฐานข้อมูลเป็นผู้ตรวจ PIN** — ห้ามตรวจเฉพาะในเบราว์เซอร์
- PIN เป็นตัวเลข 6 หลัก
- เก็บเฉพาะค่าเข้ารหัสทางเดียว (bcrypt salted hash) — **ห้ามเก็บเลข PIN จริง** ทั้งในฐานข้อมูลและ Audit
- PIN ตัวเดียวใช้ 2 งาน:
  1. **ล็อกแอปเมื่อไม่มีการใช้งาน** (แบบ iOS) — ผู้ใช้เลือกระยะเวลาเองจากรายการตัวเลือก ถ้ายังไม่เลือกใช้ค่าตั้งต้นของร้าน — บัญชียังล็อกอินอยู่ ไม่ต้องใส่ Username/Password ใหม่ / PIN ถูก → ทำงานต่อจากเดิม / PIN ผิด → ยังล็อกอยู่
  2. **ยืนยันรายการเสี่ยง** แม้หน้าจอไม่ได้ล็อก — PIN ถูก → ทำรายการต่อ / PIN ผิด → ห้ามทำรายการ
- เวลาล็อกแอปให้เลือก: 30 วินาที / 1 / 2 / 3 / 4 / 5 / 10 นาที / ไม่ล็อกอัตโนมัติ — **ค่าตั้งต้น 5 นาที** — ล็อกเฉพาะแอป Session ยังอยู่ ปลดด้วย PIN ของผู้ใช้คนปัจจุบัน แล้วกลับหน้าจอ/งานเดิม
- ใส่ผิดซ้ำ → ต้องรอนานขึ้นแบบ iOS: ครั้งที่ 1–3 ไม่ต้องรอ / 4 = 1 นาที / 5 = 5 นาที / 6 = 15 นาที / 7 = 1 ชั่วโมง / 8 = 3 ชั่วโมง / 9 = 8 ชั่วโมง / ใส่ถูกแล้วเริ่มนับใหม่
- **ผิดครั้งที่ 10 → PIN ถูกล็อก** (บัญชีไม่ถูกปิด ไม่ลบข้อมูล การ Login ด้วย Username/Password เป็นคนละเรื่องกับ PIN)
  - USER: ต้องให้ OWNER Reset PIN แล้วผู้ใช้ตั้ง PIN ใหม่เอง
  - OWNER (ไม่มีใครเหนือกว่า) และ OWNER ลืม PIN: กด "ลืม PIN" → ยืนยันตัวตนแบบทั่วไป (ลิงก์/รหัสทางอีเมล หรือ Password) → ตั้ง PIN ใหม่ — **เปลี่ยนแค่ PIN ไม่รีเซ็ตข้อมูลอื่น**
  - การ Reset PIN ทุกแบบบันทึก Audit: ใคร Reset, บัญชีใด, วันเวลา, วิธี (OWNER Reset / ยืนยัน Password ใหม่) — ห้ามบันทึกเลข PIN

ตัวอย่าง: นิดกดคืนเงิน 500 บาท → ระบบถาม PIN → นิดกรอก PIN ของนิด → ระบบตรวจ → ถูก → คืนเงิน → บันทึก Audit

### 4.4 รายการเสี่ยง (ต้อง PIN + Audit) และหลัก Free-style
หลัก: **งานปกติไม่ถาม PIN / งานที่ทำให้เงิน สต็อก หรือประวัติธุรกรรมเปลี่ยนผิดปกติ ต้องถาม PIN + บันทึก Audit**

รายการที่ต้องใส่ PIN:
- คืนเงิน (Refund)
- Void หรือยกเลิกรายการที่ยืนยันแล้ว
- รับสินค้าเข้าสต็อก
- ปรับสต็อก (รวมแปลงของชำรุด หมวด 11.5 และผลนับสต็อก)
- บันทึกของสูญหาย / ตัดจำหน่าย (Write-off)
- บันทึกรายจ่าย
- แก้ราคาหลักของสินค้า หรือ Override ราคาในบิล
- แก้รายการธุรกรรมที่ยืนยันไปแล้ว (Correction / Adjustment)
- ลด / ยกเว้น / แก้ค่าเสียหายหรือค่าสูญหายให้ต่างจากยอดที่ระบบเสนอ

ไม่ต้องใส่ PIN: งานปกติ เช่น เปิดบิล รับเงิน ส่งมอบ รับคืน บันทึกของชำรุดตอนรับคืนตามยอดที่ระบบเสนอ

ขั้นตอนยืนยันรายการเสี่ยง (คำตัดสิน 2026-10-04): กรอกข้อมูลรายการให้ครบ → ระบบคำนวณ/แสดงยอด → ผู้ใช้กรอกจำนวนจริงและเหตุผล → กด "ยืนยัน" → ระบบถาม PIN 6 หลัก → PIN ถูก → ทำรายการนั้นทันที 1 ครั้ง → สิทธิ์จาก PIN สิ้นสุด — **ไม่มีช่วงเวลาให้นำ PIN ไปใช้กับรายการอื่น** (สิทธิ์ผูกกับรายการประเภทนั้น ใช้ได้ครั้งเดียว)

**Free-style Operation:**
- OWNER และ USER ที่มีสิทธิ์เมนู ทำรายการที่จำเป็นได้เองทันที — **ไม่มีขั้นตอน Request → Pending → Owner Approve ในระบบ**
- การขอความเห็นจากเจ้าของร้านเป็นการสื่อสารนอกระบบ (โทร / คุยหน้างาน) ระบบไม่ควบคุม
- ทำผิด → ห้ามลบประวัติ ให้ทำ Correction / Reversal เป็นรายการใหม่

### 4.5 Audit ของรายการเสี่ยง
บันทึกอย่างน้อย:
- ใครทำ (user_id / ชื่อผู้ใช้), ทำอะไร, รายการที่เกี่ยวข้อง (bill / payment / product ฯลฯ)
- ค่าเดิม / ค่าใหม่, จำนวนเงินหรือจำนวนสินค้า, ช่องทางเงิน (`CASH` / `TRANSFER` / `QR` …) ถ้ามี
- เหตุผล (ผู้ใช้ต้องกรอก), วันและเวลา, ยืนยัน PIN สำเร็จหรือไม่, เครื่อง/Session ถ้ามี, ผลลัพธ์ (สำเร็จ/ไม่สำเร็จ)
- **ห้ามบันทึกเลข PIN**

ตัวอย่าง:
```
ผู้ใช้: นิด · เวลา: 04/10/2026 14:32 · การกระทำ: คืนเงิน · บิล: B00125
จำนวน: 500 บาท · เหตุผล: ลูกค้าคืนสินค้า · ยืนยัน PIN: สำเร็จ · ผลลัพธ์: คืนเงินสำเร็จ
```

---

## 5. Customer

- บิลที่มี **RENTAL Line อย่างน้อย 1 รายการ ต้องมี Customer** (รวม Mixed Bill)
- บิลที่มีเฉพาะ SALE เป็น Walk-in ได้
- ข้อมูลขั้นต่ำ: ชื่อ, เบอร์โทร, ที่อยู่
- ข้อมูลเสริม: `customer_type`, `tax_id`, `email`, `contact_person`, `billing_address`, `delivery_address`, tags, `credit_note`, `risk_note`, `document_reference`, `last_activity_at`, `note`
- ตรวจข้อมูลซ้ำ (ชื่อ/เบอร์ใกล้เคียง) → ให้เลือกใช้ลูกค้าเดิม หรือยืนยันสร้างใหม่
- **ลูกค้าเป็นศูนย์กลาง** — ประวัติลูกค้า: เอกสารลูกค้า (สัญญา สำเนา ฯลฯ), Bill, Quotation, Appointment, Payment, Refund, Rental, Return, ของค้าง, ยอดค้าง, Deposit ของแต่ละบิล, Damage/Lost, Notes
- ลูกค้าใหม่ที่จะเช่า: บันทึกข้อมูลลูกค้าก่อน แล้วจึงเปิดบิลเช่า
- เมื่อมีปัญหาหรือทุจริตภายหลัง: เปิดประวัติลูกค้า แล้วพิมพ์สัญญา สำเนา และบิลของเหตุการณ์นั้นใช้ร่วมกัน
- ห้าม Hard Delete ลูกค้าที่มีประวัติ — ใช้ `active = false`
- ทุกการแก้ไขลูกค้าต้อง Audit

---

## 6. เอกสารลูกค้า (รวมสัญญาเช่า)

### 6.1 หลักการ
- เอกสารทุกชนิด **ผูกกับลูกค้า** — สัญญาเช่า เอกสารยืนยันตัวตน สำเนาบัตรประชาชน ทะเบียนบ้าน และเอกสารอื่น
- **บิลเช่าไม่ต้องเลือกหรือผูกสัญญา** — ลูกค้ามาเช่า → เปิดบิลเช่าตามรายการที่เช่าจริง แล้วจบตามบิลนั้น
- สัญญาเช่าสร้างและจัดการจาก **เมนูจัดการเอกสาร**
- ไม่มีความสัมพันธ์ Contract ↔ Bill, ไม่มี Contract Version, ไม่มีสถานะสัญญาที่บังคับการเปิด/ปิดบิล

### 6.2 วิธีเก็บ (ดิจิทัล ประหยัดพื้นที่)
| ชนิดข้อมูล | วิธีเก็บ |
|---|---|
| สัญญาเช่า / แบบฟอร์ม | **Template ในโค้ดของระบบ** นำข้อมูลลูกค้ามาประกอบตอนแสดง/พิมพ์ — ไม่สร้างไฟล์เอกสารซ้ำโดยไม่จำเป็น |
| ลายเซ็น | ข้อมูลเส้น (SVG / JSON) |
| ภาพบัตรประชาชน / ทะเบียนบ้าน | ไฟล์ภาพที่บีบอัดแล้วใน Supabase Storage |
| ฐานข้อมูล | เก็บเฉพาะข้อมูลอ้างอิง: ประเภทเอกสาร, ลูกค้าเจ้าของ, วันที่บันทึก, ผู้บันทึก, ตำแหน่งไฟล์ / ข้อมูลลายเซ็น |

### 6.3 กฎ
- ห้าม Hard Delete เอกสารลูกค้า — เลิกใช้ด้วยสถานะ
- ไฟล์ภาพเอกสารยืนยันตัวตนเป็นข้อมูลส่วนบุคคล — อ่านได้เฉพาะผู้ใช้ที่มีสิทธิ์เมนูลูกค้า/เอกสาร (ตรวจที่ Server/Storage Policy)
- การพิมพ์สัญญาซ้ำต้องได้เนื้อหาเดิม (Template เวอร์ชันที่ใช้ + ข้อมูล ณ วันที่ทำสัญญา)

---

## 7. Product

- ข้อมูล: `sku`, `name`, `category`, `item_type`, `calculation_type`, `unit` (เลือกจากรายการหน่วยนับ), `sale_price`, `rental_price`, `cost_price`, `reorder_point`, `active`, `can_sell`, `can_rent`
- ข้อมูลเพิ่ม (คำตัดสิน 2026-10-04):
  - **อุปกรณ์เสริม** (`is_accessory`) — ชุดตั้งต้น: น็อต, กากบาท, ข้อต่อ, ครอบ และเพิ่มใหม่ได้
  - **ติดตามสต็อกแต่ไม่คิดค่าเช่า** — แยกจากสินค้าที่คิดเงิน
  - **ต้องรับคืน** (`requires_return`) — ใช้ในขั้นตอนรับคืน
  - **ค่าเสียหายตั้งต้น** และ **ค่าสูญหายตั้งต้น** — ระบบเติมให้อัตโนมัติเมื่อเกิดเหตุ ผู้ใช้แก้ได้ก่อนยืนยัน (หมวด 14.3)
  - **ไม่มี** จำนวนต่อชุดอัตโนมัติ — ผู้ใช้กำหนดจำนวนอุปกรณ์เองทุกครั้ง
  - **ไม่มี** รูปสินค้า (ลดข้อมูลและ Storage)
- **หน่วยนับ** เป็นรายการให้เลือก (เพิ่มหน่วยใหม่ได้จากหน้าจอ) — สินค้าอ้างอิงหน่วยจากรายการ
- **Product Capability**: SALE ต้อง `can_sell = true` / RENTAL ต้อง `can_rent = true`
- สูตร:
  - SALE = ราคาขาย × จำนวน
  - RENTAL ต่อครั้ง/ต่อรอบ = ราคาเช่าต่อครั้ง × จำนวน × จำนวนรอบ
  - RENTAL รายวัน = ราคาเช่าต่อวัน × จำนวน × จำนวนวัน
- แก้ราคาหลัก → ต้องใส่ PIN (หมวด 4.4) / แก้ต้นทุน → สิทธิ์เมนูสินค้า — Audit Before/After ทุกครั้ง
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
- Bill เก็บ `customer_id` — **ไม่ผูกสัญญา** (หมวด 6)
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
- Discount: รองรับ Line/Bill และ Fixed/Percentage — มีเพดานตาม Policy / Override ราคาต้องใส่ PIN (หมวด 4.4)
- VAT: `vat_enabled`, `vat_rate`, inclusive/exclusive, taxable amount, vat amount — **สวิตช์ VAT ที่ POS และ Settings ต้องเป็น state เดียวกัน**
- ค่าบริการแยกเป็น `delivery_fee`, `installation_fee`, `service_fee` — ห้ามซ่อนใน Unit Price
- Deposit **ไม่รวม** ใน Grand Total ของรายได้ (เก็บเป็นยอดมัดจำของบิลเช่า — หมวด 18)

### 8.5 Checkout (Atomic)
BEGIN → Validate Bill → Validate Customer (ต้องมีถ้ามี RENTAL) → Validate Product Capability → Lock Stock → Validate Stock → Create Bill → Bill Items → Rental Details → Stock Movements (ตามกฎ Reservation/Delivery) → Payment (ถ้ามี) → Finance Ledger → Audit → COMMIT
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
| Quotation | `DRAFT`, `SENT`, `ACCEPTED`, `EXPIRED`, `REJECTED`, `CONVERTED` |
| Reservation | `PENDING`, `ACTIVE`, `EXPIRED`, `CANCELLED`, `CONVERTED` |
| Appointment | `DRAFT`, `SCHEDULED`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`, `RESCHEDULED` |
| Notification | `UNREAD`, `READ`, `HANDLED`, `DISMISSED`, `EXPIRED` |

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
- Stock ห้ามติดลบ เว้นแต่มีกฎที่กำหนดไว้ชัด
- ใช้ Lock/Concurrency Control ป้องกัน Oversell / Over-rent
- ของชำรุดห้ามเข้า Available โดยตรง / ของหายห้ามเพิ่ม Stock
- **Carry Forward ของการเช่าต่อ ไม่สร้าง Stock Movement** (ของไม่ได้เคลื่อนจริง)

### 11.3 Backorder / Partial Delivery
- เก็บ `ordered_qty`, `allocated_qty`, `fulfilled_qty`, `delivered_qty`, `backorder_qty`, `cancelled_qty`
- Partial Delivery ต้องมี Delivery Record แยก — Backorder ห้ามนับว่า Delivered — Line ต้องเก็บ Ordered Quantity เดิม
- นโยบาย (รอทั้งหมด / ส่งบางส่วน) — หมวด 37

### 11.4 Physical Count
- สร้าง Stock Count → Snapshot → นับจริง → Count Lines → Discrepancy → Review → ยืนยันด้วย PIN → Stock Adjustment → Ledger + Audit (ไม่มีขั้นอนุมัติแยก)
- ห้ามตั้ง `quantity` ตามที่นับได้โดยตรง — Adjustment ต้องมาจาก Discrepancy และต้องมีเหตุผล

### 11.5 แปลงของชำรุดเป็นสินค้าอื่น (A → B)
- ตัวอย่าง: แบบคาน A ชำรุด 2 แผ่น นำไปทำเป็นสินค้า B 2 ชิ้น
- ต้อง **Atomic ใน Transaction เดียว**: ตัดของชำรุดของ A + รับเข้า B + Stock Movement ทั้งสองฝั่ง (อ้างอิงกัน) + PIN + Audit
- จำนวนที่ตัดจาก A ต้อง ≤ ยอดชำรุดของ A — ล้มขั้นใดขั้นหนึ่ง ต้อง Rollback ทั้งหมด

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
- ช่องทาง: `CASH`, `TRANSFER`, `CARD`, `QR`, `OTHER` — **เงินสดเป็นแค่ช่องทางหนึ่ง** ไม่มีกะ/ลิ้นชัก (หมวด 24)
- รองรับ Split Payment และหลาย Payment ต่อบิล — **แต่ละช่องทางแต่ละครั้งเป็น Record แยก**
- Flow: Validate → BEGIN → Insert Payment ใหม่ → Finance Ledger → Audit → Recalculate → COMMIT
- Validation: `amount > 0`, idempotency, สิทธิ์เมนู, balance valid, method valid, บันทึกผู้รับเงิน/เวลา/ช่องทาง/สถานะ/reference
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
| `approved_lost_qty` | Σ ของที่บันทึกยืนยันว่าหาย (ยืนยันด้วย PIN) |
| `approved_disposition_qty` | Σ disposition ที่บันทึกยืนยันแล้ว (เฉพาะสูญหาย/ตัดจำหน่าย ยืนยันด้วย PIN) |
| `resolved_qty` | `physical_returned_qty + approved_lost_qty + approved_disposition_qty` |
| `remaining_obligation` | `delivered_qty + carried_in_qty − resolved_qty` — **ค่าประวัติ** ตามเหตุการณ์ของ Line นี้ |
| `carried_forward_qty` | Σ Carry Forward ที่ออกจาก Line นี้ไปบิลลูก (ไม่นับที่ถูก Reverse) |
| `obligation_held_here` | `remaining_obligation − carried_forward_qty` — **จำนวนที่บิลนี้ยังต้องติดตามเอง** (ต้อง ≥ 0) |

- `resolved_qty` **ไม่รวม** Carry Forward — **ห้ามใช้ disposition เพื่อทำให้ภาระเป็น 0 จากการเช่าต่อ**
- ยอด "ของที่ยังอยู่กับลูกค้า" ระดับลูกค้าใช้ **Σ `obligation_held_here`** เท่านั้น (ห้ามรวม `remaining_obligation` เพราะนับซ้ำตามสายบิล)
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
- Flow: รับคืน → ตรวจสภาพ → Damage Case → ประเมิน (ซ่อมได้ → Repair Queue + Repair Cost / เสียหายถาวร → Replacement) → Damage Charge → ชำระ → Audit
- **ค่าเสียหาย/ค่าสูญหาย**: ระบบเติมยอดตั้งต้นจากราคาที่ตั้งไว้กับสินค้าให้อัตโนมัติ → ผู้ใช้แก้จำนวนเงินได้ก่อนยืนยัน → ยืนยันแล้วบันทึกไว้กับบิลและประวัติการคืนสินค้า
- บันทึกของชำรุดตอนรับคืนตามยอดที่ระบบเสนอ **ไม่ต้องใส่ PIN** / ถ้า **ลด ยกเว้น หรือแก้** ให้ต่างจากยอดที่ระบบเสนอ **ต้องใส่ PIN** + เหตุผล
- **เงินมัดจำไม่ถูกนำไปหักค่าเสียหายอัตโนมัติโดยระบบ** — การหักหรือคืนจริงจัดการที่หน้าร้าน (หมวด 18)
- งานซ่อมภายในร้านไม่ขวางการปิดบิลเมื่อ Charge ถูกกำหนดและเคลียร์แล้ว

### 14.4 Lost
- **Lost ≠ Returned** — ของหายไม่เพิ่ม Stock และห้าม mark returned
- Flow: พบจำนวนขาด → `MISSING` → ตรวจสอบ → พบ = รับคืนปกติ / ไม่พบ = บันทึก LOST (ยืนยันด้วย PIN) → Lost Charge (เติมจากค่าสูญหายตั้งต้น แก้ได้ก่อนยืนยัน) → ชำระ → ปรับทะเบียนสินค้า → Audit
- ต้องผ่าน `MISSING` ก่อน LOST
- Lost Charge เก็บ basis, amount, ผู้ยืนยัน, reason, timestamp
- **Write-off**: ใช้เมื่อร้านยอมรับภาระขาดทุน/เรียกเก็บไม่ได้ ต้องใส่ PIN + เหตุผล — ห้าม Lost → Write-off อัตโนมัติ (ลำดับ: Lost → Charge → เรียกเก็บ → Write-off)

---

## 15. คืนก่อนกำหนด (Early Return)

- เก็บ **Planned End** และ **Actual Return** แยกกัน — ห้ามแก้ Planned End ให้เท่ากับ Actual Return
- Actual Return ห้ามก่อน Delivery
- หลัก: **ไม่เอาเปรียบลูกค้า คิดตามจริง** / ส่วนลดที่ให้ไปแล้วคงเดิม (ลดแล้วก็ลดไป ไม่เรียกคืนตามสัดส่วน)
- **คืนก่อนกำหนดคิดตามวันใช้งานจริง** (คำตัดสิน 2026-10-04) — นับวันตามกฎรายวันเดิม (Timezone ร้าน วันแรก = วันที่ 1) — ระบบห้ามเลือกคิดเต็มเอง
- Flow: รับคืน → บันทึกวันคืนจริง → นับวันใช้จริง → คำนวณค่าเช่าใหม่ (บันทึกเป็นรายการปรับลด CREDIT ผูกกับการรับคืน ไม่แก้บรรทัดบิลเดิม) → เทียบยอดที่รับจริง → จ่ายเกิน = ระบบเสนอยอด Refund → ผู้ใช้ตรวจ → กดยืนยัน → PIN → บันทึก Refund
- ตัวอย่าง: เช่า 7 วัน = 700 / ใช้จริง 3 วัน = 300 / จ่ายแล้ว 700 → เสนอ Refund 400
- ใช้กับสินค้าคิดรายวัน — สินค้าคิด **ต่อครั้ง/ต่อรอบ** ราคาเป็นต่อรอบ ไม่ใช่ต่อวัน วันที่ในบิลใช้แจ้งเตือนครบกำหนดเท่านั้น คืนก่อนจึงไม่เปลี่ยนยอด
- **วันที่มี 3 แบบ**: (1) วันที่ออกเอกสาร (2) วันเช่า/วันกำหนดคืนของบิล — ไม่ใช้คิดเงิน ใช้แจ้งเตือนครบกำหนด (3) วันที่เลือกในการ์ดสินค้ารายวัน — ใช้คิดเงินเท่านั้น
- ชำระแล้วและจ่ายเกิน + Policy อนุญาต → Refund (Record ใหม่)
- ยังไม่ชำระ/ชำระบางส่วน → Settlement (หมวด 21): > 0 รับเพิ่ม / = 0 เคลียร์ / < 0 Refund
- Refund ห้ามเกินยอดที่มีสิทธิ์คืน

---

## 16. เกินกำหนด (Overdue)

- เงื่อนไข: `current_time > rental_end_at` **และ** `obligation_held_here > 0` **และ** ไม่มีการเช่าต่อที่บันทึกแล้วสำหรับภาระนั้น → Rental Status `OVERDUE`
- **ระบบแจ้งเตือนและให้ผู้ใช้ตรวจสอบเท่านั้น**
- **ห้ามสร้าง Late Fee / Charge / ค่าเช่าเพิ่มอัตโนมัติ** ไม่ว่ากรณีใด
- **ร้านไม่มีค่าปรับคืนช้า** (คำตัดสิน 2026-10-04) — เลยกำหนด = แจ้งเตือน → พนักงานโทรเช็คลูกค้าเอง → ถ้าเช่าต่อ พนักงานทำรายการเช่าต่อ (หมวด 17)
- การแจ้งเตือนทุกชนิดเปิด/ปิดและตั้งจำนวนวันล่วงหน้าได้ใน Settings (ค่าตั้งต้นตามหน้าตั้งค่าแจ้งเตือนของแอป: เปิด, ล่วงหน้า 1 วัน) — ไม่ผูกตายในโค้ด
- ระบบแสดงระยะเวลาเกินกำหนดเป็นข้อมูลประกอบได้ — ถ้าแสดงยอดประมาณ ต้องระบุชัดว่า **ไม่ใช่ยอดเรียกเก็บ** และไม่บันทึกเป็นยอดค้าง/รายได้
- **หากมีค่าใช้จ่ายเพิ่ม** ผู้ใช้ต้องตรวจและกดยืนยันเองก่อน จึงบันทึกเป็น Charge Record แยก (ไม่แก้ยอดบิลเดิม) พร้อมเหตุผล ผู้ยืนยัน เวลา และ Audit
- ห้ามคิดค่าใช้จ่ายซ้ำช่วงเดียวกัน — รวมถึงช่วงที่ถูกคิดเป็นค่าเช่าในบิลลูกแบบย้อนหลังแล้ว (หมวด 17.4.1)
- เทียบเวลาใช้ **timezone ของร้าน**
- **เลยกำหนด ≠ เช่าต่อ** — ห้ามเช่าต่ออัตโนมัติ รวมถึงเมื่อเลยกำหนด
- การเช่าต่อหลังเลยกำหนด: ผู้ใช้ที่ทำรายการเลือกวิธีเริ่มบิลลูกเองทุกครั้ง (หมวด 17.4.1)
  - เลือกเริ่ม ณ เวลาที่ทำรายการ → ช่วงตั้งแต่ `rental_end_at` เดิมถึงเวลาที่ทำรายการ **ยังเป็น OVERDUE ของบิลเดิม** และใช้กฎหมวดนี้ทั้งหมด
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
- ผู้ใช้ที่มีสิทธิ์เมนูบิลทำได้ทันที (ไม่มีขั้นอนุมัติ) พร้อมเหตุผล + Audit
- **ห้ามเช่าต่ออัตโนมัติ**
- การเช่าต่อไม่ใช่การต่อสัญญา และไม่แตะเอกสารลูกค้า

### 17.2 Bill Lineage
- `parent_bill_id` = บิลก่อนหน้าทันที
- `original_bill_id` = บิลแรกสุดของสาย (`= parent.original_bill_id ?? parent.id`)
- ตัวอย่าง A → B → C: `B.parent = A`, `B.original = A`, `C.parent = B`, `C.original = A`
- ทั้งสองค่าว่างพร้อมกัน หรือมีค่าพร้อมกัน
- บิลแม่ 1 ใบ มีบิลลูกได้หลายใบ — **ห้ามรวมการเช่าต่อจากหลายบิลแม่เป็นบิลเดียว** (เวอร์ชันนี้)
- `has_continuation` ของบิล = มี Carry Forward (ที่ไม่ถูก Reverse) ออกจากบิลนั้น

### 17.3 `rental_carry_forwards` (Source of Truth ของ Line/จำนวนที่ส่งต่อ)
- `id`, `from_bill_id`, `from_line_id`, `to_bill_id`, `to_line_id`, `product_id`, `quantity` (> 0)
- `reason`, `created_by`, `created_at`, `correlation_id`
- Append-only — ห้ามแก้/ลบ
- กฎ:
  - `to_bill.parent_bill_id = from_bill_id`
  - สินค้าเดียวกันทั้งสอง Line
  - Lock Line ต้นทาง แล้วตรวจ `quantity ≤ obligation_held_here` ณ เวลาบันทึก — คุมผลรวมเมื่อมีบิลลูกหลายใบ
- **`rental_carry_forward_units`** (สินค้ารายชิ้น): `carry_forward_id`, `product_unit_id` — จำนวนแถว = `quantity` และ Unit ต้องอยู่ในความรับผิดชอบของ Line ต้นทาง
- **`rental_carry_forward_reversals`**: `carry_forward_id` (Unique — กลับรายการเต็มจำนวนต่อ Record), `reason`, `created_by`, `created_at`, `correlation_id`

### 17.4 วันเริ่มของรอบเช่าต่อ (ห้ามซ้อนรอบเดิม)
- เก็บช่วงเช่าเป็น `timestamptz` — สูตรรายวันคำนวณตาม **timezone ของร้าน** โดยนับวันแรกเป็นวันที่ 1 (Inclusive)
- **รายวัน**: เริ่มวันถัดจากวันสิ้นสุดรอบเดิม — รอบเดิม 1–5 → รอบใหม่เริ่ม 6
- **ต่อครั้ง/ต่อรอบ**: **ผู้ใช้กำหนดรอบถัดไปเองตอนสร้างการเช่าต่อ** — ระบบตรวจแค่ว่าไม่ซ้อนรอบเดิม ห้ามเดาเอง
- ห้ามใช้กฎ +1 วันแบบเดียวกันกับทุก calculation type

#### 17.4.1 เช่าต่อหลังเลยกำหนด (สร้างหลัง `rental_end_at` เดิม)
ผู้ใช้ที่ทำรายการต้อง **เลือกเองทุกครั้ง** — **ห้ามระบบเลือกให้** และห้ามเช่าต่ออัตโนมัติ

| ทางเลือก | ค่าใน `continuation_start_mode` | ผล |
|---|---|---|
| 1. เริ่มย้อนหลัง | `FROM_PREVIOUS_END` | บิลลูกเริ่มถัดจาก `rental_end_at` เดิม (รายวัน: วันถัดไป / ต่อครั้ง-ต่อรอบ: รอบถัดไปที่ผู้ใช้กำหนด) — ช่วงย้อนหลังเป็น **Rental Period ของบิลลูก** คิดตามราคาที่ผู้ใช้ยืนยัน — **ห้ามสร้าง Charge เกินกำหนดซ้ำกับช่วงเดียวกัน** |
| 2. เริ่ม ณ เวลาที่ทำรายการ | `FROM_APPROVAL` | บิลลูกเริ่มที่วันที่/เวลาที่สร้างการเช่าต่อ — ช่วงก่อนหน้า **ยังเป็น OVERDUE ของบิลเดิม** และใช้กฎหมวด 16 |

บันทึกที่บิลลูก (ทุกการเช่าต่อหลังเลยกำหนด):
- `continuation_start_mode`, `continuation_reason`, ผู้ทำรายการ, เวลา
- Audit (ผู้ทำ, ทางเลือก, เหตุผล, ช่วงเวลาที่มีผล)

การเช่าต่อที่สร้างก่อนหรือ ณ `rental_end_at` เดิม ใช้กฎวันเริ่มปกติด้านบน (ไม่ต้องเลือกทางเลือก)

### 17.5 Flow สร้างการเช่าต่อ
1. ผู้ใช้ที่มีสิทธิ์เมนูบิล เลือกบิลแม่ → เลือก Line และจำนวน (หรือ Unit สำหรับสินค้ารายชิ้น)
2. ระบุเหตุผล — ถ้าทำหลัง `rental_end_at` เดิม ต้องเลือกวิธีเริ่มตามหมวด 17.4.1
3. Transaction เดียว:
   - Lock Line ต้นทาง
   - ตรวจ `quantity ≤ obligation_held_here`
   - สร้างบิลลูก (ลูกค้าเดียวกัน, `parent_bill_id`, `original_bill_id`)
   - สร้าง Line ของบิลลูก (ราคาและช่วงเช่าใหม่)
   - สร้าง `rental_carry_forwards` (+ `rental_carry_forward_units`)
   - Audit
4. ไม่แก้บิลแม่ ไม่มี Stock Movement ไม่มี Return/Delivery ปลอม ไม่ย้ายมัดจำอัตโนมัติ (หมวด 18)
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

## 18. Deposit (ผูกกับบิลเช่า)

1. ถ้าบิลเช่าเปิดใช้มัดจำ ผู้ใช้กรอก **จำนวนเงินมัดจำของบิลนั้น** (ไม่บังคับทุกบิล)
2. เงินมัดจำ **ผูกกับบิลเช่าครั้งนั้น** เพื่อใช้ตรวจสอบย้อนหลัง
3. ตอนรับคืนสินค้า ระบบต้อง **แสดงว่าบิลนั้นมีมัดจำเท่าไร**
4. **ระบบไม่หักและไม่คืนเงินมัดจำให้อัตโนมัติ** — การคืนหรือหักเงินจริงจัดการกันที่หน้าร้าน
5. ถ้ามีสินค้าชำรุด/สูญหาย ระบบเติมค่าเสียหาย/สูญหายตั้งต้นจากราคาที่ตั้งไว้ของสินค้า (หมวด 14.3)
6. ผู้ใช้แก้จำนวนค่าเสียหาย/สูญหายได้ก่อนยืนยัน (ลด/ยกเว้น/แก้จากยอดที่ระบบเสนอ = PIN)
7. ยืนยันแล้ว ระบบบันทึกค่าเสียหาย/สูญหายไว้กับบิลและประวัติการคืนสินค้า
8. **เงินมัดจำไม่ถูกนำไปหักค่าเสียหายอัตโนมัติโดยระบบ**

กฎร่วม:
- มัดจำ **ไม่ใช่รายได้** และไม่รวมใน Grand Total ของบิล
- มัดจำไม่ขวางการปิดบิล (หมวด 21.2)
- การเช่าต่อไม่ย้ายมัดจำระหว่างบิลอัตโนมัติ
- การบันทึกผลการคืน/หักมัดจำในระบบ — หมวด 37

---

## 19. Charges, Adjustments และ Correction

### 19.1 Charges
- ค่าใช้จ่ายที่เกิดหลังออกบิล (Damage, Lost, ค่าใช้จ่ายเพิ่มกรณีเกินกำหนด, Service อื่น) บันทึกเป็น **Charge Record แยก** ที่บิลซึ่งเป็นเหตุ — ไม่แก้ยอดบิลเดิม
- Charge ต้องถูกผู้ใช้ยืนยันก่อนนับเป็นยอดค้างชำระและรายได้
- Charge ที่ยังไม่ยืนยัน/ยังไม่กำหนด ถือเป็น Exception ค้าง

### 19.2 Adjustments
- ปรับยอดระหว่างเช่าหรือหลังยืนยันใช้ Credit/Debit Adjustment ที่เก็บ Before / After / ผู้ทำ / เวลา / เหตุผล
- ยอดล่าสุดที่ยืนยันแล้วเป็นยอดที่ต้องชำระ

### 19.3 Correction
- ใช้แก้ข้อมูลที่ **บันทึกผิดจริง** เท่านั้น — ต้องใส่ PIN + Reason + Audit Before/After
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
| Confirmed ยังไม่ส่งมอบ/ยังไม่ชำระ | Cancel หรือ Void (ต้องใส่ PIN) → Release Reservation |
| มีธุรกรรม/ส่งมอบแล้ว | Void + Reversal ของ Stock/Finance ตามจำเป็น |
| มีเงินรับแล้ว | Refund Record (ต้องใส่ PIN) — **ห้ามคืนเงินอัตโนมัติตอนยกเลิก** |
| ของเช่ายังอยู่กับลูกค้า | ห้ามคืน Stock อัตโนมัติ ต้องรับคืนจริง |
| Closed | ห้ามแก้ต้นฉบับ ใช้ Adjustment/Refund Transaction |

- Flow: ตรวจสถานะ → ตรวจสิทธิ์เมนู → PIN → Reversal/Refund → ย้อน Stock/Finance ถ้าจำเป็น → Audit (ไม่มีขั้นอนุมัติ)
- Refund: `amount > 0`, ≤ refundable amount, ต้องมีเหตุผล, PIN, เชื่อมกับ Payment/Bill, สร้าง Ledger ฝั่งเงินออก, บันทึกช่องทาง
- Refund ช่องทางเดิมเป็นค่าเริ่มต้น ผู้ใช้เลือกช่องทางอื่นได้
- `net_paid = valid_paid − valid_refund`
- ห้าม Delete Payment / ห้ามลดค่า Payment เดิมแทน Refund / เก็บ Reason และผู้ทำเสมอ
- ห้ามลบบิล — เลขเอกสารของบิลที่ Void ถือว่าใช้แล้ว

---

## 21. Settlement และการปิดบิล

### 21.1 Settlement (ระดับบิล)
- `final_amount_due` = `actual_rental_charge + damage_charge + lost_charge + confirmed_additional_charges + other_authorized_charges − discounts − credits` (Charge ที่ยืนยันแล้วเท่านั้น)
- `settlement_balance` = `final_amount_due − net_paid` (มัดจำไม่ถูกหักโดยระบบ — หมวด 18)
- > 0 ลูกค้าต้องชำระ / = 0 เคลียร์ / < 0 ร้านต้อง Refund
- ค่าเช่าของช่วงเช่าต่ออยู่ที่บิลลูก ไม่รวมในบิลแม่

### 21.2 เงื่อนไขปิดบิล
`CAN_CLOSE = financial_resolved AND merchandise_resolved AND exception_resolved`

- **merchandise_resolved**: ทุก RENTAL Line `obligation_held_here = 0` (คืนจริง / สูญหายที่บันทึกยืนยันแล้ว / disposition ที่บันทึกยืนยันแล้ว / Carry Forward ไปบิลลูกอย่างถูกต้องครบ) และทุก SALE Line ส่งมอบครบหรือยกเลิกส่วนที่เหลือ
- **financial_resolved**: `balance_due = 0` ของบิลนี้ หรือมี Write-off ที่บันทึกแล้ว และไม่มี Refund Due/Pending, ไม่มี Payment ค้างสถานะ
- **exception_resolved**: ไม่มี Missing ที่ยังไม่ได้ข้อสรุป, Damage/Lost Case ที่ยังไม่ resolve, Charge ที่ยังไม่กำหนด/ยืนยัน, การเกินกำหนดที่ยังไม่ตรวจ, Return/Stock Movement ค้างครึ่งทาง
- **Deposit ไม่อยู่ในเงื่อนไขปิดบิล** (คืน/หักที่หน้าร้าน — หมวด 18)
- ครบทุกเงื่อนไข → ระบบปิดบิลอัตโนมัติ (`CLOSED`)
- งานซ่อมภายในร้านไม่ขวางการปิดบิล
- บิลที่ปิดแล้วออกจากงานค้าง แต่ค้นได้จากประวัติ — ห้ามลบ

| ตัวอย่าง | ผล |
|---|---|
| จ่ายครบ + ของยังคืนไม่ครบ | ACTIVE |
| ของครบ + เงินยังไม่ครบ | ACTIVE |
| ของครบ + ชำรุดแต่ยังไม่กำหนด/ไม่เก็บค่าเสียหาย | ACTIVE |
| ของครบ + ชำรุดและเก็บค่าเสียหายแล้ว + เงินครบ | CLOSED |
| ของหายที่บันทึกแล้ว + Charge เคลียร์ + ครบทุกอย่าง | CLOSED |
| มี Refund ค้าง | ACTIVE |
| คืนเกินกำหนดครบแล้ว แต่ยังไม่ตรวจเรื่องค่าใช้จ่ายเพิ่ม | ACTIVE |
| ส่งต่อของทั้งหมดไปบิลลูกแล้ว + เงินของบิลเดิมเคลียร์ + ไม่มี Exception | CLOSED (บิลลูกติดตามของต่อ) |
| เช่ากล้อง 2 ตัว ส่งต่อ 1 ตัว คืนจริง 1 ตัว + เงินเคลียร์ | CLOSED |
| ของครบ + เงินครบ + มัดจำของบิลยังไม่ได้คืนที่หน้าร้าน | CLOSED (มัดจำไม่ขวางบิล) |

---

## 22. Finance Ledger, Revenue, Income/Expense

- คำที่ห้ามใช้แทนกัน: Payment, Refund, Income, Expense, Cash Movement, Finance Ledger, Deposit Movement
- Stock และ Finance มี Ledger ของตัวเอง — **Deposit แยกจาก Income/Expense** (ไม่นับเป็นรายรับ/รายจ่าย)
- Revenue Classification แยกตาม Mode (Sale Revenue / Rental Revenue) แม้รับเงินรวมที่บิล
- รายได้ของ Charge รับรู้เมื่อ Charge ถูกยืนยัน/earned
- รายรับ: Rental Revenue, Sale Revenue, Delivery Fee, Damage Charge, ค่าใช้จ่ายเพิ่มที่ยืนยันแล้ว, Service Fee, Other Income
- **รายรับอื่น (Other Income)** บันทึกแยกได้โดยไม่ผูกบิล — **แต่ถ้าเป็นการขายสินค้าจริง ต้องเปิดบิลขาย** ห้ามบันทึกเป็นรายรับอื่น
- รายจ่าย (`expense_entries`): ซื้อสินค้า, ค่าซ่อม, ค่าขนส่ง, ค่าแรง, ค่าน้ำมัน, ค่าอุปกรณ์, ค่าใช้จ่ายทั่วไป — `amount > 0`, ต้องมี category และผู้สร้าง, **ต้องใส่ PIN** (ไม่มีขั้นอนุมัติ)
- Refund ไม่นับเป็น Expense ปกติ
- รายการผิด → Void/Reversal แล้วสร้างใหม่

---

## 23. Customer Credit / AR

- ข้อมูล: `credit_enabled`, `credit_limit`, `current_balance`, `available_credit`, `payment_terms_days`, `overdue_balance`, `account_status`
- Flow: เปิดบิลเครดิต → Credit Enabled? → Current + New ≤ Limit? (ไม่ผ่าน → ตาม Policy หมวด 37) → AR → Invoice → Due Date → ชำระ → Overdue → Notification/Credit Block ตาม Policy
- หนี้ผูกกับแต่ละบิล
- ค่า Credit Limit / Credit Block Rule — หมวด 37

---

## 24. เงินสด (ไม่มีกะ / ไม่มีลิ้นชัก)

- ร้านไม่มีลิ้นชักเงินสดจริง และเจ้าของเป็นผู้ถือเงินเป็นหลัก — **ไม่มีการเปิด/ปิดกะ ไม่มี Cash Session**
- รับเงินสดได้ตามปกติ: `CASH` เป็นช่องทางหนึ่งเหมือน `TRANSFER` / `QR`
- ทุกรายการเงิน (Payment / Refund / Expense / Other Income) เก็บ **จำนวนเงิน, ช่องทาง, ผู้รับ/ผู้จ่ายเงิน, เวลา และบิล/รายการที่เกี่ยวข้อง**
- รายงานแยกยอดตามช่องทางได้ (หมวด 31) แต่ไม่มีการตรวจยอดเงินสดปลายกะในระบบ

---

## 25. เอกสารพิมพ์

- รูปแบบ: A4, 80mm, PDF, Email/Shareable PDF, สำเนา
- **Document Data แยกจาก Renderer** — Renderer อ่านค่าที่คำนวณแล้วเท่านั้น ห้ามมี Business Logic ซ้ำใน Renderer
- เอกสารย้อนหลังต้องสร้างซ้ำได้จากข้อมูลเดิม
- ข้อมูลที่ควรมี: Logo, Company, Tax ID, Address, Phone, Document Number, Customer, Items, Sale/Rental Mode, Rental Period, Discount, VAT, Shipping, Deposit (แสดงแยกจากรายได้), Grand Total, Payment Summary, Signature, QR, Footer, Copy Number
- **เอกสารสัญญาเช่า** สร้างจาก Template ในโค้ด + ข้อมูลลูกค้า (หมวด 6.2) — พิมพ์คู่กับสำเนาและบิลของเหตุการณ์ได้
- บันทึก Document Reference ทุกครั้งที่ Print/Save/Share

---

## 26. Appointment

- ประเภท: `PICKUP`, `DELIVERY`, `RETURN`, `INSTALLATION`, `PAYMENT`, `FOLLOW_UP`, `INSPECTION`, `REPAIR`, `GENERAL`
- ข้อมูล: `appointment_type`, `customer_id`, `bill_id`, `related_entity_type/id`, `title`, `description`, `start_datetime`, `end_datetime`, `location`, `contact_name/phone`, `assigned_user_id`, `priority`, `status`, `reminder_before_minutes`
- Flow: สร้าง → ประเภท → ลูกค้า → Bill/Entity → วันเวลา → ผู้รับผิดชอบ → สถานที่ → Reminder → ตรวจ Conflict → Create → Audit → Reminder → Execute → Complete/Reschedule/No-show
- เลื่อนนัด: เก็บ `original_start_datetime`, `new_start_datetime`, `reschedule_reason`, `rescheduled_by`, `rescheduled_at` + Appointment History
- ยกเลิก: `cancel_reason`, `cancelled_by`, `cancelled_at` (นัดเก่าที่ยกเลิกด้วยสถานะยังเก็บไว้)
- (เจ้าของยืนยัน 2026-10-15 — ข้อยกเว้นของหมวด 3.3) ปุ่ม "ยกเลิกงาน" ในหน้ารายละเอียด = **ลบงานจริง** ผ่าน `appointment_delete` เท่านั้น: งานและ Appointment History หายจากระบบ แต่เก็บสำเนาไว้ใน Audit (`APPOINTMENT_DELETE`) — ห้ามลบงานที่มีใบส่งของ (`deliveries`) — ไม่แตะลูกค้า บิล การเงิน สต็อก — ถ้าสั่งงานไว้ แจ้งพนักงานทาง LINE และตัดสิทธิ์ก่อนลบ (LINE Task เก็บเป็นประวัติ)
- (เจ้าของยืนยัน 2026-10-15) ปุ่ม "ยกเลิกงาน" ในหน้าสถานะ = **ถอนงานจากพนักงาน**: แจ้งทาง LINE ตัดสิทธิ์คนเดิม เอาพนักงานออกจากงาน (บันทึกขั้น WITHDRAW) งานยังอยู่และสั่งคนใหม่ได้
- (เจ้าของยืนยัน 2026-10-15) ฟอร์มใช้ "ชื่องาน" (`title`) พิมพ์เอง ไม่เลือกประเภท/สถานะ — สถานะก่อนจบงานระบบคำนวณเอง: รอถึงกำหนด / รอสั่งงาน / เลยกำหนด / กำลังดำเนินการ (สั่งงานแล้ว); ยกเลิก/ปิดงานคงสถานะสิ้นสุด
- (เจ้าของยืนยัน 2026-10-15) ขั้นตอนงาน 9 ขั้น: ร้านกด "สั่งงาน" และ "ปิดงาน" เท่านั้น — ขั้นที่เหลือพนักงานที่ได้รับมอบหมายกดผ่าน LINE ทีละขั้นตามลำดับ เวลา = เวลาที่กดจริง ห้ามเขียนทับขั้นก่อนหน้า — ร้านไม่มีปุ่มอัปเดตขั้นแทน — การเปลี่ยนสถานะงานไม่แก้บิลหรือสต็อก
- (เจ้าของยืนยัน 2026-10-15) เปลี่ยนพนักงาน: ถอนงานและตัดสิทธิ์คนเก่าพร้อมแจ้งทาง LINE แล้วส่งงานให้คนใหม่ (คนใหม่เริ่มที่ "รับงาน" ใหม่ ขั้นของคนเก่าเก็บเป็นประวัติ) 
- จากรายละเอียดนัดหมายที่ยังเปิดและยังไม่มีบิล ปุ่ม "สร้างบิล" เปิด POS พร้อมลูกค้า สินค้า และสถานที่จากงาน — ไม่สร้างหรือบันทึกบิลให้อัตโนมัติ; ถ้ามีบิลเชื่อมแล้วให้เปิดบิลเดิมแทน
- จากเมนูบิล ปุ่ม "สั่งงาน" เปิดแบบฟอร์มวันเวลา ประเภทงาน (ส่งของ/รับคืน) และรายการบิลที่ผู้ใช้เลือก — ปุ่ม "นัดหมาย" บันทึกงานตามวันเวลาที่ระบุโดยไม่สั่งคนขับ; ปุ่ม "สั่งงานทันที" สร้างงานตามประเภท/รายการที่เลือกโดยใช้เวลาปัจจุบันของร้านพร้อมช่วงงาน 1 ชั่วโมง แล้วใช้การสั่งงานและ LINE ขั้นตอนเดิม; ไม่แก้บิล การชำระเงิน หรือสต็อก
- Validation: ห้าม end < start, ห้ามเวลาไม่ครบ, งานที่ต้องมอบหมายต้องมี `assigned_user_id`, เตือน Conflict

---

## 27. Notification

- Severity: `INFO`, `WARNING`, `CRITICAL`
- Flow: Event → Rule → เข้าเงื่อนไข? → Severity → Recipient → Channel → Notification → Read → Action → Handled → Audit
- **Notification ≠ Business State** — อ่านแล้วไม่ได้แปลว่าปัญหาถูกแก้ และห้ามเปลี่ยนสถานะธุรกิจอัตโนมัติ — `HANDLED` ได้หลัง Action สำเร็จ
- Critical ห้ามถูกซ่อนโดยผู้ไม่มีสิทธิ์
- กันซ้ำด้วย `event_key` / idempotency key
- ผู้รับกำหนดตาม **ผู้ใช้ที่มอบหมาย / ผู้มีสิทธิ์เมนูที่เกี่ยวข้อง / OWNER** (ไม่ใช้ Role MANAGER/CASHIER/STOCK/FINANCE)
- ตัวอย่าง Event: Rental Due Soon, Rental Due, Rental Overdue, Return ไม่ครบ, Bill ค้างชำระ, Low Stock (Available ≤ Reorder Point), Out of Stock, Over Reserved, Damage, Lost, Repair Pending, Transaction Failed, Appointment Due, Price/Cost Missing, Inactive Product Used, Stock Mismatch
- Rental Overdue แจ้งเตือนเท่านั้น (หมวด 16)
- เวลาแจ้งเตือน — หมวด 37

---

## 28. Security / RLS / Server-side / Transaction

### 28.1 3 Layers
1. **RLS** — ใครอ่าน/เขียน row ไหนได้
2. **สิทธิ์เมนู + PIN** — ใครเข้าเมนูไหนได้ และรายการเสี่ยงต้องผ่าน PIN ที่ฝั่ง Server
3. **RPC / Server Transaction** — งานสำคัญทำฝั่ง Server

### 28.2 Action ที่ต้องผ่าน Server/RPC
`confirm_bill`, `receive_payment`, `refund_payment`, `cancel_bill`, `void_bill`, `deliver`, `receive_return`, `record_lost`, `write_off`, `confirm_charge`, `stock_adjust`, `convert_damaged_stock` (A → B), `close_bill`, `create_rental_continuation`, `reverse_carry_forward`, `correct_bill`, `expense_create`, `other_income_create`, `customer_document_save`, `set_pin`, `verify_pin`
- RPC ของรายการเสี่ยง (หมวด 4.4) ต้องตรวจ PIN ที่ฝั่ง Server ภายใน Transaction เดียวกับงานนั้น

### 28.3 ห้าม Client ทำตรง
- `UPDATE inventory SET qty = …`
- `UPDATE payments SET amount = …`
- `DELETE` ธุรกรรมใด ๆ

### 28.4 Transaction / Locking
- Atomic ทุกเหตุการณ์สำคัญ — Lock แถวที่เกี่ยวข้อง (Bill/Line/Inventory/Sequence)
- ป้องกัน Double Submit ด้วย idempotency key
- ห้ามให้ Stock, Balance หรือ `obligation_held_here` กลายเป็นค่าที่ไม่สมเหตุผล (ติดลบ/เกินจริง)
- เน็ตหลุดระหว่างธุรกรรม → ธุรกรรมไม่สำเร็จทั้งก้อน (ไม่มี Offline Queue)

---

## 29. Audit

- Audit Event: `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `before_data`, `after_data`, `amount/quantity`, `channel`, `reason`, `pin_verified`, `result`, `device/session`, `timestamp`, `correlation_id` (รายละเอียดรายการเสี่ยง — หมวด 4.5) — **ห้ามมีเลข PIN**
- ต้อง Audit อย่างน้อย: Bill Create/Confirm, เพิ่ม/เปลี่ยน Line (Mode, ราคา, จำนวน, Rental Period), Delivery, Payment, Refund, Cancel, Void, Price Override, Stock Adjustment, Count Adjustment, แปลงของชำรุด A → B, Customer Edit, เอกสารลูกค้า, Product Edit, Damage, Lost, Write-off, Charge Confirm / แก้ค่าเสียหาย, Correction, การเช่าต่อ/Carry Forward/Reversal, Deposit ของบิล, Expense, Other Income, เปลี่ยนสิทธิ์เมนู/สถานะผู้ใช้, ตั้ง/เปลี่ยน PIN (ไม่เก็บค่า), Appointment Cancel/Reschedule
- **Audit แก้/ลบไม่ได้** — Export/Report ได้ตามสิทธิ์เมนู (หมวด 37)
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
| Finance | Cash, Transfer, Card, QR, Revenue (per Mode), Other Income, Expense, Refund, Outstanding Receivable, **Deposit ต่อบิล (แยกจากรายได้)** |
| Customer | Purchase/Rental History, เอกสารลูกค้า, Outstanding, Overdue History, Damage/Lost History, Credit Usage, ของค้าง (Σ `obligation_held_here`) |
| Operations | Appointment, Delivery, Return, Employee Activity, รายการเสี่ยงที่ใช้ PIN, Notification Pending |

- รายงาน Deposit ต้องแยกจาก Revenue/Income/Expense

---

## 32. Validation สรุป

| เรื่อง | กฎ |
|---|---|
| Document | เลข Unique ต่อชนิด, ห้าม Recycle, เลข Final ห้ามแก้ |
| Tax/Discount | ส่วนลดไม่เกิน Policy, VAT rate valid, ลำดับคำนวณแน่นอน |
| Sale | `can_sell`, `qty > 0`, `sale_price ≥ 0`, Stock พอ |
| Rental | `can_rent`, `qty > 0`, `rental_rate ≥ 0`, `period_count > 0`, `start_at`/`end_at` ต้องมี, `end_at > start_at`, ต้องมี Customer ก่อน Confirm (ไม่ต้องมีสัญญา) |
| Mixed Bill | Validate ทุก Line ก่อน Commit, ห้าม Commit บาง Line |
| Payment | `amount > 0`, idempotency, สิทธิ์เมนู, balance valid, method valid |
| Return | `qty > 0`, `qty ≤ obligation_held_here`, ของเป็นของ Line นั้น, Condition required |
| Continuation | สิทธิ์เมนูบิล + Reason, `quantity ≤ obligation_held_here`, parent เดียว, ลูกค้าเดียวกัน, วันเริ่มไม่ซ้อนรอบเดิม, Serial ครบสำหรับของรายชิ้น |
| Deposit | ผูกกับบิลเช่า, `amount ≥ 0`, ห้ามนับเป็น Revenue, ระบบห้ามหัก/คืนอัตโนมัติ |
| Continuation หลังเลยกำหนด | ผู้ทำรายการต้องเลือก `continuation_start_mode` เอง + Reason + Audit, เลือกย้อนหลังห้ามมี Charge เกินกำหนดซ้ำช่วงเดียวกัน |
| Overdue | timezone ร้าน, ห้ามสร้าง Charge อัตโนมัติ, ห้ามคิดซ้ำช่วงเดียวกัน, ห้ามเช่าต่ออัตโนมัติ |
| Correction | ห้ามยืดช่วงเช่าของ Line ที่ส่งมอบแล้ว, ห้ามเพิ่ม delivered, ห้ามแทนการเช่าต่อ |
| Refund | ≤ refundable amount, reason, PIN |
| Stock | ไม่ติดลบเว้นแต่มีกฎ, Lock, Adjustment ต้องมี reason + PIN, damaged ห้ามเข้า Available ตรง, lost ห้ามเพิ่ม Stock, แปลง A → B ต้อง Atomic |
| Reservation | ต้องมี Expiry, Release เมื่อหมดอายุ |
| Backorder | ห้ามนับเป็น Delivered, Partial Delivery ต้องมี Record |
| Stock Count | Adjustment ต้องมาจาก Discrepancy, PIN, ต้อง Audit |
| Credit | ตรวจ Limit, ตรวจ Overdue |
| PIN | 1 ผู้ใช้ 1 PIN, ตรวจที่ Server, เก็บ hash เท่านั้น, ผิด = ห้ามทำรายการ, ห้ามบันทึกเลข PIN |
| Customer Document | ผูกลูกค้า, ห้าม Hard Delete, ไฟล์ส่วนบุคคลอ่านได้เฉพาะผู้มีสิทธิ์ |
| Other Income | ห้ามใช้แทนการขายสินค้า (ขายต้องเปิดบิล) |

---

## 33. Domain หลักของระบบ

1. **Master Data** — Customer, Product, Product Unit, หน่วยนับ, Tax, Discount, Role, สิทธิ์เมนู
2. **Customer Documents** — สัญญาเช่า (Template), ลายเซ็น, สำเนาเอกสาร
3. **Commercial** — Quotation, Reservation, Order, Bill, Receipt
4. **Rental** — Rental Terms, Rental Delivery, Return, Overdue, Continuation/Carry Forward, Damage, Lost, Settlement
5. **Inventory** — Reservation, Allocation, Backorder, Fulfillment, Delivery, Stock Movement, Count, Adjustment, Serialized Rental Unit
6. **Finance** — Payment, Refund, Charge, Adjustment, Ledger, Deposit ของบิล, AR/Credit, Expense, Other Income
7. **Operations** — Appointment, Notification
8. **Control** — Audit, PIN, Security, RLS, RPC, Backup
9. **Reporting** — Sales, Rental, Stock, Finance, Customer, Operations

---

## 34. แนวทางฐานข้อมูล (Database Direction)

- ฐานข้อมูลจริงเพียงชุดเดียว = **Supabase Cloud PostgreSQL** — ไม่ใช้ localStorage/mock เป็นข้อมูลธุรกิจ
- ตอนนี้บน Supabase Cloud มีเฉพาะส่วน **Auth/Profile** (`supabase/auth-only/01_auth_profiles.sql`) — ยังไม่มีตารางธุรกิจ
- ตารางธุรกิจวางตาม `supabase/baseline/00_baseline.sql` + `docs/SUPABASE_BASELINE_SCHEMA_DESIGN.md` ซึ่ง **ปรับตาม v4.3 แล้ว (2026-10-04)** และทดสอบในเครื่องด้วย `supabase/tests/run_local.sh` — ยังไม่ apply บน Cloud (ตัด Contract/Approval/Cash Session/Deposit ระดับ Contract, เพิ่ม PIN, เอกสารลูกค้า, หน่วยนับ, ฟิลด์สินค้า, Other Income, แปลง A → B) และข้ามส่วน Auth/Profile ที่ลงแล้ว
- migration เก่าทั้งชุดถูกลบออกจากโปรเจกต์แล้ว (2026-10-04) — ห้ามนำกลับมาใช้
- ขั้น 4 (2026-10-04): โค้ดแอปอ่านตารางใหม่ผ่าน RLS และเขียนผ่าน RPC เท่านั้น (lib/db/rpc.ts, lib/db/pin-confirm.ts) — ไม่มีการคำนวณเงิน/สต็อกหรือเขียน Audit ฝั่งเบราว์เซอร์อีก
- ส่วนที่เพิ่มใน baseline ระหว่างขั้น 4 (โครงสร้าง ไม่ใช่กฎใหม่): ลูกค้ามี `contact_details` (ที่อยู่แยกส่วน/LINE/เลขบัตร), ใบเสนอราคาเก็บค่าขนส่ง/มัดจำที่เสนอ/ไซต์งาน, นัดหมายเก็บ `work_order` (รายการ+ขั้นตอนหน้างาน), Storage bucket ส่วนตัว `customer-documents` สำหรับรูปบัตร/ทะเบียนบ้าน, สร้างสินค้าพร้อมจำนวนตั้งต้น = รับเข้าสต็อก (PIN), ปิดเคสเสียหาย/สูญหายโดยไม่คิดเงินทั้งที่มีค่าตั้งต้น = ยกเว้นค่าธรรมเนียม (PIN), เจ้าของร้านสั่งสแกนแจ้งเตือนได้จนกว่าจะตั้งงานอัตโนมัติ
- ขั้น 5 (2026-10-04): baseline v4.3.1 + สินค้า 43 รายการ ขึ้น Supabase Cloud แล้ว (migration baseline_v43_01–09, seed_products_43) — บัญชีเดิม 3 บัญชีคงเดิม; โครงสร้างบน Cloud ตรงกับชุดที่ผ่านเทสต์ 181/181 ทุกตาราง/ฟังก์ชัน/สิทธิ์; ตั้งงานอัตโนมัติ pg_cron: สแกนแจ้งเตือนทุกชั่วโมง (นาทีที่ 5) และปล่อยของจองหมดอายุ (นาทีที่ 10 — ปิดอยู่จนกว่าเจ้าของจะเปิด policy)
- ค่า Derived (paid_amount, balance_due, returned_qty, obligation ฯลฯ) cache ได้ แต่ต้องมีแหล่งจริงจาก Transaction Records

---

## 35. Implementation Gap ที่รู้แล้ว (Reference — ไม่ใช่กฎ)

สิ่งที่พบในโค้ดปัจจุบัน และขัดกับไฟล์นี้ ต้องแก้ตอน implement:

| พบใน Implementation | กฎที่ถูกต้อง |
|---|---|
| แอปเขียนตารางธุรกิจตรงจาก Client (บิล การเงิน สินค้า สต็อก Audit) | เขียนผ่าน RPC ฝั่ง Server เท่านั้น (หมวด 28) |
| PIN เก็บในเบราว์เซอร์ของแต่ละเครื่อง (`features/auth/services/pin-lock.ts`) | PIN ผูกบัญชีในฐานข้อมูล ตรวจที่ Server (หมวด 4.3) |
| หน้าสิทธิ์ใช้รหัสราย Action | สิทธิ์ระดับเมนู + PIN (หมวด 4.2–4.4) |
| `rentalStatus = 'EXTENDED'` และโหมด `EXTENSION` แก้บิลเดิม | บิลเช่าต่อใหม่ + Carry Forward (หมวด 9, 17) |
| โหมด CORRECTION เขียนทับวันเริ่ม/วันคืนและยอดของบิล | Correction ห้ามยืดช่วงเช่า/ห้ามแทนการเช่าต่อ (หมวด 19.3) |
| Settings มี `lateFeeMode` / คำนวณ `lateFeeTotal` | ห้ามคิดค่าเกินกำหนดอัตโนมัติ (หมวด 16) |
| คืนเงิน/คืนมัดจำบันทึกเป็นรายจ่าย และหักมัดจำในระบบ | Refund ไม่ใช่ Expense / มัดจำไม่หักอัตโนมัติ (หมวด 18, 22) |
| ลบบิล/สินค้า/ใบเสนอราคาจริง | ยกเลิก/ปิดใช้งานด้วยสถานะ (หมวด 3.3) — นัดหมายลบได้เฉพาะทาง `appointment_delete` (หมวด 26) |
| ข้อความระบบ/UI ใช้คำว่า "ต่อสัญญา" และเรียกบิลว่า "สัญญา" | ใช้คำตามหมวด 1 |

---

## 36. สิ่งที่เปลี่ยนใน v4.2 / v4.3 (คำตัดสินเจ้าของระบบ 2026-10-03 / 04)

### 36.1 v4.3 — คำตอบชุดล่าสุด 2026-10-04 (มีอำนาจเหนือข้อความเดิมที่ขัดกัน)
ใช้ ARTS ODM 7.3 เป็นแนวโครงสร้างข้อมูลเท่านั้น — ไม่ใช่ผู้กำหนดค่าทางธุรกิจ และไม่ใช่เหตุผลให้เพิ่มขั้นอนุมัติ

| เรื่อง | กฎ |
|---|---|
| PIN ผิดครั้งที่ 10 / ลืม PIN | หมวด 4.3 |
| ยืนยันรายการเสี่ยง | ทำทันทีครั้งเดียว ไม่มีหน้าต่างเวลา (หมวด 4.4) |
| Refund | ต้องผูกกับ Payment เดิมทุกครั้ง + Ledger + Audit — ห้ามเกินยอดที่รับจริงและยังไม่ได้คืน |
| ล็อกแอป | หมวด 4.3 (ค่าตั้งต้น 5 นาที มี "ไม่ล็อก") |
| คืนก่อนกำหนด | คิดตามวันใช้จริง (หมวด 15) |
| เมนู | หมวด 4.2 |
| VAT | สวิตช์กลางตัวเดียวใน Settings (POS อ่านค่าเดียวกัน) — OFF = ไม่คิด VAT / ON ได้เมื่อ OWNER กรอกอัตราและวิธีราคา (รวม/ไม่รวม VAT) แล้ว — ห้ามตั้งค่าแทนร้าน |
| ส่วนลด | ใช้เมื่ออยากให้ เช่น ตัดเศษให้ลูกค้าประจำ — ลดแล้วก็ลดไป / รายการ + ท้ายบิล / สวิตช์ "จำกัดส่วนลด" ปิดเป็นค่าตั้งต้น — เปิดแล้ว OWNER กรอก % เอง / เกินค่าที่ตั้ง = PIN + เหตุผล + Audit — ห้ามกำหนด % ตายตัว |
| มัดจำ | ของบิลเช่านั้น — แสดงตอนรับคืน ไม่หัก/ไม่คืน/ไม่เอาไปหักค่าเสียหายอัตโนมัติ — การคืน/หักหน้าร้านเป็นเรื่องของผู้ใช้ |
| เลขเอกสาร | ค่าตั้งต้น BL-2026-000001 นับใหม่ทุกปี ตั้งรูปแบบได้ใน Settings / Draft ยังไม่มีเลข / เลขที่ออกแล้วห้ามใช้ซ้ำ |
| ค่าเสียหาย/สูญหาย | ราคาตั้งต้นของสินค้า 43 รายการยังเป็น 0 — OWNER กำหนดเอง ห้ามเดา / ตอนรับคืนเติมจากค่าตั้งต้น แก้ได้ แก้ต่างจากที่เสนอ = PIN / เก็บยอดจริง + เหตุผล + ผู้ทำ + เวลา + Audit |
| คืนช้า | ไม่มีค่าปรับ — แจ้งเตือน + โทรเช็ค + เช่าต่อ (หมวด 16) |
| การจอง | วันหมดอายุใส่หรือไม่ใส่ก็ได้ / ปล่อยของคืนด้วยมือ (Atomic) / **ไม่ปล่อยอัตโนมัติ** จน OWNER กำหนด Policy |
| ส่งของไม่ครบ | รองรับ — Stock เคลื่อนตามจำนวนที่ส่งจริง ประวัติการส่งแยกแต่ละครั้ง — ชำระเงินแล้วไม่ได้แปลว่าส่งครบ |
| ค้างชำระ | ยังไม่มีวงเงินเครดิต — ติดตามยอดค้างต่อบิลและแสดงยอดค้างรวมของลูกค้า — ไม่ตัดชำระข้ามบิลอัตโนมัติ |
| สินค้า 43 รายการ | คงตั้งค่าเดิม (ให้เช่าอย่างเดียว) จน OWNER ระบุรายรหัส — ระบบยังรองรับบิลผสม ขาย + เช่า |
| Audit | เก็บตลอดไป ห้ามแก้/ลบ — Retention รูปบัตร/เอกสารลูกค้าเป็นอีก Policy แยก |
| Backup | Supabase Cloud = ฐานข้อมูลหลัก + Backup อิสระอีกชั้น — Backup ไม่ใช่ข้อมูลหลัก / ไม่มี Password/PIN แบบอ่านได้ / เอกสารลูกค้าต้องปลอดภัย — ตารางเวลา/วิธี Export เป็นงานแยก ยังไม่ติดตั้ง |
| แจ้งเตือน | ในแอปก่อน: ถึงวันส่งของ, ใกล้ถึงวันคืน, เกินกำหนด, ยอดค้าง, สินค้าใกล้หมด — ตั้งค่าได้ทุกชนิด — นัดหมายและ LINE เป็น Phase หลัง |
| ARTS | ธุรกรรมขาย/คืน/Refund/รับเงินย้อนหาต้นทางได้ / ระบุผู้ทำ เวลา ธุรกรรม / Stock และเงินผูกธุรกรรมจริง / ห้ามแก้ประวัติให้ยอดตรง ใช้รายการกลับ/ปรับแทน / แยกระดับบิล–บรรทัด–ส่วนลด/ภาษี |

### 36.2 v4.2

| เรื่อง | v4.1 (เลิกใช้) | v4.2 (ใช้แทน) | หมวด |
|---|---|---|---|
| การอนุมัติ | Request → Pending → Approve, ผู้อนุมัติแยก | Free-style: ทำได้ทันที + PIN สำหรับรายการเสี่ยง + Audit | 4.4 |
| สิทธิ์ | Permission ราย Action (รวม 8 รหัสที่เพิ่ม 2026-10-02) | สิทธิ์ระดับเมนู + PIN | 4.2 |
| PIN | ล็อกหน้าจอบนเครื่อง | 1 ผู้ใช้ 1 PIN ในฐานข้อมูล ใช้ล็อกหน้าจอ + ยืนยันรายการเสี่ยง / ใส่ผิดรอแบบ iOS / รับสินค้าเข้าต้อง PIN (v4.2.1) | 4.3, 4.4 |
| สัญญาเช่า | Entity + Version ผูกทุกบิลเช่า | เอกสารลูกค้า บิลไม่ผูกสัญญา | 6 |
| มัดจำ | ระดับ Contract, Holding + Movements, `APPLY` | ผูกบิลเช่า, ระบบไม่หัก/คืนอัตโนมัติ | 18 |
| เงินสด | Cash Session เปิด/ปิดกะ | ไม่มีกะ เงินสดเป็นช่องทางหนึ่ง | 24 |
| สินค้า | ข้อมูลพื้นฐาน | + อุปกรณ์เสริม, ไม่คิดค่าเช่า, ต้องคืน, ค่าเสียหาย/สูญหายตั้งต้น, หน่วยนับเป็นรายการ / ไม่มีรูป ไม่มีจำนวนต่อชุด | 7 |
| ของชำรุด A → B | ไม่มี | Atomic + PIN + Audit | 11.5 |
| รายรับอื่น | ไม่ชัด | บันทึกแยกได้ แต่ขายสินค้าต้องเปิดบิล | 22 |
| Offline | ไม่ระบุ | ไม่มี เน็ตหลุดหยุดธุรกรรม | 2, 28 |

กฎที่ยังคงเดิมจาก v4.1: บิลกลาง SALE/RENTAL ระดับ Line, การเช่าต่อ = บิลใหม่ + Carry Forward + Lineage, ห้ามคิดค่าเกินกำหนดอัตโนมัติ, ห้าม Hard Delete, ห้าม CASCADE, UUID + เลขเอกสารแยก, Atomic + Locking + Idempotency, Audit แก้ไม่ได้

การเปลี่ยนกฎต้องมาจากคำตัดสินใหม่ของเจ้าของระบบ และต้องปรับไฟล์นี้ก่อน implement

---

## 37. Policy ที่ยังไม่กำหนดค่า (ตั้งค่าได้ — ไม่ใช่ Architecture Blocker)

ค่าที่ OWNER ยังไม่เลือก — ระบบมีช่องรองรับแล้วแต่ **ห้ามใส่ค่าแทน**:

1. รูปแบบเลขเอกสารชนิดอื่นนอกจากบิล (ใบเสร็จ, คืนเงิน, รับคืน ฯลฯ) ถ้าต้องการต่างจากค่าตั้งต้น
2. Layout A4 / 80mm และข้อความท้ายเอกสาร
3. ข้อมูลภาษีร้าน (อัตรา VAT, ราคารวม/ไม่รวม VAT) — กรอกเมื่อจะเปิด VAT
4. เปอร์เซ็นต์จำกัดส่วนลด — กรอกเมื่อเปิดสวิตช์จำกัดส่วนลด
5. ราคาตั้งต้นค่าเสียหาย/ค่าสูญหายของสินค้า 43 รายการ
6. Reservation: จำนวนวันหมดอายุ และจะให้ปล่อยของอัตโนมัติหรือไม่
7. สินค้ารหัสใด RENT only / SALE only / SALE + RENT
8. ตารางเวลา / วิธี Export / ที่เก็บ Backup อิสระ และการทดสอบ Restore
9. Retention ของรูปบัตร/ทะเบียนบ้านและเอกสารลูกค้า
10. Notification Timing ของนัดหมาย/งาน
11. Timezone ของร้าน (ค่าเดียวที่ใช้ทั้งระบบ — ตอนนี้ Asia/Bangkok)

---

## ภาคผนวก — REFERENCE / SOURCE MATERIAL

> **สถานะ: REFERENCE เท่านั้น** — ถ้าข้อความในแหล่งต่อไปนี้ขัดกับ Master Rules ด้านบน ให้ Master Rules มีอำนาจเหนือกว่าเสมอ

### แหล่งข้อมูลดิบ
ภาคผนวก AE ของ `POS_MASTER_ALL_IN_ONE_COMPLETE_SPEC_TH.txt` (ต้นฉบับอยู่ที่ `Desktop\ฉบับสมบูรณ์\` — ไม่คัดลอกมาไว้ในไฟล์นี้ เพื่อไม่ให้มีข้อความที่ขัดกับกฎปรากฏซ้ำ):

| Source | หัวข้อ | บรรทัดโดยประมาณในไฟล์ Spec |
|---|---|---|
| SOURCE 1 | Appointment / Notification / Product / Customer / Finance Workflow | 1313–2680 |
| SOURCE 2 | Partial Return / Partial Payment Workflow | 2684–3897 |
| SOURCE 3 | Early Return / Overdue / Refund / Damage / Lost Workflow | 3901–5113 |
| SOURCE 4 | Mixed Sale + Rental Bill / Mode Separation | 5117–6143 |
| SOURCE 5 | Master Spec Completion 17 Areas | 6147–7627 |

กฎเก่าและรายงานเก่าถูกลบออกจากโปรเจกต์แล้ว (2026-10-04) — ไฟล์นี้เป็นกฎหนึ่งเดียว

### ข้อความใน Source Material ที่ถูก Override (อย่านำไปใช้)

| ข้อความในต้นฉบับ | ถูก Override โดย |
|---|---|
| Role `OWNER / MANAGER / CASHIER / STOCK / FINANCE` และการส่งงาน "ส่ง Manager" / ขั้นอนุมัติ | OWNER / USER + สิทธิ์เมนู + PIN, ไม่มีขั้นอนุมัติ (หมวด 4) |
| คำนวณ Late Fee / Late Penalty / สร้าง Charge เมื่อ Overdue / "ค่าปรับคงอยู่" / Late Policy (`late_fee_type`, `late_fee_amount`, `late_fee_percent`, min/max) — รวม "Late Fee" ในรายการรายรับ | แจ้งเตือนเท่านั้น ห้ามสร้าง Charge อัตโนมัติ ค่าใช้จ่ายเพิ่มต้องให้ผู้ใช้ยืนยัน (หมวด 16) |
| `renewal_charge` และ `late_penalty` ในสูตร `final_amount_due` | ค่าเช่าช่วงเช่าต่ออยู่ที่บิลลูก / ใช้ `confirmed_additional_charges` (หมวด 21.1) |
| Renewal / ต่ออายุ / RENEWALS ใต้ Rental Bill | การเช่าต่อ = บิลใหม่ + Carry Forward (หมวด 17) |
| ชื่อเชื่อม `renewal_of`, `parent_rental_id`, `previous_rental_id` | `parent_bill_id`, `original_bill_id`, `rental_carry_forwards` (หมวด 17) |
| `rental_contract_id` ใน `RENTAL_LINE_DETAILS` / บิลต้องผูกสัญญา | สัญญาเป็นเอกสารลูกค้า ไม่ผูกบิล (หมวด 6) |
| "Deposit ถูกคืน/หัก/เคลียร์แล้ว" เป็นเงื่อนไขปิดบิล | มัดจำผูกบิลแต่ไม่ขวางการปิดบิล (หมวด 18, 21) |
| "หัก Deposit" อัตโนมัติใน Flow ชำรุด/สูญหาย | ระบบไม่หักมัดจำอัตโนมัติ จัดการที่หน้าร้าน (หมวด 18) |
| Cash Session / ปิดกะ / Cash Variance / Till → Safe | ไม่มีกะ เงินสดเป็นช่องทางหนึ่ง (หมวด 24) |
| Notification ผู้รับ "CASHIER + OWNER", "STOCK + MANAGER", "MANAGER/OWNER" | ผู้รับตามการมอบหมาย/สิทธิ์เมนู/OWNER (หมวด 27) |
| "ใช้ยอดตามสัญญาเดิม" ใน Flow คืนก่อนกำหนด | อ่านว่า "ยอดตามบิลเดิม" — บิลไม่ใช่สัญญา (หมวด 1, 15) |
| Internal ID "UUID หรือ Internal Key" | UUID (หมวด 3.1) |
