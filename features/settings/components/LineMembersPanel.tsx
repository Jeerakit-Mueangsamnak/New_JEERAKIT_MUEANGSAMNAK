'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, Link2Off, RefreshCw, UserRound } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { useAskText } from '@/components/common/ConfirmDialogProvider'
import { DataTableFrame } from '@/components/common/DataTableFrame'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { createMyLineLinkCode, unlinkLineContact } from '@/app/actions/line'
import { SETTINGS_HELPER, SETTINGS_SECTION, SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'

/**
 * Settings › LINE › เพิ่มข้อมูล: which staff (app users) have linked LINE. A staff code is only for
 * oneself (the database refuses a code for another member); unlink: oneself or the OWNER.
 * Customers link from the customer form (CustomerLineLink).
 */

interface Contact {
  id: string
  display_name: string | null
  profile_id: string | null
  customer_id: string | null
}
interface Staff {
  id: string
  display_name: string | null
  username: string | null
}
interface IssuedCode {
  code: string
  expiresAt: string
}

const BTN = 'px-2 py-1 rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap'
const TH = 'px-2'
const TD = 'px-2'

function LinkCell({ contact }: { contact?: Contact }) {
  return contact ? (
    <span className="inline-flex items-center h-6 px-2 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
      เชื่อมแล้ว{contact.display_name ? ` · ${contact.display_name}` : ''}
    </span>
  ) : (
    <span className="inline-flex items-center h-6 px-2 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
      ยังไม่เชื่อม
    </span>
  )
}

function CodeCell({ code, onCopy }: { code: IssuedCode; onCopy: (code: string) => void }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono font-extrabold tracking-wider text-slate-900 dark:text-slate-100" data-testid="line-code">
        {code.code}
      </span>
      <button type="button" onClick={() => onCopy(code.code)} aria-label="คัดลอกรหัส" className="p-1 rounded-lg text-slate-400 hover:text-blue-600 cursor-pointer">
        <Copy className="w-3.5 h-3.5" />
      </button>
      <span className="text-[10px] text-slate-500">
        หมดอายุ {new Date(code.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
      </span>
    </span>
  )
}

export function LineMembersPanel() {
  const { showToast } = useToast()
  const askText = useAskText()
  const { user } = useAuth()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [codes, setCodes] = useState<Record<string, IssuedCode>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const supabase = createClient()
    const [c, p] = await Promise.all([
      supabase.from('line_contacts').select('id, display_name, profile_id, customer_id').eq('status', 'LINKED'),
      supabase.from('profiles').select('id, display_name, username').order('display_name'),
    ])
    if (c.error) setLoadError('ระบบ LINE ยังไม่พร้อมในฐานข้อมูลนี้ จึงยังไม่เห็นสถานะการเชื่อม')
    setContacts((c.data as Contact[] | null) ?? [])
    setStaff((p.data as Staff[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const byProfile = new Map(contacts.filter((c) => c.profile_id).map((c) => [c.profile_id as string, c]))

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      showToast('คัดลอกรหัสแล้ว', 'ให้ส่งรหัสนี้ในแชตกับ LINE ร้าน', 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }

  const issue = async (rowKey: string, run: () => ReturnType<typeof createMyLineLinkCode>) => {
    setBusyId(rowKey)
    try {
      const r = await run()
      if (!r.success || !r.data) {
        showToast('สร้างรหัสไม่สำเร็จ', r.error || 'เกิดข้อผิดพลาด', 'ERROR')
        return
      }
      setCodes((prev) => ({ ...prev, [rowKey]: { code: r.data!.code, expiresAt: r.data!.expires_at } }))
    } finally {
      setBusyId(null)
    }
  }

  const unlink = async (rowKey: string, contact: Contact, name: string, self: boolean) => {
    const reason = await askText({
      title: `ยกเลิกการเชื่อม LINE: ${name}`,
      message: 'ข้อความที่ยังไม่ส่งถึงคนนี้จะถูกยกเลิก และต้องออกรหัสใหม่เพื่อเชื่อมอีกครั้ง',
      placeholder: self ? 'เหตุผล (ไม่บังคับ)' : 'เหตุผล เช่น ผูกผิดคน',
      confirmLabel: 'ยกเลิกการเชื่อม',
      danger: true,
    })
    if (reason === null || (!self && !reason.trim())) return
    setBusyId(rowKey)
    try {
      const r = await unlinkLineContact(contact.id, reason)
      if (!r.success) {
        showToast('ยกเลิกไม่สำเร็จ', r.error || 'เกิดข้อผิดพลาด', 'ERROR')
        return
      }
      showToast('ยกเลิกการเชื่อมแล้ว', name, 'SUCCESS')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const unlinkButton = (rowKey: string, contact: Contact, name: string, self: boolean) => (
    <button
      type="button"
      disabled={busyId === rowKey}
      onClick={() => void unlink(rowKey, contact, name, self)}
      className={`${BTN} text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 inline-flex items-center gap-1`}
    >
      <Link2Off className="w-3.5 h-3.5" />
      ยกเลิกการเชื่อม
    </button>
  )

  return (
    <div className={SETTINGS_SECTION}>
      <div className="flex items-center justify-between gap-2">
        <p className={SETTINGS_HELPER}>
          พนักงานแต่ละคนกดออกรหัสของตัวเอง แล้วส่งรหัสในแชตส่วนตัวกับ LINE ร้าน · รหัสใช้ได้ครั้งเดียวและหมดอายุ · ลูกค้าเชื่อม LINE ได้ที่ฟอร์มข้อมูลลูกค้า
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="รีเฟรชสถานะ LINE"
          className="h-8 w-8 shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 inline-flex items-center justify-center text-slate-500 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {loadError && <p className="text-[11px] text-amber-700 dark:text-amber-300">{loadError}</p>}

      <h4 className={SETTINGS_SECTION_TITLE}>
        <UserRound className="w-3.5 h-3.5 text-blue-600" />
        <span>พนักงานที่ใช้ระบบ</span>
      </h4>
      <DataTableFrame
        rowCount={staff.length}
        empty={staff.length === 0}
        emptyState={<p className="py-6 text-center text-slate-400">{loading ? 'กำลังโหลด…' : 'ไม่พบรายชื่อพนักงาน'}</p>}
      >
        <table className="w-full text-left border-collapse table-auto text-xs" aria-label="ตารางพนักงาน LINE">
          <thead>
            <tr>
              <th className={`${TH} w-10 text-center`}>ลำดับ</th>
              <th className={TH}>พนักงาน</th>
              <th className={TH}>ชื่อผู้ใช้</th>
              <th className={TH}>LINE</th>
              <th className={`${TH} text-right`}>จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {staff.map((s, idx) => {
              const key = `p:${s.id}`
              const contact = byProfile.get(s.id)
              const self = s.id === user?.id
              const name = s.display_name || s.username || '-'
              return (
                <tr key={s.id}>
                  <td className={`${TD} text-center text-slate-500`}>{idx + 1}</td>
                  <td className={`${TD} font-semibold text-slate-800 dark:text-slate-200`}>
                    {name}
                    {self && <span className="ml-1 text-[10px] text-blue-600">(คุณ)</span>}
                  </td>
                  <td className={`${TD} font-mono text-slate-500`}>{s.username || '-'}</td>
                  <td className={TD}>
                    <LinkCell contact={contact} />
                  </td>
                  <td className={`${TD} text-right`}>
                    {contact ? (
                      (self || user?.role === 'OWNER') && unlinkButton(key, contact, name, self)
                    ) : codes[key] ? (
                      <CodeCell code={codes[key]} onCopy={copy} />
                    ) : self ? (
                      <button
                        type="button"
                        disabled={busyId === key || Boolean(loadError)}
                        onClick={() => void issue(key, () => createMyLineLinkCode())}
                        className={`${BTN} text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40`}
                      >
                        ออกรหัสของฉัน
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400">ให้พนักงานออกรหัสเอง</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DataTableFrame>
    </div>
  )
}
