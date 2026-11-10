// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

/** คนใน LINE (/line) and the customer page "สร้างลิงก์ผูก LINE" button. */

const C1 = '11111111-2222-4333-8444-000000000001'
const C2 = '11111111-2222-4333-8444-000000000002'
const CUST = '11111111-2222-4333-8444-0000000000c1'

const m = vi.hoisted(() => ({
  role: 'USER' as string,
  tables: {} as Record<string, unknown[]>,
  error: null as unknown,
  register: vi.fn(),
  reject: vi.fn(),
  unlink: vi.fn(),
  code: vi.fn(),
  oa: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  linked: vi.fn(),
}))

/** Thenable query builder: every filter returns itself; awaiting gives the table rows. */
function query(table: string) {
  const rows = () => (table === 'line_contacts:pending' || table === 'line_contacts:linked' || table === 'customers' ? m.tables[table] ?? [] : [])
  let key = table
  const q: Record<string, unknown> = {}
  const self = () => q
  Object.assign(q, {
    select: self,
    in: (col: string) => {
      if (table === 'line_contacts' && col === 'register_status') key = 'line_contacts:pending'
      return q
    },
    not: () => {
      if (table === 'line_contacts') key = 'line_contacts:linked'
      return q
    },
    eq: self,
    order: self,
    limit: self,
    maybeSingle: () => m.linked(),
    then: (resolve: (v: unknown) => void) => {
      const k = key === 'line_contacts' ? 'line_contacts:pending' : key
      return Promise.resolve({ data: m.error ? null : (m.tables[k] ?? (rows() as unknown[])), error: m.error }).then(resolve)
    },
  })
  return q
}

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (t: string) => query(t) }) }))
vi.mock('@/app/actions/line', () => ({
  registerLineContactByShop: m.register,
  rejectLineContact: m.reject,
  unlinkLineContact: m.unlink,
  getLineOaInfo: m.oa,
  createCustomerLineLinkCode: m.code,
}))
vi.mock('@/features/settings/components/DeliveryDriversPanel', () => ({ DeliveryDriversPanel: () => <div>พนักงานส่งของ (stub)</div> }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AAA') } }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: m.toast }) }))
vi.mock('@/components/common/ConfirmDialogProvider', () => ({ useConfirm: () => m.confirm }))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: m.role, status: 'ACTIVE', menus: [] } }) }))
vi.mock('@/features/settings/components/LineSettingsWorkspace', () => ({ LineSettingsWorkspace: () => <div>ตั้งค่า LINE (stub)</div> }))
vi.mock('@/lib/contexts/SystemSettingsContext', () => ({
  useSystemSettings: () => ({ settings: { business: { businessName: 'ร้านเอ' }, line: { templates: {} } } }),
}))

import { LinePeoplePage } from '@/features/settings/components/LinePeoplePage'
import { CustomerLineLinkButton } from '@/features/customers/components/CustomerLineLinkButton'

const pendingRows = [
  { id: C1, display_name: 'Ton_rider', register_status: 'WAITING', register_customer_id: null, typed_name: null, typed_phone: null, created_at: '2026-10-31T01:00:00Z', last_event_at: '2026-10-31T01:00:00Z' },
  { id: C2, display_name: 'Jeab', register_status: 'PHONE_TAKEN', register_customer_id: CUST, typed_name: 'สมหญิง', typed_phone: '0811111111', created_at: '2026-10-30T01:00:00Z', last_event_at: '2026-10-30T01:00:00Z' },
]
const linkedRows = [{ id: 'k1', display_name: 'Mint', customer_id: CUST, linked_at: '2026-10-29T01:00:00Z', followed: true, self_registered: true }]

async function showPage() {
  await act(async () => {
    render(<LinePeoplePage />)
  })
}
async function openTab(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('tablist', { name: 'คนใน LINE' })).getByRole('tab', { name }))
  })
}

describe('คนใน LINE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.error = null
    m.role = 'USER'
    m.tables = { 'line_contacts:pending': pendingRows, 'line_contacts:linked': linkedRows, customers: [{ id: CUST, name: 'สมหญิง ใจดี', phone: '0811111111' }] }
    m.oa.mockResolvedValue({ success: true, data: { lineId: '@myshop', addFriendUrl: 'https://line.me/R/ti/p/%40myshop' } })
  })
  afterEach(cleanup)

  it('lists the friends waiting for the shop with their status, the linked customers with the self-registered tag, and the add-friend QR', async () => {
    await showPage()
    const pending = screen.getByTestId('line-pending')
    expect(within(pending).getByText('Ton_rider')).toBeTruthy()
    expect(within(pending).getByText('ยังไม่ตอบในแชต')).toBeTruthy()
    expect(within(pending).getByText('เบอร์นี้ผูก LINE อื่นแล้ว')).toBeTruthy()
    expect(within(pending).getByText(/เบอร์นี้เป็นของลูกค้า/).textContent).toContain('สมหญิง ใจดี')
    // the tab and the summary card show how many are waiting / linked / blocked
    expect(screen.getByRole('tab', { name: /รอร้านตรวจ/ }).textContent).toContain('2')
    expect(screen.getByText('รอร้านตรวจ', { selector: 'span.font-semibold' }).parentElement?.textContent).toContain('2 คน')
    // ร้านกรอกให้ opens the form with the chat that friend has seen beside it
    const row = within(pending).getByText('Ton_rider').closest('tbody') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'ร้านกรอกให้' }))
    expect(within(row).getByTestId('line-chat-preview').textContent).toContain('ขอบคุณที่เพิ่มเพื่อนร้านเอ')

    await openTab(/ลูกค้าที่ผูก LINE/)
    const linked = screen.getByTestId('line-linked-customers')
    expect(within(linked).getByText('สมัครเองทาง LINE')).toBeTruthy()
    expect((within(linked).getByRole('link', { name: 'สมหญิง ใจดี' }) as HTMLAnchorElement).getAttribute('href')).toBe(`/customers?customer=${CUST}`)
    // search the linked customers
    fireEvent.change(screen.getByLabelText('ค้นหาคนใน LINE'), { target: { value: 'ไม่มีชื่อนี้' } })
    // nothing found: the table stays with its header and no rows
    expect(within(screen.getByTestId('line-linked-customers')).getByRole('columnheader', { name: 'ชื่อใน LINE' })).toBeTruthy()
    expect(within(screen.getByTestId('line-linked-customers')).queryAllByRole('link')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('ค้นหาคนใน LINE'), { target: { value: 'Mint' } })
    expect(within(screen.getByTestId('line-linked-customers')).getByText('สมหญิง ใจดี')).toBeTruthy()

    // the shop LINE ID on its card; the QR opens in a window
    expect(screen.getByText('@myshop')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'QR เพิ่มเพื่อน' }))
    })
    expect(screen.getByAltText('QR เพิ่มเพื่อน LINE ร้าน')).toBeTruthy()
  })

  it('ตั้งค่า LINE (moved here from ตั้งค่าระบบ) is the OWNER\'s only', async () => {
    await showPage()
    expect(screen.queryByRole('tab', { name: /ตั้งค่า LINE/ })).toBeNull()
    cleanup()
    m.role = 'OWNER'
    await showPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /ตั้งค่า LINE/ }))
    })
    expect(screen.getByText('ตั้งค่า LINE (stub)')).toBeTruthy()
    expect(screen.queryByTestId('line-pending')).toBeNull()
  })

  it('ร้านกรอกให้: name + phone go to the database rule; the result is told in Thai and the list reloads', async () => {
    m.register.mockResolvedValue({ success: true, data: { result: 'LINKED_CUSTOMER', name: 'ธนพล ส่งไว', created: true } })
    await showPage()
    const row = within(screen.getByTestId('line-pending')).getByText('Ton_rider').closest('tbody') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'ร้านกรอกให้' }))
    fireEvent.change(within(row).getByLabelText('ชื่อ-นามสกุล'), { target: { value: 'ธนพล ส่งไว' } })
    const submit = within(row).getByRole('button', { name: /ตรวจข้อมูล/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true) // no phone yet
    fireEvent.change(within(row).getByLabelText('เบอร์โทร'), { target: { value: '088-410-2253' } })
    await act(async () => {
      fireEvent.click(submit)
    })
    expect(m.register).toHaveBeenCalledWith(C1, 'ธนพล ส่งไว', '088-410-2253')
    expect(m.toast).toHaveBeenCalledWith('สร้างลูกค้าและผูก LINE แล้ว', expect.stringContaining('ธนพล ส่งไว'), 'SUCCESS')
  })

  it('a phone already linked elsewhere is refused, never replaced', async () => {
    m.register.mockResolvedValue({ success: true, data: { result: 'PHONE_TAKEN', customer_id: CUST } })
    await showPage()
    const row = within(screen.getByTestId('line-pending')).getByText('Jeab').closest('tbody') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'ร้านกรอกให้' }))
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: /ตรวจข้อมูล/ }))
    })
    expect(m.register).toHaveBeenCalledWith(C2, 'สมหญิง', '0811111111')
    expect(m.toast).toHaveBeenCalledWith('ผูกไม่ได้', expect.stringContaining('ผูก LINE อื่นไว้แล้ว'), 'ERROR')
  })

  it('ไม่รับ asks first; unlinking a customer asks to confirm (no typed reason)', async () => {
    m.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    m.reject.mockResolvedValue({ success: true })
    m.unlink.mockResolvedValue({ success: true })
    await showPage()
    const row = within(screen.getByTestId('line-pending')).getByText('Ton_rider').closest('tbody') as HTMLElement
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'ไม่รับ' }))
    })
    expect(m.reject).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'ไม่รับ' }))
    })
    expect(m.reject).toHaveBeenCalledWith(C1)

    await openTab(/ลูกค้าที่ผูก LINE/)
    m.confirm.mockResolvedValueOnce(false)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ยกเลิกการผูก/ }))
    })
    expect(m.unlink).not.toHaveBeenCalled()
    m.confirm.mockResolvedValueOnce(true)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ยกเลิกการผูก/ }))
    })
    expect(m.unlink).toHaveBeenCalledWith('k1')
  })

  it('database without the new columns: says so instead of an empty list', async () => {
    m.error = { message: 'column line_contacts.register_status does not exist' }
    await showPage()
    expect(screen.getByText(/รอติดตั้ง Migration/)).toBeTruthy()
  })
})

describe('หน้าลูกค้า › สร้างลิงก์ผูก LINE', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('not linked: makes the one-time code and shows its QR, the link to copy and the time left from the code', async () => {
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
