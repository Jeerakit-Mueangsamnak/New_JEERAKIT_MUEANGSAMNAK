'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Ban, CheckCircle2, HelpCircle, MessageCircle, UserCheck, UserMinus } from 'lucide-react'
import { ActionButton } from '@/components/common/ActionButton'
import { NumericInput } from '@/components/common/NumericInput'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { createClient } from '@/lib/supabase/client'
import {
  approveLineRegister,
  confirmLineContactReview,
  listLineAudit,
  listLineRestrictions,
  setLineRestriction,
  type LineRestriction,
  needInfoLineRegister,
  registerLineContactByShop,
  rejectLineContact,
  sendLineContactMessage,
  unlinkLineContact,
  type LineAuditRow,
  type LinePerson,
} from '@/app/actions/line'
import { LINE_RESTRICTION_SCOPES, type LineRestrictionScope, LINE_REGISTER_FIELD_LABELS, LINE_REGISTER_FIELDS, type LineRegisterField } from '@/lib/line/config'
import { SETTINGS_INPUT, SETTINGS_LABEL } from '@/features/settings/components/settings-ui'
import { LinePersonAvatar } from '@/features/settings/components/line/LinePersonAvatar'
import {
  addressText,
  canDecide,
  canMessage,
  canRegisterByShop,
  canReject,
  canReview,
  canUnlink,
  channelText,
  friendPill,
  kindPill,
  linkPill,
  matchHint,
  personName,
  personPhone,
  PILL_TONE,
  registerPill,
  thaiDateTime,
  type Pill,
} from '@/features/settings/components/line/line-people-model'

type Mode = 'view' | 'needinfo' | 'approve' | 'reject' | 'byshop' | 'message' | 'suspend' | 'restore'
interface CustomerLite {
  id: string
  name: string
  phone: string
}
interface DeliveryLite {
  id: string
  template_key: string
  status: string
  created_at: string
}

const PILL = 'inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold whitespace-nowrap'
const AUDIT_LABEL: Record<string, string> = {
  LINE_REGISTER: 'ส่งคำขอลงทะเบียน',
  LINE_REGISTER_APPROVE: 'อนุมัติ',
  LINE_REGISTER_NEED_INFO: 'ขอข้อมูลเพิ่ม',
  LINE_CONTACT_REJECT: 'ปฏิเสธ',
  LINE_LINK: 'ผูกบัญชี',
  LINE_UNLINK: 'ยกเลิกการผูก',
  LINE_SHOP_MESSAGE: 'ร้านส่งข้อความ',
  LINE_CODE_REVOKE: 'ยกเลิกรหัส',
  CUSTOMER_CREATE: 'สร้างลูกค้า',
}
const DELIVERY_STATUS: Record<string, string> = { PENDING: 'รอส่ง', SENDING: 'กำลังส่ง', SENT: 'ส่งแล้ว', FAILED: 'ส่งไม่สำเร็จ', DEAD: 'ส่งไม่สำเร็จ', CANCELLED: 'ยกเลิก' }
const EMPTY_ADDRESS: Record<LineRegisterField, string> = { province: '', district: '', subdistrict: '', address: '', postcode: '' }
const newKey = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const PillView = ({ pill }: { pill: Pill }) => <span className={`${PILL} ${PILL_TONE[pill.tone]}`}>{pill.text}</span>
const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[8.5rem_1fr] gap-2 py-1.5 border-b border-slate-100 dark:border-slate-700/60 text-xs">
    <span className="text-slate-600 dark:text-slate-400">{label}</span>
    <span className="min-w-0 font-semibold text-slate-900 dark:text-slate-100 break-words">{children}</span>
  </div>
)
const unknown = (text: string | null | undefined, fallback = 'ยังไม่ระบุ') => (text && text.trim() ? text : fallback)

/**
 * One person (owner 2026-11-21): what is known, with "ยังไม่ระบุ" / "ยังไม่ทราบ" for what is not, and only the buttons
 * that fit the person's state. A shop member decides a request here; the database does the checking (never a LINE that
 * already belongs to a customer) and writes the audit; the person is told unless the owner switched that off.
 */
export function LineContactDetail({ person: p, isOwner, onClose, onChanged }: { person: LinePerson; isOwner: boolean; onClose: () => void; onChanged: () => void }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [mode, setMode] = useState<Mode>('view')
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [restrictions, setRestrictions] = useState<LineRestriction[]>([])
  const [scope, setScope] = useState<LineRestrictionScope>('ALL')
  const [minutes, setMinutes] = useState('15')
  const [permanent, setPermanent] = useState(false)
  const [text, setText] = useState('')
  // approve
  const [how, setHow] = useState<'NEW' | 'EXISTING'>('NEW')
  const [name, setName] = useState(p.typed_name ?? '')
  const [phone, setPhone] = useState(p.typed_phone ?? '')
  const [address, setAddress] = useState<Record<LineRegisterField, string>>({ ...EMPTY_ADDRESS, ...(p.register_payload?.address ?? {}) })
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<CustomerLite[]>([])
  const [chosen, setChosen] = useState<CustomerLite | null>(null)
  // what was already known / done
  const [hint, setHint] = useState<CustomerLite | null>(null)
  const [deliveries, setDeliveries] = useState<DeliveryLite[]>([])
  const [history, setHistory] = useState<LineAuditRow[] | null>(null)

  // The customer the typed phone matched (for the shop's hint) and the last messages to this person: two small reads.
  useEffect(() => {
    let alive = true
    const db = createClient()
    void (async () => {
      if (p.register_customer_id) {
        const { data } = await db.from('customers').select('id, name, phone').eq('id', p.register_customer_id).maybeSingle()
        if (alive && data) {
          setHint(data as CustomerLite)
          setChosen((c) => c ?? (data as CustomerLite))
        }
      }
      const { data: sent } = await db.from('line_deliveries').select('id, template_key, status, created_at').eq('contact_id', p.id).order('created_at', { ascending: false }).limit(8)
      if (alive) setDeliveries((sent as DeliveryLite[] | null) ?? [])
      if (isOwner) {
        const [r, limits] = await Promise.all([listLineAudit(0, p.id), listLineRestrictions(p.id)])
        if (alive && r.success) setHistory(r.data ?? [])
        if (alive && limits.success) setRestrictions(limits.data ?? [])
      }
    })()
    return () => {
      alive = false
    }
  }, [p.id, p.register_customer_id, isOwner])

  // searching the shop's customers for "เชื่อมกับลูกค้าเดิม"
  useEffect(() => {
    const q = search.replace(/[^\p{L}\p{N} ]/gu, '').trim()
    if (how !== 'EXISTING' || q.length < 2) {
      setFound([])
      return
    }
    let alive = true
    const t = setTimeout(async () => {
      const { data } = await createClient().from('customers').select('id, name, phone').eq('active', true).or(`name.ilike.%${q}%,phone.ilike.%${q}%`).order('name').limit(8)
      if (alive) setFound((data as CustomerLite[] | null) ?? [])
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [search, how])

  const approvedRow = useMemo(() => history?.find((h) => h.action === 'LINE_REGISTER_APPROVE'), [history])
  const done = (title: string, body?: string) => {
    showToast(title, body, 'SUCCESS')
    onChanged()
    onClose()
  }
  const fail = (error?: string) => showToast('ทำรายการไม่สำเร็จ', error || 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
  const run = async (fn: () => Promise<void>) => {
    if (running.current || (!isOwner && mode !== 'message')) return
    running.current = true
    setBusy(true)
    try {
      await fn()
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const needInfo = () =>
    run(async () => {
      const r = await needInfoLineRegister(p.id, text)
      if (!r.success) return fail(r.error)
      done('บันทึกคำขอข้อมูลเพิ่มแล้ว', 'ตรวจสถานะการส่งได้ในประวัติข้อความ')
    })

  const approve = () =>
    run(async () => {
      const r = await approveLineRegister(
        how === 'EXISTING'
          ? { contactId: p.id, customerId: chosen?.id }
          : { contactId: p.id, name, phone, address },
      )
      if (!r.success || !r.data) return fail(r.error)
      done(r.data.created ? 'อนุมัติและสร้างลูกค้าแล้ว' : 'อนุมัติและผูกกับลูกค้าเดิมแล้ว', r.data.name)
    })

  const reject = () =>
    run(async () => {
      const r = await rejectLineContact(p.id, text)
      if (!r.success) return fail(r.error)
      done('ปฏิเสธแล้ว', 'รายชื่อนี้ไม่ผูกกับใคร')
    })

  const byShop = () =>
    run(async () => {
      const r = await registerLineContactByShop(p.id, name, phone)
      if (!r.success || !r.data) return fail(r.error)
      if (r.data.result === 'LINKED_CUSTOMER') return done(r.data.created ? 'สร้างลูกค้าและผูก LINE แล้ว' : 'ผูก LINE กับลูกค้าเดิมแล้ว', r.data.name)
      if (r.data.result === 'PHONE_TAKEN') return fail('เบอร์นี้เป็นของลูกค้าที่ผูก LINE อื่นไว้แล้ว 1 คนผูกได้ 1 LINE')
      if (r.data.result === 'DUPLICATE') return fail('เบอร์นี้มีลูกค้าหลายรายการ ให้แก้ข้อมูลลูกค้าที่ซ้ำก่อน')
      fail('ใส่ชื่อ-นามสกุลและเบอร์โทร 10 หลัก')
    })

  const reviewOk = () =>
    run(async () => {
      const r = await confirmLineContactReview(p.id)
      if (!r.success) return fail(r.error)
      done('ยืนยันแล้ว', 'การผูก LINE นี้ถูกต้อง')
    })

  const unlink = async () => {
    const ok = await confirm({
      title: `ยกเลิกการผูก LINE: ${personName(p)}`,
      message: 'ข้อความที่ยังไม่ส่งถึงคนนี้จะถูกยกเลิก และต้องผูกใหม่เมื่อต้องการส่งอีก',
      confirmLabel: 'ยกเลิกการผูก',
      danger: true,
    })
    if (!ok) return
    await run(async () => {
      const r = await unlinkLineContact(p.id)
      if (!r.success) return fail(r.error)
      done('ยกเลิกการผูกแล้ว', personName(p))
    })
  }

  const message = () =>
    run(async () => {
      const r = await sendLineContactMessage(p.id, text, newKey())
      if (!r.success || !r.data) return fail(r.error)
      done(r.data.mode === 'mock' ? 'บันทึกข้อความแล้ว (โหมดทดสอบ ยังไม่ส่งถึง LINE จริง)' : r.data.status === 'SENT' ? 'ส่งข้อความแล้ว' : 'รับข้อความแล้ว กำลังส่ง')
    })

  const saveRestriction = () => run(async () => {
    const duration = Number(minutes)
    if (mode === 'suspend' && !permanent && (!Number.isInteger(duration) || duration < 1 || duration > 525600)) return fail('ระบุระยะเวลา 1–525600 นาที')
    const until = mode === 'restore' || permanent ? null : new Date(Date.now() + duration * 60000).toISOString()
    const r = await setLineRestriction(p.id, scope, until, text, mode === 'restore')
    if (!r.success) return fail(r.error)
    done(mode === 'restore' ? 'ยกเลิกการระงับแล้ว' : 'ระงับสิทธิ์แล้ว', LINE_RESTRICTION_SCOPES[scope])
  })

  const back = () => {
    setMode('view')
    setText('')
  }
  const phoneDigits = phone.replace(/\D/g, '')
  const approveReady = how === 'EXISTING' ? chosen !== null : name.trim() !== '' && /^0\d{9}$/.test(phoneDigits)
  const phoneOk = /^0\d{9}$/.test(phoneDigits)

  const buttons =
    mode === 'view' ? (
      <>
        {isOwner && canDecide(p) && <ActionButton variant="primary" icon={<CheckCircle2 />} onClick={() => setMode('approve')}>อนุมัติ</ActionButton>}
        {isOwner && canDecide(p) && <ActionButton variant="outline" icon={<HelpCircle />} onClick={() => setMode('needinfo')}>ขอข้อมูลเพิ่ม</ActionButton>}
        {isOwner && canRegisterByShop(p) && <ActionButton variant="outline" icon={<UserCheck />} onClick={() => setMode('byshop')}>ร้านกรอกให้</ActionButton>}
        {isOwner && canReview(p) && <ActionButton variant="primary" icon={<CheckCircle2 />} disabled={busy} onClick={() => void reviewOk()}>ยืนยันว่าถูกต้อง</ActionButton>}
        {canMessage(p) && <ActionButton variant="outline" icon={<MessageCircle />} onClick={() => setMode('message')}>ติดต่อผ่าน LINE</ActionButton>}
        {isOwner && <ActionButton variant="danger" icon={<Ban />} onClick={() => { setText(''); setMode('suspend') }}>ระงับสิทธิ์</ActionButton>}
        {isOwner && canReject(p) && <ActionButton variant="danger" icon={<Ban />} onClick={() => setMode('reject')}>ปฏิเสธ</ActionButton>}
        {isOwner && canUnlink(p) && <ActionButton variant="danger" icon={<UserMinus />} disabled={busy} onClick={() => void unlink()}>ยกเลิกการผูกบัญชี</ActionButton>}
      </>
    ) : (
      <>
        <ActionButton variant="cancel" onClick={back} disabled={busy}>ย้อนกลับ</ActionButton>
        {(mode === 'suspend' || mode === 'restore') && <ActionButton variant={mode === 'suspend' ? 'danger' : 'primary'} disabled={busy || !text.trim()} onClick={() => void saveRestriction()}>{mode === 'restore' ? 'ยืนยันยกเลิกการระงับ' : 'ยืนยันระงับสิทธิ์'}</ActionButton>}
        {mode === 'needinfo' && <ActionButton variant="primary" disabled={busy || text.trim() === ''} onClick={() => void needInfo()}>ส่งข้อความขอข้อมูล</ActionButton>}
        {mode === 'approve' && <ActionButton variant="primary" disabled={busy || !approveReady} onClick={() => void approve()}>{how === 'EXISTING' ? 'อนุมัติและเชื่อมกับลูกค้าเดิม' : 'อนุมัติและสร้างลูกค้า'}</ActionButton>}
        {mode === 'reject' && <ActionButton variant="danger" disabled={busy || text.trim() === ''} onClick={() => void reject()}>ปฏิเสธ</ActionButton>}
        {mode === 'byshop' && <ActionButton variant="primary" disabled={busy || name.trim() === '' || !phoneOk} onClick={() => void byShop()}>บันทึกและผูก LINE</ActionButton>}
        {mode === 'message' && <ActionButton variant="primary" disabled={busy || text.trim() === ''} onClick={() => void message()}>ส่งข้อความ</ActionButton>}
      </>
    )

  return (
    <AppModal isOpen onClose={onClose} size="lg">
      <AppModalHeader title={p.display_name || 'LINE ที่ไม่ทราบชื่อ'} icon={<LinePersonAvatar name={p.display_name} pictureUrl={p.picture_url} />} onClose={onClose} />
      <AppModalBody className="space-y-3 text-xs">
        {mode === 'view' && (
          <>
            {matchHint(p, hint?.name ?? null) && (
              <p className="rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200">{matchHint(p, hint?.name ?? null)}</p>
            )}
            <div>
              <Row label="รูป / ชื่อใน LINE">
                <span className="flex items-center gap-2">
                  <LinePersonAvatar name={p.display_name} pictureUrl={p.picture_url} size="lg" />
                  {unknown(p.display_name, 'ยังไม่ทราบ')}
                </span>
              </Row>
              <Row label="ชื่อจริง / ชื่อกิจการ">{unknown(p.customer_name || p.profile_name || p.typed_name)}</Row>
              <Row label="เบอร์โทรศัพท์">{unknown(personPhone(p))}</Row>
              <Row label="ที่อยู่ที่แจ้ง">{unknown(addressText(p))}</Row>
              <Row label="ประเภทบุคคล"><PillView pill={kindPill(p)} /></Row>
              <Row label="สถานะ">
                <span className="flex flex-wrap gap-1">
                  <PillView pill={friendPill(p)} />
                  <PillView pill={registerPill(p)} />
                  <PillView pill={linkPill(p)} />
                </span>
              </Row>
              <Row label="เพิ่มเพื่อนเมื่อ">{thaiDateTime(p.followed_at)}</Row>
              <Row label="ลงทะเบียนเมื่อ">{p.register_payload?.submitted_at ? `${thaiDateTime(p.register_payload.submitted_at)}${channelText(p) ? ` · ${channelText(p)}` : ''}` : 'ยังไม่ทราบ'}</Row>
              <Row label="อนุมัติเมื่อ / โดย">{approvedRow ? `${thaiDateTime(approvedRow.created_at)} · ${approvedRow.actor}` : p.status === 'LINKED' ? `ผูกเมื่อ ${thaiDateTime(p.linked_at)}` : 'ยังไม่ทราบ'}</Row>
              <Row label="ข้อมูลที่เชื่อมโยง">{p.customer_name ? `ลูกค้า ${p.customer_name}` : p.profile_name ? `พนักงาน ${p.profile_name}` : p.driver_code ? `คนขับรถ ${p.driver_code}` : 'ยังไม่ผูกกับใคร'}</Row>
              {p.register_note && <Row label="ข้อความจากร้าน / เหตุผล">{p.register_note}</Row>}
              {p.unlink_reason && <Row label="เหตุผลที่ยกเลิกผูก">{p.unlink_reason}</Row>}
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-slate-100 mb-1">ประวัติการแจ้งเตือน (ล่าสุด 8 รายการ)</h4>
              {deliveries.length === 0 ? (
                <p className="text-slate-600 dark:text-slate-400">ยังไม่มีข้อความที่ส่งถึงคนนี้</p>
              ) : (
                <ul className="space-y-0.5">
                  {deliveries.map((d) => (
                    <li key={d.id} className="flex justify-between gap-2 tabular-nums text-slate-800 dark:text-slate-200">
                      <span>{d.template_key}</span>
                      <span>{DELIVERY_STATUS[d.status] ?? d.status} · {thaiDateTime(d.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {isOwner && restrictions.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-bold">การระงับสิทธิ์</h4>
                {restrictions.map((r) => <div key={r.scope} className="rounded-lg border border-slate-200 p-2 space-y-1">
                  <p className="font-semibold">{LINE_RESTRICTION_SCOPES[r.scope]} · {r.active ? 'ระงับอยู่' : r.revoked_at ? 'ยกเลิกแล้ว' : 'หมดเวลาแล้ว'}</p>
                  <p>{r.reason}</p>
                  <p>{thaiDateTime(r.created_at)} · {r.created_by} · {r.source === 'ABUSE' ? 'ระบบป้องกันสแปม' : 'เจ้าของร้าน'}</p>
                  <p>สิ้นสุด: {r.until_at ? thaiDateTime(r.until_at) : 'ถาวร'}</p>
                  {r.active && <ActionButton variant="outline" onClick={() => { setScope(r.scope); setText(''); setMode('restore') }}>ยกเลิกการระงับ</ActionButton>}
                </div>)}
              </div>
            )}
            {isOwner && (
              <div>
                <h4 className="font-bold text-slate-900 dark:text-slate-100 mb-1">ประวัติการแก้ไข</h4>
                {history === null ? (
                  <p className="text-slate-600 dark:text-slate-400">กำลังโหลด…</p>
                ) : history.length === 0 ? (
                  <p className="text-slate-600 dark:text-slate-400">ยังไม่มีประวัติ</p>
                ) : (
                  <ul className="space-y-0.5">
                    {history.map((h) => (
                      <li key={h.id} className="flex justify-between gap-2 text-slate-800 dark:text-slate-200">
                        <span>{AUDIT_LABEL[h.action] ?? h.action}{h.result === 'FAILED' ? ' (ไม่สำเร็จ)' : ''} · {h.actor}</span>
                        <span className="tabular-nums">{thaiDateTime(h.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {(mode === 'suspend' || mode === 'restore') && (
          <div className="space-y-3">
            <label className={SETTINGS_LABEL} htmlFor="line-restriction-scope">ประเภทการใช้งาน</label>
            <select id="line-restriction-scope" className={SETTINGS_INPUT} value={scope} disabled={mode === 'restore'} onChange={(e) => setScope(e.target.value as LineRestrictionScope)}>
              {Object.entries(LINE_RESTRICTION_SCOPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            {mode === 'suspend' && <>
              <label className="flex items-center gap-2"><input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />ระงับถาวร</label>
              {!permanent && <><label className={SETTINGS_LABEL} htmlFor="line-restriction-minutes">ระยะเวลา (นาที)</label><NumericInput id="line-restriction-minutes" className={SETTINGS_INPUT} allowDecimals={false} min={1} max={525600} value={minutes} onChange={(v) => setMinutes(v === '' ? '' : String(v))} /></>}
            </>}
            <label className={SETTINGS_LABEL} htmlFor="line-restriction-reason">เหตุผล</label>
            <textarea id="line-restriction-reason" className={SETTINGS_INPUT} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        )}
        {mode === 'needinfo' && (
          <div>
            <label className={SETTINGS_LABEL} htmlFor="line-need-info">ข้อความขอข้อมูลเพิ่ม (ส่งเข้าแชต LINE ของคนนี้)</label>
            <textarea id="line-need-info" autoFocus maxLength={500} value={text} onChange={(e) => setText(e.target.value)} className={`${SETTINGS_INPUT} min-h-[100px] h-auto py-2 resize-none`} />
          </div>
        )}

        {mode === 'reject' && (
          <div>
            <label className={SETTINGS_LABEL} htmlFor="line-reject-reason">เหตุผลที่ปฏิเสธ</label>
            <textarea id="line-reject-reason" autoFocus maxLength={500} value={text} onChange={(e) => setText(e.target.value)} className={`${SETTINGS_INPUT} min-h-[80px] h-auto py-2 resize-none`} />
          </div>
        )}

        {mode === 'message' && (
          <div>
            <label className={SETTINGS_LABEL} htmlFor="line-contact-message">ข้อความถึง {personName(p)}</label>
            <textarea id="line-contact-message" autoFocus maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} className={`${SETTINGS_INPUT} min-h-[100px] h-auto py-2 resize-none`} />
          </div>
        )}

        {mode === 'byshop' && (
          <div className="space-y-2">
            <div>
              <label className={SETTINGS_LABEL} htmlFor="line-shop-name">ชื่อ-นามสกุล</label>
              <input id="line-shop-name" autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={SETTINGS_INPUT} />
            </div>
            <div>
              <label className={SETTINGS_LABEL} htmlFor="line-shop-phone">เบอร์โทร (10 หลัก)</label>
              <input id="line-shop-phone" inputMode="tel" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} className={SETTINGS_INPUT} />
            </div>
          </div>
        )}

        {mode === 'approve' && (
          <div className="space-y-3">
            <div role="radiogroup" aria-label="วิธีอนุมัติ" className="flex flex-wrap gap-2">
              {(['NEW', 'EXISTING'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={how === v}
                  onClick={() => setHow(v)}
                  className={`h-8 px-3 rounded-lg border text-xs font-bold cursor-pointer ${how === v ? 'bg-emerald-700 text-white border-emerald-700' : 'border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200'}`}
                >
                  {v === 'NEW' ? 'สร้างลูกค้าใหม่' : 'เชื่อมกับลูกค้าเดิม'}
                </button>
              ))}
            </div>
            {how === 'NEW' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={SETTINGS_LABEL} htmlFor="line-ap-name">ชื่อ-นามสกุล / ชื่อกิจการ</label>
                  <input id="line-ap-name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={SETTINGS_INPUT} />
                </div>
                <div>
                  <label className={SETTINGS_LABEL} htmlFor="line-ap-phone">เบอร์โทร (10 หลัก)</label>
                  <input id="line-ap-phone" inputMode="tel" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} className={SETTINGS_INPUT} />
                </div>
                {LINE_REGISTER_FIELDS.map((f) => (
                  <div key={f}>
                    <label className={SETTINGS_LABEL} htmlFor={`line-ap-${f}`}>{LINE_REGISTER_FIELD_LABELS[f]}</label>
                    <input id={`line-ap-${f}`} maxLength={f === 'address' ? 300 : 100} value={address[f]} onChange={(e) => setAddress((a) => ({ ...a, [f]: e.target.value }))} className={SETTINGS_INPUT} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {hint && (
                  <button type="button" onClick={() => setChosen(hint)} className="w-full text-left rounded-lg border border-amber-300 dark:border-amber-700 px-3 py-2 cursor-pointer">
                    <b>{hint.name}</b> · {hint.phone} <span className="text-amber-800 dark:text-amber-300">(เบอร์ตรงกับที่แจ้ง)</span>
                  </button>
                )}
                <div>
                  <label className={SETTINGS_LABEL} htmlFor="line-ap-search">ค้นหาลูกค้า (ชื่อหรือเบอร์)</label>
                  <input id="line-ap-search" value={search} onChange={(e) => setSearch(e.target.value)} className={SETTINGS_INPUT} />
                </div>
                {found.length > 0 && (
                  <ul className="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                    {found.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => setChosen(c)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer">
                          <b>{c.name}</b> · {c.phone}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-slate-800 dark:text-slate-200">
                  ลูกค้าที่เลือก: <b>{chosen ? `${chosen.name} · ${chosen.phone}` : 'ยังไม่ได้เลือก'}</b>
                </p>
              </div>
            )}
          </div>
        )}
      </AppModalBody>
      <AppModalFooter>
        <div className="flex flex-wrap justify-end gap-2">{buttons}</div>
      </AppModalFooter>
    </AppModal>
  )
}
