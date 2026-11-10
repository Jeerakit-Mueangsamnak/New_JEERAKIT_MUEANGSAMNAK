import { describe, expect, it } from 'vitest'
import {
  isQuotationFormTemplate,
  pickQuotationPrintTemplate,
  renderQuotationA4PagesHtml,
} from '@/features/documents/utils/transaction-print'
import type { DocumentTemplate } from '@/lib/types/document'
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

const business = { businessName: 'ร้านทดสอบ' }

// The shop's quotation form: 20 drawn rows, one field per cell, totals once.
const shopQuotation = (over: Partial<DocumentTemplate> = {}): DocumentTemplate => ({
  id: 'tpl-q', name: 'ใบเสนอราคา', category: 'ใบเสนอราคา', targetGroup: 'BILL', source: 'CONVERTED_IMPORT', fileType: 'HTML',
  paperSize: 'A4', orientation: 'PORTRAIT', pageCount: 1, version: 1, isDefault: false,
  templateSchema: '<div>{{business.name}} {{document.number}}<table><tbody>'
    + Array.from({ length: 20 }, (_, i) => `<tr><td>{{items.${i + 1}.no}}</td><td>{{items.${i + 1}.name}}</td></tr>`).join('')
    + '</tbody></table><b id="total">{{bill.grand_total}}</b><span id="page">{{document.page}}</span></div>',
  ...over,
}) as DocumentTemplate

describe('quotation A4 printing on the shop form with unlimited items', () => {
  it.each([
    [0, 1], [1, 1], [20, 1], [21, 2], [40, 2], [41, 3],
  ])('%i items print across %i pages, all items and totals once', (count, expectedPages) => {
    const pages = renderQuotationA4PagesHtml(quotation(count), business, shopQuotation())
    expect(pages).toHaveLength(expectedPages)
    for (let index = 0; index < count; index++) {
      expect(pages[Math.floor(index / 20)]).toContain(`ทดสอบสินค้า ${index + 1}<`)
    }
    pages.forEach((page, index) => {
      expect(page).toContain('QT-TEST-001')
      expect(page).toContain('ร้านทดสอบ')
      expect(page).toContain(`<span id="page">${index + 1}/${expectedPages}</span>`)
      expect(page.includes(`<b id="total">${(count * 10).toFixed(2)}</b>`)).toBe(index === pages.length - 1)
    })
    if (count > 20) expect(pages[1]).toContain('<tr><td>21</td><td>ทดสอบสินค้า 21</td></tr>')
  })

  it('only the shop form with live fields prints; a picture-only form or another name does not', () => {
    expect(isQuotationFormTemplate(shopQuotation())).toBe(true)
    expect(isQuotationFormTemplate(shopQuotation({ templateSchema: '<img src="/form.png" />' }))).toBe(false)
    expect(isQuotationFormTemplate(shopQuotation({ name: 'ใบแจ้งหนี้' }))).toBe(false)
    expect(renderQuotationA4PagesHtml(quotation(1), business, shopQuotation({ name: 'ใบแจ้งหนี้' }))).toEqual([])
  })

  it('prints with the shop quotation form marked default, else the first usable one', () => {
    const a = shopQuotation({ id: 'tpl-a' })
    const b = shopQuotation({ id: 'tpl-b', isDefault: true })
    const blank = shopQuotation({ id: 'tpl-blank', isDefault: true, templateSchema: '<p>blank</p>' })
    expect(pickQuotationPrintTemplate([a, b])?.id).toBe('tpl-b')
    expect(pickQuotationPrintTemplate([blank, a])?.id).toBe('tpl-a')
    expect(pickQuotationPrintTemplate([blank])).toBeUndefined()
    expect(pickQuotationPrintTemplate([])).toBeUndefined()
  })
})
