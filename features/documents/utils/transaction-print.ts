import { INITIAL_TEMPLATES } from '@/features/documents/constants/initialDocumentTemplates'
import { renderDocumentTemplate } from '@/features/documents/utils/documentRenderer'
import { printDocuments } from '@/lib/print/print-service'
import type { Quotation } from '@/lib/types/rental-pos'
import type { BusinessSettings } from '@/features/settings/types/settings-page.types'

/**
 * A4 print of a quotation straight from a list row (customers, quotations).
 * Uses the built-in template and the shop's business settings. Bills print through
 * `rental-bill-print` (the same RentalBillTemplate checkout uses).
 */
function render(templateId: string, ...args: Parameters<typeof renderDocumentTemplate> extends [unknown, ...infer R] ? R : never): string {
  const tpl = INITIAL_TEMPLATES.find((t) => t.id === templateId)
  return tpl ? renderDocumentTemplate(tpl.templateSchema, ...args) : ''
}

const page = (html: string) => `<div class="p-8 text-slate-900 font-sans text-xs bg-white">${html}</div>`

export function thaiDocDate(isoDay?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay || '')
  return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : isoDay || ''
}

/** Rendered A4 quotation (the shop's quotation form); '' when the template is missing. */
export function renderQuotationA4Html(q: Quotation, business: Partial<BusinessSettings>): string {
  const tpl = INITIAL_TEMPLATES.find((t) => t.id === 'tpl_quotation')
  return render(
    'tpl_quotation',
    { id: q.customerId, customerCode: '', customerName: q.customerName, phone: q.phone || '', address: q.customerAddress || '', taxId: q.customerTaxId || '' },
    q.quotationNo,
    thaiDocDate(q.quotationDate),
    q.remark || tpl?.defaultTerms || '',
    business,
    {
      billNo: q.quotationNo,
      rentalStartDate: q.rentalStartDate,
      rentalEndDate: q.rentalEndDate,
      siteName: q.siteName,
      subtotal: q.subtotal,
      discount: q.discountAmount,
      shippingFee: q.shippingFee,
      taxAmount: q.taxAmount,
      vatRate: q.vatEnabled ? q.vatRate ?? null : null,
      depositAmount: q.depositAmount,
      grandTotal: q.grandTotal,
      // Rows show the amount before discount; the discount is one line in the summary box.
      items: q.items.map((i) => ({
        name: i.productName,
        quantity: i.quantity,
        unit: i.unitName,
        price: i.unitPrice,
        rentalType: i.rentalType,
        billableDays: i.usageCountOrDays,
        lineTotal: Math.round(i.unitPrice * i.quantity * (i.rentalType === 'SALE' ? 1 : Math.max(1, i.usageCountOrDays || 1)) * 100) / 100,
      })),
    }
  )
}

export function printQuotationA4(q: Quotation, business: Partial<BusinessSettings>): boolean {
  const html = renderQuotationA4Html(q, business)
  return html ? printDocuments([page(html)], q.quotationNo) : false
}
