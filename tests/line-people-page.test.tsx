// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

/** คนใน LINE (/line): three pages with a menu each, lists a page at a time, deciding a request; and the customer page "สร้างลิงก์ผูก LINE" button. */

const C1 = '11111111-2222-4333-8444-000000000001'
const C2 = '11111111-2222-4333-8444-000000000002'
const C3 = '11111111-2222-4333-8444-000000000003'
const CUST = '11111111-2222-4333-8444-0000000000c1'

const m = vi.hoisted(() => ({
  role: 'USER' as string,
  counts: vi.fn(),
  list: vi.fn(),
  register: vi.fn(),
  reject: vi.fn(),
  unlink: vi.fn(),
  approve: vi.fn(),
  needInfo: vi.fn(),
  review: vi.fn(),
  message: vi.fn(),
  audit: vi.fn(),
  restrictions: vi.fn(),
  setRestriction: vi.fn(),
  code: vi.fn(),
  oa: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  linked: vi.fn(),
  customer: null as unknown,
  customers: [] as unknown[],
}))

/** Thenable query builder: filters return itself; awaiting gives the rows of the table; maybeSingle gives one. */
function query(table: string) {
  const q: Record<string, unknown> = {}
  const self = () => q
  Object.assign(q, {
    select: self,
    eq: self,
    or: self,
    order: self,
    limit: self,
    maybeSingle: () => (table === 'customers' ? Promise.resolve({ data: m.customer, error: null }) : m.linked()),
    then: (resolve: (v: unknown) => void) => Promise.resolve({ data: table === 'customers' ? m.customers : [], error: null }).then(resolve),
  })
  return q
}

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (t: string) => query(t) }) }))
vi.mock('@/app/actions/line', () => ({
  getLinePeopleCounts: m.counts,
  listLinePeople: m.list,
  registerLineContactByShop: m.register,
  rejectLineContact: m.reject,
  unlinkLineContact: m.unlink,
  approveLineRegister: m.approve,
  needInfoLineRegister: m.needInfo,
  confirmLineContactReview: m.review,
  sendLineContactMessage: m.message,
  listLineAudit: m.audit,
  listLineRestrictions: m.restrictions,
  setLineRestriction: m.setRestriction,
  getLineOaInfo: m.oa,
  createCustomerLineLinkCode: m.code,
}))
vi.mock('@/features/settings/components/DeliveryDriversPanel', () => ({ DeliveryDriversPanel: () => <div>พนักงานส่งของ (stub)</div> }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AAA') } }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: m.toast }) }))
vi.mock('@/components/common/ConfirmDialogProvider', () => ({ useConfirm: () => m.confirm }))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: m.role, status: 'ACTIVE', menus: [] } }) }))
vi.mock('@/features/settings/components/LineSettingsWorkspace', () => ({ LineSettingsWorkspace: () => <div>ตั้งค่า LINE (stub)</div> }))
vi.mock('@/features/settings/components/LineBillCardDesigner', () => ({ LineBillCardDesigner: () => <div>การ์ดบิล (stub)</div> }))
vi.mock('@/features/settings/components/LineMessageComposer', () => ({ LineMessageComposer: () => <div>เขียนข้อความ (stub)</div> }))
vi.mock('@/features/settings/components/LineSettingsPanel', () => ({ LineConnectionPanel: () => <div>เชื่อมต่อ LINE (stub)</div> }))
vi.mock('@/features/settings/components/LineMembersPanel', () => ({ LineMembersPanel: () => <div>พนักงานร้าน (stub)</div> }))
vi.mock('@/features/settings/components/LineRemindersPanel', () => ({ LineRemindersPanel: () => <div>ส่งเตือนเอง (stub)</div> }))
vi.mock('@/features/settings/components/LineDeliveryLogPanel', () => ({ LineDeliveryLogPanel: () => <div>ประวัติการส่ง (stub)</div> }))
vi.mock('@/features/settings/components/line/LineCodesPanel', () => ({ LineCodesPanel: () => <div>รหัสเชิญ (stub)</div> }))
vi.mock('@/features/settings/components/line/LineAuditPanel', () => ({ LineAuditPanel: () => <div>ประวัติการตรวจสอบ (stub)</div> }))

import { LinePeoplePage } from '@/features/settings/components/LinePeoplePage'
import { CustomerLineLinkButton } from '@/features/customers/components/CustomerLineLinkButton'

const person = (over: Record<string, unknown>) => ({
  id: C1,
  display_name: 'Ton_rider',
  picture_url: null,
  status: 'UNLINKED',
  followed: true,
  followed_at: '2026-10-31T01:00:00Z',
  created_at: '2026-10-31T01:00:00Z',
  last_event_at: '2026-10-31T01:00:00Z',
  register_status: 'WAITING',
  register_note: null,
  register_payload: null,
  register_customer_id: null,
  typed_name: null,
  typed_phone: null,
  needs_review: false,
  customer_id: null,
  customer_name: null,
  customer_phone: null,
  profile_id: null,
  profile_name: null,
  driver_code: null,
  linked_at: null,
  unlinked_at: null,
  unlink_reason: null,
  self_registered: false,
  ...over,
})
const requestRow = person({
  id: C2,
  display_name: 'Jeab',
  register_status: 'PENDING',
  register_customer_id: CUST,
  register_payload: { match: 'ONE', channel: 'CHAT', submitted_at: '2026-10-30T02:00:00Z' },
  typed_name: 'สมหญิง',
  typed_phone: '0811111111',
})
const customerRow = person({ id: C3, display_name: 'Mint', status: 'LINKED', register_status: null, customer_id: CUST, customer_name: 'สมหญิง ใจดี', customer_phone: '0811111111', linked_at: '2026-10-29T01:00:00Z' })

const COUNTS = { all: 5, unreg: 1, pending: 2, needinfo: 0, customers: 1, staff: 0, drivers: 0, general: 3, rejected: 0, unlinked: 0, blocked: 1 }

async function showPage() {
  await act(async () => {
    render(<LinePeoplePage />)
  })
}
async function openPage(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name }))
  })
}
async function openPerson(table: string, name: string) {
  const row = within(screen.getByTestId(table)).getByText(name).closest('tr') as HTMLElement
  await act(async () => {
    fireEvent.click(within(row).getByRole('button', { name: 'ดูรายละเอียด' }))
  })
}

describe('คนใน LINE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.role = 'USER'
    m.customer = { id: CUST, name: 'สมหญิง ใจดี', phone: '0811111111' }
    m.customers = []
    m.counts.mockResolvedValue({ success: true, data: COUNTS })
    m.list.mockImplementation(async (view: string) => {
      if (view === 'PENDING') return { success: true, data: { total: 1, rows: [requestRow] } }
      if (view === 'CUSTOMERS') return { success: true, data: { total: 1, rows: [customerRow] } }
      return { success: true, data: { total: 1, rows: [person({})] } }
    })
    m.audit.mockResolvedValue({ success: true, data: [] })
    m.restrictions.mockResolvedValue({ success: true, data: [] })
    m.setRestriction.mockResolvedValue({ success: true })
    m.oa.mockResolvedValue({ success: true, data: { lineId: '@myshop', addFriendUrl: 'https://line.me/R/ti/p/@myshop' } })
    m.confirm.mockResolvedValue(true)
  })
  afterEach(cleanup)

  it('opens on pending customer requests and keeps the shop LINE ID and add-friend QR available', async () => {
    await showPage()
    expect(m.counts).toHaveBeenCalled()
    expect(m.list).toHaveBeenCalledWith('PENDING', '', 0)
    expect(screen.getByTestId('line-people-PENDING')).toBeTruthy()
    expect(screen.getByText('@myshop')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'QR เพิ่มเพื่อน' }))
    })
    expect(screen.getByAltText('QR เพิ่มเพื่อน LINE ร้าน')).toBeTruthy()
  })

  it('a tile opens its list; a list shows four separate statuses and asks the database a page at a time', async () => {
    await showPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'ภาพรวม' }))
    })
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('line-overview')).getByRole('button', { name: /รอร้านตรวจสอบ/ }))
    })
    expect(m.list).toHaveBeenCalledWith('PENDING', '', 0)
    const table = screen.getByTestId('line-people-PENDING')
    expect(within(table).getByText('Jeab')).toBeTruthy()
    expect(within(table).getByText('เป็นเพื่อน')).toBeTruthy()
    expect(within(table).getByText('รอร้านตรวจสอบ')).toBeTruthy()
    expect(within(table).getByText('ยังไม่ผูก')).toBeTruthy()
    expect(within(table).getByText('บุคคลทั่วไป')).toBeTruthy()
  })

  it('searching asks the database (not the browser); an empty list keeps its header only', async () => {
    m.list.mockImplementation(async (_v: string, search: string) => ({ success: true, data: { total: 0, rows: search === 'ไม่มีชื่อนี้' ? [] : [person({})] } }))
    await showPage()
    await openPage('เพื่อนทั้งหมด')
    fireEvent.change(screen.getByLabelText('ค้นหาคนใน LINE'), { target: { value: 'ไม่มีชื่อนี้' } })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })
    expect(m.list).toHaveBeenCalledWith('ALL', 'ไม่มีชื่อนี้', 0)
    const table = screen.getByTestId('line-people-ALL')
    expect(within(table).getByRole('columnheader', { name: 'ชื่อใน LINE' })).toBeTruthy()
    expect(within(table).queryAllByRole('button', { name: 'ดูรายละเอียด' })).toHaveLength(0)
  })

  it('the three pages and the owner-only menu items belong to the OWNER only', async () => {
    await showPage()
    expect(screen.getByRole('tablist', { name: 'เมนู LINE' })).toBeTruthy()
    expect(within(screen.getByRole('tablist', { name: 'เมนู LINE' })).queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryByRole('tab', { name: 'พนักงาน' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'จัดการรหัสเชิญ' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'ประวัติการตรวจสอบ' })).toBeNull()
    cleanup()
    m.role = 'OWNER'
    await showPage()
    // the group tabs are drawn inside each page's own toolbar, so ask again after every move
    const groups = () => within(screen.getByRole('tablist', { name: 'เมนู LINE' }))
    expect(groups().getAllByRole('tab').map((t) => t.textContent?.replace(/\d+$/, ''))).toEqual(['ลูกค้า', 'แก้ไขข้อความ', 'ตั้งค่า'])
    expect(within(screen.getByRole('tablist', { name: 'ลูกค้า' })).getByRole('tab', { name: 'รอยืนยัน' })).toBeTruthy()
    await act(async () => {
      fireEvent.click(groups().getByRole('tab', { name: /^ตั้งค่า/ }))
    })
    expect(screen.getByText('เชื่อมต่อ LINE (stub)')).toBeTruthy()
    const menu = within(screen.getByRole('tablist', { name: 'ตั้งค่า' }))
    for (const name of ['การเชื่อมต่อ', 'การเพิ่มเพื่อน', 'การลงทะเบียน', 'แจ้งพนักงาน', 'เตือนลูกค้า', 'ส่งเตือนเอง', 'ประวัติการส่ง']) expect(menu.getByRole('tab', { name })).toBeTruthy()
    await act(async () => {
      fireEvent.click(groups().getByRole('tab', { name: /^แก้ไขข้อความ/ }))
    })
    const msgs = within(screen.getByRole('tablist', { name: 'แก้ไขข้อความ' }))
    for (const name of ['เพิ่มเพื่อนและลงทะเบียน', 'สินค้าและการติดต่อ', 'ลูกค้าและเอกสาร', 'พนักงานและคนขับ', 'แม่แบบของร้าน', 'การ์ดบิล']) expect(msgs.getByRole('tab', { name })).toBeTruthy()
  })

  it('owner suspension requires a reason, and repeated confirmation calls the action once', async () => {
    m.role = 'OWNER'
    await showPage()
    await openPage('รอยืนยัน')
    await openPerson('line-people-PENDING', 'Jeab')
    fireEvent.click(screen.getByRole('button', { name: /^ระงับสิทธิ์$/ }))
    expect((screen.getByRole('button', { name: 'ยืนยันระงับสิทธิ์' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('ประเภทการใช้งาน'), { target: { value: 'INQUIRY' } })
    fireEvent.click(screen.getByLabelText('ระงับถาวร'))
    fireEvent.change(screen.getByLabelText('เหตุผล'), { target: { value: 'กดสอบถามราคาถี่' } })
    await act(async () => {
      const button = screen.getByRole('button', { name: 'ยืนยันระงับสิทธิ์' })
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(m.setRestriction).toHaveBeenCalledTimes(1)
    expect(m.setRestriction).toHaveBeenCalledWith(C2, 'INQUIRY', null, 'กดสอบถามราคาถี่', false)
  })

  it('a request shows what the shop needs to decide, and what the typed phone matched (never the stranger\'s view)', async () => {
    m.role = 'OWNER'
    await showPage()
    await openPage('รอยืนยัน')
    await openPerson('line-people-PENDING', 'Jeab')
    expect(screen.getByText(/เบอร์ที่แจ้งตรงกับลูกค้า "สมหญิง ใจดี"/)).toBeTruthy()
    expect(screen.getByText('ยังไม่ระบุ', { selector: 'span' })).toBeTruthy() // no address was given
    for (const name of ['อนุมัติ', 'ขอข้อมูลเพิ่ม', 'ติดต่อผ่าน LINE', 'ปฏิเสธ']) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'ยกเลิกการผูกบัญชี' })).toBeNull()
  })

  it('อนุมัติ: a new customer from the corrected request, or an existing customer the shop picked', async () => {
    m.role = 'OWNER'
    m.approve.mockResolvedValue({ success: true, data: { result: 'LINKED_CUSTOMER', contact_id: C2, customer_id: CUST, created: true, name: 'สมหญิง ใจดี' } })
    await showPage()
    await openPage('รอยืนยัน')
    await openPerson('line-people-PENDING', 'Jeab')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'อนุมัติ' }))
    })
    expect((screen.getByLabelText('ชื่อ-นามสกุล / ชื่อกิจการ') as HTMLInputElement).value).toBe('สมหญิง')
    fireEvent.change(screen.getByLabelText('ชื่อ-นามสกุล / ชื่อกิจการ'), { target: { value: 'สมหญิง ใจดี' } })
    fireEvent.change(screen.getByLabelText('จังหวัด'), { target: { value: 'อุตรดิตถ์' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'อนุมัติและสร้างลูกค้า' }))
    })
    expect(m.approve).toHaveBeenCalledWith({
      contactId: C2,
      name: 'สมหญิง ใจดี',
      phone: '0811111111',
      address: { province: 'อุตรดิตถ์', district: '', subdistrict: '', address: '', postcode: '' },
    })
    expect(m.toast).toHaveBeenCalledWith('อนุมัติและสร้างลูกค้าแล้ว', 'สมหญิง ใจดี', 'SUCCESS')
  })

  it('อนุมัติ → เชื่อมกับลูกค้าเดิม: the customer with the same phone is offered first; nothing is created', async () => {
    m.role = 'OWNER'
    m.approve.mockResolvedValue({ success: true, data: { result: 'LINKED_CUSTOMER', contact_id: C2, customer_id: CUST, created: false, name: 'สมหญิง ใจดี' } })
    await showPage()
    await openPage('รอยืนยัน')
    await openPerson('line-people-PENDING', 'Jeab')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'อนุมัติ' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'เชื่อมกับลูกค้าเดิม' }))
    })
    expect(screen.getByText(/สมหญิง ใจดี · 0811111111/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'อนุมัติและเชื่อมกับลูกค้าเดิม' }))
    })
    expect(m.approve).toHaveBeenCalledWith({ contactId: C2, customerId: CUST })
    expect(m.toast).toHaveBeenCalledWith('อนุมัติและผูกกับลูกค้าเดิมแล้ว', 'สมหญิง ใจดี', 'SUCCESS')
  })

  it('ขอข้อมูลเพิ่ม and ปฏิเสธ both need words before they can be sent', async () => {
    m.role = 'OWNER'
    m.needInfo.mockResolvedValue({ success: true, data: { contact_id: C2 } })
    m.reject.mockResolvedValue({ success: true, data: { contact_id: C2 } })
    await showPage()
    await openPage('รอยืนยัน')
    await openPerson('line-people-PENDING', 'Jeab')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ขอข้อมูลเพิ่ม' }))
    })
    const send = screen.getByRole('button', { name: 'ส่งข้อความขอข้อมูล' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/ข้อความขอข้อมูลเพิ่ม/), { target: { value: 'ขอที่อยู่ด้วยค่ะ' } })
    await act(async () => {
      fireEvent.click(send)
    })
    expect(m.needInfo).toHaveBeenCalledWith(C2, 'ขอที่อยู่ด้วยค่ะ')

    cleanup()
    await showPage()
    await openPage('รอยืนยัน')
    await openPerson('line-people-PENDING', 'Jeab')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ปฏิเสธ' }))
    })
    const reject = screen.getAllByRole('button', { name: 'ปฏิเสธ' }).at(-1) as HTMLButtonElement
    expect(reject.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('เหตุผลที่ปฏิเสธ'), { target: { value: 'ไม่ใช่ลูกค้าของร้าน' } })
    await act(async () => {
      fireEvent.click(reject)
    })
    expect(m.reject).toHaveBeenCalledWith(C2, 'ไม่ใช่ลูกค้าของร้าน')
  })

  it('ร้านกรอกให้: a friend who typed nothing yet — name + phone go to the database rule and the result is told in Thai', async () => {
    m.role = 'OWNER'
    m.register.mockResolvedValue({ success: true, data: { result: 'LINKED_CUSTOMER', name: 'ธนพล ส่งไว', created: true } })
    await showPage()
    await openPage('ยังไม่ลงทะเบียน')
    await openPerson('line-people-UNREG', 'Ton_rider')
    expect(screen.queryByRole('button', { name: 'อนุมัติ' })).toBeNull() // nothing to approve yet
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ร้านกรอกให้' }))
    })
    fireEvent.change(screen.getByLabelText('ชื่อ-นามสกุล'), { target: { value: 'ธนพล ส่งไว' } })
    const submit = screen.getByRole('button', { name: 'บันทึกและผูก LINE' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true) // no phone yet
    fireEvent.change(screen.getByLabelText('เบอร์โทร (10 หลัก)'), { target: { value: '088-410-2253' } })
    await act(async () => {
      fireEvent.click(submit)
    })
    expect(m.register).toHaveBeenCalledWith(C1, 'ธนพล ส่งไว', '088-410-2253')
    expect(m.toast).toHaveBeenCalledWith('สร้างลูกค้าและผูก LINE แล้ว', 'ธนพล ส่งไว', 'SUCCESS')
  })

  it('a linked customer: unlinking asks first; a blocked friend cannot be written to', async () => {
    m.role = 'OWNER'
    m.unlink.mockResolvedValue({ success: true })
    m.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await showPage()
    await openPage('ลูกค้า')
    await openPerson('line-people-CUSTOMERS', 'Mint')
    expect(screen.getAllByText('ผูกบัญชีแล้ว').length).toBeGreaterThan(0)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ยกเลิกการผูกบัญชี' }))
    })
    expect(m.unlink).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ยกเลิกการผูกบัญชี' }))
    })
    expect(m.unlink).toHaveBeenCalledWith(C3)

    cleanup()
    m.list.mockResolvedValue({ success: true, data: { total: 1, rows: [person({ id: C1, followed: false, followed_at: '2026-10-01T01:00:00Z', display_name: 'Blocked_Bee' })] } })
    await showPage()
    await openPage('บล็อก LINE OA')
    await openPerson('line-people-BLOCKED', 'Blocked_Bee')
    expect(screen.queryByRole('button', { name: 'ติดต่อผ่าน LINE' })).toBeNull()
    expect(screen.getAllByText('บล็อก/ลบ LINE ร้าน').length).toBeGreaterThan(0)
  })

  it('staff cannot approve, reject, bind or unlink a customer from the person dialog', async () => {
    m.role = 'USER'
    await showPage()
    await openPage('รอยืนยัน')
    await openPerson('line-people-PENDING', 'Jeab')
    for (const name of ['อนุมัติ', 'ปฏิเสธ', 'ร้านกรอกให้', 'ยืนยันว่าถูกต้อง', 'ยกเลิกการผูกบัญชี']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(m.approve).not.toHaveBeenCalled()
    expect(m.reject).not.toHaveBeenCalled()
  })
  it('the database cannot answer: says so instead of an empty list', async () => {
    m.list.mockResolvedValue({ success: false, error: 'ระบบ LINE ยังไม่พร้อมในฐานข้อมูลนี้' })
    await showPage()
    await openPage('เพื่อนทั้งหมด')
    expect(screen.getByText('ระบบ LINE ยังไม่พร้อมในฐานข้อมูลนี้')).toBeTruthy()
  })
})

describe('หน้าลูกค้า › สร้างลิงก์ผูก LINE', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('not linked: makes the one-time code and shows its QR, the link to copy and the time left from the code', async () => {
    m.role = 'OWNER'
    m.linked.mockResolvedValue({ data: null, error: null })
    const expires = new Date(Date.now() + 10 * 60_000).toISOString()
    m.code.mockResolvedValue({ success: true, data: { code: 'LINK-ABCDEFGHJK', expires_at: expires, oaUrl: 'https://line.me/R/oaMessage/%40myshop/?LINK-ABCDEFGHJK' } })
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
    await act(async () => {
      render(<CustomerLineLinkButton customerId={CUST} customerName="สมหญิง ใจดี" />)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /สร้างลิงก์ผูก LINE/ }))
    })
    expect(m.code).toHaveBeenCalledWith(CUST)
    expect(screen.getByAltText(/QR ลิงก์ผูก LINE/)).toBeTruthy()
    expect((screen.getByLabelText('ลิงก์ผูก LINE') as HTMLInputElement).value).toBe('https://line.me/R/oaMessage/%40myshop/?LINK-ABCDEFGHJK')
    expect(screen.getByTestId('customer-line-link-left').textContent).toMatch(/^(10:00|9:5\d) นาที$/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /คัดลอกลิงก์/ }))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://line.me/R/oaMessage/%40myshop/?LINK-ABCDEFGHJK')
  })

  it('already linked: shows the LINE name instead of the button', async () => {
    m.linked.mockResolvedValue({ data: { display_name: 'Mint' }, error: null })
    await act(async () => {
      render(<CustomerLineLinkButton customerId={CUST} customerName="สมหญิง ใจดี" />)
    })
    expect(screen.getByTestId('customer-line-linked').textContent).toContain('ผูก LINE แล้ว · Mint')
    expect(screen.queryByRole('button', { name: /สร้างลิงก์ผูก LINE/ })).toBeNull()
  })
})
