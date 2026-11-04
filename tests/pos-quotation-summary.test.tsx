// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import QuotationSummaryPage from '@/app/pos/quotation/page'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'
import { DEFAULT_SYSTEM_CONFIG, setCachedSystemSettings } from '@/features/settings/services/settings-storage'
import { CartItem, loadActiveCart, saveActiveCart, type ActiveCartData } from '@/features/pos/services/cart-storage'
import type { Quotation } from '@/lib/types/rental-pos'

// สรุปใบเสนอราคา (owner 2026-11-04): the quotation is finished on the same central panel as ชำระเงิน.
const mocks = vi.hoisted(() => ({
  addQuotation: vi.fn(async (_q: unknown) => 'q-1'),
  fetchQuotations: vi.fn(async () => []),
  toast: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }))
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: mocks.toast }) }))
vi.mock('@/features/quotations/services/quotation-storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/quotations/services/quotation-storage')>()
  return {
    ...real,
    addQuotation: mocks.addQuotation,
    fetchQuotationsFromSupabase: mocks.fetchQuotations,
    getQuotationById: (id: string) => (id === 'q-1' ? ({ id, quotationNo: 'QT-04112569-001' } as Quotation) : undefined),
  }
})
vi.mock('@/features/documents/utils/transaction-print', () => ({
  loadQuotationPrintTemplate: vi.fn(async () => undefined),
  renderQuotationA4PagesHtml: vi.fn(() => []),
}))
vi.mock('@/features/settings/api/settings-repository', () => ({ saveSettingsSection: vi.fn() }))
vi.mock('@/features/pos/components/A4FitPreview', () => ({ A4FitPreview: ({ children }: any) => children }))

const saleItem: CartItem = {
  id: 'SALE', product: { id: 'SALE', code: 'SALE', name: 'SALE', rentalType: 'SALE' } as CartItem['product'],
  itemType: 'SALE', rentalType: 'SALE', unitPrice: 100, quantity: 1, usageCount: 1, lineTotal: 100,
}
// The shop sets only the rate (no price mode).
const rateOnly = { ...DEFAULT_SYSTEM_CONFIG, taxDiscount: { ...DEFAULT_SYSTEM_CONFIG.taxDiscount, vatRate: 7, vatMode: null } }

function mount(extra: Partial<ActiveCartData> = {}) {
  saveActiveCart({
    items: [saleItem], customer: null, discount: 0, shippingFee: 0, depositAmount: 0,
    tax: 0, taxRate: 0, subtotal: 100, grandTotal: 100, shippingAddress: '', documentType: 'ใบเสนอราคา',
    documentDate: '2026-11-04', headerRentalDate: '2026-11-04', headerReturnDate: '2026-11-05',
    quotationMode: true, ...extra,
  })
  return render(<SystemSettingsProvider><QuotationSummaryPage /></SystemSettingsProvider>)
}
const saved = () => mocks.addQuotation.mock.calls[0][0] as Quotation

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  setCachedSystemSettings(rateOnly)
})
afterEach(cleanup)

describe('สรุปใบเสนอราคา uses the central summary panel', () => {
  it('has the same parts as ชำระเงิน but no payment: amounts, รวม/ไม่รวม VAT (none pressed), total, one save button', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'สรุปใบเสนอราคา' })).toBeTruthy()
    for (const label of ['ส่วนลด (บาท)', 'ค่าขนส่ง (บาท)', 'เงินมัดจำ (บาท)', 'ยอดรวมใบเสนอราคา', 'VAT 7%']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'รวม VAT' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'ไม่รวม VAT' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('button', { name: 'เงินสด' })).toBeNull()
    expect(screen.getByRole('button', { name: 'บันทึกใบเสนอราคา' })).toBeTruthy()
  })

  it.each([
    ['ไม่รวม VAT', 'EXCLUSIVE', 7, 107],
    ['รวม VAT', 'INCLUSIVE', 6.54, 100],
  ] as const)('%s: the quotation is saved with that mode and its amounts, then the cart is cleared', async (name, mode, tax, total) => {
    mount()
    fireEvent.click(screen.getByRole('button', { name }))
    expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกใบเสนอราคา' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/quotations'))
    expect(saved()).toMatchObject({ vatEnabled: true, vatMode: mode, taxAmount: tax, grandTotal: total, quotationDate: '2026-11-04' })
    expect(loadActiveCart()).toBeNull()
    expect(mocks.toast).toHaveBeenCalledWith('บันทึกใบเสนอราคาสำเร็จ', 'ใบเสนอราคา QT-04112569-001', 'SUCCESS')
  })

  it('no button pressed = no VAT; discount / shipping / deposit typed here are saved, deposit stays out of the total', async () => {
    mount()
    const [disc, ship, dep] = screen.getAllByPlaceholderText('0')
    fireEvent.change(disc, { target: { value: '10' } })
    fireEvent.change(ship, { target: { value: '20' } })
    fireEvent.change(dep, { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกใบเสนอราคา' }))
    await waitFor(() => expect(mocks.addQuotation).toHaveBeenCalledOnce())
    expect(saved()).toMatchObject({ vatEnabled: false, vatMode: undefined, taxAmount: 0, discountAmount: 10, shippingFee: 20, depositAmount: 50, grandTotal: 110 })
  })

  it('an edit keeps the quotation id and number; back to POS keeps the edit', async () => {
    mount({ quotationEdit: { id: 'q-9', quotationNo: 'QT-01112569-009', status: 'SENT' } })
    expect(screen.getByRole('heading', { name: 'แก้ไขใบเสนอราคา QT-01112569-009' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /ย้อนกลับไป POS/ }).getAttribute('href')).toBe('/pos?mode=quotation&resume=1&editQuotationId=q-9')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกใบเสนอราคา' }))
    await waitFor(() => expect(mocks.addQuotation).toHaveBeenCalledOnce())
    expect(mocks.fetchQuotations).toHaveBeenCalled()
    expect(saved()).toMatchObject({ id: 'q-9', quotationNo: 'QT-01112569-009', status: 'SENT' })
  })

  it('a bill cart (not a quotation) is sent back to POS quotation mode', () => {
    mount({ quotationMode: undefined })
    expect(mocks.replace).toHaveBeenCalledWith('/pos?mode=quotation')
  })

  it('VAT cannot be chosen before the OWNER sets the rate', () => {
    setCachedSystemSettings(DEFAULT_SYSTEM_CONFIG)
    mount()
    expect((screen.getByRole('button', { name: 'รวม VAT' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('เจ้าของร้านยังไม่ได้ตั้งอัตรา VAT')).toBeTruthy()
  })
})
