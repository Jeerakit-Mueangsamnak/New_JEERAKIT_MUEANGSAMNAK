'use client'

import React, { useState } from 'react'
import { Download } from 'lucide-react'
import { CustomDatePicker, getLocalDateString } from '@/components/common/CustomDatePicker'
import { DATA_TABLE_CLASSES, DATA_TABLE_TH_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { useToast } from '@/components/common/Toast'
import { exportShopBackup } from '@/app/actions/backup'
import { BACKUP_GROUPS, BACKUP_GROUP_IDS, type BackupGroupId } from '@/features/settings/utils/backup-groups'
import { REF_BUTTON, SettingsCard } from '@/features/settings/components/SettingsCards'
import { SETTINGS_TABLE_BODY, SETTINGS_TABLE_FRAME } from '@/features/settings/components/settings-ui'

const CHECKBOX = 'w-3.5 h-3.5 text-blue-600 dark:text-blue-400 rounded cursor-pointer'

/**
 * ตั้งค่าระบบ › สำรองข้อมูล (owner 2026-11-15): pick the dates and the data, then one JSON file downloads.
 * Dates left empty = every date.
 */
export function BackupPanel() {
  const { showToast } = useToast()
  const [from, setFrom] = useState<Date | null>(null)
  const [to, setTo] = useState<Date | null>(null)
  const [selected, setSelected] = useState<BackupGroupId[]>(BACKUP_GROUP_IDS)
  const [busy, setBusy] = useState(false)

  const allSelected = selected.length === BACKUP_GROUP_IDS.length
  const toggle = (id: BackupGroupId) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((g) => g !== id) : BACKUP_GROUP_IDS.filter((g) => g === id || cur.includes(g))))
  const toggleAll = () => setSelected(allSelected ? [] : BACKUP_GROUP_IDS)

  const fromText = from ? getLocalDateString(from) : null
  const toText = to ? getLocalDateString(to) : null
  const badRange = Boolean(fromText && toText && fromText > toText)

  const runBackup = async () => {
    setBusy(true)
    try {
      const res = await exportShopBackup({ groups: selected, from: fromText, to: toText })
      if (!res.success) {
        showToast('สำรองข้อมูลไม่สำเร็จ', res.error, 'ERROR')
        return
      }
      const blob = new Blob([JSON.stringify(res.backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `สำรองข้อมูล_${fromText ?? 'เริ่มต้น'}_ถึง_${toText ?? getLocalDateString()}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      const rows = Object.values(res.backup.tables).reduce((sum, list) => sum + list.length, 0)
      showToast('สำรองข้อมูลแล้ว', `${rows.toLocaleString('th-TH')} รายการ`, 'SUCCESS')
    } catch {
      showToast('สำรองข้อมูลไม่สำเร็จ', 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      title="สำรองข้อมูล"
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="w-28 sm:w-32 shrink-0">
            <CustomDatePicker value={from} onChange={setFrom} placeholder="ตั้งแต่วันที่" align="right" />
          </div>
          <span className="text-slate-600 dark:text-slate-400 text-xs font-bold shrink-0">-</span>
          <div className="w-28 sm:w-32 shrink-0">
            <CustomDatePicker value={to} onChange={setTo} placeholder="ถึงวันที่" align="right" />
          </div>
          <button type="button" onClick={runBackup} disabled={busy || selected.length === 0 || badRange} className={REF_BUTTON}>
            <Download className="w-4 h-4" />
            <span>{busy ? 'กำลังสำรอง…' : 'สำรองข้อมูล'}</span>
          </button>
        </div>
      }
    >
      <div className="py-2">
        {badRange && <p className="pb-2 text-[11px] font-bold text-rose-700 dark:text-rose-400">วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด</p>}
        <DataTableFrame className={SETTINGS_TABLE_FRAME} bodyClassName={SETTINGS_TABLE_BODY}>
          <table className={`${DATA_TABLE_CLASSES} text-xs`} aria-label="ข้อมูลที่ต้องการสำรอง">
            <thead>
              <tr>
                <th className={`${DATA_TABLE_TH_CLASSES} px-2 w-10 text-center`}>
                  <input type="checkbox" aria-label="เลือกทั้งหมด" checked={allSelected} onChange={toggleAll} className={CHECKBOX} />
                </th>
                <th className={`${DATA_TABLE_TH_CLASSES} px-2 w-12 text-center`}>ลำดับ</th>
                <th className={`${DATA_TABLE_TH_CLASSES} px-2`}>ข้อมูล</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {BACKUP_GROUPS.map((group, index) => {
                const on = selected.includes(group.id)
                return (
                  <tr
                    key={group.id}
                    onClick={() => toggle(group.id)}
                    className={`cursor-pointer ${on ? 'bg-blue-50/60 dark:bg-blue-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                  >
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`เลือก ${group.label}`}
                        checked={on}
                        onChange={() => toggle(group.id)}
                        onClick={(e) => e.stopPropagation()}
                        className={CHECKBOX}
                      />
                    </td>
                    <td className="px-2 text-center font-semibold text-slate-700 dark:text-slate-300">{index + 1}</td>
                    <td className="px-2 font-semibold text-slate-800 dark:text-slate-200">{group.label}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </DataTableFrame>
      </div>
    </SettingsCard>
  )
}
