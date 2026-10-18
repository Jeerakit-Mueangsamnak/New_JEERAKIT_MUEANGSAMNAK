'use client'

/**
 * Settings › LINE: the driver list (ทะเบียนคนขับ). Drivers are not app users; each gets a code
 * (D001, …) used when an appointment is dispatched. Changes save at once (OWNER).
 * LINE for drivers is optional: a driver without LINE is still dispatched and the office
 * contacts them by phone. To link, the OWNER makes a single-use code for one driver code and the
 * driver sends it from their own LINE in the shop chat (one driver code = one LINE).
 */
import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Link2Off, Pencil, Plus, Truck } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { useAskText } from '@/components/common/ConfirmDialogProvider'
import { createClient } from '@/lib/supabase/client'
import { createDriverLineLinkCode, unlinkLineContact } from '@/app/actions/line'
import {
  loadDrivers,
  nextDriverId,
  saveDrivers,
  type DeliveryDriver,
} from '@/features/appointments/services/driver-registry'
import {
  SETTINGS_HELPER,
  SETTINGS_INPUT,
  SETTINGS_LABEL,
  SETTINGS_SECTION,
  SETTINGS_SECTION_TITLE,
} from '@/features/settings/components/settings-ui'

interface DriverContact {
  id: string
  display_name: string | null
  driver_code: string
}
interface IssuedCode {
  code: string
  expiresAt: string
  qr: string | null
}

export function DeliveryDriversPanel() {
  const { showToast } = useToast()
  const askText = useAskText()
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
      .select('id, display_name, driver_code')
      .eq('status', 'LINKED')
      .not('driver_code', 'is', null)
    setLineReady(!error)
    setContacts(Object.fromEntries(((data as DriverContact[] | null) ?? []).map((c) => [c.driver_code, c])))
  }, [])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  const issueCode = async (d: DeliveryDriver) => {
    setLineBusy(d.id)
    try {
      const r = await createDriverLineLinkCode(d.id)
      if (!r.success || !r.data) {
        showToast('สร้างรหัสไม่สำเร็จ', r.error || 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
        return
      }
      const qr = r.data.oaUrl ? await QRCode.toDataURL(r.data.oaUrl, { margin: 1, width: 160 }).catch(() => null) : null
      setCodes((prev) => ({ ...prev, [d.id]: { code: r.data!.code, expiresAt: r.data!.expires_at, qr } }))
    } finally {
      setLineBusy(null)
    }
  }

  const unlink = async (d: DeliveryDriver, contact: DriverContact) => {
    const reason = await askText({
      title: `ยกเลิกการเชื่อม LINE: ${d.name}`,
      message: 'งานที่ยังไม่ส่งถึงคนขับคนนี้จะถูกยกเลิก และต้องออกรหัสใหม่เพื่อเชื่อมอีกครั้ง',
      placeholder: 'เหตุผล เช่น เปลี่ยนเครื่อง / ผูกผิดคน',
      confirmLabel: 'ยกเลิกการเชื่อม',
      danger: true,
    })
    if (!reason?.trim()) return
    setLineBusy(d.id)
    try {
      const r = await unlinkLineContact(contact.id, reason)
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

  const lineCell = (d: DeliveryDriver) => {
    const contact = contacts[d.id]
    const code = codes[d.id]
    if (contact) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-emerald-700 dark:text-emerald-300 font-semibold">เชื่อมแล้ว{contact.display_name ? ` · ${contact.display_name}` : ''}</span>
          <button
            type="button"
            disabled={lineBusy === d.id}
            onClick={() => void unlink(d, contact)}
            aria-label={`ยกเลิกการเชื่อม LINE ${d.id}`}
            className="p-1 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
          >
            <Link2Off className="w-3.5 h-3.5" />
          </button>
        </span>
      )
    }
    if (code) {
      return (
        <span className="inline-flex items-center gap-2">
          {code.qr && <img src={code.qr} alt={`QR เชื่อม LINE ${d.id}`} className="w-16 h-16 rounded bg-white p-0.5" />}
          <span>
            <span className="block font-mono font-extrabold tracking-wider text-slate-900 dark:text-slate-100" data-testid="driver-line-code">
              {code.code}
            </span>
            <span className="block text-[10px] text-slate-500">
              ให้คนขับส่งรหัสนี้ในแชต LINE ร้าน · หมดอายุ{' '}
              {new Date(code.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
            </span>
          </span>
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
        ยังไม่ผูก
        {d.active && lineReady && (
          <button
            type="button"
            disabled={lineBusy === d.id}
            onClick={() => void issueCode(d)}
            className="px-2 py-1 rounded-lg text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer disabled:opacity-50"
          >
            ออกรหัสเชื่อม LINE
          </button>
        )}
      </span>
    )
  }

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setPhone('')
  }

  const persist = async (next: DeliveryDriver[], reason: string, done: string) => {
    setSaving(true)
    try {
      setDrivers(await saveDrivers(next, reason))
      showToast(done, undefined, 'SUCCESS')
      resetForm()
    } catch (err) {
      showToast('บันทึกทะเบียนคนขับไม่สำเร็จ', err instanceof Error ? err.message : 'ต้องเป็นเจ้าของร้าน', 'ERROR')
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
      const id = nextDriverId(drivers)
      void persist([...drivers, { id, name: n, phone: phone.trim() || undefined, active: true }], `เพิ่มคนขับ ${id}`, `เพิ่มคนขับ ${id} แล้ว`)
    }
  }

  const toggleActive = (d: DeliveryDriver) =>
    void persist(
      drivers.map((x) => (x.id === d.id ? { ...x, active: !x.active } : x)),
      `${d.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}คนขับ ${d.id}`,
      d.active ? `ปิดใช้งาน ${d.name} แล้ว` : `เปิดใช้งาน ${d.name} แล้ว`
    )

  return (
    <div className={SETTINGS_SECTION}>
      <h4 className={SETTINGS_SECTION_TITLE}>
        <Truck className="w-3.5 h-3.5 text-blue-600" />
        <span>พนักงานส่งของ (คนขับ)</span>
      </h4>
      <p className={SETTINGS_HELPER}>
        ใช้เพิ่มพนักงานส่งของที่ไม่ต้องเข้าใช้ระบบ · ระบบออกรหัสให้เอง (D001, D002, …) และรายชื่อนี้จะขึ้นในช่องเลือกคนขับตอนกดสั่งงานในเมนูนัดหมาย · บันทึกทันทีเมื่อกดปุ่ม
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end max-w-2xl">
        <div>
          <label className={SETTINGS_LABEL} htmlFor="driver-name">
            ชื่อ-นามสกุลพนักงานส่งของ {editingId && <span className="text-blue-600">(กำลังแก้ {editingId})</span>}
          </label>
          <input id="driver-name" className={SETTINGS_INPUT} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="เช่น สมชาย" />
        </div>
        <div>
          <label className={SETTINGS_LABEL} htmlFor="driver-phone">
            เบอร์โทร (ไม่บังคับ)
          </label>
          <input id="driver-phone" className={SETTINGS_INPUT} value={phone} maxLength={20} inputMode="tel" onChange={(e) => setPhone(e.target.value)} placeholder="08x-xxx-xxxx" />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="h-9 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            {editingId ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {editingId ? 'บันทึกการแก้ไข' : 'เพิ่มพนักงานส่งของ'}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
              ยกเลิก
            </button>
          )}
        </div>
      </form>

      {!lineReady && <p className="text-[11px] text-amber-700 dark:text-amber-300">ระบบ LINE ยังไม่พร้อมในฐานข้อมูลนี้ จึงยังผูก LINE คนขับไม่ได้</p>}
      {drivers.length === 0 ? (
        <p className={SETTINGS_HELPER}>ยังไม่มีพนักงานส่งของ</p>
      ) : (
        <div className="overflow-x-auto max-w-3xl">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-1.5 pr-2 font-semibold">รหัส</th>
                <th className="py-1.5 pr-2 font-semibold">ชื่อ</th>
                <th className="py-1.5 pr-2 font-semibold">เบอร์โทร</th>
                <th className="py-1.5 pr-2 font-semibold">LINE</th>
                <th className="py-1.5 pr-2 font-semibold">สถานะ</th>
                <th className="py-1.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.id} className={`border-b border-slate-100 dark:border-slate-800 ${d.active ? '' : 'opacity-60'}`}>
                  <td className="py-1.5 pr-2 font-mono font-bold">{d.id}</td>
                  <td className="py-1.5 pr-2 font-semibold text-slate-800 dark:text-slate-200">{d.name}</td>
                  <td className="py-1.5 pr-2 font-mono">{d.phone || '-'}</td>
                  <td className="py-1.5 pr-2">{lineCell(d)}</td>
                  <td className="py-1.5 pr-2">{d.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setEditingId(d.id)
                        setName(d.name)
                        setPhone(d.phone || '')
                      }}
                      className="px-2 py-1 rounded-lg text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => toggleActive(d)}
                      className="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {d.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
