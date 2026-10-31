import { describe, expect, it } from 'vitest'
import { QUOTATION_STARTER_TEMPLATE } from '@/features/documents/constants/initialDocumentTemplates'
import {
  isQuotationPrintTemplate,
  pickQuotationPrintTemplate,
  renderQuotationA4PagesHtml,
} from '@/features/documents/utils/transaction-print'
import type { Quotation } from '@/lib/types/rental-pos'

function quotation(itemCount: number): Quotation {
  return {
    id: 'q-print', quotationNo: 'QT-TEST-001', quotationDate: '2026-10-28',
    customerId: 'customer-1', customerName: 'ลูกค้าทดสอบ',
    items: Array.from({ length: itemCount }, (_, index) => ({
      id: `item-${index + 1}`, productId: `product-${index + 1}`,
      productName: `ทดสอบสินค้า ${index + 1}`, rentalType: 'SALE' as const,
      quantity: 1, unitPrice: 10, lineTotal: 10, unitName: 'ชิ้น', usageCountOrDays: 1,
    })),
    subtotal: itemCount * 10, discountAmount: 0, shippingFee: 0,
    depositAmount: 0, taxAmount: 0, vatEnabled: false,
    grandTotal: itemCount * 10, status: 'SENT',
  } as Quotation
}

const business = {
  businessName: 'ร้านทดสอบ', address: 'อุตรดิตถ์', phone: '080-000-0000', taxId: '0000000000000',
}

describe('quotation A4 printing with live templates and unlimited items', () => {
  it.each([
    [0, 1], [1, 1], [16, 1], [17, 2], [30, 2], [33, 3],
  ])('%i items print across %i pages, all items and totals once', (count, expectedPages) => {
    const pages = renderQuotationA4PagesHtml(quotation(count), business, QUOTATION_STARTER_TEMPLATE)
    expect(pages).toHaveLength(expectedPages)
    for (let index = 0; index < count; index++) {
      expect(pages[Math.floor(index / 16)]).toContain(`ทดสอบสินค้า ${index + 1}`)
    }
    for (let index = 0; index < pages.length; index++) {
      expect(pages[index]).toContain('QT-TEST-001')
      expect(pages[index]).toContain('ร้านทดสอบ')
      expect(pages[index].includes('จำนวนเงินรวมทั้งสิ้น')).toBe(index === pages.length - 1)
    }
    if (count > 16) {
      expect(pages[1]).toMatch(/>17<\/td>/)
      expect(pages[1]).toContain(`หน้า 2 / ${expectedPages}`)
    }
  })

  it('renders a selected, data-bound store template rather than always using the builtin', () => {
    const builtin = QUOTATION_STARTER_TEMPLATE
    const custom = {
      ...builtin,
      id: 'tpl-custom-print',
      templateSchema: builtin.templateSchema.replace('ใบเสนอราคา / QUOTATION', 'ใบเสนอราคาฉบับร้าน'),
    }
    expect(isQuotationPrintTemplate(custom)).toBe(true)
    expect(renderQuotationA4PagesHtml(quotation(1), business, custom)[0]).toContain('ใบเสนอราคาฉบับร้าน')
    expect(isQuotationPrintTemplate({ ...builtin, templateSchema: '<img src="/form.png" />' })).toBe(false)
  })

  it('refuses to repeat financial summary on continuation pages for incompatible imported templates', () => {
    const builtin = QUOTATION_STARTER_TEMPLATE
    const custom = {
      ...builtin,
      id: 'tpl-no-page-boundary',
      templateSchema: builtin.templateSchema
        .replace('<!-- QUOTATION_FINAL_START -->', '')
        .replace('<!-- QUOTATION_FINAL_END -->', ''),
    }
    expect(renderQuotationA4PagesHtml(quotation(17), business, custom)).toEqual([])
  })

  it('prints with the shop quotation form marked default, else the first usable one', () => {
    const a = { ...QUOTATION_STARTER_TEMPLATE, id: 'tpl-a', isDefault: false }
    const b = { ...QUOTATION_STARTER_TEMPLATE, id: 'tpl-b', isDefault: true }
    const blank = { ...QUOTATION_STARTER_TEMPLATE, id: 'tpl-blank', isDefault: true, templateSchema: '<p>blank</p>' }
    expect(pickQuotationPrintTemplate([a, b])?.id).toBe('tpl-b')
    expect(pickQuotationPrintTemplate([blank, a])?.id).toBe('tpl-a')
    expect(pickQuotationPrintTemplate([blank])).toBeUndefined()
    expect(pickQuotationPrintTemplate([])).toBeUndefined()
  })
})
