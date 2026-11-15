'use client'

import React, { useState } from 'react'
import {
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
  TAB_CONTAINER_CLASSES,
} from '@/components/common/ActionButton'
import { LinePeoplePage } from '@/features/settings/components/LinePeoplePage'
import { LineBillCardDesigner } from '@/features/settings/components/LineBillCardDesigner'
import { LineMessageComposer } from '@/features/settings/components/LineMessageComposer'
import { LineFormsCard } from '@/features/settings/components/LineFormsCard'
import { useAuth } from '@/features/auth/contexts/AuthContext'

type LineTab = 'people' | 'card' | 'message' | 'forms'
const OWNER_TABS: Array<[LineTab, string]> = [
  ['people', 'คนใน LINE'],
  ['card', 'การ์ดบิล'],
  ['message', 'เขียนข้อความ'],
  ['forms', 'ฟอร์มใน LINE'],
]

const PANEL = 'flex-1 min-h-0 overflow-y-auto settings-ref bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-2'

/**
 * เมนู LINE (owner 2026-11-14: everything about LINE moved out of ตั้งค่า into its own menu under จัดการบิล).
 * Owner 2026-11-15: one tab per part instead of one long page — คนใน LINE | การ์ดบิล | เขียนข้อความ | ฟอร์มใน LINE.
 * The OWNER's cards stay mounted while hidden, so an unsaved card or message survives a tab switch.
 * A member who is not the OWNER sees only คนใน LINE, without the tab row.
 */
export default function LinePage() {
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  const [tab, setTab] = useState<LineTab>('people')
  const shown: LineTab = isOwner ? tab : 'people'

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col gap-2 p-2 bg-slate-100 dark:bg-black text-xs">
      {isOwner && (
        <div className="shrink-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-2">
          <div className={TAB_CONTAINER_CLASSES} role="tablist" aria-label="LINE">
            {OWNER_TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={shown === id}
                onClick={() => setTab(id)}
                className={`${TAB_BUTTON_BASE_CLASSES} ${shown === id ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div hidden={shown !== 'people'} className={shown === 'people' ? 'flex-1 min-h-0 overflow-hidden' : undefined}>
        <LinePeoplePage embedded />
      </div>
      {isOwner && (
        <>
          <div hidden={shown !== 'card'} className={shown === 'card' ? PANEL : undefined}><LineBillCardDesigner /></div>
          <div hidden={shown !== 'message'} className={shown === 'message' ? PANEL : undefined}><LineMessageComposer /></div>
          <div hidden={shown !== 'forms'} className={shown === 'forms' ? PANEL : undefined}><LineFormsCard /></div>
        </>
      )}
    </div>
  )
}
