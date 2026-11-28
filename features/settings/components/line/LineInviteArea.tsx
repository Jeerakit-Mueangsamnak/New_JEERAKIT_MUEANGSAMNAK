'use client'

import { useEffect, useState } from 'react'
import { UserCog, UserPlus } from 'lucide-react'
import { CustomerAutocomplete } from '@/components/common/CustomerAutocomplete'
import { CustomSelect } from '@/components/common/CustomSelect'
import { LineInviteButton } from '@/features/settings/components/LineInviteButton'
import { loadCustomers } from '@/features/customers/services/customer-storage'
import { loadDrivers, type DeliveryDriver } from '@/features/appointments/services/driver-registry'
import { createClient } from '@/lib/supabase/client'
import type { Customer } from '@/lib/types/rental-pos'

/**
 * LINE › ยืนยัน & จัดการ › สร้างลิงก์ผูก LINE (owner 2026-11-26). Customers and staff take different values:
 * a customer = one customer record; staff = one app user (พนักงานร้าน) or one driver code (คนขับรถ).
 * The link itself is the same single-use LIFF invite (LineInviteButton).
 */
type StaffKind = 'STAFF' | 'DRIVER'
interface Member {
  id: string
  display_name: string | null
  username: string | null
}

const BOX = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-2 flex flex-col gap-2 min-w-0'
const TITLE = 'flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100'

export function LineInviteArea() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [drivers, setDrivers] = useState<DeliveryDriver[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [staffKind, setStaffKind] = useState<StaffKind>('STAFF')
  const [personId, setPersonId] = useState('')

  useEffect(() => {
    const reload = () => {
      setCustomers(loadCustomers())
      setDrivers(loadDrivers().filter((d) => d.active))
    }
    reload()
    window.addEventListener('app-storage-update', reload)
    return () => window.removeEventListener('app-storage-update', reload)
  }, [])

  useEffect(() => {
    let alive = true
    void createClient()
      .rpc('member_directory')
      .then(({ data }) => {
        if (alive) setMembers((data as Member[] | null) ?? [])
      })
    return () => {
      alive = false
    }
  }, [])

  const people =
    staffKind === 'STAFF'
      ? members.map((m) => ({ value: m.id, label: m.display_name || m.username || 'ไม่ระบุชื่อ' }))
      : drivers.map((d) => ({ value: d.id, label: `${d.id} · ${d.name}` }))
  const person = people.find((p) => p.value === personId) ?? null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2 border-t border-slate-200 dark:border-slate-700 shrink-0" data-testid="line-invite-area">
      <div className={BOX}>
        <span className={TITLE}>
          <UserPlus className="w-3.5 h-3.5" />
          สร้างลิงก์ผูก LINE · ลูกค้า
        </span>
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex-1 min-w-0">
            <CustomerAutocomplete
              value={customer?.id}
              customerName={customer?.customerName ?? ''}
              customers={customers}
              onChange={(c) => setCustomer(c)}
            />
          </div>
          <LineInviteButton kind="CUSTOMER" target={customer?.id ?? ''} name={customer?.customerName ?? ''} disabled={!customer} />
        </div>
      </div>
      <div className={BOX}>
        <span className={TITLE}>
          <UserCog className="w-3.5 h-3.5" />
          สร้างลิงก์ผูก LINE · พนักงาน
        </span>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-32 shrink-0">
            <CustomSelect
              value={staffKind}
              ariaLabel="ประเภทพนักงาน"
              onChange={(v) => {
                setStaffKind(v as StaffKind)
                setPersonId('')
              }}
              options={[
                { value: 'STAFF', label: 'พนักงานร้าน' },
                { value: 'DRIVER', label: 'คนขับรถ' },
              ]}
            />
          </div>
          <div className="flex-1 min-w-0">
            <CustomSelect value={personId} ariaLabel="เลือกพนักงาน" placeholder="เลือกรายชื่อ" searchable onChange={(v) => setPersonId(String(v))} options={people} />
          </div>
          <LineInviteButton kind={staffKind} target={person?.value ?? ''} name={person?.label ?? ''} disabled={!person} />
        </div>
      </div>
    </div>
  )
}
