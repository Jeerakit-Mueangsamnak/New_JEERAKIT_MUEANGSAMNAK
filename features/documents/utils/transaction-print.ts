import { renderDocumentTemplate } from '@/features/documents/utils/documentRenderer'
import { refreshSharedTemplates } from '@/features/documents/services/template-library-storage'
import { printDocuments } from '@/lib/print/print-service'
import type { DocumentTemplate } from '@/lib/types/document'
import type { Quotation } from '@/lib/types/rental-pos'
import type { BusinessSettings } from '@/features/settings/types/settings-page.types'

export const QUOTATION_ROWS_PER_PAGE = 16

/** A quotation must have a live item table and totals, not a static PDF or blank form. */
export function isQuotationPrintTemplate(template: DocumentTemplate): boolean {
  return template.category === 'ใบเสนอราคา'
    && template.paperSize === 'A4'
    && template.orientation === 'PORTRAIT'
    && /<tbody\b[^>]*>\s*\{\{\s*items\.rows_quotation_16\s*\}\}\s*<\/tbody>/i.test(template.templateSchema)
    && /\{\{\s*document\.number\s*\}\}/.test(template.templateSchema)
    && /\{\{\s*bill\.grand_total\s*\}\}/.test(template.templateSchema)
}

/** The shop's quotation form to print with: the one marked default, else the first usable one. */
export function pickQuotationPrintTemplate(templates: DocumentTemplate[]): DocumentTemplate | undefined {
  const valid = templates.filter(isQuotationPrintTemplate)
  return valid.find((template) => template.isDefault) ?? valid[0]
}

/** Reads the shop's forms and returns the quotation form to print with (undefined = none usable). */
export async function loadQuotationPrintTemplate(): Promise<DocumentTemplate | undefined> {
  return pickQuotationPrintTemplate(await refreshSharedTemplates())
}

const page = (html: string) => `<div class="p-8 text-slate-900 font-sans text-xs bg-white">${html}</div>`

export function thaiDocDate(isoDay?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay || '')
  return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : isoDay || ''
}

/** One A4 page per 16 items; header repeated and final totals/signatures only on the last page. */
export function renderQuotationA4PagesHtml(
  q: Quotation,
  business: Partial<BusinessSettings>,
  template: DocumentTemplate
): string[] {
  if (!isQuotationPrintTemplate(template)) return []
  const pageCount = Math.max(1, Math.ceil(q.items.length / QUOTATION_ROWS_PER_PAGE))
  // Multi-page custom templates must mark where final totals begin/end. Do not silently repeat totals.
  if (pageCount > 1 && !/<!--\s*QUOTATION_FINAL_START\s*-->[\s\S]*<!--\s*QUOTATION_FINAL_END\s*-->/.test(template.templateSchema)) return []

  const allItems = q.items.map((i) => ({
    name: i.productName,
    quantity: i.quantity,
    unit: i.unitName,
    price: i.unitPrice,
    rentalType: i.rentalType,
    billableDays: i.usageCountOrDays,
    // Renderer only displays stored financial values, with the pre-discount line base matching existing quotation UI.
    lineTotal: Math.round(i.unitPrice * i.quantity * (i.rentalType === 'SALE' ? 1 : Math.max(1, i.usageCountOrDays || 1)) * 100) / 100,
  }))

  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const isLastPage = pageIndex === pageCount - 1
    let schema = template.templateSchema
    if (!isLastPage) {
      schema = schema.replace(/<!--\s*QUOTATION_FINAL_START\s*-->[\s\S]*?<!--\s*QUOTATION_FINAL_END\s*-->/, '')
    }
    schema = schema.replace(/<!--\s*QUOTATION_PAGE_MARKER\s*-->/g,
      pageCount > 1 ? `<span style="color:#1e293b;font-weight:700;">· หน้า ${pageIndex + 1} / ${pageCount}</span>` : '')
    return renderDocumentTemplate(
      schema,
      { id: q.customerId, customerCode: '', customerName: q.customerName, phone: q.phone || '', address: q.customerAddress || '', taxId: q.customerTaxId || '' },
      q.quotationNo,
      thaiDocDate(q.quotationDate),
      q.remark || template.defaultTerms || '',
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
        items: allItems.slice(pageIndex * QUOTATION_ROWS_PER_PAGE, (pageIndex + 1) * QUOTATION_ROWS_PER_PAGE),
      },
      undefined,
      pageIndex * QUOTATION_ROWS_PER_PAGE
    )
  })
}

/** Render full printable HTML, including continuation pages (used for preview/tests). */
export function renderQuotationA4Html(q: Quotation, business: Partial<BusinessSettings>, template: DocumentTemplate): string {
  return renderQuotationA4PagesHtml(q, business, template).join('')
}

export function printQuotationA4(q: Quotation, business: Partial<BusinessSettings>, template: DocumentTemplate): boolean {
  const pages = renderQuotationA4PagesHtml(q, business, template)
  return pages.length > 0 ? printDocuments(pages.map(page), q.quotationNo) : false
}
