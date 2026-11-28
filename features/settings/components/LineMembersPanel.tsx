'use client'
import { ActionButton, ROW_ICON_BUTTON_CLASSES, TABLE_TOOLBAR_CLASSES } from '@/components/common/ActionButton'

import { useCallback, useState, type ReactNode } from 'react'
import { Copy, Link2Off, QrCode } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { DataTableFrame, DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DATA_TABLE_THEAD_CLASSES } from '@/components/common/DataTableFrame'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { createMyLineLinkCode } from '@/app/actions/line'
import { StatusPill } from '@/features/settings/components/StatusPill'
import { LineContactInfo, LineInviteButton, type LineReviewContact } from '@/features/settings/components/LineInviteButton'
import { useUnlinkLineContact } from '@/features/settings/hooks/useUnlinkLineContact'
import { useAutoRefresh } from '@/features/settings/hooks/useAutoRefresh'
import { StaffQrModal } from '@/features/settings/components/line/StaffQrModal'

/**
 * LINE › คนใน LINE › พนักงานร้าน: which staff (app users) have linked LINE. The OWNER sends an invite
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

const TH = `px-2 ${DATA_TABLE_TH_CLASSES}`
const TD = 'px-2 py-2'

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
      <button type="button" onClick={() => onCopy(code.code)} aria-label="คัดลอกรหัส" className={`${ROW_ICON_BUTTON_CLASSES} text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700`}>
        <Copy className="w-3.5 h-3.5" />
      </button>
      <span className="text-[10px] text-slate-600 dark:text-slate-400">
        หมดอายุ {new Date(code.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
      </span>
    </span>
  )
}

/** `tabs`: the LINE menu tab bars, first in this page's toolbar row. */
export function LineMembersPanel({ tabs }: { tabs?: ReactNode }) {
  const { showToast } = useToast()
  const { user } = useAuth()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [codes, setCodes] = useState<Record<string, IssuedCode>>({})
  // QR พนักงาน (OWNER, owner 2026-11-25): made on press, 5 minutes
  const [qrFor, setQrFor] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async () => {
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
    }
  }, [])

  useAutoRefresh(load)

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
  const onQrLinked = useCallback(() => void load(), [load])

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
    <ActionButton variant="danger" icon={<Link2Off />} disabled={user?.role !== 'OWNER' || busyId === rowKey} onClick={() => void unlink(rowKey, contact, name)}>
      ยกเลิกการเชื่อม
    </ActionButton>
  )

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`${TABLE_TOOLBAR_CLASSES} flex flex-wrap items-center`}>{tabs}</div>
      {loadError && <p className="mx-3 mt-2 text-[11px] text-amber-700 dark:text-amber-300">{loadError}</p>}
      <DataTableFrame fill rowCount={staff.length} className="flex-1 min-h-0 min-w-0 rounded-none bg-transparent">
        <table className={`${DATA_TABLE_CLASSES} text-[11px] leading-tight`} aria-label="ตารางพนักงาน LINE">
          <thead className={`${DATA_TABLE_THEAD_CLASSES} text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-xs`}>
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
                      <ActionButton variant="share" disabled={busyId === key || Boolean(loadError)} onClick={() => void issue(key, () => createMyLineLinkCode())}>
                        ออกรหัสของฉัน
                      </ActionButton>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        {user?.role === 'OWNER' && (
                          <ActionButton variant="info" icon={<QrCode />} disabled={Boolean(loadError)} onClick={() => setQrFor({ id: s.id, name })}>
                            แสดง QR
                          </ActionButton>
                        )}
                        <LineInviteButton kind="STAFF" target={s.id} name={name} disabled={Boolean(loadError)} />
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DataTableFrame>
      {qrFor && <StaffQrModal profileId={qrFor.id} name={qrFor.name} onClose={() => setQrFor(null)} onLinked={onQrLinked} />}
    </div>
  )
}
