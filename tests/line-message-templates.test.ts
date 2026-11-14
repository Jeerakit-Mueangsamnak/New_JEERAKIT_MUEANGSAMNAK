import { describe, expect, it } from 'vitest'
import { fillLineMessage, newLineMessageTemplate, parseLineMessageTemplates, validateLineMessageTemplate } from '@/lib/line/message-templates'
import { sectionPatch } from '@/features/settings/api/settings-repository'
import { validateSection } from '@/features/settings/utils/settings-validation'
import { DEFAULT_SYSTEM_CONFIG } from '@/features/settings/services/settings-storage'

/** แม่แบบข้อความ LINE (Settings › LINE › เขียนข้อความ, owner 2026-11-13). */
describe('แม่แบบข้อความ LINE', () => {
  it('fills every { } word; a word with no value is left empty; no shop name = "ร้าน"', () => {
    const text = 'สวัสดี {ชื่อ} บิล {เลขบิล} ค้าง {ยอดค้าง} คืน {วันที่คืน} จาก {ร้าน} {ชื่อ}'
    expect(fillLineMessage(text, { name: 'สมชาย', billNo: 'B-1', outstanding: '1,200.00 บาท', returnDate: '14 พ.ย. 2569', shop: 'JEERAKIT' })).toBe(
      'สวัสดี สมชาย บิล B-1 ค้าง 1,200.00 บาท คืน 14 พ.ย. 2569 จาก JEERAKIT สมชาย'
    )
    expect(fillLineMessage('{เลขบิล}|{ร้าน}', { name: 'x', shop: ' ' })).toBe('|ร้าน')
  })

  it('a template needs a name, a group and a message', () => {
    const t = newLineMessageTemplate()
    expect(validateLineMessageTemplate(t)).toMatch(/ชื่อแม่แบบ/)
    expect(validateLineMessageTemplate({ ...t, name: 'ก', groups: [] })).toMatch(/กลุ่มผู้รับ/)
    expect(validateLineMessageTemplate({ ...t, name: 'ก', text: ' ' })).toMatch(/พิมพ์ข้อความ/)
    expect(validateLineMessageTemplate({ ...t, name: 'ก' })).toBeNull()
  })

  it('saved templates: malformed entries, unknown topics and groups are dropped when read', () => {
    expect(parseLineMessageTemplates([{ id: 'a', name: 'n', topic: 'X', groups: ['CUSTOMER', 'ALL'], subject: '', text: 't' }, 5, {}])).toEqual([
      { id: 'a', name: 'n', topic: 'GENERAL', groups: ['CUSTOMER'], subject: '', text: 't' },
    ])
  })

  it('saved as policies.line_message_templates only; a bad template is refused before saving', () => {
    const t = { ...newLineMessageTemplate(), id: 'a', name: ' แจ้งนัด ' }
    const cfg = { ...DEFAULT_SYSTEM_CONFIG, lineMessageTemplates: [t] }
    expect(sectionPatch('lineMessageTemplates', cfg)).toEqual({ policies: { line_message_templates: [{ ...t, name: 'แจ้งนัด' }] } })
    expect(validateSection('lineMessageTemplates', cfg)).toBeNull()
    expect(validateSection('lineMessageTemplates', { ...cfg, lineMessageTemplates: [{ ...t, groups: [] }] })).toMatch(/กลุ่มผู้รับ/)
  })
})
