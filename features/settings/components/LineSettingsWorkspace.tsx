'use client'
import { TABLE_FOOTER_CLASSES } from '@/components/common/ActionButton'

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useToast } from '@/components/common/Toast'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import type { SystemConfig } from '@/features/settings/services/settings-storage'
import { validateSection } from '@/features/settings/utils/settings-validation'
import {
  applyLinePartSaved,
  isLinePartDirty,
  isSectionDirty,
  LINE_VIEW_PART,
  resetLinePart,
  withLinePart,
  type SectionState,
} from '@/features/settings/utils/section-drafts'
import { useLeaveGuard } from '@/features/settings/hooks/useLeaveGuard'
import { LINE_SETTINGS_VIEWS, LineSettingsPanel, type LineSettingsView } from '@/features/settings/components/LineSettingsPanel'
import type { LineTemplateCategory } from '@/lib/line/config'
import { CardSaveButtons } from '@/features/settings/components/SettingsCards'
import { SETTINGS_HELPER } from '@/features/settings/components/settings-ui'

/**
 * The LINE settings draft (OWNER only): ข้อความอัตโนมัติ / แจ้งพนักงาน / เตือนลูกค้า. Each page is saved on its own
 * with "บันทึกการตั้งค่า"; an unsaved change on one page survives a switch to another page or tab, because the LINE
 * menu keeps this mounted while hidden.
 */
const CARD_VIEWS: readonly LineSettingsView[] = ['NOTIFY', 'FRIEND', 'REGISTER', 'CATALOG']

export function LineSettingsWorkspace({ view, hidden = false, templateCategory }: { view: LineSettingsView; hidden?: boolean; templateCategory?: LineTemplateCategory }) {
  const { showToast } = useToast()
  const { settings, saveSection } = useSystemSettings()
  const [state, setState] = useState<SectionState>(() => ({ base: settings, draft: settings, conflict: false }))
  const [saving, setSaving] = useState(false)

  // A change from the server (another device) follows into a draft nobody is editing
  useEffect(() => {
    setState((st) => (isSectionDirty(st, 'line') ? st : { base: settings, draft: settings, conflict: false }))
  }, [settings])
  // Unsaved edits on any page: ask before the menu is left
  useLeaveGuard(isSectionDirty(state, 'line'))

  const part = LINE_VIEW_PART[view]
  const dirty = isLinePartDirty(state, part)
  const setDraft: Dispatch<SetStateAction<SystemConfig>> = (action) =>
    setState((st) => ({ ...st, draft: typeof action === 'function' ? action(st.draft) : action }))

  const save = async () => {
    const pageDraft = withLinePart(state.base, state.draft, part)
    const error = validateSection('line', pageDraft)
    if (error) {
      showToast('บันทึกไม่สำเร็จ', error, 'ERROR')
      return
    }
    setSaving(true)
    try {
      const saved = await saveSection('line', pageDraft)
      setState((st) => applyLinePartSaved(st, part, saved))
      showToast('บันทึกแล้ว', `บันทึก "${LINE_SETTINGS_VIEWS.find((v) => v.id === view)?.label}" เรียบร้อย`, 'SUCCESS')
    } catch (err: unknown) {
      showToast('บันทึกไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setSaving(false)
    }
  }

  const buttons = (
    <CardSaveButtons
      label="บันทึกการตั้งค่า"
      dirty={dirty}
      saving={saving}
      onSave={() => void save()}
      onCancel={() => setState((st) => resetLinePart(st, part, settings))}
    />
  )

  return (
    <div hidden={hidden} className={hidden ? undefined : 'flex-1 min-h-0 flex flex-col'}>
      <LineSettingsPanel config={state.draft} setConfig={setDraft} view={view} templateCategory={templateCategory} footer={CARD_VIEWS.includes(view) ? buttons : undefined} />
      {/* The pages made of one card have the buttons inside it (owner 2026-11-17); the other pages keep the bottom bar */}
      {!CARD_VIEWS.includes(view) && (
        <div className={`${TABLE_FOOTER_CLASSES} flex items-center justify-between bg-white dark:bg-slate-800`}>
          <span className={SETTINGS_HELPER}>{dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : ''}</span>
          <div className="flex gap-2">{buttons}</div>
        </div>
      )}
    </div>
  )
}
