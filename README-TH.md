# Settings UI Redesign Patch

แพตช์นี้ปรับหน้า Settings ให้ใช้โครงสร้างตามภาพอ้างอิง:
- แถบหลัก 2 แถบอยู่ด้านบนของคอลัมน์ซ้าย: ตั้งค่าส่วนตัว / ตั้งค่าระบบ
- เมนูย่อยอยู่คอลัมน์ซ้าย
- พื้นที่ทำงานอยู่คอลัมน์ขวา
- เมนู LINE มีแถบย่อยอยู่ด้านบนของพื้นที่ทำงาน
- แถบล่างขวาใช้ปุ่มรีเซ็ตและบันทึก

## ไฟล์ที่เปลี่ยน
- `app/settings/page.tsx`
- `features/settings/components/MyAccountPanel.tsx`
- `features/settings/components/LineSettingsPanel.tsx`
- `supabase/migrations/20261031120000_settings_owner_only_v1.sql`

## วิธีนำไปใช้
1. สำรองโปรเจกต์และฐานข้อมูลก่อน
2. คัดลอกไฟล์ทั้ง 4 ไฟล์ไปทับไฟล์ในโปรเจกต์ตาม path
3. ตรวจสอบ migration ก่อนนำขึ้นฐานข้อมูล แล้วรัน migration ผ่าน Supabase CLI/กระบวนการ deploy ของโปรเจกต์
4. รัน `pnpm typecheck`, `pnpm lint` และชุดทดสอบที่เกี่ยวข้อง
5. ทดสอบด้วยบัญชี OWNER และ USER แยกกัน

## ขอบเขตสิทธิ์
- USER เห็นเฉพาะแท็บตั้งค่าส่วนตัว
- OWNER เห็นทั้งตั้งค่าส่วนตัวและตั้งค่าระบบ
- migration นี้บังคับ `settings_update`, การตั้งค่า LINE OA credentials ให้ OWNER เท่านั้นที่แก้ไขได้
- การตั้งค่าส่วนตัวใช้กลไก profile/RPC เดิม

## หมายเหตุการตรวจสอบ
แพตช์นี้ทำจาก Source ZIP ล่าสุดที่มีไฟล์ LINE Settings อัปเดตวันที่ 31 ต.ค. 2026
ยังไม่ได้รันแอปจริงหรือเชื่อม Supabase ในสภาพแวดล้อมนี้ และไม่ได้รัน migration กับฐานข้อมูลจริง
ใน sandbox นี้ไม่มี `node_modules` จึงยังยืนยันผล typecheck/lint/test แบบเต็มไม่ได้
