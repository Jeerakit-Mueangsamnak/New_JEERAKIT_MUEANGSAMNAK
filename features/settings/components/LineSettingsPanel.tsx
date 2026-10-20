'use client'

import {
  SETTINGS_HELPER,
  SETTINGS_INPUT,
  SETTINGS_INPUT_MONO,
  SETTINGS_LABEL,
  SETTINGS_SECTION,
  SETTINGS_SECTION_TITLE,
} from '@/features/settings/components/settings-ui'
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { BellRing, Copy, KeyRound, Link2, MessageSquareText, Trash2 } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { useAskText } from '@/components/common/ConfirmDialogProvider'
import { clearLineSecrets, getLineSecretStatus, saveLineSecrets, type LineSecretStatus } from '@/app/actions/system-secrets'
import { LINE_TEMPLATES, type LineTemplateKey } from '@/lib/line/templates'
import type { SystemConfig } from '@/features/settings/services/settings-storage'
import { LineMembersPanel } from '@/features/settings/components/LineMembersPanel'
import {
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
  TAB_CONTAINER_CLASSES,
} from '@/components/common/ActionButton'
import { DeliveryDriversPanel } from '@/features/settings/components/DeliveryDriversPanel'

/**
 * Settings › LINE. Two kinds of values:
 * - OA connection (Channel Secret / Access Token): saved straight to Vault by its own buttons,
 *   never shown back, never part of the section draft.
 * - policies.line (which notices go to staff LINE, the message texts): the section draft,
 *   saved with the page's บันทึก button like every other section.
 */

/** In-app notice types the server raises today (notifications.event_type). */
export const LINE_NOTIFY_EVENTS: ReadonlyArray<{ type: string; label: string; hint: string }> = [
  { type: 'APPOINTMENT_DUE', label: 'นัดหมายใกล้ถึง', hint: 'นัดหมายที่ใกล้ถึงวันนัด' },
  { type: 'DELIVERY_DUE', label: 'กำหนดส่งสินค้า', hint: 'งานส่งสินค้าที่ใกล้ถึงกำหนด' },
  { type: 'RENTAL_DUE_SOON', label: 'ใกล้ครบกำหนดคืน', hint: 'บิลเช่าที่ใกล้ถึงวันคืน' },
  { type: 'RENTAL_OVERDUE', label: 'เลยกำหนดคืน', hint: 'บิลเช่าที่เลยวันคืนแล้ว' },
  { type: 'PAYMENT_DUE', label: 'ใกล้ครบกำหนดชำระ', hint: 'บิลที่มียอดค้างใกล้ครบกำหนด' },
  { type: 'LOW_STOCK', label: 'สินค้าใกล้หมด', hint: 'สต็อกต่ำกว่าจุดสั่งซื้อ' },
]

/** Texts the OWNER may reword: only the ones the 4 LINE features send. */
export const LINE_EDITABLE_TEMPLATES: ReadonlyArray<{ key: LineTemplateKey; label: string }> = [
  { key: 'STAFF_NOTICE', label: 'แจ้งเตือนพนักงาน' },
  { key: 'TASK_NEW', label: 'สั่งงานใหม่' },
  { key: 'TASK_ACCEPTED', label: 'ตอบกลับเมื่อพนักงานรับงาน' },
  { key: 'TASK_DONE', label: 'ตอบกลับเมื่องานเสร็จ' },
  { key: 'CUSTOMER_RETURN_REMINDER', label: 'เตือนลูกค้าคืนสินค้า / ยอดค้าง' },
]

/** Sub-sections of the LINE tab (its own sub-tab bar). */
export type LineSettingsView = 'MEMBERS' | 'CONNECTION' | 'NOTIFY' | 'TEMPLATES'
export const LINE_SETTINGS_VIEWS: ReadonlyArray<{ id: LineSettingsView; label: string }> = [
  { id: 'MEMBERS', label: 'เพิ่มข้อมูล' },
  { id: 'CONNECTION', label: 'ตั้งค่าการเชื่อมต่อ' },
  { id: 'NOTIFY', label: 'แจ้งเตือน' },
  { id: 'TEMPLATES', label: 'บล็อกข้อความ' },
]

interface LineSettingsPanelProps {
  config: SystemConfig
  setConfig: Dispatch<SetStateAction<SystemConfig>>
}

function StatusPill({ ok, okText, noText }: { ok: boolean; okText: string; noText: string }) {
  return (
    <span
      className={`inline-flex items-center h-6 px-2 rounded-lg text-[11px] font-bold ${
        ok
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
      }`}
    >
      {ok ? okText : noText}
    </span>
  )
}

function ConnectionSection() {
  const { showToast } = useToast()
  const askText = useAskText()
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
    const reason = await askText({
      title: 'ล้างการเชื่อมต่อ LINE',
      message: 'ระบบจะหยุดรับและส่งข้อความ LINE จนกว่าจะใส่ค่าใหม่',
      placeholder: 'เหตุผล เช่น เปลี่ยน LINE OA',
      confirmLabel: 'ล้างการเชื่อมต่อ',
      danger: true,
    })
    if (!reason) return
    setBusy(true)
    try {
      setStatus(await clearLineSecrets(reason))
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

  return (
    <div className={SETTINGS_SECTION}>
      <h4 className={SETTINGS_SECTION_TITLE}>
        <Link2 className="w-3.5 h-3.5 text-emerald-600" />
        <span>การเชื่อมต่อ LINE OA</span>
      </h4>

      {loadError ? (
        <p className="text-[11px] text-red-600">{loadError}</p>
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
      {status && !status.liveDelivery && (
        <p className={SETTINGS_HELPER}>
          โหมดทดสอบ: ระบบบันทึกข้อความทุกอย่างตามปกติ แต่ไม่ส่งออกไปที่ LINE · เปิดส่งจริงได้ที่การตั้งค่าเซิร์ฟเวอร์เท่านั้น
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
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
      <p className={SETTINGS_HELPER}>ค่าที่บันทึกแล้วจะไม่แสดงกลับมาอีก · กรอกช่องเดียวได้ถ้าต้องการเปลี่ยนแค่ค่านั้น</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !status?.available || (!secret && !token)}
          className="h-8 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50"
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span>บันทึกการเชื่อมต่อ</span>
        </button>
        {(status?.lineSecretConfigured || status?.lineTokenConfigured) && (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            className="h-8 px-3 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 font-bold text-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>ล้างการเชื่อมต่อ</span>
          </button>
        )}
      </div>

      <div className="max-w-2xl">
        <label className={SETTINGS_LABEL}>Webhook URL (นำไปวางใน LINE Developers)</label>
        <div className="flex gap-2">
          <input readOnly value={webhookUrl} className={SETTINGS_INPUT_MONO} />
          <button
            type="button"
            onClick={() => void copyWebhook()}
            className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs flex items-center gap-1.5 shrink-0"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>คัดลอก</span>
          </button>
        </div>
        <p className={SETTINGS_HELPER}>LINE ต้องเรียกผ่าน https จึงต้องเป็นโดเมนจริงของร้าน (ใช้ localhost ไม่ได้)</p>
      </div>
    </div>
  )
}

export function LineSettingsPanel({ config, setConfig }: LineSettingsPanelProps) {
  const [view, setView] = useState<LineSettingsView>('MEMBERS')
  const line = config.line
  const setLine = (patch: Partial<SystemConfig['line']>) => setConfig((c) => ({ ...c, line: { ...c.line, ...patch } }))

  return (
    <>
      <div className="px-3 sm:px-4 pt-3 overflow-x-auto no-scrollbar">
        <div className={TAB_CONTAINER_CLASSES} role="tablist" aria-label="LINE">
          {LINE_SETTINGS_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={`${TAB_BUTTON_BASE_CLASSES} ${view === v.id ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'MEMBERS' && (
        <>
          <LineMembersPanel />
          <DeliveryDriversPanel />
        </>
      )}
      {view === 'CONNECTION' && <ConnectionSection />}

      {view === 'NOTIFY' && (
      <div className={SETTINGS_SECTION}>
        <h4 className={SETTINGS_SECTION_TITLE}>
          <BellRing className="w-3.5 h-3.5 text-teal-600" />
          <span>แจ้งเตือนพนักงานทาง LINE</span>
        </h4>
        <p className={SETTINGS_HELPER}>
          เลือกว่าการแจ้งเตือนในระบบแบบไหนให้ส่งเข้า LINE ของพนักงานด้วย · ส่งถึงพนักงานที่ผูก LINE แล้วและมีสิทธิ์เมนูนั้น
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          {LINE_NOTIFY_EVENTS.map((ev) => (
            <label key={ev.type} className="flex items-start gap-2.5 py-1.5 cursor-pointer">
              <input
                type="checkbox"
                role="switch"
                aria-label={ev.label}
                checked={line.notify[ev.type] === true}
                onChange={(e) => {
                  const notify = { ...line.notify }
                  if (e.target.checked) notify[ev.type] = true
                  else delete notify[ev.type]
                  setLine({ notify })
                }}
                className="mt-0.5 w-4 h-4 text-teal-600 rounded"
              />
              <span>
                <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">{ev.label}</span>
                <span className={SETTINGS_HELPER}>{ev.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className={SETTINGS_HELPER}>
          ลูกค้า: ผูก LINE ผ่านแชตส่วนตัวกับ LINE ร้านเท่านั้น (ไม่รับในกลุ่ม) โดยกด &quot;สร้างรหัสผูก LINE&quot; ที่หน้าส่งบิลทาง LINE แล้วให้ลูกค้าส่งรหัสในแชตกับร้าน ใส่ LINE ID ของร้านที่แท็บกิจการเพื่อให้มี QR
        </p>
      </div>
      )}

      {view === 'TEMPLATES' && (
      <div className={SETTINGS_SECTION}>
        <h4 className={SETTINGS_SECTION_TITLE}>
          <MessageSquareText className="w-3.5 h-3.5 text-blue-600" />
          <span>ข้อความที่ส่งทาง LINE</span>
        </h4>
        <p className={SETTINGS_HELPER}>เว้นว่างไว้ = ใช้ข้อความมาตรฐาน · ใช้ได้เฉพาะตัวแปรในวงเล็บปีกกาที่แสดงใต้ช่อง</p>
        <div className="space-y-3 max-w-2xl">
          {LINE_EDITABLE_TEMPLATES.map(({ key, label }) => {
            const t = LINE_TEMPLATES[key]
            return (
              <div key={key}>
                <label className={SETTINGS_LABEL} htmlFor={`line-tpl-${key}`}>
                  {label}
                </label>
                <textarea
                  id={`line-tpl-${key}`}
                  rows={2}
                  maxLength={5000}
                  value={line.templates[key] ?? ''}
                  placeholder={t.text}
                  onChange={(e) => {
                    const templates = { ...line.templates }
                    if (e.target.value === '') delete templates[key]
                    else templates[key] = e.target.value
                    setLine({ templates })
                  }}
                  className={`${SETTINGS_INPUT} h-auto py-2`}
                />
                <p className={SETTINGS_HELPER}>
                  ตัวแปร: {t.vars.length ? t.vars.map((v) => `{${v}}`).join(' ') : 'ไม่มี'}
                </p>
              </div>
            )
          })}
        </div>
      </div>
      )}
    </>
  )
}
