# id-card-ocr — OCR หน้าบัตรประชาชน + autofill + เก็บหลักฐาน

ระบบอ่านข้อมูลจากหน้าบัตรประชาชนไทยด้วย `@cf/cloudflare/clairic` (Workers AI, vision + typed extraction)
แล้วกรอกลงฟอร์มอัตโนมัติ พร้อมเก็บรูปเป็นหลักฐานใน R2 และบันทึก record + audit log ใน D1

## สถาปัตยกรรม

```
เบราว์เซอร์ (กล้อง/อัปโหลด)
   │  ย่อรูป ≤1600px, JPEG q0.9  →  ≤4 MiB
   ▼
POST /api/extract
   ├─ ตรวจชนิด/ขนาดไฟล์
   ├─ SHA-256 ของไฟล์ต้นฉบับ
   ├─ env.AI.run("@cf/cloudflare/clairic", { images, fields })
   ├─ env.EVIDENCE.put(evidence/YYYY/MM/<uuid>.jpg)  + customMetadata.sha256
   └─ คืน fields + confidences + checks + evidence{key,sha256}
   ▼
ฟอร์ม autofill + ป้ายความมั่นใจ + เตือน checksum เลขบัตร 13 หลัก
   ▼
POST /api/records  (ต้องมี consent = true)
   ├─ ตรวจว่า R2 object มีจริง และ sha256 ตรง
   ├─ INSERT id_card_records
   └─ INSERT evidence_audit (action = confirmed)
```

## ติดตั้ง

```bash
npm create cloudflare@latest -- id-card-ocr   # หรือใช้โฟลเดอร์นี้เลย
cd id-card-ocr

# 1) สร้าง R2 bucket
wrangler r2 bucket create id-evidence

# 2) สร้าง D1 แล้วเอา database_id ไปใส่ใน wrangler.toml
wrangler d1 create id-ocr
wrangler d1 execute id-ocr --remote --file=./schema.sql

# 3) deploy
wrangler deploy
```

`wrangler.toml` มี binding ให้แล้ว: `AI`, `EVIDENCE` (R2), `DB` (D1), `ASSETS` (frontend)

## ข้อกำหนดของ Clairic ที่โค้ดนี้อ้างอิง

| หัวข้อ | ค่า |
|---|---|
| รูปที่รับ | PNG / JPEG / WebP, **สูงสุด 4 รูป**, รูปละ ≤4 MiB, รวม ≤8 MiB |
| PDF | ≤4 MiB, ไม่รับไฟล์เข้ารหัส |
| Remote URL | **ไม่รับ** — ต้องฝัง base64 |
| Context | 65,273 input tokens (ไม่ตัดให้ ถ้าเกินจะ reject) |
| Output | `answers[field] = { value, confidence, p_null, ... }` |
| ราคา | `clairic` $0.10/M input (โปรถึง 1 ธ.ค. 2026, ปกติ $0.24) · `clairic-flash` $0.10/M · ไม่คิด output tokens |
| Data retention | Zero data retention |

## สิ่งที่ต้องทำก่อนใช้จริง (สำคัญ)

1. **ทดสอบความแม่นยำภาษาไทย** — เอกสารไม่ได้ยืนยันคุณภาพอักษรไทย ให้ลองกับบัตรจริง 20–30 ใบ
   แล้ววัดว่า field ไหนพลาดบ่อย (มักเป็น `address` และชื่ออังกฤษ)
2. **อย่าเชื่อเลขบัตร 100%** — โค้ดตรวจ checksum mod-11 ให้แล้ว แต่ยังต้องให้คนยืนยัน
3. **PDPA** — บัตรประชาชนเป็นข้อมูลส่วนบุคคลอ่อนไหว:
   - เก็บเฉพาะ field ที่ใช้จริง
   - อย่า log รูปต้นฉบับลง Workers Logs
   - ตั้ง R2 lifecycle rule ลบรูปตามระยะเวลาเก็บที่กำหนด (`EVIDENCE_RETENTION_DAYS`)
   - จำกัดสิทธิ์เข้าถึง `/api/evidence/*` ด้วย **Cloudflare Access** (ฟรีถึง 50 users)
4. **หลักฐานเชิงพยาน** — ทุก record มี `evidence_sha256` และ `evidence_audit`
   ถ้าต้องการแข็งกว่านี้ ให้เพิ่ม timestamp จากแหล่งภายนอก (RFC 3161 TSA) หรือเก็บ hash ลงระบบที่แยกออกไป
5. **Rate limit** — แผน Free ไม่มี advanced rate limiting ให้ใส่ตัวนับใน Worker (KV/DO) ถ้าเปิดสาธารณะ

## ทางเลือกอื่น

ถ้า Clairic ให้ผลไม่พอ: ใช้ vision LLM (`@cf/qwen/qwen3-vl-*`) + JSON mode
ซึ่งยืดหยุ่นกว่าแต่ไม่มีการคุม type/confidence เท่า Clairic
