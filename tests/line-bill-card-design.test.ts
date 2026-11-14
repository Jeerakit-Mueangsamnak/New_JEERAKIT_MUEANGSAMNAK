import { describe, expect, it } from 'vitest'
import {
  lineCardFooter,
  lineCardRows,
  newLineCardDesign,
  parseLineCardDesigns,
  validateLineCardDesign,
} from '@/lib/line/bill-card-design'
import { billDesignMessage } from '@/lib/line/flex'
import { sectionPatch } from '@/features/settings/api/settings-repository'
import { validateSection } from '@/features/settings/utils/settings-validation'
import { DEFAULT_SYSTEM_CONFIG } from '@/features/settings/services/settings-storage'

/** การ์ดบิล LINE (Settings › LINE และการแจ้งเตือน, owner 2026-11-12). */
const bill = { billNo: 'BL-1', customerName: 'สมชาย', grandTotal: 4850, outstandingAmount: 1500, returnDate: '14 พ.ย. 2569', note: '' }

describe('การ์ดบิล LINE', () => {
  it('each type starts with its own heading, label and colour', () => {
    expect(newLineCardDesign('CLOSED')).toMatchObject({ title: 'บิลเสร็จเรียบร้อย', badge: 'ชำระครบแล้ว', color: 'green' })
    expect(newLineCardDesign('CANCELLED')).toMatchObject({ title: 'ยกเลิกบิล', color: 'red' })
    expect(newLineCardDesign('OUTSTANDING')).toMatchObject({ title: 'แจ้งยอดค้างชำระ', color: 'orange' })
  })

  it('shows only the ticked rows, from the stored bill, in a fixed order; an empty note is left out', () => {
    const rows = lineCardRows({ fields: ['due', 'billNo', 'outstanding', 'note'] }, bill)
    expect(rows).toEqual([
      { label: 'เลขที่บิล', value: 'BL-1' },
      { label: 'ยอดค้างชำระ', value: '1,500.00 บาท' },
      { label: 'กำหนดคืน / ชำระ', value: '14 พ.ย. 2569' },
    ])
  })

  it('{ร้าน} becomes the shop name', () => {
    expect(lineCardFooter({ footer: 'ขอบคุณที่ใช้บริการร้าน {ร้าน}' }, 'JEERAKIT')).toBe('ขอบคุณที่ใช้บริการร้าน JEERAKIT')
  })

  it('a card needs a name, a heading and at least one row', () => {
    const d = newLineCardDesign()
    expect(validateLineCardDesign(d)).toMatch(/ชื่อการ์ด/)
    expect(validateLineCardDesign({ ...d, name: 'ก', title: ' ' })).toMatch(/หัวการ์ด/)
    expect(validateLineCardDesign({ ...d, name: 'ก', fields: [] })).toMatch(/อย่างน้อย 1/)
    expect(validateLineCardDesign({ ...d, name: 'ก' })).toBeNull()
  })

  it('saved cards: malformed entries and unknown colours / rows are dropped when read', () => {
    const read = parseLineCardDesigns([{ id: 'a', name: 'x', type: 'BAD', color: '#123456', fields: ['billNo', 'hack'], title: 't', badge: '', footer: '' }, null, { name: 'no id' }])
    expect(read).toEqual([{ id: 'a', name: 'x', type: 'CLOSED', title: 't', badge: '', color: 'green', fields: ['billNo'], footer: '' }])
    expect(parseLineCardDesigns('nope')).toEqual([])
  })

  it('saved as policies.line_bill_cards only; a bad card is refused before saving', () => {
    const card = { ...newLineCardDesign(), id: 'a', name: ' การ์ดเสร็จ ' }
    const cfg = { ...DEFAULT_SYSTEM_CONFIG, lineBillCards: [card] }
    expect(sectionPatch('lineBillCards', cfg)).toEqual({ policies: { line_bill_cards: [{ ...card, name: 'การ์ดเสร็จ' }] } })
    expect(validateSection('lineBillCards', cfg)).toBeNull()
    expect(validateSection('lineBillCards', { ...cfg, lineBillCards: [{ ...card, name: '' }] })).toMatch(/ชื่อการ์ด/)
  })

  it('the LINE message: coloured header with heading and label, rows, closing line, and no actions', () => {
    const msg = billDesignMessage({ altText: 'บิลเสร็จ', title: 'บิลเสร็จ', badge: 'ชำระครบแล้ว', color: '#06C755', rows: [{ label: 'เลขที่บิล', value: 'BL-1' }], footer: 'ขอบคุณ' })
    const json = JSON.stringify(msg)
    expect(msg.contents).toMatchObject({ type: 'bubble', header: { backgroundColor: '#06C755' } })
    for (const text of ['บิลเสร็จ', 'ชำระครบแล้ว', 'BL-1', 'ขอบคุณ']) expect(json).toContain(text)
    expect(json).not.toContain('"action"')
  })
})
