import { CustomerSnapshot, CustomerDocumentItem } from '@/lib/types/document'
import { BusinessSettings } from '@/lib/types/rental-pos'
import { escapeDocumentHtml, sanitizeDocumentHtml } from '@/features/documents/utils/document-html'

export interface BillRenderSnapshot {
  billNo?: string
  billDate?: string
  rentalStartDate?: string
  rentalEndDate?: string
  siteName?: string
  subtotal?: number
  discount?: number
  shippingFee?: number
  taxAmount?: number
  depositAmount?: number
  grandTotal?: number
  /** ยอดที่ต้องชำระ: the bill total plus the deposit taken with it (as on the payment page). */
  totalPayable?: number
  /** Page of a multi-page print, e.g. "1/2" ({{document.page}}); one page = "1/1". */
  pageLabel?: string
  /** VAT rate (%) of the document; null / undefined = no VAT. */
  vatRate?: number | null
  paidAmount?: number
  outstandingAmount?: number
  refundAmount?: number
  damageFee?: number
  paymentMethod?: string
  items?: Array<{
    code?: string
    name: string
    quantity: number
    unit?: string
    price?: number
    rentalType?: string
    billableDays?: number
    lineTotal?: number
    /** A rental the shop does not charge for: ราคา / การเช่า / จำนวนเงิน print "-" (owner 2026-11-09). */
    isNoCharge?: boolean
  }>
}

const THAI_DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const THAI_PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']

function thaiIntegerText(n: number): string {
  if (n === 0) return ''
  if (n >= 1_000_000) {
    const millions = Math.floor(n / 1_000_000)
    return `${thaiIntegerText(millions)}ล้าน${thaiIntegerText(n % 1_000_000)}`
  }
  const digits = String(n).split('').map(Number)
  return digits
    .map((d, i) => {
      const place = digits.length - 1 - i
      if (d === 0) return ''
      if (place === 0 && d === 1 && digits.length > 1) return 'เอ็ด'
      if (place === 1 && d === 1) return 'สิบ'
      if (place === 1 && d === 2) return 'ยี่สิบ'
      return THAI_DIGITS[d] + THAI_PLACES[place]
    })
    .join('')
}

/** Amount in Thai words for documents, e.g. 1,250.50 → "หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์". */
export function thaiBahtText(amount?: number | null): string {
  const satang = Math.round(Math.abs(Number(amount) || 0) * 100)
  const baht = Math.floor(satang / 100)
  const rest = satang % 100
  const bahtText = baht === 0 ? 'ศูนย์' : thaiIntegerText(baht)
  return rest === 0 ? `${bahtText}บาทถ้วน` : `${bahtText}บาท${thaiIntegerText(rest)}สตางค์`
}

export const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]

/** "9 พ.ย. 2569": day, short Thai month, Buddhist year. */
export function thaiShortFullYearDate(value?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '')
  if (m) return `${Number(m[3])} ${THAI_MONTHS_SHORT[Number(m[2]) - 1]} ${Number(m[1]) + 543}`
  const date = value ? new Date(value) : null
  if (!date || isNaN(date.getTime())) return ''
  return `${date.getDate()} ${THAI_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear() + 543}`
}

/**
 * Dates printed after a per-day line's name (owner 2026-11-09):
 * "(เริ่มเช่า 9 พ.ย. 2569 กำหนดคืน 15 พ.ย. 2569)"; empty for any other line.
 */
export function dailyRentalPeriodText(item: { rentalType?: string; dailyStartDate?: string; dailyEndDate?: string }): string {
  if (item.rentalType !== 'DAILY') return ''
  const start = thaiShortFullYearDate(item.dailyStartDate)
  const end = thaiShortFullYearDate(item.dailyEndDate)
  if (!start && !end) return ''
  return `(${[start && `เริ่มเช่า ${start}`, end && `กำหนดคืน ${end}`].filter(Boolean).join(' ')})`
}

/** "3 รอบ" / "2 วัน" / "ขาย" for the rental column of an item row. */
export function rentalTermLabel(rentalType?: string, periods?: number): string {
  if (rentalType === 'SALE') return 'ขาย'
  const n = Math.max(1, Number(periods) || 1)
  return rentalType === 'DAILY' ? `${n} วัน` : `${n} รอบ`
}

/** A rental line the shop does not charge for: its price, rental and amount cells print "-" (owner 2026-11-09). */
const isNoChargeLine = (item: { price?: number | null; rentalType?: string; isNoCharge?: boolean }) =>
  item.isNoCharge === true || (item.rentalType !== 'SALE' && Number(item.price ?? 0) === 0)

/** Columns of a shop form's item table that are centred and as wide as their header text (owner 2026-11-09). */
const FITTED_ITEM_FIELDS = new Set(['quantity', 'unit', 'rental'])
/** Room left beside the header text, on top of the cell's own padding. */
const FITTED_COLUMN_SPARE_PX = 8

const styleWidth = (style: string) => Number(/(?:^|[;\s"])width:\s*([\d.]+)px/.exec(style)?.[1] ?? NaN)
const stylePx = (style: string, prop: string) => Number(new RegExp(`${prop}:\\s*([\\d.]+)px`).exec(style)?.[1] ?? 0)
const setStyleWidth = (style: string, width: number) =>
  style.replace(/((?:^|[;\s"])width:\s*)[\d.]+px/, `$1${Math.round(width * 100) / 100}px`)

/**
 * A shop form drawn with one field per item cell ({{items.1.quantity}}): the จำนวน / หน่วย / การเช่า
 * columns are made as wide as their header text and their cells centred; the width they give up goes
 * to the รายการ column, so the table keeps its size and every row moves together. The stored form is
 * not changed. A table this cannot read cell by cell (merged cells, several header rows) is left as drawn.
 */
export function fitFormItemColumns(html: string): string {
  const firstField = html.search(/\{\{\s*items\.1\.(?:name|quantity|unit|rental)\s*\}\}/)
  if (firstField < 0) return html
  const tableStart = html.lastIndexOf('<table', firstField)
  const tableEnd = html.indexOf('</table>', firstField)
  if (tableStart < 0 || tableEnd < 0) return html
  const table = html.slice(tableStart, tableEnd)
  if (/\b(?:colspan|rowspan)\s*=/i.test(table)) return html

  const ROW = /<tr\b[^>]*>[\s\S]*?<\/tr>/g
  const CELL = /<(t[hd])\b([^>]*)>([\s\S]*?)<\/\1>/g
  const rows = table.match(ROW) ?? []
  const cellsOf = (row: string) => [...row.matchAll(CELL)]
  const headerRows = rows.filter((row) => /<th\b/.test(row))
  const fieldRow = rows.find((row) => /\{\{\s*items\.1\./.test(row))
  if (headerRows.length !== 1 || !fieldRow) return html
  const header = cellsOf(headerRows[0])
  const columnCount = header.length
  if (rows.some((row) => cellsOf(row).length !== columnCount)) return html

  const fields = cellsOf(fieldRow).map((cell) => /\{\{\s*items\.1\.(\w+)\s*\}\}/.exec(cell[3])?.[1] ?? '')
  const nameColumn = fields.indexOf('name')
  if (nameColumn < 0) return html

  const newWidths = new Map<number, number>()
  let freed = 0
  fields.forEach((field, index) => {
    if (!FITTED_ITEM_FIELDS.has(field)) return
    const [, , attrs, content] = header[index]
    const style = /style="([^"]*)"/.exec(attrs)?.[1] ?? ''
    const oldWidth = styleWidth(style)
    const textWidth = styleWidth(/style="([^"]*)"/.exec(content)?.[1] ?? '')
    if (!Number.isFinite(oldWidth) || !Number.isFinite(textWidth)) return
    const width = textWidth + stylePx(style, 'padding-left') + stylePx(style, 'padding-right') + FITTED_COLUMN_SPARE_PX
    newWidths.set(index, width)
    freed += oldWidth - width
  })
  if (newWidths.size === 0) return html
  const nameWidth = styleWidth(/style="([^"]*)"/.exec(header[nameColumn][2])?.[1] ?? '')
  if (!Number.isFinite(nameWidth) || nameWidth + freed < 40) return html
  newWidths.set(nameColumn, nameWidth + freed)

  const fitted = table.replace(ROW, (row) => {
    let index = -1
    return row.replace(CELL, (cell, tag: string, attrs: string, content: string) => {
      index += 1
      const width = newWidths.get(index)
      if (width === undefined) return cell
      let delta = 0
      const cellAttrs = attrs.replace(/style="([^"]*)"/, (_m, style: string) => {
        delta = width - styleWidth(style)
        let next = setStyleWidth(style, width)
        if (tag === 'td' && index !== nameColumn) {
          next = /text-align:\s*\w+/.test(next) ? next.replace(/text-align:\s*\w+/, 'text-align:center') : `text-align:center; ${next}`
        }
        return `style="${next}"`
      })
      // A body cell's inner box is drawn as wide as the cell: it moves with it.
      const cellContent = tag === 'td' && delta !== 0
        ? content.replace(/(<span\b[^>]*style=")([^"]*display:\s*block[^"]*)"/, (_m, open: string, style: string) => {
            const inner = styleWidth(style)
            return Number.isFinite(inner) ? `${open}${setStyleWidth(style, Math.max(0, inner + delta))}"` : _m
          })
        : content
      return `<${tag}${cellAttrs}>${cellContent}</${tag}>`
    })
  })
  return html.slice(0, tableStart) + fitted + html.slice(tableEnd)
}

const DOCUMENT_FIELD_STYLE = {
  terms: 'display:block;max-width:100%;box-sizing:border-box;white-space:pre-line;overflow-wrap:anywhere;word-break:break-word;line-height:1.45;vertical-align:top',
  singleLine: 'display:inline-block;max-width:100%;box-sizing:border-box;white-space:nowrap;overflow-wrap:normal;word-break:keep-all;font-size:0.9em;vertical-align:bottom',
  signer: 'display:inline-block;max-width:100%;box-sizing:border-box;white-space:normal;overflow-wrap:anywhere;word-break:break-word;line-height:1.3;vertical-align:bottom',
} as const

/** Bill templates may put the Thai amount in parentheses; print the amount text without them. */
export function removeThaiAmountTextParentheses(template: string): string {
  return template.replace(
    /\(\s*(\{\{\s*(?:bill|return|fine)\.(?:grand_total_text|total_payable_text|total_text)\s*\}\})\s*\)/g,
    '$1'
  )
}

function enlargeBusinessLogo(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (image) => {
    if (!/\bsrc\s*=\s*(["'])\{\{\s*business\.logo_url\s*\}\}\1/i.test(image)) return image
    const style = /style\s*=\s*(["'])(.*?)\1/i
    if (style.test(image)) {
      return image.replace(style, (_match, quote: string, value: string) =>
        `style=${quote}${value};width:100% !important;height:auto !important;max-height:150px !important;object-fit:contain;display:block${quote}`
      )
    }
    return image.replace(/>$/, ' style="width:100%;height:auto;max-height:150px;object-fit:contain;display:block">')
  })
}

/** The nearest value of a CSS property written before `index` (the box the field sits in). */
function cssValueBefore(html: string, index: number, prop: string): string | null {
  const at = html.lastIndexOf(`${prop}:`, index)
  if (at < 0) return null
  const m = /^[^:]*:\s*([^;"]+)/.exec(html.slice(at, at + 200))
  return m ? m[1].trim() : null
}

let measureContext: OffscreenCanvasRenderingContext2D | null | undefined
const THAI_MARKS = /[ัิ-ฺ็-๎]/g

/** Width of a text on paper; without a canvas (tests) a fair estimate from the letters. */
function textWidthPx(text: string, font: string, fontSizePx: number): number {
  if (measureContext === undefined) {
    measureContext = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null
  }
  if (measureContext) {
    measureContext.font = font
    return measureContext.measureText(text).width
  }
  return text.replace(THAI_MARKS, '').length * fontSizePx * 0.6
}

/** The part of `text` that fits in `maxWidth` (broken between words), and the rest. */
function splitTextToWidth(text: string, maxWidth: number, measure: (t: string) => number): [string, string] {
  if (measure(text) <= maxWidth) return [text, '']
  const words = text.split(/(\s+)/)
  let line = ''
  let i = 0
  for (; i < words.length; i++) {
    if (measure((line + words[i]).trimEnd()) > maxWidth) break
    line += words[i]
  }
  if (line.trim()) return [line.trimEnd(), words.slice(i).join('').trimStart()]
  // The first word alone is too long: break it between Thai words / letters
  const parts = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(text), (s) => s.segment)
    : Array.from(text)
  line = ''
  let j = 0
  for (; j < parts.length; j++) {
    if (line && measure(line + parts[j]) > maxWidth) break
    line += parts[j]
  }
  return [line.trimEnd(), parts.slice(j).join('').trimStart()]
}

// ที่อยู่: {{customer.address}} followed by the form's empty dotted line under it.
const ADDRESS_WITH_NEXT_LINE =
  /(<span\b[^>]*style="([^"]*)"[^>]*>)\{\{\s*customer\.address\s*\}\}(<\/span>\s*<\/div>\s*<div\b[^>]*>\s*<span\b[^>]*>\s*<\/span>\s*<span\b[^>]*>)\s*(<\/span>)/

/**
 * A long customer address carries on to the empty dotted line below it instead of being cut to
 * "...." (owner 2026-11-11, every form). Forms without that line keep their own layout.
 */
function flowCustomerAddress(html: string, address: string): string {
  return html.replace(ADDRESS_WITH_NEXT_LINE, (match, open: string, style: string, middle: string, close: string, offset: number) => {
    const text = address.replace(/\s+/g, ' ').trim()
    const width = styleWidth(style) - stylePx(style, 'padding-left') - stylePx(style, 'padding-right')
    if (!text || !(width > 0)) return match
    const fontSize = Number.parseFloat(cssValueBefore(html, offset, 'font-size') || '') || 12.5
    const family = cssValueBefore(html, offset, 'font-family') || 'Tahoma, sans-serif'
    const weight = /(?:^|;)\s*font-weight:\s*(\d+)/.exec(style)?.[1] || '400'
    const font = `${weight} ${fontSize}px ${family}`
    // A little room so a slightly wider printer font still fits
    const [first, rest] = splitTextToWidth(text, width * 0.95, (t) => textWidthPx(t, font, fontSize))
    return `${open}${escapeDocumentHtml(first)}${middle}${escapeDocumentHtml(rest)}${close}`
  })
}

/**
 * The date under a signature is a floating box sized for a short date; a long Thai date ran off to the
 * right. Its text is centred on the box, i.e. in the middle of the signature column (owner 2026-11-11).
 */
function centreFloatingDocumentDate(html: string): string {
  return html.replace(
    /<(div|span)\b([^>]*?)style="([^"]*)"([^>]*)>([^<]*\{\{\s*document\.date\s*\}\}[^<]*)<\/\1>/g,
    (match, tag: string, before: string, style: string, after: string, text: string) =>
      /position:\s*absolute/.test(style)
        ? `<${tag}${before}style="${style};display:flex;justify-content:center;text-align:center"${after}>${text}</${tag}>`
        : match
  )
}

export function formatBahtCurrency(val?: number | null): string {
  if (val === undefined || val === null || isNaN(val)) return '0.00'
  return val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function renderDocumentTemplate(
  templateSchema: string,
  customerSnapshot?: Partial<CustomerSnapshot> | null,
  docNo: string = 'DOC-PREVIEW-001',
  createdDate: string = new Date().toISOString().split('T')[0],
  customTerms: string = '',
  businessSettings?: Partial<BusinessSettings> | null,
  billSnapshot?: Partial<BillRenderSnapshot> | null,
  rawItems?: CustomerDocumentItem[],
  /** Items already printed on earlier pages: row numbers continue across pages. */
  rowOffset = 0
): string {
  if (!templateSchema) return ''

  const cust = customerSnapshot || {}
  const biz = businessSettings || {}
  const bill = billSnapshot || {}

  let html = enlargeBusinessLogo(removeThaiAmountTextParentheses(templateSchema))

  const replace = (pattern: RegExp, value: unknown) => {
    html = html.replace(pattern, escapeDocumentHtml(value))
  }
  const replaceStyled = (pattern: RegExp, value: unknown, style: string) => {
    html = html.replace(pattern, () => `<span style="${style}">${escapeDocumentHtml(value)}</span>`)
  }

  // Business settings values - use empty strings when not provided
  const fallbackBizName = biz.businessName || ''
  const fallbackBizAddress = biz.address || ''
  const fallbackBizTaxId = biz.taxId || ''
  const fallbackBizPhone = biz.phone || ''
  const fallbackBizEmail = biz.email || ''
  const fallbackBizLine = biz.lineId || ''
  const fallbackBizSigner = biz.authorizedPerson || ''
  const fallbackBankName = biz.bankName || ''
  const fallbackAccountName = biz.bankAccountName || biz.accountName || ''
  const fallbackAccountNumber = biz.bankAccountNumber || ''
  const fallbackPromptPay = biz.promptPayValue || biz.promptPayId || ''

  // Mapping Business fields (Authoritative Business Settings)
  replace(/\{\{\s*business\.name\s*\}\}/g, fallbackBizName)
  replace(/\{\{\s*business\.address\s*\}\}/g, fallbackBizAddress)
  replace(/\{\{\s*business\.tax_id\s*\}\}/g, fallbackBizTaxId)
  replace(/\{\{\s*business\.phone\s*\}\}/g, fallbackBizPhone)
  replace(/\{\{\s*business\.email\s*\}\}/g, fallbackBizEmail)
  replace(/\{\{\s*business\.line_id\s*\}\}/g, fallbackBizLine)
  replace(/\{\{\s*business\.description\s*\}\}/g, '')
  replaceStyled(/\{\{\s*business\.authorized_person\s*\}\}/g, fallbackBizSigner, DOCUMENT_FIELD_STYLE.signer)
  replaceStyled(/\{\{\s*business\.bank_name\s*\}\}/g, fallbackBankName, DOCUMENT_FIELD_STYLE.singleLine)
  replaceStyled(/\{\{\s*business\.bank_account_name\s*\}\}/g, fallbackAccountName, DOCUMENT_FIELD_STYLE.singleLine)
  replaceStyled(/\{\{\s*business\.bank_account_number\s*\}\}/g, fallbackAccountNumber, DOCUMENT_FIELD_STYLE.singleLine)
  replaceStyled(/\{\{\s*business\.promptpay\s*\}\}/g, fallbackPromptPay, DOCUMENT_FIELD_STYLE.singleLine)
  replace(/\{\{\s*business\.logo_url\s*\}\}/g, biz.logoDataUrl || biz.logoUrl || '/logo.png')
  replace(/\{\{\s*business\.qr_url\s*\}\}/g, biz.bankQrDataUrl || '')

  // Fitting fixes made while printing (the shop's form itself is not changed)
  html = centreFloatingDocumentDate(flowCustomerAddress(html, cust.address || ''))

  // Mapping customer fields
  replace(/\{\{\s*customer\.code\s*\}\}/g, cust.customerCode || '')
  replace(/\{\{\s*customer\.name\s*\}\}/g, cust.customerName || '')
  replace(/\{\{\s*customer\.company_name\s*\}\}/g, cust.companyName || cust.customerName || '')
  replace(/\{\{\s*customer\.phone\s*\}\}/g, cust.phone || '')
  replace(/\{\{\s*customer\.email\s*\}\}/g, cust.email || '')
  replace(/\{\{\s*customer\.address\s*\}\}/g, cust.address || '')
  replace(/\{\{\s*customer\.tax_id\s*\}\}/g, cust.taxId || '')
  replace(/\{\{\s*customer\.id_card\s*\}\}/g, cust.idCardNumber || '')
  replace(/\{\{\s*customer\.id_card_expire\s*\}\}/g, cust.idCardExpiry || '')

  // Mapping document fields
  replace(/\{\{\s*document\.number\s*\}\}/g, docNo)
  replace(/\{\{\s*document\.date\s*\}\}/g, createdDate)
  replace(/\{\{\s*document\.valid_until\s*\}\}/g, bill.rentalEndDate || '15 วันนับจากวันที่ออกเอกสาร')
  replace(/\{\{\s*document\.rental_start_date\s*\}\}/g, bill.rentalStartDate || createdDate)
  replace(/\{\{\s*document\.rental_end_date\s*\}\}/g, bill.rentalEndDate || createdDate)
  // สถานที่จัดส่ง = only the place given for this document, never the customer's address (owner 2026-11-07).
  replace(/\{\{\s*document\.site_name\s*\}\}/g, bill.siteName?.trim() || '')
  replaceStyled(/\{\{\s*document\.custom_terms\s*\}\}/g, customTerms || '', DOCUMENT_FIELD_STYLE.terms)

  // Mapping financial / bill fields
  replace(/\{\{\s*bill\.no\s*\}\}/g, bill.billNo || docNo)
  replace(/\{\{\s*bill\.subtotal\s*\}\}/g, formatBahtCurrency(bill.subtotal ?? bill.grandTotal ?? 0))
  replace(/\{\{\s*bill\.discount\s*\}\}/g, formatBahtCurrency(bill.discount ?? 0))
  replace(/\{\{\s*bill\.shipping_fee\s*\}\}/g, formatBahtCurrency(bill.shippingFee ?? 0))
  replace(/\{\{\s*bill\.tax_amount\s*\}\}/g, formatBahtCurrency(bill.taxAmount ?? 0))
  replace(/\{\{\s*bill\.deposit_amount\s*\}\}/g, formatBahtCurrency(bill.depositAmount ?? 0))
  replace(/\{\{\s*bill\.grand_total\s*\}\}/g, formatBahtCurrency(bill.grandTotal ?? 0))
  replace(/\{\{\s*bill\.grand_total_text\s*\}\}/g, thaiBahtText(bill.grandTotal ?? 0))
  replace(/\{\{\s*document\.vat_label\s*\}\}/g, bill.vatRate ? `${bill.vatRate}%` : 'ไม่คิด')
  replace(/\{\{\s*bill\.paid_amount\s*\}\}/g, formatBahtCurrency(bill.paidAmount ?? bill.grandTotal ?? 0))
  replace(/\{\{\s*bill\.outstanding_amount\s*\}\}/g, formatBahtCurrency(bill.outstandingAmount ?? 0))
  replace(/\{\{\s*bill\.refund_amount\s*\}\}/g, formatBahtCurrency(bill.refundAmount ?? 0))
  replace(/\{\{\s*bill\.damage_fee\s*\}\}/g, formatBahtCurrency(bill.damageFee ?? 0))
  replace(/\{\{\s*bill\.payment_method\s*\}\}/g, bill.paymentMethod || '')
  const totalPayable = bill.totalPayable ?? Math.round(((bill.grandTotal ?? 0) + (bill.depositAmount ?? 0)) * 100) / 100
  replace(/\{\{\s*bill\.total_payable\s*\}\}/g, formatBahtCurrency(totalPayable))
  replace(/\{\{\s*bill\.total_payable_text\s*\}\}/g, thaiBahtText(totalPayable))
  replace(/\{\{\s*document\.page\s*\}\}/g, bill.pageLabel || '1/1')

  // Item rows of the form (one field per cell). A customer document line has no rental flag of its
  // own: a free line (price 0) is shown as "-" in the money columns (owner 2026-11-09).
  const itemsForTable = bill.items || (rawItems ? rawItems.map(i => ({
    name: i.productName,
    quantity: i.quantity,
    unit: i.unit,
    price: i.normalPrice,
    lineTotal: (i.normalPrice || 0) * (i.quantity || 1),
    isNoCharge: Number(i.normalPrice || 0) === 0
  })) : [])

  html = fitFormItemColumns(html)
  // A form that draws its own item rows has one field per cell ({{items.3.name}}); its rows stay as drawn.
  const cellItems: Array<{ name: string; quantity?: number; unit?: string; price?: number; rentalType?: string; billableDays?: number; lineTotal?: number; isNoCharge?: boolean }> = itemsForTable
  html = html.replace(
    /\{\{\s*items\.(\d+)\.(no|name|quantity|unit|price|rental|amount)\s*\}\}/g,
    (_match, row: string, field: string) => {
      const index = Number(row) - 1
      if (field === 'no') return String(rowOffset + index + 1)
      const item = cellItems[index]
      if (!item) return ''
      if (field === 'name') return escapeDocumentHtml(item.name)
      if (field === 'quantity') return String(item.quantity ?? '')
      if (field === 'unit') return escapeDocumentHtml(item.unit || '')
      if (field === 'price') return isNoChargeLine(item) ? '-' : formatBahtCurrency(item.price)
      if (field === 'rental') return isNoChargeLine(item) ? '-' : rentalTermLabel(item.rentalType, item.billableDays)
      return isNoChargeLine(item) ? '-' : formatBahtCurrency(item.lineTotal)
    }
  )
  return sanitizeDocumentHtml(html)
}
