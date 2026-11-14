import { describe, expect, it } from 'vitest'
import { applyFormNotes, readFormNotes } from '@/features/documents/utils/form-notes'
import { sectionPatch } from '@/features/settings/api/settings-repository'
import { validateSection } from '@/features/settings/utils/settings-validation'
import { DEFAULT_SYSTEM_CONFIG } from '@/features/settings/services/settings-storage'

// Shaped like the shop's forms: a "1." in the items above, then the heading and 6 numbered lines in spans.
const form = [
  '<div><span>1.</span><span>ไม้แบบ</span></div>',
  '<div><span>หมายเหตุ / Terms &amp; Conditions: </span>',
  ...[1, 2, 3, 4, 5, 6].map((n) => `<span style="x">${n}.ข้อ ${n} &amp; เงื่อนไข</span>`),
  '<span>ยอดรวมทั้งหมด</span><span>{{bill.subtotal}}</span></div>',
].join('')

describe('หมายเหตุ of a shop form (Settings → ภาษีและเอกสาร)', () => {
  it('reads the 6 lines after the heading, without numbers', () => {
    expect(readFormNotes(form)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `ข้อ ${n} & เงื่อนไข`))
  })

  it('a form without the heading gives 6 empty lines and prints unchanged', () => {
    expect(readFormNotes('<p>no notes</p>')).toEqual(['', '', '', '', '', ''])
    expect(applyFormNotes('<p>no notes</p>', ['a', 'b'])).toBe('<p>no notes</p>')
  })

  it('prints the saved wording in place of the lines; an emptied line drops its number too', () => {
    const out = applyFormNotes(form, ['ห้ามดัดแปลง <ไม้แบบ>', 'ข้อ 2 & เงื่อนไข', '', 'ข้อ 4 & เงื่อนไข', 'ใหม่', 'ข้อ 6 & เงื่อนไข'])
    expect(out).toContain('<span style="x">1.ห้ามดัดแปลง &lt;ไม้แบบ&gt;</span>')
    expect(out).toContain('<span style="x"></span>')
    expect(out).toContain('<span style="x">5.ใหม่</span>')
    expect(out).toContain('<div><span>1.</span><span>ไม้แบบ</span></div>')
    expect(out).toContain('{{bill.subtotal}}')
    expect(readFormNotes(out).slice(0, 2)).toEqual(['ห้ามดัดแปลง <ไม้แบบ>', 'ข้อ 2 & เงื่อนไข'])
  })

  it('no saved wording = the form as it is', () => {
    expect(applyFormNotes(form, undefined)).toBe(form)
  })

  it('saves only policies.document_notes, trimmed; over 300 letters is refused', () => {
    const cfg = { ...DEFAULT_SYSTEM_CONFIG, documentNotes: { f1: [' a ', 'b'] } }
    expect(sectionPatch('documentNotes', cfg)).toEqual({ policies: { document_notes: { f1: ['a', 'b'] } } })
    expect(validateSection('documentNotes', cfg)).toBeNull()
    expect(validateSection('documentNotes', { ...cfg, documentNotes: { f1: ['x'.repeat(301)] } })).toMatch(/300/)
  })
})
