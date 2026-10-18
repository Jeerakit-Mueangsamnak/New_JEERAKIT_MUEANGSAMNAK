'use client'

import React, { useState } from 'react'
import { FileCode, FilePlus, Layers } from 'lucide-react'

import {
  TAB_CONTAINER_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { CustomerDocumentsWorkspace } from '@/features/documents/components/CustomerDocumentsWorkspace'
import { TemplateLibraryPanel, type TemplateLibraryMode } from '@/features/documents/components/TemplateLibraryPanel'

type MainTab = 'CREATE' | 'MANAGE'

/**
 * เอกสาร — customer document creation and a library of reusable document templates.
 */
export default function DocumentsPage() {
  const { settings } = useSystemSettings()
  const business = settings.business
  const [tab, setTab] = useState<MainTab>('MANAGE')
  const [libraryMode, setLibraryMode] = useState<TemplateLibraryMode>('LIBRARY')

  const tabButton = (active: boolean) => `${TAB_BUTTON_BASE_CLASSES} ${active ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`

  const mainTabs = (
    <div className={`grid grid-cols-2 ${TAB_CONTAINER_CLASSES} w-full`}>
      <button type="button" onClick={() => setTab('CREATE')} className={tabButton(tab === 'CREATE')}>
        <FilePlus className="w-3.5 h-3.5 shrink-0" />
        <span>สร้างเอกสาร</span>
      </button>
      <button type="button" onClick={() => setTab('MANAGE')} className={tabButton(tab === 'MANAGE')}>
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <span>จัดการเอกสาร</span>
      </button>
    </div>
  )

  const divider = <div className="border-b border-slate-200 dark:border-slate-700/80 shrink-0 my-0.5" />
  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden p-2 bg-slate-100 dark:bg-slate-900 gap-2 text-xs">
      <div hidden={tab !== 'CREATE'} className={tab === 'CREATE' ? 'flex-1 min-h-0 flex flex-col' : undefined}>
        <CustomerDocumentsWorkspace
          business={business}
          header={
            <>
              {mainTabs}
              {divider}
            </>
          }
        />
      </div>
      <div hidden={tab !== 'MANAGE'} className={tab === 'MANAGE' ? 'flex-1 min-h-0 flex flex-col' : undefined}>
        <TemplateLibraryPanel
          mode={libraryMode}
          onModeChange={setLibraryMode}
          business={business}
          header={
            <>
              {mainTabs}
              {divider}
              <div className={`grid grid-cols-2 ${TAB_CONTAINER_CLASSES} w-full`}>
                <button type="button" onClick={() => setLibraryMode('LIBRARY')} className={tabButton(libraryMode === 'LIBRARY')}>
                  <FileCode className="w-3.5 h-3.5 shrink-0" />
                  <span>คลังแบบฟอร์ม</span>
                </button>
                <button type="button" onClick={() => setLibraryMode('ADD')} className={tabButton(libraryMode === 'ADD')}>
                  <FilePlus className="w-3.5 h-3.5 shrink-0" />
                  <span>เพิ่มแบบฟอร์ม</span>
                </button>
              </div>
            </>
          }
        />
      </div>
    </div>
  )
}
