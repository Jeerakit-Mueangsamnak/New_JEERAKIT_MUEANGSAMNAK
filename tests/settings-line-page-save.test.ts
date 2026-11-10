import { describe, expect, it } from 'vitest'
import { DEFAULT_SYSTEM_CONFIG, type SystemConfig } from '@/features/settings/services/settings-storage'
import {
  applyLinePartSaved,
  isLinePartDirty,
  isSectionDirty,
  resetLinePart,
  withLinePart,
  type SectionState,
} from '@/features/settings/utils/section-drafts'

// Owner 2026-11-06: "บันทึกการตั้งค่า" saves only the page that is open — page by page.
// คนใน LINE › ตั้งค่า LINE has sub-pages; each one is saved on its own.
const saved: SystemConfig = { ...DEFAULT_SYSTEM_CONFIG, line: { notify: {}, templates: {}, other: {} } }

function editBoth(): SectionState {
  const draft: SystemConfig = {
    ...saved,
    line: { ...saved.line, notify: { RENTAL_OVERDUE: true }, templates: { STAFF_NOTICE: 'ข้อความใหม่ {หัวข้อ}' } },
  }
  return { base: saved, draft, conflict: false }
}

describe('ตั้งค่า LINE: บันทึกหน้าต่อหน้า', () => {
  it('each sub-page knows only its own changes', () => {
    const st = editBoth()
    expect(isLinePartDirty(st, 'notify')).toBe(true)
    expect(isLinePartDirty(st, 'templates')).toBe(true)
    expect(isLinePartDirty(st, 'other')).toBe(false)
  })

  it('saving แจ้งเตือนพนักงาน sends only that sub-page; ข้อความ keeps its unsaved change', () => {
    const st = editBoth()
    const sent = withLinePart(st.base, st.draft, 'notify')
    expect(sent.line.notify).toEqual({ RENTAL_OVERDUE: true })
    expect(sent.line.templates).toEqual({})

    // the server answers with what it saved
    const after = applyLinePartSaved(st, 'notify', sent)
    expect(isLinePartDirty(after, 'notify')).toBe(false)
    expect(isLinePartDirty(after, 'templates')).toBe(true)
    expect(after.draft.line.templates).toEqual({ STAFF_NOTICE: 'ข้อความใหม่ {หัวข้อ}' })
    // the page still warns before leaving: one sub-page is not saved yet
    expect(isSectionDirty(after, 'line')).toBe(true)
  })

  it('คืนค่าที่บันทึกไว้ on one sub-page leaves the other sub-page alone', () => {
    const after = resetLinePart(editBoth(), 'templates', saved)
    expect(isLinePartDirty(after, 'templates')).toBe(false)
    expect(isLinePartDirty(after, 'notify')).toBe(true)
  })
})
