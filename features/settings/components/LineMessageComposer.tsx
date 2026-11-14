'use client'
/**
 * เขียนข้อความ (owner 2026-11-13, from the shop's reference screen): write a LINE message, see it before sending,
 * and keep it as a แม่แบบ for sending bills on LINE. Sending to a whole group at once is not built yet
 * (owner: แม่แบบอย่างเดียวก่อน), so ส่งเลย stays off.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Check, Copy, Eraser, Save, Send, Trash2, Users } from 'lucide-react'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'
import { CustomSelect } from '@/components/common/CustomSelect'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { createClient } from '@/lib/supabase/client'
import { SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { REF_BUTTON, REF_BUTTON_QUIET, SettingsCard } from '@/features/settings/components/SettingsCards'
import { LineChatPreview } from '@/features/settings/components/LineChatPreview'
import { validateSection } from '@/features/settings/utils/settings-validation'
import {
  fillLineMessage,
  LINE_MESSAGE_GROUPS,
  LINE_MESSAGE_LIMITS,
  LINE_MESSAGE_TOPICS,
  LINE_MESSAGE_VARS,
  newLineMessageTemplate,
  validateLineMessageTemplate,
  type LineMessageGroup,
  type LineMessageTemplate,
  type LineMessageTopic,
} from '@/lib/line/message-templates'

/** Values for the preview only (a real send fills the bill's own). */
const SAMPLE = { name: 'คุณสมชาย', billNo: 'BL-12112569-001', outstanding: '1,200.00 บาท', returnDate: '14 พ.ย. 2569' }
/** Which line_contacts column marks each group. */
const GROUP_COLUMN: Record<LineMessageGroup, string> = { STAFF: 'profile_id', CUSTOMER: 'customer_id', DRIVER: 'driver_code' }

/** Linked LINE accounts in the chosen groups (null = not known). */
function useLinkedCount(groups: LineMessageGroup[]): number | null {
  const [count, setCount] = useState<number | null>(null)
  const key = [...groups].sort().join(',')
  useEffect(() => {
    let alive = true
    const chosen = key ? (key.split(',') as LineMessageGroup[]) : []
    if (!chosen.length) {
      setCount(0)
      return
    }
    const supabase = createClient()
    Promise.all(
      chosen.map((g) =>
        supabase.from('line_contacts').select('id', { count: 'exact', head: true }).eq('status', 'LINKED').not(GROUP_COLUMN[g], 'is', null)
      )
    )
      .then((results) => {
        if (!alive) return
        setCount(results.some((r) => r.error) ? null : results.reduce((n, r) => n + (r.count ?? 0), 0))
      })
      .catch(() => alive && setCount(null))
    return () => {
      alive = false
    }
  }, [key])
  return count
}

export function LineMessageComposer() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { settings, saveSection } = useSystemSettings()
  const templates = settings.lineMessageTemplates
  const shopName = settings.business.businessName || ''
  const [draft, setDraft] = useState<LineMessageTemplate>(() => newLineMessageTemplate())
  const [saving, setSaving] = useState(false)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const linked = useLinkedCount(draft.groups)

  const patch = (p: Partial<LineMessageTemplate>) => setDraft((d) => ({ ...d, ...p }))
  const toggleGroup = (g: LineMessageGroup) =>
    setDraft((d) => ({ ...d, groups: d.groups.includes(g) ? d.groups.filter((x) => x !== g) : [...d.groups, g] }))
  // a { } word goes in where the cursor is (at the end when the box was not used yet)
  const insertVar = (token: string) => {
    const el = textRef.current
    const at = el && document.activeElement === el ? el.selectionStart : draft.text.length
    const text = `${draft.text.slice(0, at)}${token}${draft.text.slice(at)}`
    if (text.length > LINE_MESSAGE_LIMITS.text) return
    patch({ text })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + token.length, at + token.length)
    })
  }

  const preview = fillLineMessage(draft.text, { ...SAMPLE, shop: shopName })
  const store = async (next: LineMessageTemplate[], done: string) => {
    const cfg = { ...settings, lineMessageTemplates: next }
    const error = validateSection('lineMessageTemplates', cfg)
    if (error) {
      showToast('บันทึกไม่สำเร็จ', error, 'ERROR')
      return false
    }
    setSaving(true)
    try {
      await saveSection('lineMessageTemplates', cfg)
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
    const error = validateLineMessageTemplate(draft)
    if (error) {
      showToast('บันทึกไม่สำเร็จ', error, 'ERROR')
      return
    }
    const t = { ...draft, id: draft.id || crypto.randomUUID() }
    const next = templates.some((x) => x.id === t.id) ? templates.map((x) => (x.id === t.id ? t : x)) : [...templates, t]
    if (await store(next, `แม่แบบ "${t.name.trim()}"`)) setDraft(t)
  }
  const remove = async (t: LineMessageTemplate) => {
    const ok = await confirm({ title: 'ลบแม่แบบ', message: `ลบแม่แบบ "${t.name}" ใช่ไหม`, confirmLabel: 'ลบ', cancelLabel: 'ยกเลิก', danger: true })
    if (!ok) return
    if (await store(templates.filter((x) => x.id !== t.id), `ลบแม่แบบ "${t.name}" แล้ว`) && draft.id === t.id) setDraft(newLineMessageTemplate())
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preview)
      showToast('คัดลอกแล้ว', 'ข้อความตัวอย่าง', 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }
  const topicLabel = (id: LineMessageTopic) => LINE_MESSAGE_TOPICS.find((t) => t.id === id)?.label ?? ''
  const tile = (on: boolean) =>
    `${COMMAND_BUTTON_SIZE_CLASSES} px-3 border flex items-center text-left transition ${
      on ? 'border-[var(--ref-accent)] bg-[var(--ref-accent-soft)] text-slate-900 dark:text-white' : 'border-[var(--ref-line)] bg-[var(--ref-field)] text-slate-600 dark:text-slate-400'
    }`

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-5 items-start">
      <SettingsCard
        title="เขียนข้อความ"
      >
        <div className="py-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => setDraft(newLineMessageTemplate())} disabled={saving} className={REF_BUTTON_QUIET}>
              <Eraser className="w-4 h-4" />
              <span>เริ่มใหม่</span>
            </button>
            <button type="button" onClick={() => void save()} disabled={saving} className={REF_BUTTON}>
              <Save className="w-4 h-4" />
              <span>บันทึกแม่แบบ</span>
            </button>
            <button type="button" disabled title="ยังส่งถึงทั้งกลุ่มไม่ได้" className={REF_BUTTON}>
              <Send className="w-4 h-4" />
              <span>ส่งเลย</span>
            </button>
          </div>
          <div>
            <label className={SETTINGS_LABEL} htmlFor="line-msg-name">ชื่อแม่แบบ</label>
            <input id="line-msg-name" value={draft.name} maxLength={LINE_MESSAGE_LIMITS.name} placeholder="เช่น แจ้งนัดรับคืน" onChange={(e) => patch({ name: e.target.value })} className={SETTINGS_INPUT} />
          </div>
          <div>
            <span className={SETTINGS_LABEL}>หัวข้อแจ้งเตือน</span>
            <CustomSelect value={draft.topic} onChange={(v: LineMessageTopic) => patch({ topic: v })} options={LINE_MESSAGE_TOPICS.map((t) => ({ value: t.id, label: t.label }))} ariaLabel="หัวข้อแจ้งเตือน" />
          </div>
          <div className="sm:col-span-2">
            <span className={SETTINGS_LABEL}>กลุ่มผู้รับ</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {LINE_MESSAGE_GROUPS.map((g) => {
                const on = draft.groups.includes(g.id)
                return (
                  <button key={g.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggleGroup(g.id)} className={tile(on)}>
                    <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${on ? 'bg-[var(--ref-accent)] text-white' : 'border-2 border-slate-300 dark:border-slate-600'}`}>
                      {on && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    {g.label}
                  </button>
                )
              })}
            </div>
            {linked !== null && (
              <p className="mt-2 rounded-xl border border-[var(--ref-line)] bg-[var(--ref-field)] px-3.5 py-2.5 flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                <Users className="w-4 h-4 shrink-0" />
                ผูก LINE แล้ว {linked.toLocaleString('th-TH')} บัญชี
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className={SETTINGS_LABEL} htmlFor="line-msg-subject">เรื่อง (ถ้ามี)</label>
            <input id="line-msg-subject" value={draft.subject} maxLength={LINE_MESSAGE_LIMITS.subject} onChange={(e) => patch({ subject: e.target.value })} className={SETTINGS_INPUT} />
          </div>
          <div className="sm:col-span-2">
            <label className={SETTINGS_LABEL} htmlFor="line-msg-text">ข้อความ</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {LINE_MESSAGE_VARS.map((v) => (
                <button key={v.token} type="button" onClick={() => insertVar(v.token)} className="h-7 px-2.5 rounded-full border border-[var(--ref-line)] bg-[var(--ref-field)] text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:border-[var(--ref-accent)]">
                  {v.token} {v.label}
                </button>
              ))}
            </div>
            <textarea
              id="line-msg-text"
              ref={textRef}
              rows={7}
              value={draft.text}
              maxLength={LINE_MESSAGE_LIMITS.text}
              onChange={(e) => patch({ text: e.target.value })}
              className={`${SETTINGS_INPUT} h-auto py-2 resize-y`}
            />
            <p className="mt-1 text-right text-[11px] text-slate-500 dark:text-slate-400">{draft.text.length}/{LINE_MESSAGE_LIMITS.text}</p>
          </div>
        </div>
      </SettingsCard>

      <div className="space-y-5 min-w-0">
        <SettingsCard
          title="ตัวอย่างก่อนส่ง"
          action={
            <button type="button" onClick={() => void copy()} className={`${REF_BUTTON_QUIET} shrink-0 whitespace-nowrap`}>
              <Copy className="w-4 h-4" />
              <span>คัดลอก</span>
            </button>
          }
        >
          <div className="py-2">
            <LineChatPreview
              shopName={shopName || 'ร้าน'}
              bubbles={[{ from: 'shop', text: preview.trim() || ' ' }]}
              note="ตัวอย่าง · ยังไม่ส่งจริง"
            />
          </div>
        </SettingsCard>
        <SettingsCard title="แม่แบบที่บันทึกไว้">
          {templates.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">ยังไม่มีแม่แบบ</p>
          ) : (
            <ul className="divide-y divide-[var(--ref-line)]">
              {templates.map((t) => (
                <li key={t.id} className={`px-4 py-2.5 flex items-center gap-3 ${draft.id === t.id ? 'bg-[var(--ref-accent-soft)]' : ''}`}>
                  <button type="button" onClick={() => setDraft(t)} className="flex-1 min-w-0 text-left">
                    <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{t.name}</span>
                    <span className="block text-[11px] text-slate-500 truncate">{topicLabel(t.topic)}</span>
                  </button>
                  <button type="button" onClick={() => void remove(t)} disabled={saving} aria-label={`ลบแม่แบบ ${t.name}`} className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40">
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
