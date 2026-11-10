// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { CartItem } from '@/features/pos/services/cart-storage'
import type { Product } from '@/lib/types/rental-pos'
import { CartPanel } from '@/features/pos/components/CartPanel'
import { SystemSettingsProvider } from '@/lib/contexts/SystemSettingsContext'
import { isNoChargeBillLine } from '@/features/pos/services/accessory-rules'
import { fullBillToTemplateData } from '@/features/documents/utils/rental-bill-print'
import type { FullBill, FullBillItem } from '@/lib/types/rental-return'
import type { DocumentTemplate } from '@/lib/types/document'
import { renderBillFormPagesHtml } from '@/features/documents/utils/transaction-print'

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'tester', fullName: 'Tester', role: 'USER' } }) }))
vi.mock('@/features/pos/components/CustomerUnifiedSelector', () => ({ CustomerUnifiedSelector: () => null }))
vi.mock('@/features/customers/components/NewCustomerModal', () => ({ NewCustomerModal: () => null }))

afterEach(cleanup)

// สินค้าวิธีคิดราคา "ไม่คิดเงิน" (owner 2026-11-09): แสดงจำนวน + หน่วย เท่านั้น
// ราคา/หน่วย, การเช่า (รอบ/วัน) และจำนวนเงิน เป็น "-".
const noChargeProduct = {
  id: 'p-nut', code: 'ACC-NUT-0401', name: 'น็อต 12นิ้ว', rentalType: 'NORMAL', calculationType: 'PER_ROUND',
  isChargeable: false, unit: 'ตัว', normalPrice: 0, rentPrice: 0,
} as unknown as Product

const paidProduct = {
  id: 'p-col', code: 'COL-1', name: 'แบบเสา 15x15x3.00', rentalType: 'NORMAL', calculationType: 'PER_ROUND',
  isChargeable: true, unit: 'ตัว', normalPrice: 15, rentPrice: 15,
} as unknown as Product

const noChargeItem = {
  id: 'i-nut', product: noChargeProduct, productId: 'p-nut', productName: 'น็อต 12นิ้ว', itemType: 'RENT',
  rentalType: 'NORMAL', quantity: 700, unitPrice: 0, usageCount: 1, billableDays: 1, lineTotal: 0,
} as unknown as CartItem

const paidItem = {
  id: 'i-col', product: paidProduct, productId: 'p-col', productName: 'แบบเสา 15x15x3.00', itemType: 'RENT',
  rentalType: 'NORMAL', quantity: 10, unitPrice: 15, usageCount: 2, billableDays: 1, lineTotal: 300,
} as unknown as CartItem

const form = (): DocumentTemplate => ({
  id: 'tpl-1', name: 'ใบส่งของ/ใบเสร็จรับเงิน', category: 'ใบส่งของ/ใบเสร็จรับเงิน', targetGroup: 'BILL',
  source: 'CONVERTED_IMPORT', fileType: 'HTML', paperSize: 'A4', orientation: 'PORTRAIT', pageCount: 1,
  version: 1, isDefault: false, templateSchema:
    '<div>{{document.number}}<table><tbody><tr>'
    + '<td id="q">{{items.1.quantity}}</td><td id="u">{{items.1.unit}}</td>'
    + '<td id="p">{{items.1.price}}</td><td id="r">{{items.1.rental}}</td><td id="a">{{items.1.amount}}</td>'
    + '</tr></tbody></table></div>',
}) as DocumentTemplate

const billItem = (over: Partial<FullBillItem>): FullBillItem => ({
  rentalBillItemId: 'l1', productId: 'p-nut', productCode: 'ACC-NUT-0401', productName: 'น็อต 12นิ้ว',
  quantity: 700, returnedQty: 0, outstandingQty: 700, dailyRate: 0, unit: 'ตัว',
  defaultRepairFee: 0, defaultReplacementFee: 0, requiresReturn: true,
  rentalStartDate: '2026-11-09', scheduledReturnDate: '2026-11-20', rentalType: 'NORMAL', itemType: 'RENT',
  usageCount: 1, lineTotal: 0, status: 'RENTING', ...over,
})

const bill = (item: FullBillItem): FullBill => ({
  id: 'b1', billNo: 'B-001', billDate: '2026-11-09', customerName: 'ลูกค้า ก', customerPhone: '',
  rentalStartDate: '2026-11-09', scheduledReturnDate: '2026-11-20',
  heldDepositAmount: 0, paidDepositAmount: 0, deposits: [], grandTotal: 0, paidAmount: 0, outstandingAmount: 0,
  rentalStatus: 'RENTING', paymentStatus: 'UNPAID', items: [item],
})

describe('สินค้า "ไม่คิดเงิน" ในตะกร้า POS (owner 2026-11-09)', () => {
  const mount = (items: CartItem[]) =>
    render(
      <SystemSettingsProvider>
        <CartPanel onCheckout={vi.fn()} items={items} customer={null} setCustomer={() => undefined} />
      </SystemSettingsProvider>
    )

  it('แสดงจำนวนและหน่วย แต่ยอดเงินเป็น "-" และไม่พิมพ์ราคา/รอบ', () => {
    mount([noChargeItem])
    expect(screen.getByText(/ไม่คิดเงิน · 700 ตัว/)).toBeTruthy()
    expect(screen.queryByText(/บาท ×/)).toBeNull()
    expect(screen.queryByText(/รอบ/)).toBeNull()
    expect(screen.queryByText(/0\.00 บาท/)).toBeNull()
  })

  it('สินค้าคิดเงินในตะกร้าเดียวกันยังแสดงราคาและยอดเงินตามเดิม', () => {
    mount([noChargeItem, paidItem])
    expect(screen.getByText(/15 บาท × 10 ตัว × 2 รอบ/)).toBeTruthy()
    expect(screen.getByText('300.00 บาท')).toBeTruthy()
  })
})

describe('สินค้า "ไม่คิดเงิน" บนแบบฟอร์มพิมพ์', () => {
  it('รหัสสินค้าที่ไม่คิดเงิน: จำนวน + หน่วย มีค่า ราคา / การเช่า / จำนวนเงิน เป็น "-"', () => {
    const data = fullBillToTemplateData(bill(billItem({})))
    expect(data.items[0].isNoCharge).toBe(true)
    const [page] = renderBillFormPagesHtml(data, {}, form())
    expect(page).toContain('<td id="q">700</td><td id="u">ตัว</td><td id="p">-</td><td id="r">-</td><td id="a">-</td>')
  })

  it('สินค้าคิดเงินพิมพ์ราคาและจำนวนเงินปกติ', () => {
    const data = fullBillToTemplateData(bill(billItem({ productId: 'p-col', dailyRate: 15, lineTotal: 300, isChargeable: true })))
    expect(data.items[0].isNoCharge).toBe(false)
    expect(renderBillFormPagesHtml(data, {}, form())[0]).toContain('<td id="p">15.00</td>')
  })
})

describe('isNoChargeBillLine', () => {
  it('ใช้สถานะสินค้าเป็นหลัก รายการราคา 0 ที่ยังไม่รู้สถานะจึงถูกนับเฉพาะการเช่า', () => {
    expect(isNoChargeBillLine({ rentalType: 'NORMAL', isNoCharge: true })).toBe(true)
    expect(isNoChargeBillLine({ rentalType: 'NORMAL', isChargeable: true, dailyRate: 0, lineTotal: 0 })).toBe(false)
    expect(isNoChargeBillLine({ rentalType: 'NORMAL', dailyRate: 0, lineTotal: 0 })).toBe(true)
    expect(isNoChargeBillLine({ rentalType: 'SALE', isChargeable: false, dailyRate: 0, lineTotal: 0 })).toBe(false)
  })
})
