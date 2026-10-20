'use client'

import React from 'react'
import { Lock, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { ActionButton } from '@/components/common/ActionButton'
import { DATA_TABLE_CLASSES, DATA_TABLE_THEAD_CLASSES } from '@/components/common/DataTableFrame'
import { SETTINGS_HELPER } from '@/features/settings/components/settings-ui'
import {
  ACTION_PERMISSIONS,
  MATRIX_MENUS,
  PIN_LABEL,
  actionAccess,
} from '@/features/auth/services/permission-matrix'

export interface MatrixMember {
  id: string
  name: string
  role?: 'OWNER' | 'USER'
  status?: string
}

interface PermissionMatrixPanelProps {
  member: MatrixMember | null
  /** Menus being edited (USER) — the saved ones until the OWNER changes a box. */
  draftMenus: string[]
  /** Risky actions being edited (USER) — the saved grants until the OWNER changes a box. */
  draftActions: string[]
  /** false until the action-grants migration is on the database (boxes stay disabled). */
  actionGrantsAvailable: boolean
  dirty: boolean
  saving: boolean
  onToggle: (code: string) => void
  onToggleAction: (code: string) => void
  onPresetPos: () => void
  onSelectAll: () => void
  onClear: () => void
  onCancel: () => void
  onSave: () => void
}

const ACCESS_BADGE = {
  ALLOWED: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400',
  NO_MENU: 'bg-slate-50 dark:bg-slate-700/40 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400',
  NOT_GRANTED: 'bg-slate-50 dark:bg-slate-700/40 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400',
  OWNER_ONLY: 'bg-slate-50 dark:bg-slate-700/40 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400',
} as const

/**
 * Permission matrix of ONE member: the menus the OWNER grants (the only thing that is stored,
 * through owner_set_member_menus) and, read only, the actions those menus allow as the database
 * checks them. Owner-only menus and actions are shown locked; an OWNER has everything.
 */
export function PermissionMatrixPanel({
  member,
  draftMenus,
  draftActions,
  actionGrantsAvailable,
  dirty,
  saving,
  onToggle,
  onToggleAction,
  onPresetPos,
  onSelectAll,
  onClear,
  onCancel,
  onSave,
}: PermissionMatrixPanelProps) {
  if (!member) {
    return (
      <div className="h-full min-h-[160px] flex items-center justify-center p-4 text-center text-slate-400 text-xs font-bold">
        เลือกผู้ใช้จากรายการเพื่อดูสิทธิ์
      </div>
    )
  }
  const isOwner = member.role === 'OWNER'
  const editable = !isOwner && member.status === 'ACTIVE'
  const menuCell = (code: string, locked: boolean) => {
    if (isOwner) return <span className="text-emerald-700 dark:text-emerald-400 font-bold">เต็ม</span>
    if (locked)
      return (
        <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
          <Lock className="w-3 h-3" /> เฉพาะเจ้าของร้าน
        </span>
      )
    return (
      <input
        type="checkbox"
        aria-label={`ให้สิทธิ์เมนู ${code}`}
        checked={draftMenus.includes(code)}
        disabled={!editable || saving}
        onChange={() => onToggle(code)}
        className="w-4 h-4 rounded border-slate-300 text-emerald-600"
      />
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="min-w-0 flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="truncate">{member.name}</span>
          <span className="text-[10px] font-bold text-slate-500">{member.role}</span>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-1">
            <ActionButton size="sm" variant="neutral" onClick={onPresetPos} disabled={saving}>
              ชุดพนักงานขาย (POS)
            </ActionButton>
            <ActionButton size="sm" variant="neutral" onClick={onSelectAll} disabled={saving}>
              เลือกทั้งหมด
            </ActionButton>
            <ActionButton size="sm" variant="neutral" onClick={onClear} disabled={saving}>
              ล้าง
            </ActionButton>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isOwner && <p className={`${SETTINGS_HELPER} px-3 pt-2`}>เจ้าของร้านมีสิทธิ์ทุกเมนูและทุก action โดยระบบ</p>}
        {!isOwner && member.status !== 'ACTIVE' && (
          <p className={`${SETTINGS_HELPER} px-3 pt-2`}>อนุมัติผู้ใช้ก่อน จึงกำหนดเมนูได้</p>
        )}

        <table className={`${DATA_TABLE_CLASSES} text-xs`}>
          <thead className={DATA_TABLE_THEAD_CLASSES}>
            <tr className="text-slate-700 dark:text-slate-300">
              <th className="px-3 py-2">เมนูที่เข้าได้</th>
              <th className="px-3 py-2 text-right w-36">สิทธิ์</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {MATRIX_MENUS.map((m) => (
              <tr key={m.code}>
                <td className="px-3 py-1.5 font-semibold text-slate-800 dark:text-slate-200">{m.label}</td>
                <td className="px-3 py-1.5 text-right">{menuCell(m.code, m.locked)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className={`${DATA_TABLE_CLASSES} text-xs mt-2`}>
          <thead className={DATA_TABLE_THEAD_CLASSES}>
            <tr className="text-slate-700 dark:text-slate-300">
              <th className="px-3 py-2">Action ที่ทำได้ (ตามเมนู)</th>
              <th className="px-3 py-2">การยืนยัน</th>
              <th className="px-3 py-2 text-right w-36">ผล</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {ACTION_PERMISSIONS.map((a) => {
              const access = actionAccess(member.role, draftMenus, a, draftActions)
              // A USER's risky action is a real grant: a box, usable only when a menu allows it.
              if (a.grant && !isOwner) {
                const grant = a.grant
                const hasMenu = a.menus.some((m) => draftMenus.includes(m))
                return (
                  <tr key={a.id} title={a.rpc}>
                    <td className="px-3 py-1.5 font-semibold text-slate-800 dark:text-slate-200">{a.label}</td>
                    <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{a.pin ? PIN_LABEL[a.pin] : '-'}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="checkbox"
                        aria-label={`ให้สิทธิ์ ${grant}`}
                        title={hasMenu ? undefined : 'ต้องให้เมนูที่เกี่ยวข้องก่อน'}
                        checked={hasMenu && draftActions.includes(grant)}
                        disabled={!editable || saving || !actionGrantsAvailable || !hasMenu}
                        onChange={() => onToggleAction(grant)}
                        className="w-4 h-4 rounded border-slate-300 text-emerald-600 disabled:opacity-40"
                      />
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={a.id} title={a.rpc}>
                  <td className="px-3 py-1.5 font-semibold text-slate-800 dark:text-slate-200">{a.label}</td>
                  <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{a.pin ? PIN_LABEL[a.pin] : '-'}</td>
                  <td className="px-3 py-1.5 text-right">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-px rounded-full border text-[10px] font-bold whitespace-nowrap ${ACCESS_BADGE[access]}`}>
                      {access === 'OWNER_ONLY' && <Lock className="w-3 h-3" />}
                      {access === 'ALLOWED' ? 'ทำได้' : access === 'OWNER_ONLY' ? 'เฉพาะเจ้าของร้าน' : access === 'NOT_GRANTED' ? 'ไม่ได้รับสิทธิ์' : 'ไม่มีเมนู'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className={`${SETTINGS_HELPER} px-3 py-2`}>
          รายการที่มีช่องติ๊ก ต้องมีทั้งเมนูและสิทธิ์ที่เจ้าของร้านให้ แล้วยืนยันด้วย PIN ของผู้ใช้เอง · รายการอื่นเปิดตามเมนู
          {!actionGrantsAvailable && ' · ฐานข้อมูลยังไม่รองรับสิทธิ์รายการ (ยังไม่ได้ apply migration)'}
        </p>
      </div>

      {editable && (
        <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 shrink-0">
          <span className={SETTINGS_HELPER}>
            เลือก {draftMenus.length} เมนู · {draftActions.length} สิทธิ์{dirty ? ' · ยังไม่บันทึก' : ''}
          </span>
          <div className="flex gap-1.5">
            <ActionButton size="sm" variant="neutral" onClick={onCancel} disabled={!dirty || saving} icon={<RotateCcw />}>
              ยกเลิก
            </ActionButton>
            <ActionButton size="sm" variant="primary" onClick={onSave} disabled={!dirty || saving} icon={<Save />}>
              {saving ? 'กำลังบันทึก…' : 'บันทึกสิทธิ์'}
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  )
}
