// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CartPanel } from '@/features/pos/components/CartPanel'
import CheckoutPage from '@/app/pos/checkout/page'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'
import { DEFAULT_SYSTEM_CONFIG, loadSystemSettings, setCachedSystemSettings } from '@/features/settings/services/settings-storage'
import { CartItem, loadActiveCart, saveActiveCart } from '@/features/pos/services/cart-storage'
import { Customer } from '@/lib/types/rental-pos'

const mocks = vi.hoisted(() => ({
  saveDraft: vi.fn(async (_input: { lines: unknown[]; vatEnabled?: boolean }) => 'bill-1'),
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
vi.mock('@/templates/rental-bill/RentalBillTemplate', () => ({
  RentalBillTemplate: ({ data }: any) => <output data-testid="preview-tax">{data.taxAmount}</output>,
}))
vi.mock('@/features/pos/components/payment/PaymentDynamicContent', () => ({ PaymentDynamicContent: () => null }))
vi.mock('@/components/common/PostSavePrintModal', () => ({ PostSavePrintModal: () => null }))

const customer = { id: 'customer', customerName: 'Customer', phone: '0812345678', address: 'Bangkok' } as Customer
const saleItem: CartItem = {
  id: 'SALE', product: { id: 'SALE', code: 'SALE', name: 'SALE', rentalType: 'SALE' } as CartItem['product'],
  itemType: 'SALE', rentalType: 'SALE', unitPrice: 100, quantity: 1, usageCount: 1, lineTotal: 100,
}
const vatShop = { ...DEFAULT_SYSTEM_CONFIG, taxDiscount: { ...DEFAULT_SYSTEM_CONFIG.taxDiscount, vatRate: 7, vatMode: 'EXCLUSIVE' as const } }

function mountCheckout(vatEnabled: boolean | undefined) {
  saveActiveCart({
    items: [saleItem], customer: null, discount: 0, shippingFee: 0, depositAmount: 0,
    tax: 999, taxRate: 0.99, subtotal: 100, grandTotal: 1099, vatEnabled,
    shippingAddress: '', documentType: 'บิลขาย', documentDate: '2026-10-07',
    headerRentalDate: '2026-10-07', headerReturnDate: '2026-10-07',
  })
  return render(<SystemSettingsProvider><CheckoutPage /></SystemSettingsProvider>)
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  setCachedSystemSettings(vatShop)
})
afterEach(cleanup)

describe('VAT ON/OFF is the state of the current bill, not a shop setting', () => {
  it('a new cart starts with VAT off; switching it on changes only this bill (settings untouched)', async () => {
    const before = JSON.stringify(loadSystemSettings())
    render(<SystemSettingsProvider><CartPanel onCheckout={vi.fn()} items={[saleItem]} /></SystemSettingsProvider>)
    const toggle = screen.getByRole('switch', { name: 'เปิด VAT สำหรับบิลนี้' }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.checked).toBe(true))
    expect(screen.getByText('ภาษี VAT (7%)')).toBeTruthy()
    expect(mocks.saveSection).not.toHaveBeenCalled()
    expect(JSON.stringify(loadSystemSettings())).toBe(before)
  })

  it('VAT chosen for one bill does not leak into the next bill', async () => {
    const first = render(<SystemSettingsProvider><CartPanel onCheckout={vi.fn()} items={[saleItem]} /></SystemSettingsProvider>)
    fireEvent.click(screen.getByRole('switch', { name: 'เปิด VAT สำหรับบิลนี้' }))
    fireEvent.click(screen.getByRole('button', { name: /ชำระเงิน/ }))
    expect(loadActiveCart()?.vatEnabled).toBe(true)
    first.unmount()
    // next bill = a fresh cart
    render(<SystemSettingsProvider><CartPanel onCheckout={vi.fn()} items={[saleItem]} /></SystemSettingsProvider>)
    expect((screen.getByRole('switch', { name: 'เปิด VAT สำหรับบิลนี้' }) as HTMLInputElement).checked).toBe(false)
  })

  it('VAT cannot be switched on before the OWNER sets the rate and mode (no 7% fallback)', () => {
    setCachedSystemSettings(DEFAULT_SYSTEM_CONFIG)
    render(<SystemSettingsProvider><CartPanel onCheckout={vi.fn()} items={[saleItem]} /></SystemSettingsProvider>)
    const toggle = screen.getByRole('switch', { name: 'เปิด VAT สำหรับบิลนี้' }) as HTMLInputElement
    expect(toggle.disabled).toBe(true)
    expect(screen.getByText('เจ้าของร้านยังไม่ได้ตั้งอัตรา VAT')).toBeTruthy()
  })

  it.each([true, false])('checkout previews this bill VAT (%s) and sends it with the draft; the SERVER total is paid', async (on) => {
    mountCheckout(on)
    expect(screen.getByTestId('preview-tax').textContent).toBe(on ? '7' : '0')
    fireEvent.click(screen.getByRole('button', { name: 'เงินสด' }))
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันออกบิล' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ vatEnabled: on })
    expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [expect.objectContaining({ method: 'CASH', amount: 107 })])
    expect(mocks.saveSection).not.toHaveBeenCalled()
  })

  it('an old cart without a VAT choice is a bill with VAT off', async () => {
    mountCheckout(undefined)
    expect(screen.getByTestId('preview-tax').textContent).toBe('0')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกแบบร่าง (Save Draft)' }))
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledOnce())
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ vatEnabled: false })
  })

  it('quotation mode has its own VAT switch (off at start) and sends the choice when saving', () => {
    setCachedSystemSettings(vatShop)
    const onSave = vi.fn()
    render(<SystemSettingsProvider><CartPanel onCheckout={vi.fn()} items={[saleItem]} isQuotationMode onSaveQuotation={onSave} /></SystemSettingsProvider>)
    const vatSwitch = screen.getByRole('switch', { name: 'เปิด VAT สำหรับใบเสนอราคานี้' }) as HTMLInputElement
    expect(vatSwitch.checked).toBe(false)
    fireEvent.click(vatSwitch)
    fireEvent.click(screen.getByRole('button', { name: /บันทึกใบเสนอราคา/ }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ vatEnabled: true }))
    expect(onSave.mock.calls[0][0].tax).toBeGreaterThan(0)
  })
})
