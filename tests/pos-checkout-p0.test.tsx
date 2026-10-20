// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CheckoutPage from '@/app/pos/checkout/page'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'
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
vi.mock('@/templates/rental-bill/RentalBillTemplate', () => ({ RentalBillTemplate: () => null }))
vi.mock('@/components/common/PostSavePrintModal', () => ({ PostSavePrintModal: () => null }))
// Only the cash box matters here
vi.mock('@/features/pos/components/payment/PaymentDynamicContent', () => ({
  PaymentDynamicContent: ({ receivedCashInput, onReceivedCashInputChange }: any) => (
    <input aria-label="cash" value={receivedCashInput} onChange={(e) => onReceivedCashInputChange(e.target.value)} />
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
  return render(<SystemSettingsProvider><CheckoutPage /></SystemSettingsProvider>)
}

function selectCashPayment() {
  fireEvent.click(screen.getByRole('button', { name: 'เงินสด' }))
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

  it('blocks confirm when cash received is less than the total (nothing saved)', async () => {
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.change(screen.getByLabelText('cash'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันออกบิล' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('เงินสดไม่ถูกต้อง', expect.any(String), 'ERROR'))
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('blocks confirm when the server total is above the cash typed in', async () => {
    mocks.fetchBill.mockResolvedValueOnce({ id: 'bill-1', grandTotal: 1200 })
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.change(screen.getByLabelText('cash'), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันออกบิล' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('เงินสดไม่ถูกต้อง', expect.any(String), 'ERROR'))
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('pays the server total when cash covers it, and when the cash box is left empty', async () => {
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.change(screen.getByLabelText('cash'), { target: { value: '1500' } })
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันออกบิล' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [expect.objectContaining({ method: 'CASH', amount: 1000 })]))
    cleanup()
    vi.clearAllMocks()
    mountCheckout([saleItem])
    selectCashPayment()
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันออกบิล' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [expect.objectContaining({ method: 'CASH', amount: 1000 })]))
  })

  it('requires an explicit payment choice and hides PromptPay until its QR flow is available', () => {
    mountCheckout([saleItem])
    const confirmButton = screen.getByRole('button', { name: 'ยืนยันออกบิล' }) as HTMLButtonElement
    expect(confirmButton.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'PromptPay QR' })).toBeNull()
    selectCashPayment()
    expect(confirmButton.disabled).toBe(false)
  })

  it('records unpaid bills without credit classification or an immediate tender', async () => {
    mountCheckout([saleItem])
    fireEvent.click(screen.getByRole('button', { name: 'ค้างชำระ' }))
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันออกบิล' }))

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
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกแบบร่าง (Save Draft)' }))
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledOnce())
    expect(mocks.saveDraft.mock.calls[0][0].lines).toEqual([
      expect.objectContaining({ productId: 'p1', mode: 'RENTAL', quantity: 2, unitPrice: 80 }),
    ])
  })
})

describe('P1-B2 retry after a failed confirm reuses the saved draft', () => {
  const confirmButton = () => screen.getByRole('button', { name: /ยืนยันออกบิล/ })

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
    fireEvent.change(screen.getByLabelText('cash'), { target: { value: '1000' } })
    fireEvent.click(confirmButton())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('เงินสดไม่ถูกต้อง', expect.any(String), 'ERROR'))
    fireEvent.change(screen.getByLabelText('cash'), { target: { value: '1500' } })
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
