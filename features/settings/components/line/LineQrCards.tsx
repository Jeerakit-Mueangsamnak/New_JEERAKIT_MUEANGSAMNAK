'use client'

import { useCallback, useEffect, useState } from 'react'
import { Ban, Copy, Link2, QrCode, ShieldAlert, UserPlus } from 'lucide-react'
import { ActionButton } from '@/components/common/ActionButton'
import { CustomSelect } from '@/components/common/CustomSelect'
import { useToast } from '@/components/common/Toast'
import { createClient } from '@/lib/supabase/client'
import { StaffQrModal } from '@/features/settings/components/line/StaffQrModal'

/**
 * The two QR cards of ภาพรวม (owner 2026-11-25, line.html section 1):
 *   ลูกค้า   — the shop OA add-friend QR, its LINE ID and link (may be sent from afar: adding a friend links nobody)
 *   พนักงาน — OWNER only: pick a staff member, the QR lives 5 minutes, is dead once used, nothing to copy
 */
export interface LineOaInfo {
  lineId: string | null
  addFriendUrl: string | null
  qr: string | null
}

const CARD = 'rounded-2xl border bg-white dark:bg-slate-800 p-3 flex flex-col sm:flex-row gap-3'

export function LineQrCards({ oa, isOwner }: { oa: LineOaInfo | null; isOwner: boolean }) {
  const { showToast } = useToast()
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([])
  const [pick, setPick] = useState('')
  const [qrFor, setQrFor] = useState<{ id: string; name: string } | null>(null)

  // staff who have not linked LINE yet (names only, through member_directory)
  const loadStaff = useCallback(async () => {
    const supabase = createClient()
    const [p, c] = await Promise.all([
      supabase.rpc('member_directory'),
      supabase.from('line_contacts').select('profile_id').eq('status', 'LINKED').not('profile_id', 'is', null),
    ])
    const linked = new Set(((c.data as Array<{ profile_id: string }> | null) ?? []).map((x) => x.profile_id))
    const list = ((p.data as Array<{ id: string; display_name: string | null; username: string | null }> | null) ?? [])
      .filter((s) => !linked.has(s.id))
      .map((s) => ({ id: s.id, name: s.display_name || s.username || '-' }))
    setStaff(list)
    setPick((cur) => (list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? '')))
  }, [])
  useEffect(() => {
    if (isOwner) void loadStaff()
  }, [isOwner, loadStaff])

  const copy = async (text: string, title: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(title, undefined, 'SUCCESS')
    } catch {
      showToast('คัดลอกไม่สำเร็จ', 'กรุณาคัดลอกเอง', 'ERROR')
    }
  }

  const qrBox = (img: string | null, label: string, tone: string) => (
    <div className="shrink-0 flex flex-col items-center gap-1">
      <div className="w-32 h-32 rounded-xl bg-white border border-slate-200 grid place-items-center overflow-hidden">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- a generated data: URL QR, nothing to optimise
          <img src={img} alt={label} className="w-full h-full p-1.5" />
        ) : (
          <QrCode className="w-10 h-10 text-slate-300" />
        )}
      </div>
      <span className={`text-[10px] font-bold px-2 h-5 inline-flex items-center rounded-full ${tone}`}>{label}</span>
    </div>
  )

  return (
    <div className={`grid grid-cols-1 ${isOwner ? 'xl:grid-cols-2' : ''} gap-2`}>
      <div className={`${CARD} border-emerald-200 dark:border-emerald-800`}>
        {qrBox(oa?.qr ?? null, 'สำหรับลูกค้า', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200')}
        <div className="flex-1 min-w-0 space-y-2">
          <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <UserPlus className="w-4 h-4 text-emerald-700 dark:text-emerald-400" /> เชื่อมต่อ LINE สำหรับลูกค้า
          </h3>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            <div className="flex items-center justify-between gap-2 p-2">
              <div className="min-w-0">
                <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">LINE Official ID</span>
                <span className="block font-mono font-bold text-slate-900 dark:text-slate-100 truncate">{oa?.lineId || 'ยังไม่ได้ตั้ง'}</span>
              </div>
              {oa?.lineId && (
                <ActionButton variant="share" icon={<Copy />} onClick={() => void copy(oa.lineId as string, 'คัดลอก LINE ID แล้ว')}>
                  คัดลอก ID
                </ActionButton>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 p-2">
              <div className="min-w-0">
                <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">ลิงก์เพิ่มเพื่อน</span>
                <span className="block font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate">{oa?.addFriendUrl || '-'}</span>
              </div>
              {oa?.addFriendUrl && (
                <ActionButton variant="share" icon={<Link2 />} onClick={() => void copy(oa.addFriendUrl as string, 'คัดลอกลิงก์เพิ่มเพื่อนแล้ว')}>
                  คัดลอกลิงก์
                </ActionButton>
              )}
            </div>
          </div>
        </div>
      </div>

      {isOwner && (
        <div className={`${CARD} border-red-200 dark:border-red-900`}>
          {qrBox(null, 'สำหรับพนักงานร้าน', 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200')}
          <div className="flex-1 min-w-0 space-y-2">
            <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" /> เชื่อมต่อ LINE พนักงานร้าน
            </h3>
            <p className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 dark:text-red-300">
              <Ban className="w-3.5 h-3.5" /> สแกนที่หน้าร้านเท่านั้น · QR ใช้ได้ 5 นาที · สแกนแล้วหมดอายุทันที
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <CustomSelect
                ariaLabel="เลือกพนักงาน"
                value={pick}
                onChange={(v) => setPick(String(v))}
                placeholder="พนักงานผูก LINE ครบแล้ว"
                options={staff.map((s) => ({ value: s.id, label: s.name }))}
                className="w-48"
              />
              <ActionButton
                variant="primary"
                icon={<QrCode />}
                disabled={!pick}
                onClick={() => {
                  const s = staff.find((x) => x.id === pick)
                  if (s) setQrFor(s)
                }}
              >
                แสดง QR
              </ActionButton>
            </div>
          </div>
        </div>
      )}
      {qrFor && <StaffQrModal profileId={qrFor.id} name={qrFor.name} onClose={() => setQrFor(null)} onLinked={() => void loadStaff()} />}
    </div>
  )
}
