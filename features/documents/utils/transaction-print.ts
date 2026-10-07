import { INITIAL_TEMPLATES } from '@/features/documents/constants/initialDocumentTemplates'
import { renderDocumentTemplate } from '@/features/documents/utils/documentRenderer'
import { printDocuments } from '@/lib/print/print-service'
import type { Quotation, RentalBill } from '@/lib/types/rental-pos'
import type { BusinessSettings } from '@/features/settings/types/settings-page.types'

/**
 * A4 print of a bill / quotation straight from a list row (bills, customers, quotations).
 * Uses the built-in templates and the shop's business settings.
 */
function render(templateId: string, ...args: Parameters<typeof renderDocumentTemplate> extends [unknown, ...infer R] ? R : never): string {
  const tpl = INITIAL_TEMPLATES.find((t) => t.id === templateId)
  return tpl ? renderDocumentTemplate(tpl.templateSchema, ...args) : ''
}

const page = (html: string) => `<div class="p-8 text-slate-900 font-sans text-xs bg-white">${html}</div>`

interface PrintableBillItem {
  productName: string
  quantity: number
  unitName?: string
  unit?: string
  unitPrice?: number
  dailyRate?: number
  billableDays?: number
  lineTotal?: number
}

type PrintableBill = { items: PrintableBillItem[] } & Pick<RentalBill, 'billNo' | 'billDate' | 'customerName'> &
  Partial<Pick<RentalBill, 'subtotal' | 'discountAmount' | 'shippingFee' | 'taxAmount' | 'grandTotal' | 'paidAmount' | 'outstandingAmount' | 'customerId' | 'customerPhone' | 'customerAddress' | 'customerTaxId' | 'shippingAddress' | 'rentalStartDate' | 'rentalEndDate' | 'depositAmount'>>

/** Rendered A4 rental-bill body (same template the print uses); '' when the template is missing. */
export function renderBillA4Html(bill: PrintableBill, business: Partial<BusinessSettings>): string {
  return render(
    'tpl_rental_bill',
    { id: bill.customerId || '', customerCode: '', customerName: bill.customerName, phone: bill.customerPhone || '', address: bill.customerAddress || '', taxId: bill.customerTaxId || '' },
    bill.billNo,
    bill.billDate,
    '',
    business,
    {
      billNo: bill.billNo,
      billDate: bill.billDate,
      rentalStartDate: bill.rentalStartDate,
      rentalEndDate: bill.rentalEndDate,
      siteName: bill.shippingAddress,
      subtotal: bill.subtotal,
      discount: bill.discountAmount,
      shippingFee: bill.shippingFee,
      taxAmount: bill.taxAmount,
      depositAmount: bill.depositAmount,
      grandTotal: bill.grandTotal,
      paidAmount: bill.paidAmount,
      outstandingAmount: bill.outstandingAmount,
      items: bill.items.map((i) => ({
        name: i.productName,
        quantity: i.quantity,
        unit: i.unitName ?? i.unit,
        price: i.unitPrice ?? i.dailyRate,
        billableDays: i.billableDays,
        lineTotal: i.lineTotal,
      })),
    }
  )
}

export function printBillA4(bill: PrintableBill, business: Partial<BusinessSettings>): boolean {
  const html = renderBillA4Html(bill, business)
  return html ? printDocuments([page(html)], bill.billNo) : false
}

export function printQuotationA4(q: Quotation, business: Partial<BusinessSettings>): boolean {
  const html = render(
    'tpl_quotation',
    { id: q.customerId, customerCode: '', customerName: q.customerName, phone: '', address: q.customerAddress || '', taxId: q.customerTaxId || '' },
    q.quotationNo,
    q.quotationDate,
    q.remark || '',
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
      depositAmount: q.depositAmount,
      grandTotal: q.grandTotal,
      items: q.items.map((i) => ({
        name: i.productName,
        quantity: i.quantity,
        unit: i.unitName,
        price: i.unitPrice,
        billableDays: i.usageCountOrDays,
        lineTotal: i.lineTotal,
      })),
    }
  )
  return html ? printDocuments([page(html)], q.quotationNo) : false
}
