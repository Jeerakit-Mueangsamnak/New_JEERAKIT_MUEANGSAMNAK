'use client'

import { LinePeoplePage } from '@/features/settings/components/LinePeoplePage'
import { LineBillCardDesigner } from '@/features/settings/components/LineBillCardDesigner'
import { LineMessageComposer } from '@/features/settings/components/LineMessageComposer'
import { LineFormsCard } from '@/features/settings/components/LineFormsCard'
import { useAuth } from '@/features/auth/contexts/AuthContext'

/**
 * เมนู LINE (owner 2026-11-14: everything about LINE moved out of ตั้งค่า into its own menu under จัดการบิล):
 * คนใน LINE (friends waiting for the shop, drivers, linked customers, ตั้งค่า LINE), then the OWNER's cards —
 * การ์ดบิล LINE, เขียนข้อความ, ฟอร์มใน LINE.
 */
export default function LinePage() {
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  return (
    <div className="h-full min-h-0 overflow-y-auto flex flex-col gap-2 p-2 bg-slate-100 dark:bg-black text-xs">
      <div className="h-[75vh] min-h-[420px] shrink-0 overflow-hidden"><LinePeoplePage embedded /></div>
      {isOwner && (
        <div className="settings-ref shrink-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-2 space-y-4">
          <LineBillCardDesigner />
          <LineMessageComposer />
          <LineFormsCard />
        </div>
      )}
    </div>
  )
}
