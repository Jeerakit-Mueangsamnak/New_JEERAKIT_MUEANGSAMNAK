'use client'

import type React from 'react'
import { BellRing } from 'lucide-react'
import { NumericInput } from '@/components/common/NumericInput'
import type { NotificationSettings } from '@/features/settings/services/settings-storage'
import {
  SETTINGS_ROW_NUMBER,
  SETTINGS_ROW_UNIT,
  SettingsRow,
  SettingsRowsCard,
  SettingsSwitch,
} from '@/features/settings/components/SettingsRows'

interface NotificationSettingsPanelProps {
  value: NotificationSettings
  onChange: (next: NotificationSettings) => void
  /** The save buttons, shown in the last row of the card */
  footer?: React.ReactNode
}

type DaysKey = 'deliveryReminder' | 'returnReminder' | 'appointmentReminder' | 'paymentReminder'
type FlagKey = 'lowStockReminder' | 'overdueReturnReminder'

const ROWS: ReadonlyArray<
  | { kind: 'days'; key: DaysKey; label: string; description: string; defaultDays: number; alwaysOn?: boolean }
  | { kind: 'flag'; key: FlagKey; label: string; description: string; badge: string; badgeClass: string }
> = [
  { kind: 'days', key: 'deliveryReminder', label: 'กำหนดส่งสินค้า', description: 'แจ้งเตือนรายการนัดหมายส่งสินค้าล่วงหน้า', defaultDays: 1 },
  { kind: 'days', key: 'returnReminder', label: 'กำหนดคืนสินค้า', description: 'แจ้งเตือนบิลที่ใกล้ครบกำหนดรับคืนอุปกรณ์', defaultDays: 1 },
  { kind: 'days', key: 'appointmentReminder', label: 'นัดหมายใกล้ถึง', description: 'แจ้งเตือนนัดหมาย และใช้เป็นช่วง “ใกล้ถึงกำหนด” ในปฏิทินนัดหมาย', defaultDays: 3 },
  // always on, no switch (owner 2026-11-18: ค้างชำระ is a state the shop must always be told about)
  { kind: 'days', key: 'paymentReminder', label: 'ค้างชำระ', description: 'แจ้งเตือนยอดเงินค้างชำระที่ถึงกำหนด', defaultDays: 1, alwaysOn: true },
  {
    kind: 'flag',
    key: 'lowStockReminder',
    label: 'สต็อกต่ำ',
    description: 'แจ้งเตือนเมื่อสินค้าพร้อมใช้ต่ำกว่าขั้นต่ำ',
    badge: 'เตือนสต็อก',
    badgeClass: 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300',
  },
  {
    kind: 'flag',
    key: 'overdueReturnReminder',
    label: 'สินค้าค้างคืน / คืนล่าช้า',
    description: 'แจ้งเตือนรายการบิลที่เลยกำหนดส่งคืนอุปกรณ์',
    badge: 'เตือนค้างคืน',
    badgeClass: 'bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300',
  },
]

/**
 * The shop's in-app notices (ตั้งค่าระบบ › การแจ้งเตือนของร้าน, OWNER): store_settings.policies.notifications, the same
 * for every member. Read by rental_overdue_scan (each member still gets only the menus they hold) and the appointment
 * calendar ("ใกล้ถึงกำหนด"). One row per notice with its switch on the right (owner 2026-11-17).
 */
export function NotificationSettingsPanel({ value, onChange, footer }: NotificationSettingsPanelProps) {
  return (
    <SettingsRowsCard title="การแจ้งเตือนในระบบ" icon={BellRing} footer={footer}>
      {ROWS.map((row) => {
        if (row.kind === 'days') {
          const s = value?.[row.key]
          const on = row.alwaysOn || (s?.enabled ?? true)
          return (
            <SettingsRow key={row.key} label={row.label} description={row.description}>
              <span className={SETTINGS_ROW_UNIT}>แจ้งล่วงหน้า</span>
              <NumericInput
                aria-label={`${row.label} แจ้งล่วงหน้า (วัน)`}
                value={s?.daysBefore ?? row.defaultDays}
                onChange={(val) =>
                  onChange({ ...value, [row.key]: { ...s, daysBefore: val === '' ? 0 : Math.min(365, Math.max(0, val)) } })
                }
                defaultValueOnBlur={row.defaultDays}
                min={0}
                max={365}
                allowDecimals={false}
                disabled={!on}
                className={SETTINGS_ROW_NUMBER}
              />
              <span className={SETTINGS_ROW_UNIT}>วัน</span>
              {row.alwaysOn ? (
                // keeps the number box in line with the rows that have a switch
                <span aria-hidden className="w-10 shrink-0" />
              ) : (
                <SettingsSwitch label={row.label} checked={on} onChange={(enabled) => onChange({ ...value, [row.key]: { ...s, enabled } })} />
              )}
            </SettingsRow>
          )
        }
        const on = value?.[row.key]?.enabled ?? true
        return (
          <SettingsRow key={row.key} label={row.label} description={row.description}>
            <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${row.badgeClass}`}>{row.badge}</span>
            <SettingsSwitch label={row.label} checked={on} onChange={(enabled) => onChange({ ...value, [row.key]: { enabled } })} />
          </SettingsRow>
        )
      })}
    </SettingsRowsCard>
  )
}
