// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/** Bill screen › ส่งทาง LINE (outbox + mock sender) and the customer link code (OA 1:1 chat). */

const BILL = '9d0f2a52-7d1c-4d6e-8f0e-222222222222'
const CUSTOMER = '9d0f2a52-7d1c-4d6e-8f0e-333333333333'
const LINE_USER = 'U' + '5'.repeat(32)

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  status: 'SENT' as string,
  toast: vi.fn(),
  recipient: vi.fn(),
  send: vi.fn(),
  code: vi.fn(),
}))

describe('sendBillViaLine (server action)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: m.rpc }) }))
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({
        from: () => {
          const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { status: m.status } }) }
          return q
        },
      }),
    }))
    vi.doMock('@/lib/line/supabase-store', () => ({
      createSupabaseLineStore: () => ({ credentials: async () => ({ channelSecret: null, accessToken: null }), claim: m.claim, complete: m.complete }),
    }))
    m.rpc.mockReset()
    m.claim.mockReset()
    m.complete.mockReset()
  })
  afterEach(() => {
    vi.doUnmock('@/lib/supabase/server')
    vi.doUnmock('@/lib/supabase/admin')
    vi.doUnmock('@/lib/line/supabase-store')
  })

  it('queues the bill text for the bill (recipient chosen by the database); live mode runs the sender once', async () => {
    vi.stubEnv('LINE_DELIVERY_MODE', 'live')
    m.rpc.mockResolvedValueOnce({ data: { delivery_id: 'd1', status: 'QUEUED', duplicate: false }, error: null })
    const text = 'สรุปบิลเช่า\nยอดค้าง: ฿1,500.00'
    m.claim.mockResolvedValueOnce([{ id: 'd1', line_user_id: LINE_USER, messages: [{ type: 'text', text }], attempts: 1, max_attempts: 5, retry_key: '11111111-1111-4111-8111-111111111111' }])
    const { sendBillViaLine } = await import('@/app/actions/line')
    const r = await sendBillViaLine({ billId: BILL, text, idempotencyKey: 'bill-00000001' })
    vi.unstubAllEnvs()
    expect(m.rpc).toHaveBeenCalledWith('line_bill_send', { p_bill_id: BILL, p_text: text, p_idempotency_key: 'bill-00000001' })
    expect(m.complete).toHaveBeenCalledWith('d1', 'SENT', expect.anything())
    expect(r).toEqual({ success: true, data: { delivery_id: 'd1', status: 'SENT', duplicate: false, mode: 'live' } })
  })

  it('mock mode never pushes, so the row stays queued and is not reported as sent', async () => {
    vi.stubEnv('LINE_DELIVERY_MODE', 'mock')
    m.status = 'PENDING'
    m.rpc.mockResolvedValueOnce({ data: { delivery_id: 'd3', status: 'PENDING', duplicate: false }, error: null })
    const { sendBillViaLine } = await import('@/app/actions/line')
    const r = await sendBillViaLine({ billId: BILL, text: 'a', idempotencyKey: 'bill-00000005' })
    vi.unstubAllEnvs()
    m.status = 'SENT'
    expect(m.claim).not.toHaveBeenCalled()
    expect(r.data).toMatchObject({ status: 'PENDING', mode: 'mock' })
  })

  it('a customer without LINE gets a Thai refusal and nothing is sent', async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'LINE_CONTACT_NOT_LINKED' } })
    const { sendBillViaLine } = await import('@/app/actions/line')
    expect(await sendBillViaLine({ billId: BILL, text: 'x', idempotencyKey: 'bill-00000002' })).toEqual({ success: false, error: 'ผู้รับยังไม่ได้ผูก LINE' })
    expect(m.claim).not.toHaveBeenCalled()
  })

  it('bad input never reaches the database', async () => {
    const { sendBillViaLine, getBillLineRecipient } = await import('@/app/actions/line')
    expect((await sendBillViaLine({ billId: 'x', text: 'a', idempotencyKey: 'bill-00000003' })).success).toBe(false)
    expect((await sendBillViaLine({ billId: BILL, text: ' ', idempotencyKey: 'bill-00000003' })).success).toBe(false)
    expect((await sendBillViaLine({ billId: BILL, text: 'a', idempotencyKey: 'x' })).success).toBe(false)
    expect((await getBillLineRecipient('x')).success).toBe(false)
    expect(m.rpc).not.toHaveBeenCalled()
  })

  it('if the sender run fails the message stays queued (no false "sent")', async () => {
    m.rpc.mockResolvedValueOnce({ data: { delivery_id: 'd2', status: 'QUEUED', duplicate: false }, error: null })
    vi.stubEnv('LINE_DELIVERY_MODE', 'live')
    m.claim.mockRejectedValueOnce(new Error('db down'))
    const { sendBillViaLine } = await import('@/app/actions/line')
    const r = await sendBillViaLine({ billId: BILL, text: 'a', idempotencyKey: 'bill-00000004' })
    vi.unstubAllEnvs()
    expect(r.data?.status).toBe('QUEUED')
  })
})

describe('LineNotifyModal (bill screen)', () => {
  const bill = { id: BILL, billNo: 'B-0001', customerName: 'สมชาย', returnDate: '10/10/2569', grandTotal: 2500, outstandingAmount: 1500, rentalStatus: 'RENTING' }

  async function open() {
    vi.resetModules()
    vi.doMock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: m.toast }) }))
    vi.doMock('@/app/actions/line', () => ({ getBillLineRecipient: m.recipient, sendBillViaLine: m.send, createCustomerLineLinkCode: m.code }))
    vi.doMock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,QR' } }))
    const { LineNotifyModal } = await import('@/features/bills/components/LineNotifyModal')
    const onClose = vi.fn()
    await act(async () => {
      render(<LineNotifyModal isOpen onClose={onClose} billData={bill} />)
    })
    return onClose
  }

  beforeEach(() => {
    m.toast.mockReset()
    m.recipient.mockReset()
    m.send.mockReset()
    m.code.mockReset()
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
  })
  afterEach(() => {
    cleanup()
    vi.doUnmock('@/components/common/Toast')
    vi.doUnmock('@/app/actions/line')
    vi.doUnmock('qrcode')
  })

  it('linked customer: "ส่งทาง LINE" sends the stored bill numbers (no recalculation) and closes', async () => {
    m.recipient.mockResolvedValue({ success: true, data: { state: 'LINKED', customer_id: CUSTOMER, display_name: null } })
    m.send.mockResolvedValue({ success: true, data: { delivery_id: 'd1', status: 'SENT', duplicate: false, mode: 'mock' } })
    const onClose = await open()
    expect(m.recipient).toHaveBeenCalledWith(BILL)
    expect(await screen.findByText(/ลูกค้าผูก LINE กับร้านแล้ว/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /ยอดค้าง/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ส่งทาง LINE/ }))
    })
    const sent = m.send.mock.calls[0][0]
    expect(sent.billId).toBe(BILL)
    expect(sent.text).toContain('ยอดสุทธิ: ฿2,500')
    expect(sent.text).toContain('ยอดค้าง: ฿1,500')
    expect(sent.idempotencyKey).toMatch(/^bill-/)
    // test mode must not read like a real send
    expect(m.toast).toHaveBeenCalledWith('โหมดทดสอบ: ยังไม่ได้ส่งถึงลูกค้า', expect.any(String), 'INFO')
    expect(m.toast).not.toHaveBeenCalledWith('ส่งบิลทาง LINE แล้ว', expect.anything(), expect.anything())
    expect(onClose).toHaveBeenCalled()
  })

  it('live mode: SENT is reported as sent to the customer', async () => {
    m.recipient.mockResolvedValue({ success: true, data: { state: 'LINKED', customer_id: CUSTOMER, display_name: null } })
    m.send.mockResolvedValue({ success: true, data: { delivery_id: 'd1', status: 'SENT', duplicate: false, mode: 'live' } })
    await open()
    await screen.findByText(/ลูกค้าผูก LINE กับร้านแล้ว/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ส่งทาง LINE/ }))
    })
    expect(m.toast).toHaveBeenCalledWith('ส่งบิลทาง LINE แล้ว', expect.stringContaining('สมชาย'), 'SUCCESS')
  })

  it('Flex Card is switched off (not sent as text under a Flex label); "สรุปบิล" sends the summary text', async () => {
    m.recipient.mockResolvedValue({ success: true, data: { state: 'LINKED', customer_id: CUSTOMER } })
    m.send.mockResolvedValue({ success: true, data: { delivery_id: 'd1', status: 'QUEUED', duplicate: false, mode: 'live' } })
    await open()
    await screen.findByText(/ลูกค้าผูก LINE กับร้านแล้ว/)
    expect((screen.getByRole('button', { name: /Flex Card/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /สรุปบิล/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ส่งทาง LINE/ }))
    })
    expect(m.send.mock.calls[0][0].text).toBe('สรุปบิลเช่า\nลูกค้า: สมชาย\nเลขที่บิล: B-0001\nสถานะ: กำลังเช่า\nวันครบกำหนด: 10/10/2569\nยอดรวม: ฿2,500.00\nยอดค้าง: ฿1,500.00')
    expect(m.toast).toHaveBeenCalledWith('ยังส่งไม่ถึงลูกค้า', expect.any(String), 'INFO')
  })

  it('each preset writes its own message from the stored bill', async () => {
    m.recipient.mockResolvedValue({ success: true, data: { state: 'LINKED', customer_id: CUSTOMER } })
    await open()
    const box = () => (screen.getByRole('textbox') as HTMLTextAreaElement).value
    expect(box()).toContain('ใกล้ครบกำหนดคืน')
    expect(box()).toContain('กำหนดคืน: 10/10/2569')
    fireEvent.click(screen.getByRole('button', { name: /เกินกำหนด/ }))
    expect(box()).toContain('เลยกำหนดคืนสินค้าแล้ว')
    fireEvent.click(screen.getByRole('button', { name: /ยอดค้าง/ }))
    expect(box()).toContain('ยอดค้าง: ฿1,500')
    expect(box()).toContain('ยอดสุทธิ: ฿2,500')
    fireEvent.click(screen.getByRole('button', { name: /ปรับแต่งเอง/ }))
    expect(box()).toBe('เรียน คุณ สมชาย\nเรื่อง บิลเลขที่ B-0001\n')
  })

  it('not linked: send is off, copy still works, and staff can make a link code with QR + link', async () => {
    m.recipient.mockResolvedValue({ success: true, data: { state: 'NOT_LINKED', customer_id: CUSTOMER } })
    m.code.mockResolvedValue({ success: true, data: { code: 'LINK-ABCDEFGHJK', expires_at: '2026-10-08T10:10:00Z', oaUrl: 'https://line.me/R/oaMessage/%40myshop/?LINK-ABCDEFGHJK' } })
    await open()
    await screen.findByText('ลูกค้ายังไม่ได้ผูก LINE กับร้าน')
    expect((screen.getByRole('button', { name: /ส่งทาง LINE/ }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /คัดลอกไปส่งเอง/ }))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('B-0001'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /สร้างรหัสผูก LINE/ }))
    })
    expect(m.code).toHaveBeenCalledWith(CUSTOMER)
    await waitFor(() => expect(screen.getByTestId('line-link-code').textContent).toBe('LINK-ABCDEFGHJK'))
    expect((screen.getByAltText(/QR/) as HTMLImageElement).src).toContain('data:image/png')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /คัดลอกลิงก์/ }))
    })
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('https://line.me/R/oaMessage/%40myshop/?LINK-ABCDEFGHJK')
    expect(m.send).not.toHaveBeenCalled()
  })

  it('no shop LINE ID: the code is still shown, with a hint where to set the LINE ID', async () => {
    m.recipient.mockResolvedValue({ success: true, data: { state: 'NOT_LINKED', customer_id: CUSTOMER } })
    m.code.mockResolvedValue({ success: true, data: { code: 'LINK-ABCDEFGHJK', expires_at: '2026-10-08T10:10:00Z', oaUrl: null } })
    await open()
    await screen.findByText('ลูกค้ายังไม่ได้ผูก LINE กับร้าน')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /สร้างรหัสผูก LINE/ }))
    })
    await waitFor(() => expect(screen.getByText(/ใส่ LINE ID ของร้าน/)).toBeTruthy())
    expect(screen.queryByAltText(/QR/)).toBeNull()
  })

  it('no LINE system yet (database not ready): copy-only, with the reason shown', async () => {
    m.recipient.mockResolvedValue({ success: false, error: 'ระบบ LINE ยังไม่พร้อมในฐานข้อมูลนี้' })
    await open()
    expect(await screen.findByText(/ระบบ LINE ยังไม่พร้อม/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /ส่งทาง LINE/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /คัดลอกไปส่งเอง/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
