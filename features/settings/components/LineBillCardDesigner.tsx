'use client'
/**
 * การ์ดบิล LINE (owner 2026-11-12, from the shop's reference screen): design a bill card (heading, status label,
 * colour, the bill's rows, closing line), see it as the customer will, and keep it for sending bills on LINE.
 */
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'
import React, { useState } from 'react'
import { Check, Eraser, Save, Trash2 } from 'lucide-react'
import { CustomSelect } from '@/components/common/CustomSelect'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { REF_BUTTON, REF_BUTTON_QUIET, SettingsCard } from '@/features/settings/components/SettingsCards'
import { LineCardPreview } from '@/features/settings/components/LineCardPreview'
import { validateSection } from '@/features/settings/utils/settings-validation'
import {
  LINE_CARD_COLORS,
  LINE_CARD_FIELDS,
  LINE_CARD_LIMITS,
  LINE_CARD_TYPES,
  lineCardFooter,
  lineCardRows,
  newLineCardDesign,
  validateLineCardDesign,
  type LineBillCardDesign,
  type LineCardColor,
  type LineCardType,
} from '@/lib/line/bill-card-design'

/** Numbers for the preview only (the real card takes the bill's own). */
const SAMPLE = { billNo: 'BL-12112569-001', customerName: 'คุณสมชาย', grandTotal: 4850, outstandingAmount: 1500, returnDate: '14 พ.ย. 2569', note: 'ส่งของช่วงบ่าย' }

export function LineBillCardDesigner() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { settings, saveSection } = useSystemSettings()
  const cards = settings.lineBillCards
  const [draft, setDraft] = useState<LineBillCardDesign>(() => newLineCardDesign())
  const [saving, setSaving] = useState(false)
  const shopName = settings.business.businessName || ''

  const patch = (p: Partial<LineBillCardDesign>) => setDraft((d) => ({ ...d, ...p }))
  const pickType = (type: LineCardType) => {
    const t = LINE_CARD_TYPES.find((x) => x.id === type)
    if (t) patch({ type, title: t.title, badge: t.badge, color: t.color })
  }
  const toggleField = (id: LineBillCardDesign['fields'][number]) =>
    setDraft((d) => ({ ...d, fields: d.fields.includes(id) ? d.fields.filter((f) => f !== id) : [...d.fields, id] }))

  const store = async (next: LineBillCardDesign[], done: string) => {
    const cfg = { ...settings, lineBillCards: next }
    const error = validateSection('lineBillCards', cfg)
    if (error) {
      showToast('บันทึกไม่สำเร็จ', error, 'ERROR')
      return false
    }
    setSaving(true)
    try {
      await saveSection('lineBillCards', cfg)
      showToast('บันทึกแล้ว', done, 'SUCCESS')
      return true
    } catch (err: unknown) {
      showToast('บันทึกไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด', 'ERROR')
      return false
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    const error = validateLineCardDesign(draft)
    if (error) {
      showToast('บันทึกไม่สำเร็จ', error, 'ERROR')
      return
    }
    const card = { ...draft, id: draft.id || crypto.randomUUID() }
    const next = cards.some((c) => c.id === card.id) ? cards.map((c) => (c.id === card.id ? card : c)) : [...cards, card]
    if (await store(next, `การ์ด "${card.name.trim()}"`)) setDraft(card)
  }

  const remove = async (card: LineBillCardDesign) => {
    const ok = await confirm({ title: 'ลบการ์ด', message: `ลบการ์ด "${card.name}" ใช่ไหม`, confirmLabel: 'ลบ', cancelLabel: 'ยกเลิก', danger: true })
    if (!ok) return
    if (await store(cards.filter((c) => c.id !== card.id), `ลบการ์ด "${card.name}" แล้ว`) && draft.id === card.id) setDraft(newLineCardDesign())
  }

  const typeLabel = (type: LineCardType) => LINE_CARD_TYPES.find((t) => t.id === type)?.label ?? ''

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-4 items-start">
      <SettingsCard
        title="ออกแบบการ์ดบิล"
        action={
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={() => setDraft(newLineCardDesign())} disabled={saving} className={REF_BUTTON_QUIET}>
              <Eraser className="w-4 h-4" />
              <span>เริ่มใหม่</span>
            </button>
            <button type="button" onClick={() => void save()} disabled={saving} className={REF_BUTTON}>
              <Save className="w-4 h-4" />
              <span>บันทึกการ์ด</span>
            </button>
          </div>
        }
      >
        <div className="py-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className={SETTINGS_LABEL} htmlFor="line-card-name">ชื่อการ์ด</label>
            <input id="line-card-name" value={draft.name} maxLength={LINE_CARD_LIMITS.name} placeholder="เช่น การ์ดบิลเสร็จ" onChange={(e) => patch({ name: e.target.value })} className={SETTINGS_INPUT} />
          </div>
          <div>
            <span className={SETTINGS_LABEL}>ประเภทการ์ด</span>
            <CustomSelect value={draft.type} onChange={(v: LineCardType) => pickType(v)} options={LINE_CARD_TYPES.map((t) => ({ value: t.id, label: t.label }))} ariaLabel="ประเภทการ์ด" />
          </div>
          <div>
            <label className={SETTINGS_LABEL} htmlFor="line-card-title">หัวการ์ด</label>
            <input id="line-card-title" value={draft.title} maxLength={LINE_CARD_LIMITS.title} onChange={(e) => patch({ title: e.target.value })} className={SETTINGS_INPUT} />
          </div>
          <div>
            <label className={SETTINGS_LABEL} htmlFor="line-card-badge">ป้ายสถานะ</label>
            <input id="line-card-badge" value={draft.badge} maxLength={LINE_CARD_LIMITS.badge} onChange={(e) => patch({ badge: e.target.value })} className={SETTINGS_INPUT} />
          </div>
          <div className="sm:col-span-2">
            <span className={SETTINGS_LABEL}>สีหัวการ์ด</span>
            <div role="radiogroup" aria-label="สีหัวการ์ด" className="flex flex-wrap gap-2">
              {(Object.keys(LINE_CARD_COLORS) as LineCardColor[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={draft.color === c}
                  onClick={() => patch({ color: c })}
                  className={`${COMMAND_BUTTON_SIZE_CLASSES} px-3 border flex items-center transition ${
                    draft.color === c ? 'border-[var(--ref-accent)] bg-[var(--ref-accent-soft)] text-slate-900 dark:text-white' : 'border-[var(--ref-line)] bg-[var(--ref-field)] text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: LINE_CARD_COLORS[c].hex }} />
                  {LINE_CARD_COLORS[c].label}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <span className={SETTINGS_LABEL}>ข้อมูลที่แสดงบนการ์ด</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {LINE_CARD_FIELDS.map((f) => {
                const on = draft.fields.includes(f.id)
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleField(f.id)}
                    className={`${COMMAND_BUTTON_SIZE_CLASSES} px-3 border flex items-center text-left transition ${
                      on ? 'border-[var(--ref-accent)] bg-[var(--ref-accent-soft)] text-slate-900 dark:text-white' : 'border-[var(--ref-line)] bg-[var(--ref-field)] text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${on ? 'bg-[var(--ref-accent)] text-white' : 'border-2 border-slate-300 dark:border-slate-600'}`}>
                      {on && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    {f.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className={SETTINGS_LABEL} htmlFor="line-card-footer">ข้อความท้ายการ์ด</label>
            <textarea id="line-card-footer" rows={2} value={draft.footer} maxLength={LINE_CARD_LIMITS.footer} onChange={(e) => patch({ footer: e.target.value })} className={`${SETTINGS_INPUT} h-auto py-2 resize-y`} />
          </div>
        </div>
      </SettingsCard>

      <div className="space-y-4 min-w-0">
        <SettingsCard title="ตัวอย่างการ์ด">
          <div className="p-5 flex justify-center bg-[var(--ref-field)]">
            <LineCardPreview
              title={draft.title}
              badge={draft.badge}
              color={LINE_CARD_COLORS[draft.color].hex}
              rows={lineCardRows(draft, SAMPLE)}
              footer={lineCardFooter(draft, shopName)}
            />
          </div>
        </SettingsCard>
        <SettingsCard title="การ์ดที่บันทึกไว้">
          {cards.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">ยังไม่มีการ์ด</p>
          ) : (
            <ul className="divide-y divide-[var(--ref-line)]">
              {cards.map((c) => (
                <li key={c.id} className={`px-4 py-2.5 flex items-center gap-3 ${draft.id === c.id ? 'bg-[var(--ref-accent-soft)]' : ''}`}>
                  <button type="button" onClick={() => setDraft(c)} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                    <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: LINE_CARD_COLORS[c.color].hex }} />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{c.name}</span>
                      <span className="block text-[11px] text-slate-500 truncate">{typeLabel(c.type)}</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => void remove(c)} disabled={saving} aria-label={`ลบการ์ด ${c.name}`} className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>
      </div>
    </div>
  )
}
