'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, Link2Off, RefreshCw, UserRound } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { DataTableFrame } from '@/components/common/DataTableFrame'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { createMyLineLinkCode } from '@/app/actions/line'
import { SETTINGS_HELPER, SETTINGS_SECTION, SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'
import { StatusPill } from '@/features/settings/components/StatusPill'
import { LineContactInfo, LineInviteButton, type LineReviewContact } from '@/features/settings/components/LineInviteButton'
import { useUnlinkLineContact } from '@/features/settings/hooks/useUnlinkLineContact'

/**
 * Settings › LINE › เพิ่มข้อมูล: which staff (app users) have linked LINE. The OWNER sends an invite
 * link to a member's own LINE; a member may also issue a typed code for oneself. Unlink: oneself
 * or the OWNER. A link whose typed name did not match is flagged until someone checks it.
 */

interface Contact extends LineReviewContact {
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
    <StatusPill ok okText={`เชื่อมแล้ว${contact.display_name ? ` · ${contact.display_name}` : ''}`} noText="" />
  ) : (
    <StatusPill ok={false} okText="" noText="ยังไม่เชื่อม" />
  )
}

function CodeCell({ code, onCopy }: { code: IssuedCode; onCopy: (code: string) => void }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono font-extrabold tracking-wider text-slate-900 dark:text-slate-100" data-testid="line-code">
        {code.code}
      </span>
      <button type="button" onClick={() => onCopy(code.code)} aria-label="คัดลอกรหัส" className="p-1 rounded-lg text-slate-600 dark:text-slate-400 hover:text-blue-600 cursor-pointer">
        <Copy className="w-3.5 h-3.5" />
      </button>
      <span className="text-[10px] text-slate-600 dark:text-slate-400">
        หมดอายุ {new Date(code.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
      </span>
    </span>
  )
}

export function LineMembersPanel() {
  const { showToast } = useToast()
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
    try {
      const supabase = createClient()
      const [c, p] = await Promise.all([
        supabase
          .from('line_contacts')
          .select('id, display_name, profile_id, customer_id, typed_name, typed_phone, line_handle, needs_review')
          .eq('status', 'LINKED'),
        // Every member opens this tab (owner 2026-10-26): names only, through member_directory().
        supabase.rpc('member_directory'),
      ])
      // Report the first failure with its own message; never keep the old rows on a failed read.
      if (c.error) {
        setLoadError('ระบบ LINE ยังไม่พร้อมในฐานข้อมูลนี้ จึงยังไม่เห็นสถานะการเชื่อม')
        setContacts([])
      } else {
        setContacts((c.data as Contact[] | null) ?? [])
      }
      if (p.error) {
        setLoadError((prev) => prev ?? p.error.message ?? 'โหลดรายชื่อพนักงานไม่สำเร็จ')
        setStaff([])
      } else {
        setStaff((p.data as Staff[] | null) ?? [])
      }
    } catch (e: unknown) {
      // A rejected client / network call must not leave the panel spinning forever.
      setLoadError(e instanceof Error ? e.message : 'โหลดรายชื่อพนักงานไม่สำเร็จ')
      setContacts([])
      setStaff([])
    } finally {
      setLoading(false)
    }
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

  const unlinkContact = useUnlinkLineContact(() => load())

  const unlink = async (rowKey: string, contact: Contact, name: string) => {
    setBusyId(rowKey)
    try {
      await unlinkContact(
        contact.id,
        name,
        'ข้อความที่ยังไม่ส่งถึงคนนี้จะถูกยกเลิก และต้องออกรหัสใหม่เพื่อเชื่อมอีกครั้ง'
      )
    } finally {
      setBusyId(null)
    }
  }

  const unlinkButton = (rowKey: string, contact: Contact, name: string) => (
    <button
      type="button"
      disabled={busyId === rowKey}
      onClick={() => void unlink(rowKey, contact, name)}
      className={`${BTN} text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 inline-flex items-center gap-1`}
    >
      <Link2Off className="w-3.5 h-3.5" />
      ยกเลิกการเชื่อม
    </button>
  )

  return (
    <div className={SETTINGS_SECTION}>
      <div className="flex items-center justify-between gap-2">
        <p className={SETTINGS_HELPER}>
          เจ้าของร้านกด &quot;ส่งลิงก์ผูก LINE&quot; แล้วส่งเข้า LINE ส่วนตัวของพนักงาน · หรือพนักงานออกรหัสของตัวเองแล้วพิมพ์ในแชต LINE ร้าน · ลิงก์และรหัสใช้ได้ครั้งเดียว
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="รีเฟรชสถานะ LINE"
          className="h-8 w-8 shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 inline-flex items-center justify-center text-slate-600 dark:text-slate-400 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {loadError && <p className="text-[11px] text-amber-700 dark:text-amber-300">{loadError}</p>}

      <h4 className={SETTINGS_SECTION_TITLE}>
        <UserRound className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
        <span>พนักงานที่ใช้ระบบ</span>
      </h4>
      <DataTableFrame
        rowCount={staff.length}
        empty={staff.length === 0}
        emptyState={<p className="py-6 text-center text-slate-600 dark:text-slate-400">{loading ? 'กำลังโหลด…' : 'ไม่พบรายชื่อพนักงาน'}</p>}
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
                  <td className={`${TD} text-center text-slate-600 dark:text-slate-400`}>{idx + 1}</td>
                  <td className={`${TD} font-semibold text-slate-800 dark:text-slate-200`}>
                    {name}
                    {self && <span className="ml-1 text-[10px] text-blue-600 dark:text-blue-400">(คุณ)</span>}
                  </td>
                  <td className={`${TD} font-mono text-slate-600 dark:text-slate-400`}>{s.username || '-'}</td>
                  <td className={TD}>
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <LinkCell contact={contact} />
                      {contact && <LineContactInfo contact={contact} onChanged={() => void load()} />}
                    </span>
                  </td>
                  <td className={`${TD} text-right`}>
                    {contact ? (
                      unlinkButton(key, contact, name)
                    ) : codes[key] ? (
                      <CodeCell code={codes[key]} onCopy={copy} />
                    ) : self ? (
                      <button
                        type="button"
                        disabled={busyId === key || Boolean(loadError)}
                        onClick={() => void issue(key, () => createMyLineLinkCode())}
                        className={`${BTN} text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40`}
                      >
                        ออกรหัสของฉัน
                      </button>
                    ) : (
                      <LineInviteButton kind="STAFF" target={s.id} name={name} disabled={Boolean(loadError)} />
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
