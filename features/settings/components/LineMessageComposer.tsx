'use client'
/**
 * LINE › ข้อความ › แม่แบบของร้าน (owner 2026-11-13, laid out list | form | preview 2026-11-17): write a LINE message, see it before sending,
 * and keep it as a แม่แบบ for sending bills on LINE. Sending to a whole group at once is not built yet
 * (owner: แม่แบบอย่างเดียวก่อน), so ส่งเลย stays off.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Check, Copy, Eraser, Save, Send, Users } from 'lucide-react'
import { ActionButton, COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'
import { CustomSelect } from '@/components/common/CustomSelect'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { createClient } from '@/lib/supabase/client'
import { SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { LineChatPreview } from '@/features/settings/components/LineChatPreview'
import { LineBlockTitle, LineEditorLayout, LineListEmpty, LineListItem } from '@/features/settings/components/LineEditorLayout'
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
    <LineEditorLayout
      listTitle="แม่แบบที่บันทึกไว้"
      listAction={
        <ActionButton variant="clear" icon={<Eraser />} onClick={() => setDraft(newLineMessageTemplate())} disabled={saving}>
          เริ่มใหม่
        </ActionButton>
      }
      list={
        templates.length === 0 ? (
          <LineListEmpty text="ยังไม่มีแม่แบบ" />
        ) : (
          templates.map((t) => (
            <LineListItem
              key={t.id}
              title={t.name}
              sub={topicLabel(t.topic)}
              active={draft.id === t.id}
              onSelect={() => setDraft(t)}
              onDelete={() => void remove(t)}
              deleteLabel={`ลบแม่แบบ ${t.name}`}
              disabled={saving}
            />
          ))
        )
      }
      preview={
        <div className="space-y-2">
          <LineBlockTitle
            action={
              <ActionButton variant="share" icon={<Copy />} onClick={() => void copy()} className="shrink-0">
                คัดลอก
              </ActionButton>
            }
          >
            ตัวอย่างก่อนส่ง
          </LineBlockTitle>
          <LineChatPreview shopName={shopName || 'ร้าน'} bubbles={[{ from: 'shop', text: preview.trim() || ' ' }]} note="ตัวอย่าง · ยังไม่ส่งจริง" />
        </div>
      }
    >
      <LineBlockTitle
        action={
          <div className="flex gap-2 shrink-0">
            <ActionButton variant="primary" icon={<Save />} onClick={() => void save()} disabled={saving}>
              บันทึกแม่แบบ
            </ActionButton>
            <ActionButton variant="share" icon={<Send />} disabled title="ยังส่งถึงทั้งกลุ่มไม่ได้">
              ส่งเลย
            </ActionButton>
          </div>
        }
      >
        {draft.id ? draft.name || 'แม่แบบ' : 'แม่แบบใหม่'}
      </LineBlockTitle>
      <div className="shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className={SETTINGS_LABEL} htmlFor="line-msg-name">ชื่อแม่แบบ</label>
          <input id="line-msg-name" value={draft.name} maxLength={LINE_MESSAGE_LIMITS.name} placeholder="เช่น แจ้งนัดรับคืน" onChange={(e) => patch({ name: e.target.value })} className={SETTINGS_INPUT} />
        </div>
        <div>
          <span className={SETTINGS_LABEL}>หัวข้อแจ้งเตือน</span>
          <CustomSelect value={draft.topic} onChange={(v: LineMessageTopic) => patch({ topic: v })} options={LINE_MESSAGE_TOPICS.map((t) => ({ value: t.id, label: t.label }))} ariaLabel="หัวข้อแจ้งเตือน" />
        </div>
      </div>
      <div className="shrink-0">
        <span className={SETTINGS_LABEL}>กลุ่มผู้รับ</span>
        <div className="flex flex-wrap items-center gap-2">
          {LINE_MESSAGE_GROUPS.map((g) => {
            const on = draft.groups.includes(g.id)
            return (
              <button key={g.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggleGroup(g.id)} className={tile(on)}>
                <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${on ? 'bg-[var(--ref-accent)] text-white' : 'border-2 border-slate-300 dark:border-slate-600'}`}>
                  {on && <Check className="w-3 h-3" strokeWidth={3} />}
                </span>
                {g.label}
              </button>
            )
          })}
          {linked !== null && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
              <Users className="w-3.5 h-3.5 shrink-0" />
              ผูก LINE แล้ว {linked.toLocaleString('th-TH')} บัญชี
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0">
        <label className={SETTINGS_LABEL} htmlFor="line-msg-subject">เรื่อง (ถ้ามี)</label>
        <input id="line-msg-subject" value={draft.subject} maxLength={LINE_MESSAGE_LIMITS.subject} onChange={(e) => patch({ subject: e.target.value })} className={SETTINGS_INPUT} />
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 flex items-center justify-between gap-2">
          <label className={SETTINGS_LABEL} htmlFor="line-msg-text">ข้อความ</label>
          <span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">{draft.text.length}/{LINE_MESSAGE_LIMITS.text}</span>
        </div>
        <div className="shrink-0 flex flex-wrap gap-1.5 mb-2">
          {LINE_MESSAGE_VARS.map((v) => (
            <button
              key={v.token}
              type="button"
              onClick={() => insertVar(v.token)}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-dashed border-emerald-700 dark:border-emerald-400 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer`}
            >
              {v.token} {v.label}
            </button>
          ))}
        </div>
        <textarea
          id="line-msg-text"
          ref={textRef}
          value={draft.text}
          maxLength={LINE_MESSAGE_LIMITS.text}
          onChange={(e) => patch({ text: e.target.value })}
          className={`${SETTINGS_INPUT} flex-1 min-h-[120px] h-auto py-2 leading-relaxed resize-none`}
        />
      </div>
    </LineEditorLayout>
  )
}
