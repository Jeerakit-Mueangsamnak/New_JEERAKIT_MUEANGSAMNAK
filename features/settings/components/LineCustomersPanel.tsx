'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link2Off, RefreshCw, Search, Users } from 'lucide-react'
import { ActionButton } from '@/components/common/ActionButton'
import { DataTableFrame } from '@/components/common/DataTableFrame'
import { createClient } from '@/lib/supabase/client'
import { LineContactInfo, LineInviteButton, type LineReviewContact } from '@/features/settings/components/LineInviteButton'
import { SETTINGS_HELPER, SETTINGS_INPUT, SETTINGS_SECTION, SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'
import { useUnlinkLineContact } from '@/features/settings/hooks/useUnlinkLineContact'

/**
 * Settings › LINE › ลูกค้า: find a customer, send them an invite link (they type name + phone +
 * LINE ID), see who is linked and unlink. The customer menu keeps its own code flow.
 */

interface Customer {
  id: string
  name: string
  phone: string | null
}
interface Contact extends LineReviewContact {
  customer_id: string
  followed: boolean
}

const TH = 'px-2'
const TD = 'px-2'
const LIMIT = 50

export function LineCustomersPanel() {
  const [query, setQuery] = useState('')
  const [onlyLinked, setOnlyLinked] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [contacts, setContacts] = useState<Record<string, Contact>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const supabase = createClient()
      const c = await supabase
        .from('line_contacts')
        .select('id, display_name, customer_id, followed, typed_name, typed_phone, line_handle, needs_review')
        .eq('status', 'LINKED')
        .not('customer_id', 'is', null)
      if (c.error) setLoadError('ระบบ LINE ยังไม่พร้อมในฐานข้อมูลนี้')
      const linked = (c.data as Contact[] | null) ?? []
      setContacts(Object.fromEntries(linked.map((x) => [x.customer_id, x])))

      let q = supabase.from('customers').select('id, name, phone').eq('active', true).order('name').limit(LIMIT)
      const term = query.trim().replace(/[%,()"\\*]/g, ' ')
      if (term) q = q.or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
      if (onlyLinked) q = q.in('id', linked.length ? linked.map((x) => x.customer_id) : ['00000000-0000-0000-0000-000000000000'])
      const r = await q
      if (r.error) setLoadError('โหลดรายชื่อลูกค้าไม่สำเร็จ')
      setCustomers((r.data as Customer[] | null) ?? [])
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : 'โหลดรายชื่อลูกค้าไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [query, onlyLinked])

  useEffect(() => {
    const t = setTimeout(() => void load(), 250)
    return () => clearTimeout(t)
  }, [load])

  const unlinkContact = useUnlinkLineContact(() => load())

  const unlink = (customer: Customer, contact: Contact) =>
    unlinkContact(contact.id, customer.name, 'ข้อความที่ยังไม่ส่งถึงลูกค้าคนนี้จะถูกยกเลิก')

  return (
    <div className={SETTINGS_SECTION}>
      <h4 className={SETTINGS_SECTION_TITLE}>
        <Users className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
        <span>ลูกค้า</span>
      </h4>
      <p className={SETTINGS_HELPER}>ค้นหาลูกค้าแล้วกด &quot;ส่งลิงก์ผูก LINE&quot; ส่งเข้า LINE ส่วนตัวของลูกค้า · ลูกค้ากรอกชื่อ เบอร์ และไอดีไลน์ ระบบผูกให้เอง</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-600 dark:text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ชื่อหรือเบอร์ลูกค้า" className={`${SETTINGS_INPUT} pl-8`} aria-label="ค้นหาลูกค้า" />
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
          <input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} className="w-4 h-4 rounded" />
          เฉพาะที่ผูกแล้ว
        </label>
        <ActionButton variant="outline" icon={<RefreshCw className={loading ? 'animate-spin' : ''} />} onClick={() => void load()} aria-label="รีเฟรช" />
      </div>
      {loadError && <p className="text-[11px] text-amber-700 dark:text-amber-300">{loadError}</p>}
      <DataTableFrame
        rowCount={customers.length}
        empty={customers.length === 0}
        emptyState={<p className="py-6 text-center text-slate-600 dark:text-slate-400">{loading ? 'กำลังโหลด…' : 'ไม่พบลูกค้า'}</p>}
      >
        <table className="w-full text-left border-collapse table-auto text-xs" aria-label="ตารางลูกค้า LINE">
          <thead>
            <tr>
              <th className={TH}>ลูกค้า</th>
              <th className={TH}>เบอร์</th>
              <th className={TH}>LINE</th>
              <th className={`${TH} text-right`}>จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {customers.map((cu) => {
              const contact = contacts[cu.id]
              return (
                <tr key={cu.id}>
                  <td className={`${TD} font-semibold text-slate-800 dark:text-slate-200`}>{cu.name}</td>
                  <td className={`${TD} font-mono text-slate-600 dark:text-slate-400`}>{cu.phone || '-'}</td>
                  <td className={TD}>
                    {contact ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span className={`font-semibold ${contact.followed ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                          {contact.followed ? 'เชื่อมแล้ว' : 'เชื่อมแล้ว · บล็อก/ยังไม่แอดร้าน'}
                          {contact.display_name ? ` · ${contact.display_name}` : ''}
                        </span>
                        <LineContactInfo contact={contact} onChanged={() => void load()} />
                      </span>
                    ) : (
                      <span className="text-slate-600 dark:text-slate-400">ยังไม่ผูก</span>
                    )}
                  </td>
                  <td className={`${TD} text-right whitespace-nowrap`}>
                    {contact ? (
                      <ActionButton size="sm" variant="ghost" icon={<Link2Off />} className="text-red-700 dark:text-red-400" onClick={() => void unlink(cu, contact)}>
                        ยกเลิกการเชื่อม
                      </ActionButton>
                    ) : (
                      <LineInviteButton kind="CUSTOMER" target={cu.id} name={cu.name} disabled={Boolean(loadError)} />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DataTableFrame>
      {customers.length === LIMIT && <p className={SETTINGS_HELPER}>แสดง {LIMIT} รายการแรก · พิมพ์ค้นหาเพื่อหาลูกค้าคนอื่น</p>}
    </div>
  )
}
