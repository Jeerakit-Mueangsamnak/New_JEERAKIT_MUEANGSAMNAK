// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CheckoutPage from '@/app/pos/checkout/page'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'
import { ConfirmDialogProvider } from '@/components/common/ConfirmDialogProvider'
import { loadSystemSettings, setCachedSystemSettings } from '@/features/settings/services/settings-storage'
import { CartItem, saveActiveCart } from '@/features/pos/services/cart-storage'
import { Customer, Product } from '@/lib/types/rental-pos'

const mocks = vi.hoisted(() => ({
  saveDraft: vi.fn(async () => 'bill-9'),
  confirm: vi.fn(async () => ({ id: 'bill-9', billNo: 'BL-2026-000009', grandTotal: 1000, items: [] })),
  fetchBill: vi.fn(async () => ({ id: 'bill-9', grandTotal: 1000 })),
  print: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'tester', fullName: 'Tester' } }) }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
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
vi.mock('@/features/pos/components/payment/PaymentDynamicContent', () => ({ PaymentDynamicContent: () => null }))
// The bill is shown and printed on the shop's main bill form (จัดการเอกสาร › แบบฟอร์มบิล).
vi.mock('@/features/documents/services/template-library-storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/documents/services/template-library-storage')>()),
  refreshSharedTemplates: vi.fn(async () => [{
    id: 'tpl-main', name: 'ใบส่งของ/ใบเสร็จรับเงิน', category: 'ใบส่งของ/ใบเสร็จรับเงิน', targetGroup: 'BILL',
    paperSize: 'A4', orientation: 'PORTRAIT', templateSchema: '<div>{{document.number}}</div>',
  }]),
  loadDocumentNames: () => [],
}))
// The printed document = what the shop form receives
vi.mock('@/features/documents/utils/transaction-print', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/documents/utils/transaction-print')>()),
  pickBillFormTemplate: (templates: unknown[]) => templates[0],
  renderBillFormPagesHtml: (data: any, business: any) => [
    `<output data-testid="doc">${JSON.stringify({ shop: business.businessName, taxId: business.taxId, billNo: data.billNo, billDate: data.billDate, items: data.items.length, total: data.grandTotal })}</output>`,
  ],
  printBillForm: mocks.print,
}))
vi.mock('@/components/common/PostSavePrintModal', () => ({
  PostSavePrintModal: ({ isOpen, onPrint }: any) => (isOpen ? <button onClick={onPrint}>พิมพ์เอกสาร</button> : null),
}))

const customer = { id: 'c1', customerName: 'Customer', phone: '0812345678', address: 'Bangkok' } as Customer
const saleItem: CartItem = {
  id: 'sale', product: { id: 'p1', code: 'p1', name: 'Item', rentalType: 'SALE', salePrice: 1000 } as Product,
  itemType: 'SALE', rentalType: 'SALE', unitPrice: 1000, quantity: 1, usageCount: 1, lineTotal: 1000,
}
const doc = async () => JSON.parse((await screen.findByTestId('doc')).textContent || '{}')

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  const settings = loadSystemSettings()
  setCachedSystemSettings({
    ...settings,
    business: { ...settings.business, businessName: 'ร้านทดสอบ', taxId: '1234567890123', address: '', phone: '' },
  })
  saveActiveCart({
    items: [saleItem], customer, discount: 0, shippingFee: 0, depositAmount: 0, tax: 0, taxRate: 0, subtotal: 1000, grandTotal: 1000,
    shippingAddress: '', documentType: 'บิลขาย', documentDate: '2026-10-07', headerRentalDate: '2026-10-07', headerReturnDate: '2026-10-07',
  })
})
afterEach(cleanup)

describe('P1-B1 the document printed after saving is the saved bill', () => {
  it('shows the shop details from Settings, never made-up ones', async () => {
    render(<ConfirmDialogProvider><SystemSettingsProvider><CheckoutPage /></SystemSettingsProvider></ConfirmDialogProvider>)
    expect(await doc()).toMatchObject({ shop: 'ร้านทดสอบ', taxId: '1234567890123' })
    // The issue date picked in the cart, not today
    expect(await doc()).toMatchObject({ billDate: '2026-10-07' })
    expect(screen.getByTestId('doc').textContent).not.toContain('0105560001234')
  })

  it('after confirm, the print keeps the items and uses the real bill number although the cart is cleared', async () => {
    render(<ConfirmDialogProvider><SystemSettingsProvider><CheckoutPage /></SystemSettingsProvider></ConfirmDialogProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'เงินสด' }))
    fireEvent.click(screen.getByRole('button', { name: /ออกบิล/ }))
    const printButton = await screen.findByRole('button', { name: 'พิมพ์เอกสาร' })
    expect(await doc()).toMatchObject({ billNo: 'BL-2026-000009', items: 1, total: 1000, shop: 'ร้านทดสอบ' })
    fireEvent.click(printButton)
    await waitFor(() => expect(mocks.print).toHaveBeenCalledOnce())
    // Printed on the shop form with the saved bill, not window.print() of the page
    const [[data, business, form]] = mocks.print.mock.calls as unknown as [[{ billNo: string }, { businessName: string }, { id: string }]]
    expect(data.billNo).toBe('BL-2026-000009')
    expect(business.businessName).toBe('ร้านทดสอบ')
    expect(form.id).toBe('tpl-main')
  })
})
