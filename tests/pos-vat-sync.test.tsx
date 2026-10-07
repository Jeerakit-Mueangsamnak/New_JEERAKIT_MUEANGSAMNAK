// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CartPanel } from '@/features/pos/components/CartPanel'
import CheckoutPage from '@/app/pos/checkout/page'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'
import { loadSystemSettings, saveSystemSettings } from '@/features/settings/services/settings-storage'
import { CartItem, saveActiveCart } from '@/features/pos/services/cart-storage'
import { Customer } from '@/lib/types/rental-pos'

const mocks = vi.hoisted(() => ({
  saveDraft: vi.fn(async (_input: { lines: unknown[] }) => 'bill-1'),
  confirm: vi.fn(async () => ({ id: 'bill-1', billNo: 'BL-2026-000001', items: [] })),
  deliver: vi.fn(async () => null),
  fetchBill: vi.fn(async () => ({ id: 'bill-1', grandTotal: 107 })),
  toast: vi.fn(),
  push: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'tester', fullName: 'Tester' } }) }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: mocks.toast }) }))
// The checkout talks to the server only through bill-service (RPC); the server prices the bill.
vi.mock('@/features/bills/services/bill-service', () => ({
  saveBillDraft: mocks.saveDraft, confirmBill: mocks.confirm, deliverBill: mocks.deliver,
}))
vi.mock('@/features/bills/services/bill-storage', () => ({
  fetchBillByIdFromSupabase: mocks.fetchBill, fetchBillsFromSupabase: vi.fn(async () => []), loadBillById: () => undefined,
}))
vi.mock('@/features/settings/api/settings-repository', () => ({
  fetchSharedSystemConfig: vi.fn(async () => null),
  saveSharedSystemConfig: vi.fn(async () => {}),
}))
vi.mock('@/features/pos/components/CustomerUnifiedSelector', () => ({ CustomerUnifiedSelector: () => null }))
vi.mock('@/features/customers/components/NewCustomerModal', () => ({ NewCustomerModal: () => null }))
vi.mock('@/features/pos/components/A4FitPreview', () => ({ A4FitPreview: ({ children }: any) => children }))
vi.mock('@/templates/rental-bill/RentalBillTemplate', () => ({
  RentalBillTemplate: ({ data }: any) => <output data-testid="preview-tax">{data.taxAmount}</output>,
}))
vi.mock('@/features/pos/components/payment/PaymentDynamicContent', () => ({ PaymentDynamicContent: () => null }))
vi.mock('@/components/common/PostSavePrintModal', () => ({ PostSavePrintModal: () => null }))

const customer = { id: 'customer', customerName: 'Customer', phone: '0812345678', address: 'Bangkok' } as Customer
function item(mode: 'RENT' | 'SALE', legacy = false): CartItem {
  return {
    id: mode, product: { id: mode, code: mode, name: mode, rentalType: mode === 'SALE' ? 'SALE' : 'NORMAL' } as CartItem['product'],
    itemType: legacy ? undefined : mode, rentalType: mode === 'SALE' ? 'SALE' : 'NORMAL',
    unitPrice: 100, quantity: 1, usageCount: 1, lineTotal: 100,
  }
}
function mountCheckout(items: CartItem[], selectedCustomer: Customer | null = customer) {
  saveActiveCart({
    items, customer: selectedCustomer, discount: 0, shippingFee: 0, depositAmount: 0,
    tax: 999, taxRate: 0.99, subtotal: 100, grandTotal: 1099,
    shippingAddress: '', documentType: 'บิลเช่า', documentDate: '2026-09-24',
    headerRentalDate: '2026-09-24', headerReturnDate: '2026-09-25',
  })
  return render(<SystemSettingsProvider><CheckoutPage /></SystemSettingsProvider>)
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  const settings = loadSystemSettings()
  saveSystemSettings({ ...settings, financePayment: { ...settings.financePayment, defaultVatPercent: 7, vatEnabled: true } })
})
afterEach(cleanup)

describe('MASTER #5 rendered POS/Checkout', () => {
  it('POS switch persists shared setting and responds to settings changes', async () => {
    render(<SystemSettingsProvider><CartPanel onCheckout={vi.fn()} items={[item('SALE')]} /></SystemSettingsProvider>)
    const toggle = screen.getByRole('switch', { name: 'เปิดใช้งาน VAT' }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(loadSystemSettings().financePayment).toMatchObject({ vatEnabled: false, defaultVatPercent: 7 })
      expect(toggle.checked).toBe(false)
    })
    act(() => {
      const settings = loadSystemSettings()
      saveSystemSettings({ ...settings, financePayment: { ...settings.financePayment, vatEnabled: true } })
    })
    expect(toggle.checked).toBe(true)
  })

  it.each([false, true])('Checkout previews current VAT (enabled=%s); confirm pays the SERVER total', async (enabled) => {
    const settings = loadSystemSettings()
    saveSystemSettings({ ...settings, financePayment: { ...settings.financePayment, vatEnabled: enabled } })
    mountCheckout([item('SALE')], null)
    expect(screen.getByTestId('preview-tax').textContent).toBe(enabled ? '7' : '0')
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันออกบิลเช่า' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({
      lines: [expect.objectContaining({ productId: 'SALE', mode: 'SALE', quantity: 1, unitPrice: 100 })],
    })
    // amount comes from the server-priced draft (107), never from the browser math
    expect(mocks.confirm).toHaveBeenCalledWith('bill-1', [expect.objectContaining({ method: 'CASH', amount: 107 })])
  })

  it('Checkout follows VAT changes while mounted; draft sends rental + sale lines to the server', async () => {
    mountCheckout([item('RENT'), item('SALE')])
    expect(screen.getByTestId('preview-tax').textContent).toBe('14')
    act(() => {
      const settings = loadSystemSettings()
      saveSystemSettings({ ...settings, financePayment: { ...settings.financePayment, vatEnabled: false } })
    })
    expect(screen.getByTestId('preview-tax').textContent).toBe('0')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกแบบร่าง (Save Draft)' }))
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledOnce())
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.saveDraft.mock.calls[0][0].lines).toEqual([
      expect.objectContaining({ productId: 'RENT', mode: 'RENTAL', calc: 'PER_PERIOD', periods: 1 }),
      expect.objectContaining({ productId: 'SALE', mode: 'SALE' }),
    ])
  })

  it.each([null, { ...customer, phone: '' }, { ...customer, address: '' }])('legacy RENT blocks confirm and draft for incomplete customer', (selectedCustomer) => {
    mountCheckout([item('RENT', true)], selectedCustomer)
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันออกบิลเช่า' }))
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกแบบร่าง (Save Draft)' }))
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledTimes(2)
  })
})
