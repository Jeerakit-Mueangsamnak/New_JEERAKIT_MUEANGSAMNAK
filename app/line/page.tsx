'use client'

import { LinePeoplePage } from '@/features/settings/components/LinePeoplePage'

/**
 * เมนู LINE (owner 2026-11-14: everything about LINE moved out of ตั้งค่า into its own menu under จัดการบิล).
 * Owner 2026-11-15: one tab row — รอร้านตรวจ | ลูกค้าที่ผูก LINE | พนักงานส่งของ | ตั้งค่า LINE | การ์ดบิล |
 * เขียนข้อความ | ฟอร์มใน LINE (the last four are the OWNER's).
 */
export default function LinePage() {
  return <LinePeoplePage />
}
