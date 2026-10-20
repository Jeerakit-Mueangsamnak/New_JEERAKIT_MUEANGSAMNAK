'use client'

import { SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'
import { BellRing } from 'lucide-react'
import { NumericInput } from '@/components/common/NumericInput'
import type { NotificationSettings } from '@/features/settings/services/settings-storage'

interface NotificationSettingsPanelProps {
  value: NotificationSettings
  onChange: (next: NotificationSettings) => void
}

/**
 * The member's own in-app notices (ตั้งค่าส่วนตัว): profiles.notification_prefs, read by
 * rental_overdue_scan (per member, menus they hold) and the appointment calendar.
 */
export function NotificationSettingsPanel({ value, onChange }: NotificationSettingsPanelProps) {
  const config = { notifications: value }
  const setConfig = (next: { notifications: NotificationSettings }) => onChange(next.notifications)
  return (
    <div className="space-y-2.5">
        <h4 className={SETTINGS_SECTION_TITLE}>
          <BellRing className="w-3.5 h-3.5 text-teal-600" />
          <span>การแจ้งเตือนในระบบ</span>
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* 1. กำหนดส่งสินค้า */}
          <div className="py-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.notifications?.deliveryReminder?.enabled ?? true}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      deliveryReminder: {
                        ...config.notifications?.deliveryReminder,
                        enabled: e.target.checked,
                      },
                    },
                  })
                }
                className="w-4 h-4 text-teal-600 rounded"
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  กำหนดส่งสินค้า
                </span>
                <span className="text-[11px] text-slate-500">
                  แจ้งเตือนรายการนัดหมายส่งสินค้าล่วงหน้า
                </span>
              </div>
            </label>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[11px] text-slate-500">แจ้งล่วงหน้า</span>
              <NumericInput
                value={config.notifications?.deliveryReminder?.daysBefore ?? 1}
                onChange={(val) => {
                  const num = val === '' ? 0 : Math.min(365, Math.max(0, val))
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      deliveryReminder: {
                        ...config.notifications?.deliveryReminder,
                        daysBefore: num,
                      },
                    },
                  })
                }}
                defaultValueOnBlur={1}
                min={0}
                max={365}
                allowDecimals={false}
                disabled={!config.notifications?.deliveryReminder?.enabled}
                className="w-12 h-7 px-1.5 py-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-center font-bold text-xs disabled:opacity-50"
              />
              <span className="text-[11px] text-slate-500">วัน</span>
            </div>
          </div>

          {/* 2. กำหนดคืนสินค้า */}
          <div className="py-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.notifications?.returnReminder?.enabled ?? true}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      returnReminder: {
                        ...config.notifications?.returnReminder,
                        enabled: e.target.checked,
                      },
                    },
                  })
                }
                className="w-4 h-4 text-teal-600 rounded"
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  กำหนดคืนสินค้า
                </span>
                <span className="text-[11px] text-slate-500">
                  แจ้งเตือนบิลที่ใกล้ครบกำหนดรับคืนอุปกรณ์
                </span>
              </div>
            </label>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[11px] text-slate-500">แจ้งล่วงหน้า</span>
              <NumericInput
                value={config.notifications?.returnReminder?.daysBefore ?? 1}
                onChange={(val) => {
                  const num = val === '' ? 0 : Math.min(365, Math.max(0, val))
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      returnReminder: {
                        ...config.notifications?.returnReminder,
                        daysBefore: num,
                      },
                    },
                  })
                }}
                defaultValueOnBlur={1}
                min={0}
                max={365}
                allowDecimals={false}
                disabled={!config.notifications?.returnReminder?.enabled}
                className="w-12 h-7 px-1.5 py-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-center font-bold text-xs disabled:opacity-50"
              />
              <span className="text-[11px] text-slate-500">วัน</span>
            </div>
          </div>

          {/* นัดหมาย: ใช้เป็นช่วง "ใกล้ถึงกำหนด" ของปฏิทินด้วย */}
          <div className="py-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.notifications?.appointmentReminder?.enabled ?? true}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      appointmentReminder: {
                        ...config.notifications?.appointmentReminder,
                        enabled: e.target.checked,
                      },
                    },
                  })
                }
                className="w-4 h-4 text-teal-600 rounded"
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  นัดหมายใกล้ถึง
                </span>
                <span className="text-[11px] text-slate-500">
                  แจ้งเตือนนัดหมาย และใช้เป็นช่วง &ldquo;ใกล้ถึงกำหนด&rdquo; ในปฏิทินนัดหมาย
                </span>
              </div>
            </label>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[11px] text-slate-500">แจ้งล่วงหน้า</span>
              <NumericInput
                value={config.notifications?.appointmentReminder?.daysBefore ?? 3}
                onChange={(val) => {
                  const num = val === '' ? 0 : Math.min(365, Math.max(0, val))
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      appointmentReminder: {
                        ...config.notifications?.appointmentReminder,
                        daysBefore: num,
                      },
                    },
                  })
                }}
                defaultValueOnBlur={3}
                min={0}
                max={365}
                allowDecimals={false}
                disabled={!config.notifications?.appointmentReminder?.enabled}
                className="w-12 h-7 px-1.5 py-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-center font-bold text-xs disabled:opacity-50"
              />
              <span className="text-[11px] text-slate-500">วัน</span>
            </div>
          </div>

          {/* 3. ค้างชำระ */}
          <div className="py-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.notifications?.paymentReminder?.enabled ?? true}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      paymentReminder: {
                        ...config.notifications?.paymentReminder,
                        enabled: e.target.checked,
                      },
                    },
                  })
                }
                className="w-4 h-4 text-teal-600 rounded"
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  ค้างชำระ
                </span>
                <span className="text-[11px] text-slate-500">
                  แจ้งเตือนยอดเงินค้างชำระที่ถึงกำหนด
                </span>
              </div>
            </label>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[11px] text-slate-500">แจ้งล่วงหน้า</span>
              <NumericInput
                value={config.notifications?.paymentReminder?.daysBefore ?? 1}
                onChange={(val) => {
                  const num = val === '' ? 0 : Math.min(365, Math.max(0, val))
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      paymentReminder: {
                        ...config.notifications?.paymentReminder,
                        daysBefore: num,
                      },
                    },
                  })
                }}
                defaultValueOnBlur={1}
                min={0}
                max={365}
                allowDecimals={false}
                disabled={!config.notifications?.paymentReminder?.enabled}
                className="w-12 h-7 px-1.5 py-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-center font-bold text-xs disabled:opacity-50"
              />
              <span className="text-[11px] text-slate-500">วัน</span>
            </div>
          </div>

          {/* 4. สต็อกต่ำ */}
          <label className="py-2 flex items-center justify-between gap-2.5 cursor-pointer">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={config.notifications?.lowStockReminder?.enabled ?? true}
                onChange={(e) => {
                  const checked = e.target.checked
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      lowStockReminder: {
                        enabled: checked,
                      },
                    },
                  })
                }}
                className="w-4 h-4 text-teal-600 rounded"
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  สต็อกต่ำ
                </span>
                <span className="text-[11px] text-slate-500">
                  แจ้งเตือนเมื่อสินค้าพร้อมใช้ต่ำกว่าขั้นต่ำ
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold text-[10px]">
              Stock Alert
            </span>
          </label>

          {/* 5. สินค้าค้างคืน/คืนล่าช้า */}
          <label className="py-2 flex items-center justify-between gap-2.5 cursor-pointer">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={config.notifications?.overdueReturnReminder?.enabled ?? true}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      overdueReturnReminder: {
                        enabled: e.target.checked,
                      },
                    },
                  })
                }
                className="w-4 h-4 text-teal-600 rounded"
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  สินค้าค้างคืน / คืนล่าช้า
                </span>
                <span className="text-[11px] text-slate-500">
                  แจ้งเตือนรายการบิลที่เลยกำหนดส่งคืนอุปกรณ์
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 font-bold text-[10px]">
              Overdue Alert
            </span>
          </label>
        </div>
      </div>

  )
}
