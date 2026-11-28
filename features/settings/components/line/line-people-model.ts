import type { LinePerson, LinePeopleView } from '@/app/actions/line'
import { LINE_REGISTER_FIELDS, LINE_REGISTER_FIELD_LABELS } from '@/lib/line/config'

/**
 * How a person in คนใน LINE is described (owner 2026-11-21): four separate things, never one status for everything —
 * is the person a friend of the OA, has the person registered, is the LINE linked, and who is it.
 * Nothing here guesses: what LINE or the person did not give shows as "ยังไม่ระบุ" / "ยังไม่ทราบ".
 */

export type PillTone = 'slate' | 'emerald' | 'amber' | 'blue' | 'red' | 'violet'
export interface Pill {
  text: string
  tone: PillTone
}

export const PILL_TONE: Record<PillTone, string> = {
  slate: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
}

/** Request states the shop decides on (the two typed-by-shop failures count as a request to look at by hand). */
const OPEN_REQUEST = ['PENDING', 'NEED_INFO', 'PHONE_TAKEN', 'DUPLICATE']

export function friendPill(p: LinePerson): Pill {
  if (p.followed) return { text: 'เป็นเพื่อน', tone: 'emerald' }
  return p.followed_at ? { text: 'บล็อก/ลบ LINE ร้าน', tone: 'red' } : { text: 'ยังไม่เป็นเพื่อน', tone: 'slate' }
}

export function registerPill(p: LinePerson): Pill {
  if (p.status === 'LINKED') return { text: 'ลงทะเบียนแล้ว', tone: 'emerald' }
  switch (p.register_status) {
    case 'PENDING':
    case 'PHONE_TAKEN':
    case 'DUPLICATE':
      return { text: 'รอร้านตรวจสอบ', tone: 'blue' }
    case 'NEED_INFO':
      return { text: 'รอข้อมูลเพิ่มเติม', tone: 'amber' }
    case 'REJECTED':
      return { text: 'ถูกปฏิเสธ', tone: 'red' }
    default:
      return { text: 'ยังไม่ลงทะเบียน', tone: 'slate' }
  }
}

export function linkPill(p: LinePerson): Pill {
  if (p.status === 'LINKED') return p.needs_review ? { text: 'ผูกแล้ว รอร้านยืนยัน', tone: 'amber' } : { text: 'ผูกบัญชีแล้ว', tone: 'emerald' }
  return p.unlinked_at ? { text: 'ยกเลิกผูกแล้ว', tone: 'slate' } : { text: 'ยังไม่ผูก', tone: 'slate' }
}

/** Who the person is: only what the shop has confirmed (a linked customer / staff / driver), else a general person. */
export function kindPill(p: LinePerson): Pill {
  if (p.status === 'LINKED') {
    if (p.customer_id) return { text: 'ลูกค้า', tone: 'violet' }
    if (p.profile_id) return { text: 'พนักงาน', tone: 'violet' }
    if (p.driver_code) return { text: 'คนขับรถ', tone: 'violet' }
  }
  return { text: 'บุคคลทั่วไป', tone: 'slate' }
}

/** The name the shop should read first: the confirmed one, then what was typed, then the LINE profile name. */
export function personName(p: LinePerson): string {
  return p.customer_name || p.profile_name || p.typed_name || p.display_name || 'LINE ที่ไม่ทราบชื่อ'
}

export function personPhone(p: LinePerson): string | null {
  const raw = p.customer_phone || p.typed_phone
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  return /^\d{10}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : raw
}

/** The address the person gave in the form, in reading order; null when none was given. */
export function addressText(p: LinePerson): string | null {
  const a = p.register_payload?.address
  if (!a) return null
  const parts = (['address', 'subdistrict', 'district', 'province', 'postcode'] as const).map((k) => (a[k] ? (k === 'subdistrict' ? `ต.${a[k]}` : k === 'district' ? `อ.${a[k]}` : k === 'province' ? `จ.${a[k]}` : a[k]) : ''))
  const text = parts.filter(Boolean).join(' ')
  return text || null
}

/** What the shop's own form needs to show a person a short summary of the request's channel. */
export function channelText(p: LinePerson): string | null {
  const c = p.register_payload?.channel
  return c === 'FORM' ? 'ฟอร์มลงทะเบียน' : c === 'CHAT' ? 'พิมพ์ในแชต' : null
}

export const canDecide = (p: LinePerson) => p.status === 'UNLINKED' && OPEN_REQUEST.includes(p.register_status ?? '')
export const canReject = (p: LinePerson) => p.status === 'UNLINKED' && p.register_status !== 'REJECTED'
export const canRegisterByShop = (p: LinePerson) => p.status === 'UNLINKED' && (p.register_status === null || p.register_status === 'WAITING')
export const canUnlink = (p: LinePerson) => p.status === 'LINKED'
export const canReview = (p: LinePerson) => p.status === 'LINKED' && p.needs_review
export const canMessage = (p: LinePerson) => p.followed

/** The hint the shop reads about what the typed phone matched (never shown to the person). */
export function matchHint(p: LinePerson, customerName: string | null): string | null {
  if (!canDecide(p)) return null
  switch (p.register_payload?.match) {
    case 'ONE':
      return `เบอร์ที่แจ้งตรงกับลูกค้า "${customerName || '-'}" ตรวจให้แน่ใจว่าเป็นคนเดียวกันก่อนอนุมัติ (ระบบยังไม่ได้ผูกให้)`
    case 'TAKEN':
      return 'เบอร์นี้เป็นของลูกค้าที่ผูก LINE อื่นไว้แล้ว อาจเป็นคนสวมสิทธิ์ ตรวจให้แน่ใจก่อน (1 คนผูกได้ 1 LINE)'
    case 'MANY':
      return 'เบอร์ที่แจ้งตรงกับลูกค้าหลายรายการ ให้แก้ข้อมูลลูกค้าที่ซ้ำก่อน'
    case 'NONE':
      return 'ไม่พบเบอร์นี้ในลูกค้าเดิม ถ้าอนุมัติแบบสร้างใหม่ จะเพิ่มลูกค้าใหม่ในระบบ'
    default:
      return null
  }
}

/** Address parts the owner marked as a must, for the label of the form preview in settings. */
export const REGISTER_FIELD_LABELS = LINE_REGISTER_FIELDS.map((f) => LINE_REGISTER_FIELD_LABELS[f])

/** The pages of คนใน LINE that are lists of people, with the Thai name each one has in the menu. */
export const PEOPLE_VIEW_LABEL: Record<LinePeopleView, string> = {
  ALL: 'เพื่อนทั้งหมด',
  UNREG: 'ยังไม่ลงทะเบียน',
  PENDING: 'รอร้านตรวจสอบ',
  NEEDINFO: 'รอข้อมูลเพิ่มเติม',
  CUSTOMERS: 'ลูกค้า',
  MEMBERS: 'สมาชิก',
  STAFF: 'พนักงาน',
  DRIVERS: 'คนขับรถ',
  GENERAL: 'บุคคลทั่วไป',
  REJECTED: 'ถูกปฏิเสธ',
  UNLINKED: 'ยกเลิกผูกบัญชี',
  BLOCKED: 'บล็อก LINE OA',
}

export const thaiDateTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ยังไม่ทราบ'
