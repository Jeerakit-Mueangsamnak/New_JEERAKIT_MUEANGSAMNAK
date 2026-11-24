# โครงสร้างโค้ด

อ่านเมื่อ: ต้องสร้างไฟล์ใหม่หรือหาว่าโค้ดส่วนไหนอยู่ที่ใด (กฎหลักอยู่ที่ `CLAUDE.md`)

```text
app/                    หน้า App Router; app/actions/ และ app/api/ = ฝั่งเซิร์ฟเวอร์
components/             UI components; components/common/ = shared components
features/<domain>/      โค้ดตามโดเมน (api/, components/, hooks/, services/, utils/ ตาม pattern ที่มี)
lib/                    utilities, types, Supabase integration, services ส่วนกลาง
supabase/migrations/    ประวัติ SQL migration
supabase/tests/         ทดสอบกฎข้อมูล/ธุรกรรมด้วย SQL
tests/ · e2e/           Vitest · Playwright (Supabase Local เท่านั้น)
ai-rules/               กฎ AI ส่วนที่ไม่ต้องใช้ทุกงาน (CLAUDE.md ชี้มาที่นี่)
.agents/skills/ · .claude/skills/   Skills ของเครื่องมือแต่ละตัว
```

- วางโค้ดใหม่ตามโครงสร้างโดเมนและรูปแบบที่ใช้อยู่จริง
- ห้ามสร้าง component หรือ abstraction ซ้ำโดยไม่จำเป็น
- ยึดโครงสร้างและ component ที่มีอยู่; ห้ามเปลี่ยนเป็นโปรเจกต์ตัวอย่างหรือ Mobile Prototype Template
