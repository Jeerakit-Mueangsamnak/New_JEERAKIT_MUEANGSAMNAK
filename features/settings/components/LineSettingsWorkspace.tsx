'use client'
import { COMMAND_BUTTON_SIZE_CLASSES, TABLE_FOOTER_CLASSES } from '@/components/common/ActionButton'

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { RotateCcw, Save } from 'lucide-react'
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
import { SETTINGS_HELPER } from '@/features/settings/components/settings-ui'

/**
 * คนใน LINE › ตั้งค่า LINE (OWNER only; moved out of ตั้งค่าระบบ, owner 2026-11-06).
 * Holds the LINE settings draft: each sub-page that has settings (แจ้งเตือนพนักงาน / ข้อความ /
 * ตารางเตือนลูกค้า) is saved on its own with "บันทึกการตั้งค่า"; the other sub-pages act at once.
 */
export function LineSettingsWorkspace({ initialView = 'CONNECTION' }: { initialView?: LineSettingsView }) {
  const { showToast } = useToast()
  const { settings, saveSection } = useSystemSettings()
  const [state, setState] = useState<SectionState>(() => ({ base: settings, draft: settings, conflict: false }))
  const [view, setView] = useState<LineSettingsView>(initialView)
  const [saving, setSaving] = useState(false)

  // A change from the server (another device) follows into a draft nobody is editing
  useEffect(() => {
    setState((st) => (isSectionDirty(st, 'line') ? st : { base: settings, draft: settings, conflict: false }))
  }, [settings])
  // Unsaved edits on any sub-page: ask before the page is left
  useLeaveGuard(isSectionDirty(state, 'line'))

  const part = LINE_VIEW_PART[view]
  const dirty = part ? isLinePartDirty(state, part) : false
  const setDraft: Dispatch<SetStateAction<SystemConfig>> = (action) =>
    setState((st) => ({ ...st, draft: typeof action === 'function' ? action(st.draft) : action }))

  const save = async () => {
    if (!part) return
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

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <LineSettingsPanel config={state.draft} setConfig={setDraft} view={view} onViewChange={setView} />
      </div>
      {part && (
        <div className={`${TABLE_FOOTER_CLASSES} flex items-center justify-between bg-white dark:bg-slate-800`}>
          <span className={SETTINGS_HELPER}>{dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : ''}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setState((st) => resetLinePart(st, part, settings))}
              disabled={!dirty || saving}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center disabled:opacity-50`}
            >
              <RotateCcw className="w-4 h-4" />
              <span>คืนค่าที่บันทึกไว้</span>
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-blue-600 hover:bg-blue-700 text-white flex items-center disabled:opacity-50`}
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
