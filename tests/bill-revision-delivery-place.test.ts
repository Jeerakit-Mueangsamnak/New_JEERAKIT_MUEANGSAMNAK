import { describe, expect, it } from 'vitest'
import { deliveryPlaceOfNote, noteWithDeliveryPlace } from '@/features/bills/components/BillRevisionView'

// แก้ไขบิลเช่า › สถานที่จัดส่ง (owner 2026-11-19): the "ส่งที่: …" line the POS writes into the bill's note
describe('สถานที่จัดส่งในหมายเหตุบิล', () => {
  it('อ่านบรรทัด "ส่งที่:" แบบเดียวกับที่ POS บันทึก', () => {
    expect(deliveryPlaceOfNote('หมายเหตุ\nส่งที่: ไซต์งานบางนา\nโทร: 0812345678')).toBe('ไซต์งานบางนา')
    expect(deliveryPlaceOfNote('ไม่มีที่ส่ง')).toBe('')
    expect(deliveryPlaceOfNote(null)).toBe('')
  })

  it('แก้เฉพาะบรรทัด "ส่งที่:" บรรทัดอื่นอยู่ครบที่เดิม', () => {
    expect(noteWithDeliveryPlace('หมายเหตุ\nส่งที่: บางนา\nโทร: 081', ' ลาดพร้าว ')).toBe('หมายเหตุ\nส่งที่: ลาดพร้าว\nโทร: 081')
  })

  it('ไม่มีบรรทัดเดิม = เพิ่มต่อท้าย; ลบชื่อสถานที่ = เอาบรรทัดออก', () => {
    expect(noteWithDeliveryPlace('โทร: 081', 'บางนา')).toBe('โทร: 081\nส่งที่: บางนา')
    expect(noteWithDeliveryPlace(undefined, 'บางนา')).toBe('ส่งที่: บางนา')
    expect(noteWithDeliveryPlace('ส่งที่: บางนา\nโทร: 081', '')).toBe('โทร: 081')
    expect(noteWithDeliveryPlace('ส่งที่: บางนา', '  ')).toBe('')
  })
})
