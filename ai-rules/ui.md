# UI และการตรวจหน้าจอ

อ่านเมื่อ: งานแตะหน้าจอ ตาราง หรือ layout (กฎหลักอยู่ที่ `CLAUDE.md`)

- ใช้ component และรูปแบบเดิม; แก้ shared component ต้องตรวจทุกหน้าที่เรียกใช้ ไม่ใช่ดูเฉพาะหน้าที่แจ้งบั๊ก
- ตารางที่ใช้ `DataTableFrame` ต้องรักษา sticky header, row-scroll และ footer/count เดิม; ไม่ใส่ pagination หรือเปลี่ยนการ scroll เองโดยไม่มีคำสั่ง
- รักษาความกระชับของ font, input, button, badge และ rows ให้สอดคล้องกับหน้าที่มีอยู่
- Full Workspace แก้ด้วย layout/reflow ตามพฤติกรรมเดิม ไม่แก้ด้วย browser zoom
- แตะ layout → ตรวจ responsive ที่ 768 / 820 / 1024 / 1280px
- typecheck/lint/test/build ผ่าน ไม่ได้แปลว่าหน้าจอผ่าน; ถ้ามีเครื่องมือ Browser ให้เปิดหน้าจริง ทดสอบการกด และตรวจ console
- ตารางว่างใช้พิสูจน์พฤติกรรม scroll ของรายการยาวไม่ได้
- เจ้าของเป็นผู้ยืนยันว่าหน้าจอผ่าน; AI รายงานได้แค่ "ตรวจหน้าจอแล้ว"
