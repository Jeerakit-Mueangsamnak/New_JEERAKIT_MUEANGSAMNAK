import { describe, expect, it } from 'vitest'
import { buildRevision, deliveryPlaceOfNote, resolveBillCustomer, noteLineValue, noteWithDeliveryPlace, noteWithLine, PHONE_LABEL } from '@/features/bills/components/BillRevisionView'

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

describe('เบอร์โทรติดต่อในหมายเหตุบิล', () => {
  it('อ่าน/แก้บรรทัด "โทร:" โดยไม่แตะบรรทัด "ส่งที่:"', () => {
    const note = 'ส่งที่: บางนา\nโทร: 081'
    expect(noteLineValue(note, PHONE_LABEL)).toBe('081')
    expect(noteWithLine(note, PHONE_LABEL, '089-999')).toBe('ส่งที่: บางนา\nโทร: 089-999')
    expect(noteWithLine('ส่งที่: บางนา', PHONE_LABEL, '081')).toBe('ส่งที่: บางนา\nโทร: 081')
  })
})

describe('+ รายการนอกร้าน ในแก้ไขบิล', () => {
  it('ส่งเป็นรายการที่ไม่มีสินค้า: product_name + unit_name แบบเดียวกับ POS', () => {
    const bill = { items: [], rentalStartDate: '2026-11-19', scheduledReturnDate: '2026-11-26', discountAmount: 0, billDiscountAmount: 0, shippingFee: 0 }
    const revision = buildRevision(
      bill,
      [
        {
          productId: '',
          productName: 'ค่าแรงติดตั้ง',
          unitName: 'งาน',
          isCustom: true,
          rentalType: 'SALE',
          quantity: 2,
          unitPrice: 300,
          usageCount: 1,
          dailyStartDate: '2026-11-19',
          dailyEndDate: '2026-11-26',
          action: 'ADD',
        },
      ],
      { start: '2026-11-19', end: '2026-11-26' },
      0,
      0
    )
    expect(revision.lines).toEqual([
      { product_id: null, product_name: 'ค่าแรงติดตั้ง', unit_name: 'งาน', line_mode: 'SALE', ordered_qty: 2, unit_price: 300 },
    ])
  })
})

// แก้ไขบิล › เปลี่ยนลูกค้า (owner 2026-11-19)
describe('เลือกลูกค้าในแก้ไขบิล', () => {
  const c = (id: string, customerName: string) => ({ id, customerName, phone: '', address: '', taxId: '', status: 'ACTIVE' as const })
  const current = c('cust-a', 'สมชาย ใจดี')
  const saved = [current, c('cust-b', 'สมหญิง รักงาน'), c('cust-c', 'ซ้ำ'), c('cust-d', 'ซ้ำ')]

  it('พิมพ์ชื่อเดิมของบิล = ลูกค้าคนเดิม', () => {
    expect(resolveBillCustomer(c('', ' สมชาย ใจดี '), current, saved)).toBe(current)
  })
  it('พิมพ์ชื่อที่ตรงกับลูกค้าในระบบคนเดียว = ลูกค้าคนนั้น', () => {
    expect(resolveBillCustomer(c('', 'สมหญิง รักงาน'), current, saved).id).toBe('cust-b')
  })
  it('ชื่อใหม่ที่ไม่มีในระบบ (หรือชื่อซ้ำหลายคน) = ลูกค้าทั่วไป', () => {
    expect(resolveBillCustomer(c('', 'คนใหม่'), current, saved).id).toBe('')
    expect(resolveBillCustomer(c('', 'ซ้ำ'), current, saved).id).toBe('')
  })
  it('เลือกลูกค้าจากรายการ = ลูกค้าคนนั้น', () => {
    expect(resolveBillCustomer(saved[1], current, saved).id).toBe('cust-b')
  })
})
