// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CheckoutPage from '@/app/pos/checkout/page'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'
import { ConfirmDialogProvider } from '@/components/common/ConfirmDialogProvider'
import { loadSystemSettings, setCachedSystemSettings } from '@/features/settings/services/settings-storage'
import {
  CartItem,
  cartLineUnitPriceForServer,
  isCashShort,
  saveActiveCart,
} from '@/features/pos/services/cart-storage'
import { mapQuotationToPos } from '@/features/quotations/services/quotation-storage'
import { Customer, Product, Quotation } from '@/lib/types/rental-pos'

const mocks = vi.hoisted(() => ({
  saveDraft: vi.fn(async (_input: { lines: unknown[] }) => 'bill-1'),
  confirm: vi.fn(async () => ({ id: 'bill-1', billNo: 'BL-2026-000001', items: [] })),
  fetchBill: vi.fn(async () => ({ id: 'bill-1', grandTotal: 1000 })),
  toast: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'tester', fullName: 'Tester' } }) }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: mocks.toast }) }))
vi.mock('@/features/bills/services/bill-service', () => ({
  saveBillDraft: mocks.saveDraft, confirmBill: mocks.confirm, deliverBill: vi.fn(async () => null),
}))
vi.mock('@/features/bills/services/bill-storage', () => ({
  fetchBillByIdFromSupabase: mocks.fetchBill, fetchBillsFromSupabase: vi.fn(async () => []), loadBillById: () => undefined,
}))
vi.mock('@/features/settings/api/settings-repository', () => ({
  fetchSharedSystemConfig: vi.fn(async () => null),
  saveSharedSystemConfig: vi.fn(async () => {}),
}))
vi.mock('@/features/pos/components/A4FitPreview', () => ({ A4FitPreview: ({ children }: any) => children }))
// The bill is shown and printed on the shop's main bill form (จัดการเอกสาร › แบบฟอร์มบิล).
vi.mock('@/features/documents/services/template-library-storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/documents/services/template-library-storage')>()),
  refreshSharedTemplates: vi.fn(async () => [{
    id: 'tpl-main', name: 'ใบส่งของ/ใบเสร็จรับเงิน', category: 'ใบส่งของ/ใบเสร็จรับเงิน', targetGroup: 'BILL',
    paperSize: 'A4', orientation: 'PORTRAIT', templateSchema: '<div>{{document.number}}</div>',
  }]),
  loadDocumentNames: () => [],
}))
vi.mock('@/components/common/PostSavePrintModal', () => ({ PostSavePrintModal: () => null }))
// Only the cash box (and its ยืนยัน button) matters here
vi.mock('@/features/pos/components/payment/PaymentDynamicContent', () => ({
  PaymentDynamicContent: ({ receivedCashInput, onReceivedCashInputChange, onConfirmCash, onOpenQr, split }: any) => (
    <>
      <input aria-label="cash" value={receivedCashInput} onChange={(e) => onReceivedCashInputChange(e.target.value)} />
      <button type="button" onClick={() => onConfirmCash?.()}>ยืนยันยอดเงินสด</button>
      <button type="button" onClick={() => onOpenQr?.()}>แสดง QR กลางจอ</button>
      {split && <p>จ่าย 2 ช่องทาง</p>}
    </>
  ),
}))

const customer = { id: 'c1', customerName: 'Customer', phone: '0812345678', address: 'Bangkok' } as Customer
const saleItem: CartItem = {
  id: 'sale', product: { id: 'p1', code: 'p1', name: 'Item', rentalType: 'SALE', salePrice: 1000 } as Product,
  itemType: 'SALE', rentalType: 'SALE', unitPrice: 1000, quantity: 1, usageCount: 1, lineTotal: 1000,
}

function mountCheckout(items: CartItem[]) {
  saveActiveCart({
    items, customer, discount: 0, shippingFee: 0, depositAmount: 0, tax: 0, taxRate: 0, subtotal: 1000, grandTotal: 1000,
    shippingAddress: '', documentType: 'บิลขาย', documentDate: '2026-10-07',
    headerRentalDate: '2026-10-07', headerReturnDate: '2026-10-07',
  })
  return render(<ConfirmDialogProvider><SystemSettingsProvider><CheckoutPage /></SystemSettingsProvider></ConfirmDialogProvider>)
}

function selectCashPayment() {
  fireEvent.click(screen.getByRole('button', { name: 'เงินสด' }))
}

/** Types the cash, presses ยืนยัน and answers ถูกต้อง in the centre pop-up (records nothing). */
async function typeAndConfirmCash(value: string) {
  fireEvent.change(screen.getByLabelText('cash'), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยอดเงินสด' }))
  fireEvent.click(await screen.findByRole('button', { name: 'ถูกต้อง' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'ถูกต้อง' })).toBeNull())
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  const settings = loadSystemSettings()
  setCachedSystemSettings(settings)
})
afterEach(cleanup)

describe('P0-2 cash taken at checkout must cover the payment', () => {
  it('isCashShort only blocks cash below the amount due', () => {
    expect(isCashShort('CASH', 500, 1000)).toBe(true)
    expect(isCashShort('CASH', 1000, 1000)).toBe(false)
    expect(isCashShort('CASH', 1500, 1000)).toBe(false)
    expect(isCashShort('TRANSFER', 0, 1000)).toBe(false)
    expect(isCashShort('UNPAID', 0, 1000)).toBe(false)
  })

  it('เงินสด then QR Code: back to the cash box, ยืนยัน → the QR for the rest → ได้รับเงินแล้ว → saved (owner 2026-11-06)', async () => {
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.click(screen.getByRole('button', { name: 'QR Code' }))
    // both buttons lit, no QR yet: the cash amount comes first
    expect(screen.getByRole('button', { name: 'เงินสด' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'QR Code' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('dialog', { name: 'สแกนจ่ายด้วย QR Code' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    expect(await screen.findByText('ยังไม่ได้กรอกเงินสด')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ตกลง' }))

    fireEvent.change(screen.getByLabelText('cash'), { target: { value: '700' } })
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยอดเงินสด' }))
    expect(await screen.findByText(/ส่วนที่เหลือ 300\.00 บาท จ่ายด้วย QR Code/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ถูกต้อง' }))
    const qr = await screen.findByRole('dialog', { name: 'สแกนจ่ายด้วย QR Code' })
    expect(qr.textContent).toMatch(/300\.00 บาท/)

    // the QR closed before ได้รับเงินแล้ว: the bill waits for it
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    expect(await screen.findByText('ยังไม่ได้รับเงินทาง QR Code')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ตกลง' }))
    expect(mocks.saveDraft).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'แสดง QR กลางจอ' }))
    fireEvent.click(await screen.findByRole('button', { name: 'ได้รับเงินแล้ว' }))
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [
        expect.objectContaining({ method: 'CASH', amount: 700 }),
        expect.objectContaining({ method: 'QR', amount: 300 }),
      ])
    )
  })

  it('QR Code then เงินสด: the QR first (the transfer typed there) → ได้รับเงินแล้ว → the cash for the rest → ยืนยัน → saved', async () => {
    mountCheckout([saleItem])
    fireEvent.click(screen.getByRole('button', { name: 'QR Code' }))
    fireEvent.click(await screen.findByRole('button', { name: 'ปิด' }))
    selectCashPayment()
    expect(await screen.findByRole('dialog', { name: 'สแกนจ่ายด้วย QR Code' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'ยอดที่ลูกค้าโอน' }), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: 'ได้รับเงินแล้ว' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'สแกนจ่ายด้วย QR Code' })).toBeNull())

    // the cash box for the rest must be confirmed, even left empty (= exactly the rest)
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    expect(await screen.findByText('ยังไม่ได้ยืนยันยอดเงินสด')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ตกลง' }))
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยอดเงินสด' }))
    expect(await screen.findByText(/ยอดที่ต้องชำระ 600\.00 บาท/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ถูกต้อง' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'ถูกต้อง' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [
        expect.objectContaining({ method: 'QR', amount: 400 }),
        expect.objectContaining({ method: 'CASH', amount: 600 }),
      ])
    )
  })

  it('cash alone below the total does not move to QR by itself; the bill needs the whole amount', async () => {
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.change(screen.getByLabelText('cash'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยอดเงินสด' }))
    expect(await screen.findByText(/กดปุ่ม "QR Code" เพิ่ม/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ถูกต้อง' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'ถูกต้อง' })).toBeNull())
    expect(screen.queryByRole('dialog', { name: 'สแกนจ่ายด้วย QR Code' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('ยังรับเงินไม่ครบ', expect.stringContaining('500'), 'ERROR'))
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('pressing one of the two again takes it out (nothing is locked)', async () => {
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.click(screen.getByRole('button', { name: 'QR Code' }))
    expect(screen.getByText('จ่าย 2 ช่องทาง')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'QR Code' }))
    expect(screen.queryByText('จ่าย 2 ช่องทาง')).toBeNull()
    expect(screen.getByRole('button', { name: 'QR Code' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'เงินสด' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('ค้างชำระ after a part was taken keeps that part; the rest stays owed (owner 2026-11-11)', async () => {
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.click(screen.getByRole('button', { name: 'QR Code' }))
    await typeAndConfirmCash('500')
    fireEvent.click(await screen.findByRole('button', { name: 'ปิด' }))
    fireEvent.click(screen.getByRole('button', { name: 'ค้างชำระ' }))
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [expect.objectContaining({ method: 'CASH', amount: 500 })]))
  })

  it('cash confirmed for part of the amount, then ค้างชำระ: the bill is issued with that cash (owner 2026-11-11)', async () => {
    mountCheckout([saleItem])
    selectCashPayment()
    await typeAndConfirmCash('500')
    fireEvent.click(screen.getByRole('button', { name: 'ค้างชำระ' }))
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [expect.objectContaining({ method: 'CASH', amount: 500 })]))
    expect(mocks.toast).not.toHaveBeenCalledWith('ยังรับเงินไม่ครบ', expect.anything(), 'ERROR')
  })

  it('blocks confirm when the server total is above the cash typed in', async () => {
    mocks.fetchBill.mockResolvedValueOnce({ id: 'bill-1', grandTotal: 1200 })
    mountCheckout([saleItem])
    selectCashPayment()
    await typeAndConfirmCash('1000')
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('ยอดเงินที่รับไม่พอ', expect.any(String), 'ERROR'))
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('pays the server total when cash covers it, and when the cash box is left empty', async () => {
    mountCheckout([saleItem])
    selectCashPayment()
    await typeAndConfirmCash('1500')
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [expect.objectContaining({ method: 'CASH', amount: 1000 })]))
    cleanup()
    vi.clearAllMocks()
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [expect.objectContaining({ method: 'CASH', amount: 1000 })]))
  })

  it('requires an explicit payment choice; the system has three buttons: เงินสด, QR Code, ค้างชำระ (owner 2026-11-04)', async () => {
    mountCheckout([saleItem])
    expect(screen.getByRole('button', { name: 'QR Code' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /เงินโอน|โอนเงิน/ })).toBeNull()
    // owner 2026-11-05: ออกบิล can be pressed; with no choice a centre warning says what to do
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    expect(await screen.findByText('ยังไม่ได้เลือกวิธีรับเงิน')).toBeTruthy()
    expect(mocks.saveDraft).not.toHaveBeenCalled()
  })

  it('typed cash must be confirmed (ยืนยัน → ถูกต้อง) before ออกบิล; the pop-up itself saves nothing (owner 2026-11-05)', async () => {
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.change(screen.getByLabelText('cash'), { target: { value: '1500' } })
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    expect(await screen.findByText('ยังไม่ได้ยืนยันยอดเงินสด')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ตกลง' }))
    expect(mocks.saveDraft).not.toHaveBeenCalled()

    // แก้ไข = not confirmed
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยอดเงินสด' }))
    expect(await screen.findByText(/รับเงินสดมา 1,500\.00 บาท/)).toBeTruthy()
    expect(screen.getByText(/เงินทอน 500\.00 บาท/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไข' }))
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    expect(await screen.findByText('ยังไม่ได้ยืนยันยอดเงินสด')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ตกลง' }))
    expect(mocks.saveDraft).not.toHaveBeenCalled()

    // ถูกต้อง, then the amount is changed: confirm again
    await typeAndConfirmCash('1500')
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('cash'), { target: { value: '2000' } })
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    expect(await screen.findByText('ยังไม่ได้ยืนยันยอดเงินสด')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ตกลง' }))
    expect(mocks.saveDraft).not.toHaveBeenCalled()

    await typeAndConfirmCash('2000')
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [expect.objectContaining({ method: 'CASH', amount: 1000 })]))
  })

  it('records unpaid bills without credit classification or an immediate tender', async () => {
    mountCheckout([saleItem])
    fireEvent.click(screen.getByRole('button', { name: 'ค้างชำระ' }))
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('bill-1', []))
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ isCreditBill: false, dueDate: null })
  })
})

describe('P0-4 quoted price survives quotation → bill', () => {
  const product = {
    id: 'p1', code: 'P1', name: 'Scaffold', rentalType: 'NORMAL', productType: 'BOTH', status: 'ACTIVE',
    normalPrice: 100, dailyPrice: 30, rentPrice: 100, salePrice: 900,
  } as Product
  const quote = {
    id: 'q1', quotationNo: 'QT-1', customerId: 'c1', customerName: 'Customer',
    items: [
      { id: 'l1', productId: 'p1', productName: 'Scaffold', rentalType: 'NORMAL', quantity: 2, unitPrice: 80, usageCountOrDays: 1, lineTotal: 160 },
      { id: 'l2', productId: 'p1', productName: 'Scaffold', rentalType: 'SALE', quantity: 1, unitPrice: 850, usageCountOrDays: 1, lineTotal: 850 },
      { id: 'l3', productId: 'p1', productName: 'Scaffold', rentalType: 'NORMAL', quantity: 1, unitPrice: 100, usageCountOrDays: 1, lineTotal: 100 },
    ],
  } as unknown as Quotation

  it('sends the quoted price when it differs from the product price, omits it when equal', () => {
    const { cartItems } = mapQuotationToPos(quote, [product], [customer])
    expect(cartItems.map((it) => cartLineUnitPriceForServer(it))).toEqual([80, 850, undefined])
  })

  it('refuses to build a POS cart from a quote whose product is missing', () => {
    const quoteWithMissingProduct = {
      ...quote,
      items: [...quote.items, { id: 'missing', productId: 'gone', productName: 'Old item', rentalType: 'NORMAL', quantity: 1, unitPrice: 55, usageCountOrDays: 1, lineTotal: 55 }],
    } as unknown as Quotation
    expect(() => mapQuotationToPos(quoteWithMissingProduct, [product], [customer])).toThrow('Old item')
  })

  it('checkout sends the quoted unit price in the draft', async () => {
    const { cartItems } = mapQuotationToPos(quote, [product], [customer])
    mountCheckout([cartItems[0]])
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกแบบร่าง' }))
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledOnce())
    expect(mocks.saveDraft.mock.calls[0][0].lines).toEqual([
      expect.objectContaining({ productId: 'p1', mode: 'RENTAL', quantity: 2, unitPrice: 80 }),
    ])
  })
})

describe('P1-B2 retry after a failed confirm reuses the saved draft', () => {
  const confirmButton = () => screen.getByRole('button', { name: 'ออกบิล' })

  it('confirm fails → retry updates the same draft (no second draft) and then confirms it', async () => {
    mocks.confirm.mockRejectedValueOnce(new Error('network down'))
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.click(confirmButton())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('เกิดข้อผิดพลาดในการบันทึกบิล', 'network down', 'ERROR'))
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1)
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ billId: null })

    fireEvent.click(confirmButton())
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2))
    expect(mocks.saveDraft).toHaveBeenCalledTimes(2)
    // the retry saves into the draft created by the first attempt
    expect(mocks.saveDraft.mock.calls[1][0]).toMatchObject({ billId: 'bill-1' })
    expect(mocks.confirm).toHaveBeenLastCalledWith('bill-1', [expect.objectContaining({ method: 'CASH', amount: 1000 })])
  })

  it('save draft itself fails → nothing is remembered, the retry starts a new draft', async () => {
    mocks.saveDraft.mockRejectedValueOnce(new Error('save failed'))
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.click(confirmButton())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('เกิดข้อผิดพลาดในการบันทึกบิล', 'save failed', 'ERROR'))
    expect(mocks.confirm).not.toHaveBeenCalled()
    fireEvent.click(confirmButton())
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.saveDraft.mock.calls[1][0]).toMatchObject({ billId: null })
  })

  it('server total above the cash typed: retry with enough cash reuses the draft from the first try', async () => {
    mocks.fetchBill.mockResolvedValueOnce({ id: 'bill-1', grandTotal: 1200 })
    mountCheckout([saleItem])
    selectCashPayment()
    await typeAndConfirmCash('1000')
    fireEvent.click(confirmButton())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('ยอดเงินที่รับไม่พอ', expect.any(String), 'ERROR'))
    await typeAndConfirmCash('1500')
    fireEvent.click(confirmButton())
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.saveDraft.mock.calls[1][0]).toMatchObject({ billId: 'bill-1' })
  })

  it('confirm succeeds first time: one draft, one confirm (normal flow)', async () => {
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.click(confirmButton())
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.saveDraft).toHaveBeenCalledOnce()
    expect(mocks.toast).toHaveBeenCalledWith('บันทึกการขายสำเร็จ', 'เลขที่บิล: BL-2026-000001', 'SUCCESS')
  })
})
