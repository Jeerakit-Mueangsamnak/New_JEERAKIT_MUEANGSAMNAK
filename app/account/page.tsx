'use client'

import React, { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { MyAccountPanel, type MyAccountTab } from '@/features/settings/components/MyAccountPanel'

const TABS: MyAccountTab[] = ['PROFILE', 'SECURITY', 'NOTIFICATIONS', 'APPEARANCE']

function AccountPageContent() {
  const tab = useSearchParams().get('tab')?.toUpperCase() as MyAccountTab | undefined
  return <MyAccountPanel key={tab} initialTab={tab && TABS.includes(tab) ? tab : 'PROFILE'} />
}

/** ตั้งค่าส่วนตัว — every active member's own profile / password / PIN / notifications / look (no menu needed). */
export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-center min-h-[200px]">
          กำลังโหลดบัญชีของฉัน...
        </div>
      }
    >
      <AccountPageContent />
    </Suspense>
  )
}
