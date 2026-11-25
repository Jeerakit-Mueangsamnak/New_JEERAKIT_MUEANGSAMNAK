'use client'

import {
  SETTINGS_HELPER,
  SETTINGS_INPUT,
  SETTINGS_LABEL,
} from '@/features/settings/components/settings-ui'
import { StatusPill } from '@/features/settings/components/StatusPill'
import { REF_BUTTON, REF_BUTTON_QUIET } from '@/features/settings/components/SettingsCards'
import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { BellRing, ClipboardCheck, Copy, KeyRound, Link2, RotateCcw, Trash2, UserPlus } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { clearLineSecrets, getLineSecretStatus, saveLineSecrets, type LineSecretStatus } from '@/app/actions/system-secrets'
import { LINE_TEMPLATES, type LineTemplateKey } from '@/lib/line/templates'
import {
  LINE_EDITABLE_TEMPLATES,
  LINE_NOTIFY_EVENTS,
  LINE_NUMBER_OPTIONS, LINE_ABUSE_NUMBER_KEYS,
  LINE_REGISTER_FIELDS,
  LINE_REGISTER_FIELD_LABELS,
  type LineNotifyEventType,
  type LineTemplateCategory,
} from '@/lib/line/config'
import { NumericInput } from '@/components/common/NumericInput'
import type { SystemConfig } from '@/features/settings/services/settings-storage'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'
import { LineChatPreview, type LineChatBubble } from '@/features/settings/components/LineChatPreview'
import { LineSchedulePanel } from '@/features/settings/components/LineSchedulePanel'
import { LineCatalogSettings } from '@/features/settings/components/line/LineCatalogSettings'
import { LineFormsRow } from '@/features/settings/components/LineFormsCard'
import { LineBlockTitle, LineEditorLayout, LineTemplateCard } from '@/features/settings/components/LineEditorLayout'
import { SETTINGS_ROW_INPUT, SETTINGS_ROW_NUMBER, SettingsRow, SettingsRowsCard, SettingsSwitch } from '@/features/settings/components/SettingsRows'

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
export type LineSettingsView = 'NOTIFY' | 'TEMPLATES' | 'SCHEDULE' | 'FRIEND' | 'REGISTER' | 'CATALOG'
export const LINE_SETTINGS_VIEWS: ReadonlyArray<{ id: LineSettingsView; label: string }> = [
  { id: 'TEMPLATES', label: 'แก้ไขข้อความ' },
  { id: 'NOTIFY', label: 'แจ้งพนักงาน' },
  { id: 'SCHEDULE', label: 'เตือนลูกค้า' },
  { id: 'FRIEND', label: 'การเพิ่มเพื่อน' },
  { id: 'REGISTER', label: 'การลงทะเบียน' },
  { id: 'CATALOG', label: 'รายการสินค้า' },
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
  เบอร์โทรร้าน: '081-234-5678',
  รายการ: 'แบบคาน 40x1.00',
  หมวด: 'แบบคาน',
  ข้อความจากร้าน: 'ขอที่อยู่ด้วยค่ะ',
  ยอดเงิน: '1,500.00',
  วันที่: '25 พ.ย. 2569',
  รายรับรวม: '4,200.00',
  รายรับแยกช่องทาง: 'เงินสด 1,200.00 · โอน 3,000.00',
  บิลใหม่: '3',
  ยอดค้างรวม: '12,500.00',
  ชื่อพนักงาน: 'สมชาย',
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
    case 'REGISTER_PENDING':
      return [{ from: 'shop', text: text('REGISTER_WELCOME') }, typed, { from: 'shop', text: text('REGISTER_PENDING') }]
    case 'REGISTER_NEED_INFO':
    case 'REGISTER_APPROVED':
    case 'REGISTER_REJECTED':
      return [{ from: 'shop', text: text('REGISTER_WELCOME') }, typed, { from: 'shop', text: text('REGISTER_PENDING') }, { from: 'shop', text: text(key) }]
    case 'LINK_SUCCESS':
      return [{ from: 'me', text: 'LINK-ABCDEFGHJK' }, { from: 'shop', text: text('LINK_SUCCESS') }]
    case 'LINK_INVALID':
    case 'LINK_EXPIRED':
    case 'LINK_LOCKED':
    case 'LINK_TAKEN':
      return [{ from: 'me', text: 'LINK-ABCDEFGHJK' }, { from: 'shop', text: text(key) }]
    case 'PRICE_INQUIRY_REPLY':
      return [{ from: 'me', text: 'สอบถามราคา: แบบคาน 40x1.00' }, { from: 'shop', text: text('PRICE_INQUIRY_REPLY') }]
    case 'PREORDER_INQUIRY_REPLY':
      return [{ from: 'me', text: 'สอบถามสั่งสินค้าล่วงหน้า: แบบคาน 40x1.00' }, { from: 'shop', text: text('PREORDER_INQUIRY_REPLY') }]
    default:
      return [{ from: 'shop', text: text(key) }]
  }
}

/** Red outline button (clear the connection). */
const DANGER_QUIET = `${COMMAND_BUTTON_SIZE_CLASSES} px-3 border border-red-200 dark:border-red-800 bg-white dark:bg-slate-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-45 flex items-center`

/** ตั้งค่า › เชื่อมต่อ LINE: the OA keys card, then the links card (Webhook URL, ฟอร์มใน LINE). */
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
    <>
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
    </>
  )

  /** Shown in place of the state pills until the keys can be saved. */
  const notReady = loadError ? (
    <span className="text-red-700 dark:text-red-400">{loadError}</span>
  ) : !status ? (
    'กำลังโหลดสถานะ…'
  ) : !status.available ? (
    <span className="text-amber-700 dark:text-amber-300">ฐานข้อมูลนี้ยังไม่พร้อมสำหรับ LINE (ยังไม่ได้ติดตั้งส่วน LINE) จึงยังบันทึกการเชื่อมต่อไม่ได้</span>
  ) : null
  const ready = status?.available ? status : null

  // Rows like the reference (owner 2026-11-18): name on the left, its field on the right, one card per topic.
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3">
      <div className="space-y-4">
        <SettingsRowsCard title="การเชื่อมต่อ LINE OA" icon={Link2} footer={buttons}>
          {notReady && <SettingsRow label="สถานะ" description={notReady} />}
          <SettingsRow label="Channel Secret">
            {ready && <StatusPill ok={ready.lineSecretConfigured} okText="ตั้งแล้ว" noText="ยังไม่ตั้ง" />}
            <input
              aria-label="Channel Secret"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              maxLength={64}
              disabled={busy || !ready}
              placeholder="ตัวอักษร 0-9 a-f 32 ตัว"
              onChange={(e) => setSecret(e.target.value.trim())}
              className={`${SETTINGS_ROW_INPUT} font-mono`}
            />
          </SettingsRow>
          <SettingsRow label="Channel Access Token">
            {ready && <StatusPill ok={ready.lineTokenConfigured} okText="ตั้งแล้ว" noText="ยังไม่ตั้ง" />}
            <input
              aria-label="Channel Access Token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              maxLength={1024}
              disabled={busy || !ready}
              placeholder="จาก LINE Developers › Messaging API"
              onChange={(e) => setToken(e.target.value.trim())}
              className={`${SETTINGS_ROW_INPUT} font-mono`}
            />
          </SettingsRow>
          {ready && (
            <SettingsRow label="โหมดการส่ง">
              <StatusPill ok={ready.liveDelivery} okText="ส่งจริง" noText="ทดสอบ (ไม่ส่งถึง LINE จริง)" />
            </SettingsRow>
          )}
        </SettingsRowsCard>

        <SettingsRowsCard title="ลิงก์" icon={Copy}>
          <SettingsRow label="Webhook URL (นำไปวางใน LINE Developers)">
            <input readOnly aria-label="Webhook URL" value={webhookUrl} className={`${SETTINGS_ROW_INPUT} font-mono`} />
            <button type="button" onClick={() => void copyWebhook()} className={`${REF_BUTTON_QUIET} shrink-0`}>
              <Copy className="w-3.5 h-3.5" />
              <span>คัดลอก</span>
            </button>
          </SettingsRow>
          <LineFormsRow />
        </SettingsRowsCard>
      </div>
    </div>
  )
}

interface LineSettingsPanelProps {
  config: SystemConfig
  setConfig: Dispatch<SetStateAction<SystemConfig>>
  view: LineSettingsView
  /** The pages made of one card (แจ้งพนักงาน, การเพิ่มเพื่อน, การลงทะเบียน): the page save buttons, in the last row of the card */
  footer?: ReactNode
  /** แก้ไขข้อความ: which of the four groups of texts is open (all of them when left out) */
  templateCategory?: LineTemplateCategory
}

export function LineSettingsPanel({ config, setConfig, view, footer, templateCategory }: LineSettingsPanelProps) {
  const [focusEvent, setFocusEvent] = useState<LineNotifyEventType>(LINE_NOTIFY_EVENTS[0].type)
  const templateList = LINE_EDITABLE_TEMPLATES.filter((t) => !templateCategory || t.category === templateCategory)
  const [tplKey, setTplKey] = useState<LineTemplateKey>(LINE_EDITABLE_TEMPLATES[0].key)
  const tplRef = useRef<HTMLTextAreaElement>(null)
  const line = config.line
  const setLine = (patch: Partial<SystemConfig['line']>) => setConfig((c) => ({ ...c, line: { ...c.line, ...patch } }))
  const shopName = config.business.businessName.trim() || 'ร้านของคุณ'
  const vars = { ...SAMPLE_VARS, ชื่อร้าน: shopName }
  const onCount = LINE_NOTIFY_EVENTS.filter((ev) => line.notify[ev.type] === true).length
  const focusLabel = LINE_NOTIFY_EVENTS.find((e) => e.type === focusEvent)?.label ?? ''

  const tpl = templateList.find((t) => t.key === tplKey) ?? templateList[0] ?? LINE_EDITABLE_TEMPLATES[0]
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

  if (view === 'CATALOG') return <LineCatalogSettings config={config} setConfig={setConfig} footer={footer} />

  const welcomeOn = line.friend.welcome !== false
  if (view === 'FRIEND') {
    return (
      <LineEditorLayout
        preview={
          <LineChatPreview
            shopName={shopName}
            caption={<b className="text-slate-800 dark:text-slate-200">เพื่อนใหม่จะเห็นแบบนี้</b>}
            bubbles={[
              welcomeOn
                ? { from: 'shop', text: fill(effectiveText('REGISTER_WELCOME', line.templates.REGISTER_WELCOME), vars) }
                : { from: 'shop', text: 'ปิดอยู่ ระบบไม่ส่งข้อความต้อนรับ', empty: true },
            ]}
          />
        }
      >
        <SettingsRowsCard title="การเพิ่มเพื่อน" icon={UserPlus} footer={footer}>
          <SettingsRow label="ส่งข้อความต้อนรับเมื่อมีเพื่อนใหม่">
            <SettingsSwitch label="ส่งข้อความต้อนรับเมื่อมีเพื่อนใหม่" checked={welcomeOn} onChange={(on) => setLine({ friend: { ...line.friend, welcome: on } })} />
          </SettingsRow>
          <SettingsRow label="แจ้งเจ้าของเมื่อมีเพื่อนใหม่">
            <SettingsSwitch label="แจ้งเจ้าของเมื่อมีเพื่อนใหม่" checked={line.friend.notifyOwner === true} onChange={(on) => setLine({ friend: { ...line.friend, notifyOwner: on } })} />
          </SettingsRow>
          <SettingsRow label="ข้อความทักทายของ LINE Official Account Manager" description="ต้องปิดที่ LINE OA Manager เอง ถ้าเปิดไว้เพื่อนใหม่จะได้รับข้อความต้อนรับซ้ำสองข้อความ" />
          <SettingsRow label="เมื่อบล็อก" description="หยุดส่งข้อความหาคนนั้นเอง และแสดงในหน้า บล็อก LINE OA" />
          <SettingsRow label="เมื่อปลดบล็อก" description="กลับมาส่งได้เอง ไม่ส่งข้อความต้อนรับซ้ำ และไม่เปลี่ยนสถานะลงทะเบียน" />
          <SettingsRow label="เพื่อนเดิมที่กลับมาเพิ่มใหม่" description="ใช้ข้อมูลเดิม ไม่สร้างรายการซ้ำ และไม่ลบคำขอลงทะเบียนที่รออยู่" />
        </SettingsRowsCard>
      </LineEditorLayout>
    )
  }

  if (view === 'REGISTER') {
    const reg = line.register
    const setReg = (patch: Partial<SystemConfig['line']['register']>) => setLine({ register: { ...reg, ...patch } })
    const setRequired = (field: string, on: boolean) => {
      const required = { ...(reg.required ?? {}) }
      if (on) required[field] = true
      else delete required[field]
      const next: SystemConfig['line']['register'] = { ...reg, required }
      if (Object.keys(required).length === 0) delete next.required
      setLine({ register: next })
    }
    const setOtherNumber = (key: string, value: number | undefined) =>
      setConfig((c) => {
        const next = { ...c.line.other }
        if (value === undefined) delete next[key]
        else next[key] = value
        return { ...c, line: { ...c.line, other: next } }
      })
    const ownerLine = reg.notifyOwner !== false
    return (
      <LineEditorLayout
        preview={
          <LineChatPreview
            shopName={shopName}
            caption={<b className="text-slate-800 dark:text-slate-200">ผู้ลงทะเบียนจะเห็นแบบนี้</b>}
            bubbles={[
              { from: 'me', text: 'สมชาย ใจดี 0812345678' },
              { from: 'shop', text: fill(effectiveText('REGISTER_PENDING', line.templates.REGISTER_PENDING), vars) },
              reg.notifyApproved !== false
                ? { from: 'shop', text: fill(effectiveText('REGISTER_APPROVED', line.templates.REGISTER_APPROVED), vars) }
                : { from: 'shop', text: 'ปิดอยู่ ระบบไม่แจ้งผลเมื่ออนุมัติ', empty: true },
            ]}
          />
        }
      >
        <SettingsRowsCard title="การลงทะเบียน" icon={ClipboardCheck} footer={footer}>
          <SettingsRow label="แจ้งเจ้าของเมื่อมีคำขอลงทะเบียน">
            <SettingsSwitch label="แจ้งเจ้าของเมื่อมีคำขอลงทะเบียน" checked={ownerLine} onChange={(on) => setReg({ notifyOwner: on })} />
          </SettingsRow>
          <SettingsRow label="แจ้งผู้ลงทะเบียนเมื่ออนุมัติ">
            <SettingsSwitch label="แจ้งผู้ลงทะเบียนเมื่ออนุมัติ" checked={reg.notifyApproved !== false} onChange={(on) => setReg({ notifyApproved: on })} />
          </SettingsRow>
          <SettingsRow label="แจ้งผู้ลงทะเบียนเมื่อปฏิเสธ">
            <SettingsSwitch label="แจ้งผู้ลงทะเบียนเมื่อปฏิเสธ" checked={reg.notifyRejected !== false} onChange={(on) => setReg({ notifyRejected: on })} />
          </SettingsRow>
          {LINE_REGISTER_FIELDS.map((field) => (
            <SettingsRow key={field} label={`ต้องกรอก${LINE_REGISTER_FIELD_LABELS[field]}`}>
              <SettingsSwitch label={`ต้องกรอก${LINE_REGISTER_FIELD_LABELS[field]}`} checked={reg.required?.[field] === true} onChange={(on) => setRequired(field, on)} />
            </SettingsRow>
          ))}
          {([...(['linkCodeTtlMinutes', 'linkMaxFailures'] as const), ...LINE_ABUSE_NUMBER_KEYS]).map((key) => {
            const o = LINE_NUMBER_OPTIONS[key]
            const value = typeof line.other[key] === 'number' ? (line.other[key] as number) : o.default
            return (
              <SettingsRow key={key} label={<label htmlFor={`line-opt-${key}`}>{o.label}</label>}>
                <NumericInput
                  id={`line-opt-${key}`}
                  value={value}
                  min={o.min}
                  max={o.max}
                  allowDecimals={false}
                  defaultValueOnBlur={o.default}
                  onChange={(v) => setOtherNumber(key, v === '' ? undefined : Math.min(Math.max(v, o.min), o.max))}
                  className={SETTINGS_ROW_NUMBER}
                />
              </SettingsRow>
            )
          })}
          <SettingsRow label="ระงับอัตโนมัติเมื่อพบการใช้งานผิดปกติ" description="ระงับเฉพาะประเภทที่ฝ่าฝืน เจ้าของยกเลิกการระงับรายคนได้">
            <SettingsSwitch label="ระงับอัตโนมัติเมื่อพบการใช้งานผิดปกติ" checked={line.other.abuseAutoSuspend !== false} onChange={(on) => setLine({ other: { ...line.other, abuseAutoSuspend: on } })} />
          </SettingsRow>
          <SettingsRow label="ผู้ตรวจและอนุมัติ" description="เจ้าของร้านเท่านั้น ตรวจสิทธิ์ซ้ำที่ฐานข้อมูลทุกครั้ง" />
          <SettingsRow label="ตรวจข้อมูลซ้ำ" description="เทียบเบอร์โทรกับลูกค้าเดิมทุกครั้ง แต่ไม่ผูกให้เอง ร้านเป็นผู้ตัดสิน" />
        </SettingsRowsCard>
        <SettingsRowsCard title="ประกาศความเป็นส่วนตัว (แสดงก่อนกดส่งฟอร์ม)" icon={ClipboardCheck}>
          <div className="p-3">
            <textarea
              aria-label="ประกาศความเป็นส่วนตัว"
              maxLength={1000}
              value={reg.privacy ?? ''}
              placeholder="ร้านเก็บชื่อ เบอร์โทร และที่อยู่ที่คุณกรอก เพื่อตรวจสอบการลงทะเบียน และส่งเอกสารหรือการแจ้งเตือนทาง LINE ให้คุณ"
              onChange={(e) => {
                const next = { ...reg }
                if (e.target.value === '') delete next.privacy
                else next.privacy = e.target.value
                setLine({ register: next })
              }}
              className={`${SETTINGS_INPUT} min-h-[90px] h-auto py-2 leading-relaxed resize-none`}
            />
          </div>
        </SettingsRowsCard>
      </LineEditorLayout>
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
        {/* One card of rows, each notice with its switch on the right; save buttons in the card's last row
            (owner 2026-11-17: reference "Connection logging" look) */}
        <SettingsRowsCard title={`แจ้งพนักงานทาง LINE · เปิดอยู่ ${onCount} จาก ${LINE_NOTIFY_EVENTS.length}`} icon={BellRing} footer={footer}>
          {LINE_NOTIFY_EVENTS.map((ev) => (
            <SettingsRow key={ev.type} label={ev.label} active={focusEvent === ev.type} onMouseEnter={() => setFocusEvent(ev.type)}>
              <SettingsSwitch
                label={ev.label}
                checked={line.notify[ev.type] === true}
                onFocus={() => setFocusEvent(ev.type)}
                onChange={(on) => {
                  const notify = { ...line.notify }
                  if (on) notify[ev.type] = true
                  else delete notify[ev.type]
                  setFocusEvent(ev.type)
                  setLine({ notify })
                }}
              />
            </SettingsRow>
          ))}
          {/* the linked OWNER's LINE only; off until switched on (owner 2026-11-25) */}
          <SettingsRow label="เจ้าของพิมพ์สั่งในแชต LINE" description="#สรุปยอดวันนี้ · #สั่งงาน ชื่อพนักงาน รายละเอียดงาน">
            <SettingsSwitch label="เจ้าของพิมพ์สั่งในแชต LINE" checked={line.other.ownerCommands === true} onChange={(on) => setLine({ other: { ...line.other, ownerCommands: on } })} />
          </SettingsRow>
        </SettingsRowsCard>
      </LineEditorLayout>
    )
  }

  // TEMPLATES: ข้อความ › ข้อความอัตโนมัติ
  return (
    <LineEditorLayout
      list={templateList.map((t) => {
        const own = (line.templates[t.key] ?? '').trim()
        return (
          <LineTemplateCard
            key={t.key}
            title={t.label}
            text={own || LINE_TEMPLATES[t.key].text}
            to={t.to}
            custom={own !== ''}
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
