import { dailyRentalPeriodText, fitFormItemColumns, formatBahtCurrency, renderDocumentTemplate, removeThaiAmountTextParentheses, thaiBahtText } from '@/features/documents/utils/documentRenderer'
import { getTemplateTarget, refreshSharedTemplates } from '@/features/documents/services/template-library-storage'
import type { DocumentName } from '@/features/documents/api/template-library-repository'
import { printDocuments } from '@/lib/print/print-service'
import { THAI_MONTHS } from '@/components/common/CustomDatePicker'
import type { DocumentTemplate } from '@/lib/types/document'
import type { Quotation } from '@/lib/types/rental-pos'
import type { BusinessSettings } from '@/features/settings/types/settings-page.types'
import type { BillTemplateData } from '@/features/documents/utils/rental-bill-print'

/** The shop's own quotation form drawn like its bill forms: one field per item cell ({{items.1.name}}). */
export function isQuotationFormTemplate(template: DocumentTemplate): boolean {
  return template.name.trim() === 'ใบเสนอราคา'
    && template.paperSize === 'A4'
    && template.orientation === 'PORTRAIT'
    && /\{\{\s*document\.number\s*\}\}/.test(template.templateSchema)
    && /\{\{\s*items\.1\.name\s*\}\}/.test(template.templateSchema)
}

/** The quotation form to print with: the one marked default, else the first one. */
export function pickQuotationPrintTemplate(templates: DocumentTemplate[]): DocumentTemplate | undefined {
  const valid = templates.filter(isQuotationFormTemplate)
  return valid.find((template) => template.isDefault) ?? valid[0]
}

/** A quotation as the shop's bill-style form takes it (ยอดที่ต้องชำระ = total + deposit, owner 2026-11-07). */
function quotationFormData(q: Quotation): BillTemplateData {
  return {
    customerName: q.customerName,
    customerAddress: q.customerAddress,
    customerPhone: q.phone,
    customerTaxId: q.customerTaxId,
    billNo: q.quotationNo,
    billDate: q.quotationDate,
    headerRentalDate: q.rentalStartDate,
    headerReturnDate: q.rentalEndDate,
    siteName: q.siteName,
    items: q.items.map((i) => ({
      name: i.productName,
      quantity: i.quantity,
      unit: i.unitName || '',
      price: i.unitPrice,
      rentalType: i.rentalType,
      usageCount: i.usageCountOrDays,
      billableDays: i.usageCountOrDays,
      // Before discount, as the quotation table always showed it.
      lineTotal: Math.round(i.unitPrice * i.quantity * (i.rentalType === 'SALE' ? 1 : Math.max(1, i.usageCountOrDays || 1)) * 100) / 100,
    })),
    subtotal: q.subtotal,
    discount: q.discountAmount,
    shippingFee: q.shippingFee,
    taxAmount: q.taxAmount,
    vatRatePercent: q.vatEnabled ? q.vatRate ?? undefined : undefined,
    depositAmount: q.depositAmount,
    grandTotal: q.grandTotal,
    paidAmount: 0,
    outstandingAmount: q.grandTotal,
    remark: q.remark,
  }
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

/** "19 พฤศจิกายน 2569": dates on the shop's own forms are written in full (owner 2026-11-07). */
export function thaiLongDate(isoDay?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay || '')
  return m ? `${Number(m[3])} ${THAI_MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}` : isoDay || ''
}

/** A quotation on the shop's ใบเสนอราคา form (20 rows per page, totals on the last page). */
export function renderQuotationA4PagesHtml(
  q: Quotation,
  business: Partial<BusinessSettings>,
  template: DocumentTemplate
): string[] {
  return isQuotationFormTemplate(template) ? renderFormPages(quotationFormData(q), business, template) : []
}

/** Render full printable HTML, including continuation pages (used for preview/tests). */
export function renderQuotationA4Html(q: Quotation, business: Partial<BusinessSettings>, template: DocumentTemplate): string {
  return renderQuotationA4PagesHtml(q, business, template).join('')
}

export function printQuotationA4(q: Quotation, business: Partial<BusinessSettings>, template: DocumentTemplate): boolean {
  const pages = renderQuotationA4PagesHtml(q, business, template)
  return pages.length > 0 ? printDocuments(pages.map(page), q.quotationNo) : false
}

// ─── Bill printed on the shop's own form (POS cart › ประเภทเอกสาร, owner 2026-11-07) ───

export const BILL_FORM_ROWS_PER_PAGE = 20

/** A form of the แบบฟอร์มบิล tab that can take the bill's data (not a picture-only PDF, not the quotation). */
export function isBillFormTemplate(template: DocumentTemplate): boolean {
  return getTemplateTarget(template) === 'BILL'
    && template.name.trim() !== 'ใบเสนอราคา'
    && template.paperSize === 'A4'
    && template.orientation === 'PORTRAIT'
    && /\{\{\s*document\.number\s*\}\}/.test(template.templateSchema)
}

/** The แบบฟอร์มบิล form with this name (tab + name, owner 2026-11-07): the one marked default, else the newest. */
export function pickBillFormTemplate(templates: DocumentTemplate[], documentName: string): DocumentTemplate | undefined {
  const name = documentName.trim()
  if (!name) return undefined
  const valid = templates.filter((template) => isBillFormTemplate(template) && template.name.trim() === name)
  return valid.find((template) => template.isDefault) ?? valid[0]
}

/** Forms printed from จัดการบิล (owner 2026-11-07), not offered when a new bill is made in the POS cart. */
export const RETURN_FORM_NAME = 'ใบรับคืนบางส่วน'
export const CHECK_FORM_NAME = 'ใบเช็คของ'
/** Money taken in จัดการบิล with nothing coming back is printed on this form (owner 2026-11-07). */
export const RECEIPT_FORM_NAME = 'ใบเสร็จรับเงิน'
/**
 * The shop's main bill form: a bill printed again from จัดการบิล / ลูกค้า, a เช่าต่อ bill, and a POS bill with
 * no form picked are printed on it (the system's own A4 bill was removed, owner 2026-11-09).
 */
export const MAIN_BILL_FORM_NAME = 'ใบส่งของ/ใบเสร็จรับเงิน'
/** Lost / damaged goods of a return are charged on this form (owner 2026-11-09). */
export const FINE_FORM_NAME = 'ใบชำระค่าปรับ'

/** Names of the แบบฟอร์มบิล tab that the POS cart offers (have a form to print with), in the order they were added. */
export function billFormDocumentNames(names: DocumentName[], templates: DocumentTemplate[]): string[] {
  return names
    .filter((n) => n.targetGroup === 'BILL' && n.name !== RETURN_FORM_NAME && n.name !== CHECK_FORM_NAME && n.name !== FINE_FORM_NAME && pickBillFormTemplate(templates, n.name))
    .map((n) => n.name)
}

// Totals belong to the last page only; on earlier pages they print empty (with the brackets of the words line).
const BILL_TOTAL_FIELDS =
  /\(?\{\{\s*bill\.(?:subtotal|discount|shipping_fee|tax_amount|deposit_amount|grand_total|grand_total_text|total_payable|total_payable_text|paid_amount|outstanding_amount)\s*\}\}\)?/g

/** A bill on a form of the แบบฟอร์มบิล tab (see renderFormPages). */
export function renderBillFormPagesHtml(
  data: BillTemplateData,
  business: Partial<BusinessSettings>,
  template: DocumentTemplate
): string[] {
  return isBillFormTemplate(template) ? renderFormPages(data, business, template) : []
}

/** One A4 page per 20 items on the same form; the row numbers continue and the totals are on the last page. */
function renderFormPages(
  data: BillTemplateData,
  business: Partial<BusinessSettings>,
  template: DocumentTemplate
): string[] {
  const pageCount = Math.max(1, Math.ceil(data.items.length / BILL_FORM_ROWS_PER_PAGE))
  const items = data.items.map((i) => ({
    code: i.code,
    name: `${i.name}${dailyRentalPeriodText(i)}`,
    quantity: i.quantity,
    unit: i.unit,
    price: i.price,
    rentalType: i.rentalType,
    billableDays: i.rentalType === 'DAILY' ? i.billableDays : i.usageCount,
    lineTotal: i.lineTotal,
  }))
  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const schema = pageIndex === pageCount - 1 ? template.templateSchema : template.templateSchema.replace(BILL_TOTAL_FIELDS, '')
    return renderDocumentTemplate(
      schema,
      { customerName: data.customerName, phone: data.customerPhone || '', address: data.customerAddress || '', taxId: data.customerTaxId || '' },
      data.billNo,
      thaiLongDate(data.billDate),
      data.remark || template.defaultTerms || '',
      business,
      {
        billNo: data.billNo,
        rentalStartDate: thaiLongDate(data.headerRentalDate),
        rentalEndDate: thaiLongDate(data.headerReturnDate),
        siteName: data.siteName,
        subtotal: data.subtotal,
        discount: data.discount,
        shippingFee: data.shippingFee,
        taxAmount: data.taxAmount,
        vatRate: data.vatRatePercent ?? null,
        depositAmount: data.depositAmount,
        grandTotal: data.grandTotal,
        // Same as ยอดคงต้องชำระ on the payment page: the bill total plus the deposit.
        totalPayable: Math.round((data.grandTotal + (data.depositAmount || 0)) * 100) / 100,
        paidAmount: data.paidAmount,
        outstandingAmount: data.outstandingAmount,
        pageLabel: `${pageIndex + 1}/${pageCount}`,
        items: items.slice(pageIndex * BILL_FORM_ROWS_PER_PAGE, (pageIndex + 1) * BILL_FORM_ROWS_PER_PAGE),
      },
      undefined,
      pageIndex * BILL_FORM_ROWS_PER_PAGE
    )
  })
}

export function printBillForm(data: BillTemplateData, business: Partial<BusinessSettings>, template: DocumentTemplate): boolean {
  const pages = renderBillFormPagesHtml(data, business, template)
  return pages.length > 0 ? printDocuments(pages.map(page), data.billNo) : false
}

// ── ใบรับคืนบางส่วน (owner 2026-11-07): ONE document for the return, even when rent is paid at the same time ──

export interface ReturnFormItem {
  name: string
  returnedQty: number
  normalQty: number
  damagedQty: number
  lostQty: number
  damageFee: number
}

export interface ReturnFormData {
  slipNo: string
  returnDate: string
  scheduledReturnDate?: string
  rentalStartDate?: string
  siteName?: string
  customerName: string
  customerPhone?: string
  customerAddress?: string
  customerTaxId?: string
  items: ReturnFormItem[]
  /** This bill's rent after the return (early-return credit taken off). */
  rentFee: number
  damageFee: number
  /** Paid on this bill before today. */
  paidBefore: number
  /** Paid from the held deposit today. */
  depositApplied: number
  /** Taken today for this bill. */
  collected: number
}

const RETURN_TOTAL_FIELDS = /\(?\{\{\s*return\.(?:rent|damage|paid_before|deposit_applied|total_payable|total_payable_text|collected)\s*\}\}\)?/g
const RETURN_ITEM_FIELD = /\{\{\s*items\.(\d+)\.(returned|normal|damaged|lost|damage_fee)\s*\}\}/g

/** Prints a return on the shop's ใบรับคืนบางส่วน form; false when the form gives no page. */
export function printReturnForm(data: ReturnFormData, business: Partial<BusinessSettings>, template: DocumentTemplate): boolean {
  const pages = renderReturnFormPagesHtml(data, business, template)
  return pages.length > 0 ? printDocuments(pages.map(page), data.slipNo) : false
}

/** What is still to pay on the bill today, before today's payment: rent + damage − paid before − deposit used. */
export function returnFormTotalPayable(data: Pick<ReturnFormData, 'rentFee' | 'damageFee' | 'paidBefore' | 'depositApplied'>): number {
  return Math.max(0, Math.round((data.rentFee + data.damageFee - data.paidBefore - data.depositApplied) * 100) / 100)
}

/**
 * The return on the shop's ใบรับคืนบางส่วน form: ลำดับ | รายการ | คืนครั้งนี้ | ปกติ | ชำรุด | หาย | ค่าเสียหาย,
 * and ค่าเช่า / ค่าเสียหาย / ชำระแล้ว / หักมัดจำ / ยอดที่ต้องชำระ / รับชำระครั้งนี้. 20 rows per page, totals on the last page.
 */
export function renderReturnFormPagesHtml(
  data: ReturnFormData,
  business: Partial<BusinessSettings>,
  template: DocumentTemplate
): string[] {
  if (!isBillFormTemplate(template)) return []
  const pageCount = Math.max(1, Math.ceil(data.items.length / BILL_FORM_ROWS_PER_PAGE))
  const totalPayable = returnFormTotalPayable(data)
  const totals: Record<string, string> = {
    rent: formatBahtCurrency(data.rentFee),
    damage: formatBahtCurrency(data.damageFee),
    paid_before: formatBahtCurrency(data.paidBefore),
    deposit_applied: formatBahtCurrency(data.depositApplied),
    total_payable: formatBahtCurrency(totalPayable),
    total_payable_text: thaiBahtText(totalPayable),
    collected: formatBahtCurrency(data.collected),
  }
  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const offset = pageIndex * BILL_FORM_ROWS_PER_PAGE
    const pageItems = data.items.slice(offset, offset + BILL_FORM_ROWS_PER_PAGE)
    const isLast = pageIndex === pageCount - 1
    const schema = removeThaiAmountTextParentheses(template.templateSchema)
      .replace(RETURN_TOTAL_FIELDS, (match) => {
        if (!isLast) return ''
        const field = /return\.([a-z_]+)/.exec(match)?.[1] || ''
        return match.replace(/\{\{[^}]*\}\}/, totals[field] ?? '')
      })
      .replace(RETURN_ITEM_FIELD, (_match, row: string, field: string) => {
        const item = pageItems[Number(row) - 1]
        if (!item) return ''
        if (field === 'returned') return String(item.returnedQty)
        if (field === 'normal') return String(item.normalQty)
        if (field === 'damaged') return String(item.damagedQty)
        if (field === 'lost') return String(item.lostQty)
        return formatBahtCurrency(item.damageFee)
      })
    return renderDocumentTemplate(
      schema,
      { customerName: data.customerName, phone: data.customerPhone || '', address: data.customerAddress || '', taxId: data.customerTaxId || '' },
      data.slipNo,
      thaiLongDate(data.returnDate),
      template.defaultTerms || '',
      business,
      {
        billNo: data.slipNo,
        rentalStartDate: thaiLongDate(data.rentalStartDate),
        rentalEndDate: thaiLongDate(data.scheduledReturnDate),
        siteName: data.siteName,
        pageLabel: `${pageIndex + 1}/${pageCount}`,
        items: pageItems.map((item) => ({ name: item.name, quantity: item.returnedQty })),
      },
      undefined,
      offset
    )
  })
}

// ── ใบชำระค่าปรับ (owner 2026-11-09): the lost / damaged goods of a return and what they are charged ──

/** One returned line with its counts and the fee per piece of each kind (the return table's figures). */
export interface FineFormLine {
  name: string
  deliveredQty: number
  normalQty: number
  damagedQty: number
  lostQty: number
  repairFeePerUnit: number
  replacementFeePerUnit: number
}

export interface FineFormRow {
  name: string
  deliveredQty?: number
  normalQty?: number
  lostQty?: number
  damagedQty?: number
  fineRate: number
  fine: number
}

export interface FineFormData {
  slipNo: string
  returnDate: string
  scheduledReturnDate?: string
  rentalStartDate?: string
  siteName?: string
  customerName: string
  customerPhone?: string
  customerAddress?: string
  customerTaxId?: string
  lines: FineFormLine[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The fine rows of a return: one row per charged kind, so each row has one rate. A line with both
 * damaged and lost pieces gets two rows (ชำรุด first); its delivered / normal counts are on the first.
 */
export function fineFormRows(lines: FineFormLine[]): FineFormRow[] {
  return lines.flatMap((line) => {
    const rows: FineFormRow[] = []
    if (line.damagedQty > 0) {
      rows.push({ name: line.name, damagedQty: line.damagedQty, fineRate: line.repairFeePerUnit, fine: round2(line.damagedQty * line.repairFeePerUnit) })
    }
    if (line.lostQty > 0) {
      rows.push({ name: line.name, lostQty: line.lostQty, fineRate: line.replacementFeePerUnit, fine: round2(line.lostQty * line.replacementFeePerUnit) })
    }
    if (rows[0]) Object.assign(rows[0], { deliveredQty: line.deliveredQty, normalQty: line.normalQty })
    return rows
  })
}

/** ค่าปรับชำรุด / ค่าปรับสูญหาย / รวมค่าปรับ of a return. */
export function fineFormTotals(lines: FineFormLine[]): { damage: number; lost: number; total: number } {
  const damage = round2(lines.reduce((sum, l) => sum + l.damagedQty * l.repairFeePerUnit, 0))
  const lost = round2(lines.reduce((sum, l) => sum + l.lostQty * l.replacementFeePerUnit, 0))
  return { damage, lost, total: round2(damage + lost) }
}

const FINE_TOTAL_FIELDS = /\(?\{\{\s*fine\.(?:damage|lost|total|total_text)\s*\}\}\)?/g
const FINE_ITEM_FIELD = /\{\{\s*items\.(\d+)\.(delivered|normal|lost|damaged|fine_rate|fine)\s*\}\}/g

/**
 * A return's fines on the shop's ใบชำระค่าปรับ form: ลำดับ | รายการ | ส่งมอบ | คืนปกติ | หาย | ชำรุด |
 * ค่าปรับ/หน่วย | จำนวนเงิน, and ค่าปรับชำรุด / ค่าปรับสูญหาย / รวมค่าปรับ. 20 rows per page, totals on the last page.
 * No page when nothing is charged.
 */
export function renderFineFormPagesHtml(
  data: FineFormData,
  business: Partial<BusinessSettings>,
  template: DocumentTemplate
): string[] {
  if (!isBillFormTemplate(template)) return []
  const rows = fineFormRows(data.lines)
  if (rows.length === 0) return []
  const sums = fineFormTotals(data.lines)
  const totals: Record<string, string> = {
    damage: formatBahtCurrency(sums.damage),
    lost: formatBahtCurrency(sums.lost),
    total: formatBahtCurrency(sums.total),
    total_text: thaiBahtText(sums.total),
  }
  const count = (n?: number) => (n ? String(n) : '')
  const pageCount = Math.max(1, Math.ceil(rows.length / BILL_FORM_ROWS_PER_PAGE))
  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const offset = pageIndex * BILL_FORM_ROWS_PER_PAGE
    const pageRows = rows.slice(offset, offset + BILL_FORM_ROWS_PER_PAGE)
    const isLast = pageIndex === pageCount - 1
    // Columns are fitted while the item fields are still there (จำนวนเงิน is found by its field)
    const schema = fitFormItemColumns(removeThaiAmountTextParentheses(template.templateSchema))
      .replace(FINE_TOTAL_FIELDS, (match) => {
        if (!isLast) return ''
        const field = /fine\.([a-z_]+)/.exec(match)?.[1] || ''
        return match.replace(/\{\{[^}]*\}\}/, totals[field] ?? '')
      })
      .replace(FINE_ITEM_FIELD, (_match, row: string, field: string) => {
        const item = pageRows[Number(row) - 1]
        if (!item) return ''
        if (field === 'delivered') return count(item.deliveredQty)
        if (field === 'normal') return count(item.normalQty)
        if (field === 'lost') return count(item.lostQty)
        if (field === 'damaged') return count(item.damagedQty)
        if (field === 'fine_rate') return formatBahtCurrency(item.fineRate)
        return formatBahtCurrency(item.fine)
      })
    return renderDocumentTemplate(
      schema,
      { customerName: data.customerName, phone: data.customerPhone || '', address: data.customerAddress || '', taxId: data.customerTaxId || '' },
      data.slipNo,
      thaiLongDate(data.returnDate),
      template.defaultTerms || '',
      business,
      {
        billNo: data.slipNo,
        rentalStartDate: thaiLongDate(data.rentalStartDate),
        rentalEndDate: thaiLongDate(data.scheduledReturnDate),
        siteName: data.siteName,
        pageLabel: `${pageIndex + 1}/${pageCount}`,
        items: pageRows.map((item) => ({ name: item.name, quantity: 0 })),
      },
      undefined,
      offset
    )
  })
}
