// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CartPanel } from '@/features/pos/components/CartPanel'
import CheckoutPage from '@/app/pos/checkout/page'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'
import { ConfirmDialogProvider } from '@/components/common/ConfirmDialogProvider'
import { DEFAULT_SYSTEM_CONFIG, loadSystemSettings, setCachedSystemSettings } from '@/features/settings/services/settings-storage'
import { CartItem, loadActiveCart, saveActiveCart } from '@/features/pos/services/cart-storage'
import { Customer } from '@/lib/types/rental-pos'

const mocks = vi.hoisted(() => ({
  saveDraft: vi.fn(async (_input: { lines: unknown[]; vatEnabled?: boolean; vatMode?: string | null }) => 'bill-1'),
  confirm: vi.fn(async () => ({ id: 'bill-1', billNo: 'BL-07102569-001', items: [] })),
  deliver: vi.fn(async () => null),
  fetchBill: vi.fn(async () => ({ id: 'bill-1', grandTotal: 107 })),
  saveSection: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'tester', fullName: 'Tester', role: 'USER' } }) }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: mocks.toast }) }))
vi.mock('@/features/bills/services/bill-service', () => ({
  saveBillDraft: mocks.saveDraft, confirmBill: mocks.confirm, deliverBill: mocks.deliver,
}))
vi.mock('@/features/bills/services/bill-storage', () => ({
  fetchBillByIdFromSupabase: mocks.fetchBill, fetchBillsFromSupabase: vi.fn(async () => []), loadBillById: () => undefined,
}))
// Shop settings are written only through this — the POS must never call it.
vi.mock('@/features/settings/api/settings-repository', () => ({ saveSettingsSection: mocks.saveSection }))
vi.mock('@/features/pos/components/CustomerUnifiedSelector', () => ({ CustomerUnifiedSelector: () => null }))
vi.mock('@/features/customers/components/NewCustomerModal', () => ({ NewCustomerModal: () => null }))
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
vi.mock('@/features/documents/utils/transaction-print', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/documents/utils/transaction-print')>()),
  pickBillFormTemplate: (templates: unknown[]) => templates[0],
  renderBillFormPagesHtml: (data: any) => [`<output data-testid="preview-tax">${data.taxAmount}</output>`],
}))
vi.mock('@/features/pos/components/payment/PaymentDynamicContent', () => ({ PaymentDynamicContent: () => null }))
vi.mock('@/components/common/PostSavePrintModal', () => ({ PostSavePrintModal: () => null }))

const customer = { id: 'customer', customerName: 'Customer', phone: '0812345678', address: 'Bangkok' } as Customer
const saleItem: CartItem = {
  id: 'SALE', product: { id: 'SALE', code: 'SALE', name: 'SALE', rentalType: 'SALE' } as CartItem['product'],
  itemType: 'SALE', rentalType: 'SALE', unitPrice: 100, quantity: 1, usageCount: 1, lineTotal: 100,
}
const vatShop = { ...DEFAULT_SYSTEM_CONFIG, taxDiscount: { ...DEFAULT_SYSTEM_CONFIG.taxDiscount, vatRate: 7, vatMode: 'EXCLUSIVE' as const } }

function mountCheckout(vatEnabled: boolean | undefined, vatMode?: 'INCLUSIVE' | 'EXCLUSIVE') {
  saveActiveCart({
    items: [saleItem], customer: null, discount: 0, shippingFee: 0, depositAmount: 0,
    tax: 999, taxRate: 0.99, subtotal: 100, grandTotal: 1099, vatEnabled, vatMode,
    shippingAddress: '', documentType: 'บิลขาย', documentDate: '2026-10-07',
    headerRentalDate: '2026-10-07', headerReturnDate: '2026-10-07',
  })
  return render(<ConfirmDialogProvider><SystemSettingsProvider><CheckoutPage /></SystemSettingsProvider></ConfirmDialogProvider>)
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  setCachedSystemSettings(vatShop)
})
afterEach(cleanup)

describe('VAT is chosen per bill with รวม VAT / ไม่รวม VAT, not a shop setting', () => {
  const inclusiveBtn = () => screen.getByRole('button', { name: 'รวม VAT' }) as HTMLButtonElement
  const exclusiveBtn = () => screen.getByRole('button', { name: 'ไม่รวม VAT' }) as HTMLButtonElement

  it('a new bill starts with no button pressed (no VAT); ไม่รวม VAT adds VAT for this bill only (settings untouched)', async () => {
    const before = JSON.stringify(loadSystemSettings())
    mountCheckout(undefined)
    expect(inclusiveBtn().getAttribute('aria-pressed')).toBe('false')
    expect(exclusiveBtn().getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('VAT 7%')).toBeTruthy()
    expect((await screen.findByTestId('preview-tax')).textContent).toBe('0')
    fireEvent.click(exclusiveBtn())
    await waitFor(() => expect(exclusiveBtn().getAttribute('aria-pressed')).toBe('true'))
    expect(inclusiveBtn().getAttribute('aria-pressed')).toBe('false')
    expect((await screen.findByTestId('preview-tax')).textContent).toBe('7')
    expect(screen.getByText('ภาษีมูลค่าเพิ่ม 7%')).toBeTruthy()
    expect(loadActiveCart()).toMatchObject({ vatEnabled: true, vatMode: 'EXCLUSIVE' })
    expect(mocks.saveSection).not.toHaveBeenCalled()
    expect(JSON.stringify(loadSystemSettings())).toBe(before)
  })

  it('รวม VAT works by its name even though the shop price mode says EXCLUSIVE: VAT is inside the price', async () => {
    mountCheckout(undefined)
    fireEvent.click(inclusiveBtn())
    await waitFor(() => expect(inclusiveBtn().getAttribute('aria-pressed')).toBe('true'))
    expect((await screen.findByTestId('preview-tax')).textContent).toBe('6.54')
    expect(screen.getByText('ภาษีมูลค่าเพิ่ม 7% (รวมในราคาแล้ว)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'เงินสด' }))
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledOnce())
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ vatEnabled: true, vatMode: 'INCLUSIVE' })
  })

  it('pressing the chosen button again cancels VAT; the other button switches the mode', async () => {
    mountCheckout(undefined)
    fireEvent.click(exclusiveBtn())
    await waitFor(() => expect(exclusiveBtn().getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(inclusiveBtn())
    await waitFor(() => expect(inclusiveBtn().getAttribute('aria-pressed')).toBe('true'))
    expect(exclusiveBtn().getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(inclusiveBtn())
    await waitFor(() => expect(inclusiveBtn().getAttribute('aria-pressed')).toBe('false'))
    expect((await screen.findByTestId('preview-tax')).textContent).toBe('0')
    expect(loadActiveCart()).toMatchObject({ vatEnabled: false, vatMode: null })
  })

  it('a saved cart with a chosen mode comes back with that button pressed', () => {
    mountCheckout(true, 'INCLUSIVE')
    expect(inclusiveBtn().getAttribute('aria-pressed')).toBe('true')
    expect(exclusiveBtn().getAttribute('aria-pressed')).toBe('false')
  })

  it('the bill cart in the POS has no VAT switch any more, and a fresh bill starts with VAT off', () => {
    render(<SystemSettingsProvider><CartPanel onCheckout={vi.fn()} items={[saleItem]} /></SystemSettingsProvider>)
    expect(screen.queryByRole('switch', { name: 'เปิด VAT สำหรับบิลนี้' })).toBeNull()
    expect(screen.queryByText(/VAT บิลนี้/)).toBeNull()
  })

  it('VAT cannot be chosen before the OWNER sets the rate in Settings (no 7% fallback)', () => {
    setCachedSystemSettings(DEFAULT_SYSTEM_CONFIG)
    mountCheckout(true)
    expect(inclusiveBtn().disabled).toBe(true)
    expect(exclusiveBtn().disabled).toBe(true)
    expect(inclusiveBtn().getAttribute('aria-pressed')).toBe('false')
    expect(exclusiveBtn().getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('เจ้าของร้านยังไม่ได้ตั้งอัตรา VAT')).toBeTruthy()
  })

  it.each([true, false])('a bill that came with VAT %s but no mode keeps the shop price mode, is sent with the draft and the SERVER total is paid', async (on) => {
    mountCheckout(on)
    expect((await screen.findByTestId('preview-tax')).textContent).toBe(on ? '7' : '0')
    fireEvent.click(screen.getByRole('button', { name: 'เงินสด' }))
    fireEvent.click(screen.getByRole('button', { name: 'ออกบิล' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ vatEnabled: on, vatMode: on ? 'EXCLUSIVE' : null })
    expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [expect.objectContaining({ method: 'CASH', amount: 107 })])
    expect(mocks.saveSection).not.toHaveBeenCalled()
  })

  it('an old cart without a VAT choice is a bill with VAT off', async () => {
    mountCheckout(undefined)
    expect((await screen.findByTestId('preview-tax')).textContent).toBe('0')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกแบบร่าง' }))
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledOnce())
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ vatEnabled: false, vatMode: null })
    expect(screen.queryByRole('button', { name: 'ยกเลิก' })).toBeNull()
  })

  it('the quotation cart has no VAT buttons any more: it goes to สรุปใบเสนอราคา like a bill goes to ชำระเงิน', () => {
    const onCheckout = vi.fn()
    render(<SystemSettingsProvider><CartPanel onCheckout={onCheckout} items={[saleItem]} isQuotationMode /></SystemSettingsProvider>)
    expect(screen.queryByRole('button', { name: 'รวม VAT' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'ไม่รวม VAT' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'สรุปใบเสนอราคา' }))
    expect(onCheckout).toHaveBeenCalledOnce()
    // The quotation cart has its own key: it never replaces a held bill cart.
    expect(loadActiveCart('QUOTATION')).toMatchObject({ quotationMode: true, items: [expect.objectContaining({ id: 'SALE' })] })
  })
})
