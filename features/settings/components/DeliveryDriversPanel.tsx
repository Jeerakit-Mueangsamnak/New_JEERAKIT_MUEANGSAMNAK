'use client'
import { COMMAND_BUTTON_SIZE_CLASSES, TABLE_TOOLBAR_CLASSES } from '@/components/common/ActionButton'

/**
 * Settings › LINE: the driver list (ทะเบียนคนขับ). Drivers are not app users; each gets a code
 * (D001, …) used when an appointment is dispatched. Changes save at once (OWNER).
 * LINE for drivers is optional: a driver without LINE is still dispatched and the office
 * contacts them by phone. To link, the shop makes a single-use link for one driver code (QR at the
 * shop, or the link sent to the driver); it opens the shop chat with the code typed in and one send
 * links that LINE (one driver code = one LINE). Shown on คนใน LINE (/line).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import Image from 'next/image'
import { Copy, Link2Off, Pencil, Plus, RefreshCw, Truck } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { useDataActions } from '@/components/common/useDataActions'
import { createClient } from '@/lib/supabase/client'
import { DbError } from '@/lib/db/rpc'
import { loadAppointments } from '@/features/appointments/services/appointment-storage'
import { createDriverLineLinkCode, unlinkLineContact } from '@/app/actions/line'
import { LineContactInfo, type LineReviewContact } from '@/features/settings/components/LineInviteButton'
import {
  loadDrivers,
  nextDriverId,
  saveDrivers,
  type DeliveryDriver,
} from '@/features/appointments/services/driver-registry'
import { SETTINGS_HELPER, SETTINGS_INPUT } from '@/features/settings/components/settings-ui'
import { DataTableFrame, DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES } from '@/components/common/DataTableFrame'

interface DriverContact extends LineReviewContact {
  driver_code: string
}
interface IssuedCode {
  code: string
  expiresAt: string
  oaUrl: string | null
  qr: string | null
}

function leftText(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} นาที` : 'หมดอายุแล้ว'
}

const PILL = 'inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold whitespace-nowrap'

/** `tabs`: the page tab bar, shown first in the toolbar row before the add-driver fields. */
export function DeliveryDriversPanel({ tabs }: { tabs?: ReactNode }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { confirmSuspend, deleteOrSuspend } = useDataActions()
  const [now, setNow] = useState(() => Date.now())
  const [contacts, setContacts] = useState<Record<string, DriverContact>>({})
  const [lineReady, setLineReady] = useState(true)
  const [codes, setCodes] = useState<Record<string, IssuedCode>>({})
  const [lineBusy, setLineBusy] = useState<string | null>(null)
  const [drivers, setDrivers] = useState<DeliveryDriver[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDrivers(loadDrivers())
    const reload = () => setDrivers(loadDrivers())
    window.addEventListener('app-storage-update', reload)
    return () => window.removeEventListener('app-storage-update', reload)
  }, [])

  const loadContacts = useCallback(async () => {
    const { data, error } = await createClient()
      .from('line_contacts')
      .select('id, display_name, driver_code, typed_name, typed_phone, line_handle, needs_review')
      .eq('status', 'LINKED')
      .not('driver_code', 'is', null)
    setLineReady(!error)
    setContacts(Object.fromEntries(((data as DriverContact[] | null) ?? []).map((c) => [c.driver_code, c])))
  }, [])

  useEffect(() => {
    void loadContacts()
    // a driver who presses the link elsewhere shows up when the shop comes back to this screen
    const onFocus = () => void loadContacts()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadContacts])

  const hasCodes = Object.keys(codes).length > 0
  useEffect(() => {
    if (!hasCodes) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [hasCodes])

  const issueCode = async (driverId: string) => {
    setLineBusy(driverId)
    try {
      const r = await createDriverLineLinkCode(driverId)
      if (!r.success || !r.data) {
        showToast('สร้างลิงก์ไม่สำเร็จ', r.error || 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
        return
      }
      const qr = r.data.oaUrl ? await QRCode.toDataURL(r.data.oaUrl, { margin: 1, width: 160 }).catch(() => null) : null
      setNow(Date.now())
      setCodes((prev) => ({ ...prev, [driverId]: { code: r.data!.code, expiresAt: r.data!.expires_at, oaUrl: r.data!.oaUrl, qr } }))
    } finally {
      setLineBusy(null)
    }
  }

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link)
      showToast('คัดลอกลิงก์แล้ว', 'ส่งลิงก์นี้ให้พนักงานส่งของกดจากมือถือ', 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }

  const unlink = async (d: DeliveryDriver, contact: DriverContact) => {
    const ok = await confirm({
      title: `ยกเลิกการผูก LINE: ${d.name}`,
      message: 'งานที่ยังไม่ส่งถึงพนักงานคนนี้จะถูกยกเลิก และต้องสร้างลิงก์ใหม่เพื่อผูกอีกครั้ง',
      confirmLabel: 'ยกเลิกการผูก',
      danger: true,
    })
    if (!ok) return
    setLineBusy(d.id)
    try {
      const r = await unlinkLineContact(contact.id)
      if (!r.success) {
        showToast('ยกเลิกไม่สำเร็จ', r.error || 'เกิดข้อผิดพลาด', 'ERROR')
        return
      }
      showToast('ยกเลิกการเชื่อมแล้ว', d.name, 'SUCCESS')
      await loadContacts()
    } finally {
      setLineBusy(null)
    }
  }

  const statusPill = (d: DeliveryDriver) =>
    contacts[d.id] ? (
      <span className={`${PILL} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300`}>ผูก LINE แล้ว</span>
    ) : codes[d.id] ? (
      <span className={`${PILL} bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300`}>รอกดลิงก์</span>
    ) : (
      <span className={`${PILL} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300`}>ยังไม่ผูก</span>
    )

  const lineCell = (d: DeliveryDriver) => {
    const contact = contacts[d.id]
    const code = codes[d.id]
    if (contact) {
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {contact.display_name && <span className="text-slate-700 dark:text-slate-300">LINE &quot;{contact.display_name}&quot;</span>}
          <LineContactInfo contact={contact} onChanged={() => void loadContacts()} />
          <button
            type="button"
            disabled={lineBusy === d.id}
            onClick={() => void unlink(d, contact)}
            className={`${COMMAND_BUTTON_SIZE_CLASSES} inline-flex items-center text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer`}
          >
            <Link2Off className="w-3.5 h-3.5" /> ยกเลิกการผูก
          </button>
        </span>
      )
    }
    if (code) {
      const left = new Date(code.expiresAt).getTime() - now
      return (
        <span className="flex flex-wrap items-start gap-2" data-testid="driver-line-link">
          {code.qr && (
            <Image unoptimized width={88} height={88} src={code.qr} alt={`QR ลิงก์ผูก LINE ของ${d.name}`} className="w-[88px] h-[88px] rounded bg-white p-0.5" />
          )}
          <span className="min-w-0 space-y-1">
            <span className="block text-[11px] text-slate-600 dark:text-slate-400">
              ลิงก์ผูก LINE ของ{d.name} (รหัส{' '}
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100" data-testid="driver-line-code">
                {code.code}
              </span>
              )
            </span>
            {code.oaUrl ? (
              <span className="block font-mono text-[10px] text-slate-500 dark:text-slate-400 break-all">{code.oaUrl}</span>
            ) : (
              <span className="block text-[10px] text-amber-700 dark:text-amber-300">
                ใส่ LINE ID ร้านที่ ตั้งค่า › กิจการ เพื่อให้มี QR และลิงก์ · ระหว่างนี้ให้พิมพ์รหัสในแชต LINE ร้าน
              </span>
            )}
            <span className={`block text-[11px] ${left > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-400'}`}>
              {left > 0 ? (
                <>
                  รอกดลิงก์ ใช้ได้ครั้งเดียว หมดอายุใน <b className="tabular-nums">{leftText(left)}</b>
                </>
              ) : (
                'ลิงก์หมดอายุแล้ว'
              )}
            </span>
            <span className="flex flex-wrap gap-1">
              {code.oaUrl && (
                <button
                  type="button"
                  onClick={() => void copyLink(code.oaUrl as string)}
                  className={`${COMMAND_BUTTON_SIZE_CLASSES} inline-flex items-center border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer`}
                >
                  <Copy className="w-3 h-3" /> คัดลอกลิงก์
                </button>
              )}
              <button
                type="button"
                disabled={lineBusy === d.id}
                onClick={() => void issueCode(d.id)}
                className={`${COMMAND_BUTTON_SIZE_CLASSES} inline-flex items-center border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer disabled:opacity-50`}
              >
                <RefreshCw className="w-3 h-3" /> สร้างลิงก์ใหม่
              </button>
            </span>
          </span>
        </span>
      )
    }
    return d.active && lineReady ? (
      <button
        type="button"
        disabled={lineBusy === d.id}
        onClick={() => void issueCode(d.id)}
        className={`${COMMAND_BUTTON_SIZE_CLASSES} text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer disabled:opacity-50`}
      >
        สร้างลิงก์
      </button>
    ) : (
      <span className="text-slate-600 dark:text-slate-400">-</span>
    )
  }

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setPhone('')
  }

  const persist = async (next: DeliveryDriver[], reason: string, done: string): Promise<boolean> => {
    setSaving(true)
    try {
      setDrivers(await saveDrivers(next, reason))
      showToast(done, undefined, 'SUCCESS')
      resetForm()
      return true
    } catch (err) {
      showToast('บันทึกทะเบียนคนขับไม่สำเร็จ', err instanceof Error ? err.message : 'ต้องเป็นเจ้าของร้าน', 'ERROR')
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) {
      showToast('กรุณาใส่ชื่อพนักงานส่งของ', undefined, 'ERROR')
      return
    }
    if (editingId) {
      void persist(
        drivers.map((d) => (d.id === editingId ? { ...d, name: n, phone: phone.trim() || undefined } : d)),
        `แก้ข้อมูลคนขับ ${editingId}`,
        'แก้ข้อมูลคนขับแล้ว'
      )
    } else {
      // บันทึกและสร้างลิงก์: the new driver gets their link at once
      const id = nextDriverId(drivers)
      void persist([...drivers, { id, name: n, phone: phone.trim() || undefined, active: true }], `เพิ่มคนขับ ${id}`, `เพิ่มคนขับ ${id} แล้ว`).then(
        (ok) => (ok && lineReady ? issueCode(id) : undefined)
      )
    }
  }

  const setActive = (d: DeliveryDriver, active: boolean) =>
    persist(
      drivers.map((x) => (x.id === d.id ? { ...x, active } : x)),
      `${active ? 'เปิดใช้งาน' : 'ระงับ'}คนขับ ${d.id}`,
      active ? `เปิดใช้งาน ${d.name} แล้ว` : `ระงับการใช้งาน ${d.name} แล้ว`
    )

  const toggleActive = async (d: DeliveryDriver) => {
    if (d.active && !(await confirmSuspend(`พนักงานส่งของ "${d.name}" (${d.id})`))) return
    await setActive(d, !d.active)
  }

  // Drivers live in the shop settings, so the dependency check is here: appointments sent to the driver,
  // LINE tasks for the driver, and a linked LINE. Any of them = used (ระงับ instead of ลบ).
  const driverUses = async (d: DeliveryDriver): Promise<number> => {
    const appointments = loadAppointments().filter((a) => a.driverId === d.id).length
    const { count, error } = await createClient()
      .from('line_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('driver_code', d.id)
    if (error && lineReady) throw new Error('ตรวจสอบประวัติงานของพนักงานไม่สำเร็จ กรุณาลองใหม่')
    return appointments + (count ?? 0) + (contacts[d.id] ? 1 : 0)
  }

  const removeDriver = async (d: DeliveryDriver) => {
    try {
      await deleteOrSuspend({
        name: `พนักงานส่งของ "${d.name}" (${d.id})`,
        remove: async () => {
          const uses = await driverUses(d)
          if (uses > 0) throw new DbError(`DRIVER_IN_USE: ${uses}`)
          if (!(await persist(drivers.filter((x) => x.id !== d.id), `ลบคนขับ ${d.id}`, `ลบ ${d.name} แล้ว`))) {
            throw new Error('ลบพนักงานส่งของไม่สำเร็จ')
          }
        },
        suspend: d.active ? () => setActive(d, false) : undefined,
      })
    } catch (err) {
      showToast('ลบพนักงานส่งของไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด', 'ERROR')
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Toolbar: the page tabs, then add / edit a driver in the same row */}
      <div className={`${TABLE_TOOLBAR_CLASSES} flex flex-wrap items-center`}>
        {tabs}
        <form onSubmit={handleSubmit} className="flex-1 min-w-[min(100%,26rem)] flex items-center gap-2">
          <input
            id="driver-name"
            aria-label="ชื่อ-นามสกุลพนักงานส่งของ"
            className={`${SETTINGS_INPUT} flex-1 min-w-0`}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder="ชื่อ-นามสกุลพนักงานส่งของ"
          />
          <input
            id="driver-phone"
            aria-label="เบอร์โทร (ไม่บังคับ)"
            className={`${SETTINGS_INPUT} flex-1 min-w-0`}
            value={phone}
            maxLength={20}
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
            placeholder="เบอร์โทร (ไม่บังคับ)"
          />
          <button
            type="submit"
            disabled={saving}
            className={`${COMMAND_BUTTON_SIZE_CLASSES} shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white flex items-center cursor-pointer`}
          >
            {editingId ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {editingId ? 'บันทึกการแก้ไข' : lineReady ? 'บันทึกและสร้างลิงก์' : 'เพิ่มพนักงานส่งของ'}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className={`${COMMAND_BUTTON_SIZE_CLASSES} shrink-0 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer`}>
              ยกเลิก
            </button>
          )}
        </form>
        {!lineReady && <p className="basis-full text-[11px] text-amber-700 dark:text-amber-300">ระบบ LINE ยังไม่พร้อมในฐานข้อมูลนี้ จึงยังผูก LINE คนขับไม่ได้</p>}
      </div>

      <DataTableFrame
        fill
        rowCount={drivers.length}
        className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent"
      >
        <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`}>
          <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
            <tr>
              <th className={`px-3 ${DATA_TABLE_TH_CLASSES}`}>รหัส</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>ชื่อ</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>เบอร์โทร</th>
              <th className={`px-2 ${DATA_TABLE_TH_CLASSES}`}>LINE</th>
              <th className={`px-2 text-center ${DATA_TABLE_TH_CLASSES}`}>สถานะ</th>
              <th className={`px-3 text-right ${DATA_TABLE_TH_CLASSES}`}>จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {drivers.map((d) => (
              <tr key={d.id} className={`hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors ${d.active ? '' : 'opacity-60'}`}>
                <td className="px-3 py-2 font-mono font-bold text-blue-600 dark:text-blue-400">{d.id}</td>
                <td className="px-2 py-2 font-bold text-slate-900 dark:text-slate-100">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {d.name}
                    {d.active && statusPill(d)}
                  </span>
                </td>
                <td className="px-2 py-2 tabular-nums text-slate-600 dark:text-slate-400">{d.phone || '-'}</td>
                <td className="px-2 py-2">{lineCell(d)}</td>
                <td className="px-2 py-2 text-center">
                  <span className={`${PILL} ${d.active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                    {d.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setEditingId(d.id)
                      setName(d.name)
                      setPhone(d.phone || '')
                    }}
                    className={`${COMMAND_BUTTON_SIZE_CLASSES} text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer`}
                  >
                    แก้ไข
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void toggleActive(d)}
                    className={`${COMMAND_BUTTON_SIZE_CLASSES} text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer`}
                  >
                    {d.active ? 'ระงับ' : 'เปิดใช้งาน'}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void removeDriver(d)}
                    className={`${COMMAND_BUTTON_SIZE_CLASSES} text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer`}
                  >
                    ลบ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableFrame>
    </div>
  )
}
