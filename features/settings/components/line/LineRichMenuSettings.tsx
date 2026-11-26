'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { LayoutGrid } from 'lucide-react'
import { ActionButton, TABLE_TOOLBAR_CLASSES } from '@/components/common/ActionButton'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { getRichMenuStatus, publishRichMenu, unpublishRichMenu, type RichMenuInfo } from '@/app/actions/line'
import { PILL_TONE, thaiDateTime } from '@/features/settings/components/line/line-people-model'
import { SettingsRow, SettingsRowsCard } from '@/features/settings/components/SettingsRows'

/**
 * ตั้งค่า › เมนู LINE (OWNER): the chat menus (general, customer, staff, driver, owner), each with its picture, its buttons and whether it is published.
 * Nothing is published by looking, and not at all while the server is in the trial mode. Publishing creates the menu at
 * LINE; people see it once their kind matches (anyone who added the OA: the default menu; a confirmed customer / staff /
 * driver: their own). The buttons are the ones whose function exists (the list is in lib/line/rich-menu.labels.json).
 */
const AUDIENCE: Record<string, string> = {
  GENERAL: 'ทุกคนที่เพิ่มเพื่อน (เมนูเริ่มต้นของ LINE)',
  CUSTOMER: 'ลูกค้าที่ร้านอนุมัติและผูกบัญชีแล้ว',
  STAFF: 'พนักงานที่ผูกบัญชีแล้ว',
  DRIVER: 'คนขับรถที่ผูกบัญชีแล้ว',
  OWNER: 'เจ้าของร้านที่ผูกบัญชีแล้ว',
}

export function LineRichMenuSettings({ tabs }: { tabs: ReactNode }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [menus, setMenus] = useState<RichMenuInfo[] | null>(null)
  const [mode, setMode] = useState<'mock' | 'live'>('mock')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await getRichMenuStatus()
    if (!r.success || !r.data) return setError(r.error || 'โหลดเมนูไม่สำเร็จ')
    setError(null)
    setMenus(r.data.menus)
    setMode(r.data.mode)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const publish = async (m: RichMenuInfo) => {
    const ok = await confirm({
      title: `เผยแพร่เมนู "${m.label}"`,
      message: m.published_at ? 'เมนูเดิมจะถูกแทนที่ด้วยเมนูใหม่ใน LINE ทันที' : 'เมนูนี้จะขึ้นให้คนในกลุ่มนี้เห็นในแชต LINE จริงทันที',
      confirmLabel: 'เผยแพร่',
    })
    if (!ok) return
    setBusy(m.kind)
    try {
      const r = await publishRichMenu(m.kind)
      if (!r.success) return showToast('เผยแพร่ไม่สำเร็จ', r.error, 'ERROR')
      showToast('เผยแพร่เมนูแล้ว', m.label, 'SUCCESS')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const unpublish = async (m: RichMenuInfo) => {
    const ok = await confirm({ title: `ยกเลิกเผยแพร่เมนู "${m.label}"`, message: 'เมนูนี้จะหายจากแชต LINE ของคนกลุ่มนี้', confirmLabel: 'ยกเลิกเผยแพร่', danger: true })
    if (!ok) return
    setBusy(m.kind)
    try {
      const r = await unpublishRichMenu(m.kind)
      if (!r.success) return showToast('ยกเลิกไม่สำเร็จ', r.error, 'ERROR')
      showToast('ยกเลิกเผยแพร่แล้ว', m.label, 'SUCCESS')
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`${TABLE_TOOLBAR_CLASSES} flex items-center`}>{tabs}</div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" data-testid="line-rich-menus">
        {mode === 'mock' && (
          <p className="rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-900 dark:text-amber-200" data-testid="line-menu-mock">
            เซิร์ฟเวอร์อยู่ในโหมดทดลอง ดูตัวอย่างได้ แต่ยังเผยแพร่เมนูจริงไม่ได้
          </p>
        )}
        {error && <p className="rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">{error}</p>}
        {(menus ?? []).map((m) => (
          <SettingsRowsCard key={m.kind} title={`เมนู${m.label}`} icon={LayoutGrid}>
            <div className="p-3 grid grid-cols-1 md:grid-cols-[minmax(0,320px)_1fr] gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- a picture of the shop's own file in /public */}
              <img src={m.image} alt={`ตัวอย่างเมนู ${m.label}`} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white" />
              <div className="space-y-2 text-xs text-slate-900 dark:text-slate-100">
                <p className="text-slate-700 dark:text-slate-300">{AUDIENCE[m.kind]}</p>
                <p>
                  ปุ่ม: <b>{m.items.join(' · ')}</b>
                </p>
                <p className="tabular-nums">
                  คนที่ควรเห็นเมนูนี้ {m.people} คน · LINE แสดงให้แล้ว {m.on_menu} คน
                </p>
                <p>
                  <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold ${m.published_at ? PILL_TONE.emerald : PILL_TONE.slate}`}>
                    {m.published_at ? `เผยแพร่แล้ว ${thaiDateTime(m.published_at)}` : 'ยังไม่ได้เผยแพร่'}
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <ActionButton variant="primary" disabled={busy !== null || mode !== 'live'} onClick={() => void publish(m)}>
                    {m.published_at ? 'เผยแพร่ใหม่' : 'เผยแพร่เมนูนี้'}
                  </ActionButton>
                  {m.published_at && (
                    <ActionButton variant="danger" disabled={busy !== null || mode !== 'live'} onClick={() => void unpublish(m)}>
                      ยกเลิกเผยแพร่
                    </ActionButton>
                  )}
                </div>
              </div>
            </div>
          </SettingsRowsCard>
        ))}
        <SettingsRowsCard title="ที่ยังไม่มี" icon={LayoutGrid}>
          <SettingsRow label="เปิด–ปิดปุ่ม จัดลำดับ และบันทึกแบบร่าง" description="ปุ่มและรูปเมนูสร้างจากไฟล์ lib/line/rich-menu.labels.json แล้วรันสคริปต์สร้างรูปใหม่ ยังไม่มีหน้าจอแก้ในแอป" />
        </SettingsRowsCard>
      </div>
    </div>
  )
}
