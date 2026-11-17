'use client'

import {
  SETTINGS_HELPER,
  SETTINGS_INPUT,
  SETTINGS_INPUT_MONO,
  SETTINGS_LABEL,
} from '@/features/settings/components/settings-ui'
import { StatusPill } from '@/features/settings/components/StatusPill'
import { REF_BUTTON, REF_BUTTON_QUIET, SettingsCard } from '@/features/settings/components/SettingsCards'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { BellRing, Copy, KeyRound, Link2, RotateCcw, Trash2 } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { clearLineSecrets, getLineSecretStatus, saveLineSecrets, type LineSecretStatus } from '@/app/actions/system-secrets'
import { LINE_TEMPLATES, type LineTemplateKey } from '@/lib/line/templates'
import { LINE_EDITABLE_TEMPLATES, LINE_NOTIFY_EVENTS, type LineNotifyEventType } from '@/lib/line/config'
import type { SystemConfig } from '@/features/settings/services/settings-storage'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'
import { LineChatPreview, type LineChatBubble } from '@/features/settings/components/LineChatPreview'
import { LineSchedulePanel } from '@/features/settings/components/LineSchedulePanel'
import { LineFormsCard } from '@/features/settings/components/LineFormsCard'
import { LineBlockTitle, LineEditorLayout, LineListItem } from '@/features/settings/components/LineEditorLayout'

/**
 * LINE settings pages of the LINE menu (owner 2026-11-17: 4 groups, no page scroll):
 * - LineConnectionPanel (ตั้งค่า › เชื่อมต่อ LINE): Channel Secret / Access Token saved straight to Vault by its own
 *   buttons, never shown back; the Webhook URL; the ฟอร์มใน LINE link.
 * - LineSettingsPanel: the policies.line pages held by LineSettingsWorkspace's draft, saved one page at a time:
 *   แจ้งพนักงาน (NOTIFY), ข้อความอัตโนมัติ (TEMPLATES, under ข้อความ), เตือนลูกค้า (SCHEDULE).
 * Every list on these screens comes from lib/line/config.ts.
 */

export { LINE_NOTIFY_EVENTS, LINE_EDITABLE_TEMPLATES } from '@/lib/line/config'

/** The LINE pages that edit the settings draft (each saved on its own). */
export type LineSettingsView = 'NOTIFY' | 'TEMPLATES' | 'SCHEDULE'
export const LINE_SETTINGS_VIEWS: ReadonlyArray<{ id: LineSettingsView; label: string }> = [
  { id: 'TEMPLATES', label: 'ข้อความอัตโนมัติ' },
  { id: 'NOTIFY', label: 'แจ้งพนักงาน' },
  { id: 'SCHEDULE', label: 'เตือนลูกค้า' },
]

/** Sample values for the chat preview only (never real data). */
const SAMPLE_VARS: Record<string, string> = {
  ชื่อ: 'สมชาย ใจดี',
  หัวข้อ: 'เลยกำหนดคืน',
  รายละเอียด: 'บิล BR-0131 คุณวิภา เลยกำหนด 2 วัน',
  ผู้สั่ง: 'เจ้าของร้าน',
  เรื่อง: 'ส่งชุดให้คุณวิภาก่อน 15:00',
  ขั้นตอน: 'ถึงหน้างานแล้ว',
  คนขับ: 'ชาย',
  เหตุผล: 'ร้านยกเลิกงาน',
  ชื่อลูกค้า: 'สมหญิง ใจดี',
  เลขบิล: 'BR-0142',
  วันคืน: '12 ต.ค. 2569',
  วันครบ: '12 ต.ค. 2569',
  วันนัด: '12 ต.ค. 2569 10:00',
  ยอดค้าง: '1,500',
}

/** Sample line per staff notice type, for the preview of แจ้งพนักงาน. */
const NOTICE_SAMPLE: Record<LineNotifyEventType, string> = {
  APPOINTMENT_DUE: 'พรุ่งนี้ 10:00 คุณกานดา ลองชุด 3 รายการ',
  DELIVERY_DUE: 'ส่งของบิล BR-0139 ภายในวันนี้',
  RENTAL_DUE_SOON: 'บิล BR-0142 คุณสมหญิง ครบกำหนดคืนพรุ่งนี้',
  RENTAL_OVERDUE: 'บิล BR-0131 คุณวิภา เลยกำหนด 2 วัน',
  PAYMENT_DUE: 'บิล BR-0127 ยอดค้าง 2,300 บาท ครบกำหนดพรุ่งนี้',
  LOW_STOCK: 'ผ้าคลุมไหล่สีครีม เหลือ 2 ชิ้น',
  JOB_STEP: 'คนขับชาย: ถึงหน้างานแล้ว (งานส่งของคุณวิภา)',
  JOB_ACCEPT_LATE: 'คนขับชาย ยังไม่กดรับงานส่งของคุณวิภา',
}

const PLACEHOLDER = /\{([^{}]+)\}/g

/** Placeholders a draft uses that its message does not have (the page save refuses them too). */
function unknownVars(key: LineTemplateKey, draft: string): string[] {
  const allowed = new Set<string>(LINE_TEMPLATES[key].vars)
  return [...draft.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((v) => !allowed.has(v))
}

/** The text a template sends: the OWNER's draft when it only uses the key's own placeholders. */
function effectiveText(key: LineTemplateKey, draft: string | undefined): string {
  return draft && draft.trim() && unknownVars(key, draft).length === 0 ? draft : LINE_TEMPLATES[key].text
}

const fill = (text: string, vars: Record<string, string>) => text.replace(PLACEHOLDER, (all, n: string) => vars[n] ?? all)

/** The chat a template appears in (with the message before it when that helps to read it). */
function templateBubbles(key: LineTemplateKey, templates: Record<string, string>, vars: Record<string, string>): LineChatBubble[] {
  const text = (k: LineTemplateKey) => fill(effectiveText(k, templates[k]), vars)
  const typed: LineChatBubble = { from: 'me', text: 'สมชาย ใจดี 0812345678' }
  switch (key) {
    case 'TASK_NEW':
      return [{ from: 'shop', text: text('TASK_NEW'), buttons: ['รับงาน'] }]
    case 'TASK_ACCEPTED':
      return [{ from: 'shop', text: text('TASK_NEW'), buttons: ['รับงาน'] }, { from: 'me', text: 'รับงาน' }, { from: 'shop', text: text('TASK_ACCEPTED') }]
    case 'TASK_DONE':
      return [{ from: 'me', text: 'เสร็จแล้ว' }, { from: 'shop', text: text('TASK_DONE') }]
    case 'REGISTER_RETRY':
      return [{ from: 'shop', text: text('REGISTER_WELCOME') }, { from: 'me', text: 'สวัสดีค่ะ' }, { from: 'shop', text: text('REGISTER_RETRY') }]
    case 'LINK_SUCCESS':
    case 'REGISTER_PHONE_TAKEN':
    case 'REGISTER_PENDING':
      return [{ from: 'shop', text: text('REGISTER_WELCOME') }, typed, { from: 'shop', text: text(key) }]
    default:
      return [{ from: 'shop', text: text(key) }]
  }
}

/** Red outline button (clear the connection). */
const DANGER_QUIET = `${COMMAND_BUTTON_SIZE_CLASSES} px-3 border border-red-200 dark:border-red-800 bg-white dark:bg-slate-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-45 flex items-center`

/** ตั้งค่า › เชื่อมต่อ LINE: the OA keys (left), the Webhook URL and the ฟอร์มใน LINE link (right). */
export function LineConnectionPanel() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [status, setStatus] = useState<LineSecretStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/line/webhook`)
    getLineSecretStatus()
      .then(setStatus)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'โหลดสถานะ LINE ไม่สำเร็จ'))
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      setStatus(await saveLineSecrets({ lineSecret: secret || undefined, lineToken: token || undefined }))
      showToast('บันทึกแล้ว', 'บันทึกการเชื่อมต่อ LINE เรียบร้อย', 'SUCCESS')
    } catch (e: unknown) {
      showToast('บันทึกไม่สำเร็จ', e instanceof Error ? e.message : 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      // What was typed never stays on screen, saved or not.
      setSecret('')
      setToken('')
      setBusy(false)
    }
  }

  const clear = async () => {
    const ok = await confirm({
      title: 'ล้างการเชื่อมต่อ LINE',
      message: 'ระบบจะหยุดรับและส่งข้อความ LINE จนกว่าจะใส่ค่าใหม่',
      confirmLabel: 'ล้างการเชื่อมต่อ',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      setStatus(await clearLineSecrets())
      showToast('ล้างแล้ว', 'ลบข้อมูลการเชื่อมต่อ LINE แล้ว', 'SUCCESS')
    } catch (e: unknown) {
      showToast('ล้างไม่สำเร็จ', e instanceof Error ? e.message : 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setBusy(false)
    }
  }

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      showToast('คัดลอกแล้ว', 'นำไปวางในช่อง Webhook URL ของ LINE Developers', 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }

  const buttons = (
    <div className="flex flex-wrap justify-end gap-2">
      {(status?.lineSecretConfigured || status?.lineTokenConfigured) && (
        <button type="button" onClick={() => void clear()} disabled={busy} className={DANGER_QUIET}>
          <Trash2 className="w-3.5 h-3.5" />
          <span>ล้างการเชื่อมต่อ</span>
        </button>
      )}
      <button type="button" onClick={() => void save()} disabled={busy || !status?.available || (!secret && !token)} className={REF_BUTTON}>
        <KeyRound className="w-3.5 h-3.5" />
        <span>บันทึกการเชื่อมต่อ</span>
      </button>
    </div>
  )

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 grid grid-cols-1 lg:grid-cols-2 gap-4 content-start">
      <SettingsCard title="การเชื่อมต่อ LINE OA" icon={Link2} action={buttons}>
        <div className="py-2 space-y-3">
          {loadError ? (
            <p className="text-[11px] text-red-700 dark:text-red-400">{loadError}</p>
          ) : !status ? (
            <p className={SETTINGS_HELPER}>กำลังโหลดสถานะ…</p>
          ) : !status.available ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              ฐานข้อมูลนี้ยังไม่พร้อมสำหรับ LINE (ยังไม่ได้ติดตั้งส่วน LINE) จึงยังบันทึกการเชื่อมต่อไม่ได้
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2" data-testid="line-status">
              <span className="text-[11px] text-slate-600 dark:text-slate-300">Channel Secret</span>
              <StatusPill ok={status.lineSecretConfigured} okText="ตั้งแล้ว" noText="ยังไม่ตั้ง" />
              <span className="text-[11px] text-slate-600 dark:text-slate-300 ml-2">Access Token</span>
              <StatusPill ok={status.lineTokenConfigured} okText="ตั้งแล้ว" noText="ยังไม่ตั้ง" />
              <span className="text-[11px] text-slate-600 dark:text-slate-300 ml-2">โหมดการส่ง</span>
              <StatusPill ok={status.liveDelivery} okText="ส่งจริง" noText="ทดสอบ (ไม่ส่งถึง LINE จริง)" />
            </div>
          )}
          <div>
            <label className={SETTINGS_LABEL} htmlFor="line-secret">
              Channel Secret
            </label>
            <input
              id="line-secret"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              maxLength={64}
              disabled={busy || !status?.available}
              placeholder={status?.lineSecretConfigured ? 'ตั้งไว้แล้ว · กรอกเฉพาะเมื่อต้องการเปลี่ยน' : 'ตัวอักษร 0-9 a-f 32 ตัว'}
              onChange={(e) => setSecret(e.target.value.trim())}
              className={SETTINGS_INPUT_MONO}
            />
          </div>
          <div>
            <label className={SETTINGS_LABEL} htmlFor="line-token">
              Channel Access Token
            </label>
            <input
              id="line-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              maxLength={1024}
              disabled={busy || !status?.available}
              placeholder={status?.lineTokenConfigured ? 'ตั้งไว้แล้ว · กรอกเฉพาะเมื่อต้องการเปลี่ยน' : 'จาก LINE Developers › Messaging API'}
              onChange={(e) => setToken(e.target.value.trim())}
              className={SETTINGS_INPUT_MONO}
            />
          </div>
        </div>
      </SettingsCard>

      <div className="space-y-4 min-w-0">
        <SettingsCard title="Webhook URL (นำไปวางใน LINE Developers)" icon={Copy}>
          <div className="py-2 flex gap-2">
            <input readOnly aria-label="Webhook URL" value={webhookUrl} className={`${SETTINGS_INPUT_MONO} flex-1 min-w-0`} />
            <button type="button" onClick={() => void copyWebhook()} className={`${REF_BUTTON_QUIET} shrink-0`}>
              <Copy className="w-3.5 h-3.5" />
              <span>คัดลอก</span>
            </button>
          </div>
        </SettingsCard>
        <LineFormsCard />
      </div>
    </div>
  )
}

interface LineSettingsPanelProps {
  config: SystemConfig
  setConfig: Dispatch<SetStateAction<SystemConfig>>
  view: LineSettingsView
}

export function LineSettingsPanel({ config, setConfig, view }: LineSettingsPanelProps) {
  const [focusEvent, setFocusEvent] = useState<LineNotifyEventType>(LINE_NOTIFY_EVENTS[0].type)
  const [tplKey, setTplKey] = useState<LineTemplateKey>(LINE_EDITABLE_TEMPLATES[0].key)
  const tplRef = useRef<HTMLTextAreaElement>(null)
  const line = config.line
  const setLine = (patch: Partial<SystemConfig['line']>) => setConfig((c) => ({ ...c, line: { ...c.line, ...patch } }))
  const shopName = config.business.businessName.trim() || 'ร้านของคุณ'
  const vars = { ...SAMPLE_VARS, ชื่อร้าน: shopName }
  const onCount = LINE_NOTIFY_EVENTS.filter((ev) => line.notify[ev.type] === true).length
  const focusLabel = LINE_NOTIFY_EVENTS.find((e) => e.type === focusEvent)?.label ?? ''

  const tpl = LINE_EDITABLE_TEMPLATES.find((t) => t.key === tplKey) ?? LINE_EDITABLE_TEMPLATES[0]
  const tplDraft = line.templates[tpl.key] ?? ''
  const unknown = unknownVars(tpl.key, tplDraft)
  const setTemplate = (key: LineTemplateKey, value: string) => {
    const templates = { ...line.templates }
    if (value === '') delete templates[key]
    else templates[key] = value
    setLine({ templates })
  }
  /** Puts {name} at the cursor (an empty text starts from the standard text). */
  const insertVar = (name: string) => {
    const el = tplRef.current
    const base = tplDraft || LINE_TEMPLATES[tpl.key].text
    const at = el && tplDraft ? el.selectionStart : base.length
    const end = el && tplDraft ? el.selectionEnd : base.length
    setTemplate(tpl.key, `${base.slice(0, at)}{${name}}${base.slice(end)}`)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + name.length + 2, at + name.length + 2)
    })
  }

  if (view === 'SCHEDULE') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <LineSchedulePanel config={config} setConfig={setConfig} />
      </div>
    )
  }

  if (view === 'NOTIFY') {
    return (
      <LineEditorLayout
        preview={
          <LineChatPreview
            shopName={shopName}
            caption={
              <>
                <b className="text-slate-800 dark:text-slate-200">พนักงานจะเห็นแบบนี้</b> เมื่อมีแจ้งเตือน &quot;{focusLabel}&quot;
              </>
            }
            bubbles={[
              line.notify[focusEvent] === true
                ? {
                    from: 'shop',
                    text: fill(effectiveText('STAFF_NOTICE', line.templates.STAFF_NOTICE), { หัวข้อ: focusLabel, รายละเอียด: NOTICE_SAMPLE[focusEvent] }),
                  }
                : { from: 'shop', text: 'ปิดอยู่ แจ้งเตือนนี้จะไม่ส่งเข้า LINE', empty: true },
            ]}
          />
        }
      >
        <LineBlockTitle>
          <BellRing className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span>แจ้งพนักงานทาง LINE</span>
          <span className="font-semibold text-[11px] text-slate-500 dark:text-slate-400">
            เปิดอยู่ {onCount} จาก {LINE_NOTIFY_EVENTS.length}
          </span>
        </LineBlockTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
          {LINE_NOTIFY_EVENTS.map((ev) => (
            <label
              key={ev.type}
              onMouseEnter={() => setFocusEvent(ev.type)}
              className={`flex items-center gap-2.5 py-1.5 px-1.5 rounded-lg cursor-pointer ${focusEvent === ev.type ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
            >
              <input
                type="checkbox"
                role="switch"
                aria-label={ev.label}
                checked={line.notify[ev.type] === true}
                onFocus={() => setFocusEvent(ev.type)}
                onChange={(e) => {
                  const notify = { ...line.notify }
                  if (e.target.checked) notify[ev.type] = true
                  else delete notify[ev.type]
                  setFocusEvent(ev.type)
                  setLine({ notify })
                }}
                className="w-4 h-4 text-emerald-700 dark:text-emerald-400 rounded"
              />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{ev.label}</span>
            </label>
          ))}
        </div>
      </LineEditorLayout>
    )
  }

  // TEMPLATES: ข้อความ › ข้อความอัตโนมัติ
  return (
    <LineEditorLayout
      list={LINE_EDITABLE_TEMPLATES.map((t) => {
        const custom = (line.templates[t.key] ?? '').trim() !== ''
        return (
          <LineListItem
            key={t.key}
            title={t.label}
            sub={`${custom ? 'แก้แล้ว' : 'มาตรฐาน'} · ถึง${t.to}`}
            subTone={custom ? 'accent' : 'muted'}
            active={t.key === tpl.key}
            onSelect={() => setTplKey(t.key)}
          />
        )
      })}
      preview={
        <LineChatPreview
          shopName={shopName}
          caption={
            <>
              <b className="text-slate-800 dark:text-slate-200">{tpl.to}จะเห็นแบบนี้</b> ({tpl.label})
            </>
          }
          bubbles={templateBubbles(tpl.key, line.templates, vars)}
        />
      }
    >
      <LineBlockTitle action={<span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">{tplDraft.length}/5000</span>}>
        <label htmlFor={`line-tpl-${tpl.key}`}>{tpl.label}</label>
      </LineBlockTitle>
      <textarea
        id={`line-tpl-${tpl.key}`}
        ref={tplRef}
        maxLength={5000}
        value={tplDraft}
        placeholder={LINE_TEMPLATES[tpl.key].text}
        onChange={(e) => setTemplate(tpl.key, e.target.value)}
        className={`${SETTINGS_INPUT} flex-1 min-h-[140px] h-auto py-2 leading-relaxed resize-none`}
      />
      <div className="shrink-0 flex flex-wrap items-center gap-1.5">
        <span className={SETTINGS_LABEL}>แทรกข้อมูล:</span>
        {LINE_TEMPLATES[tpl.key].vars.length === 0 ? (
          <span className={SETTINGS_HELPER}>ไม่มี</span>
        ) : (
          LINE_TEMPLATES[tpl.key].vars.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVar(v)}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-dashed border-emerald-700 dark:border-emerald-400 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer`}
            >
              {`{${v}}`}
            </button>
          ))
        )}
        {tplDraft !== '' && (
          <button type="button" onClick={() => setTemplate(tpl.key, '')} className={`${REF_BUTTON_QUIET} ml-auto`}>
            <RotateCcw className="w-3.5 h-3.5" />
            <span>กลับไปใช้ข้อความมาตรฐาน</span>
          </button>
        )}
      </div>
      {unknown.length > 0 && (
        <p className="shrink-0 text-[11px] rounded-lg px-2.5 py-1.5 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200">
          ข้อความนี้ใช้ข้อมูลที่ระบบไม่รู้จัก: {unknown.map((v) => `{${v}}`).join(' ')} · แก้ก่อนบันทึก
        </p>
      )}
    </LineEditorLayout>
  )
}
