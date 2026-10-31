# Jeerakit — Hotfix หลังผลทดสอบ 2026-10-27

แก้เฉพาะ 4 ไฟล์บนสำเนา ZIP ต้นทาง `1Jeerakit_Mueangsamnak(2).zip`
ใช้ควบคู่กับ `Jeerakit_UI_Fixes_2026-10-27.zip` (ไม่ทับซ้อนกับไฟล์ในชุดแรก)

- ปรับ QR ทั้ง 3 ตำแหน่งจาก native `<img>` เป็น `next/image` พร้อม `unoptimized` และขนาด 144,112,64 ตามคลาสเดิม เพื่อหลีกเลี่ยง Lint Warning แต่ยังใช้ data URL QR เดิม
- แก้ test ให้คาดหวังคลาสสีตาม UI เดิม: blue-600, purple-600, orange-700, emerald-700; ไม่ได้เปลี่ยนสี UI เพื่อให้ผ่าน test

ไม่มีการแก้ Protected, Master, ธุรกิจ หรือฐานข้อมูล

ข้อจำกัด: ยังไม่ได้รัน pnpm typecheck/lint/test กับไฟล์ชุดนี้ ต้องทดสอบบน PC ต่อ

PowerShell ในโฟลเดอร์โปรเจกต์สำเนา:
`pnpm typecheck`
`pnpm lint`
`pnpm exec vitest run tests/appointments-work-order.test.tsx`
`pnpm test`
