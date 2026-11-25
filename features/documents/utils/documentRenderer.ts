import { CustomerSnapshot, CustomerDocumentItem } from '@/lib/types/document'
import { BusinessSettings } from '@/lib/types/rental-pos'
import { escapeDocumentHtml, sanitizeDocumentHtml } from '@/features/documents/utils/document-html'
import { applyDocumentInk } from '@/features/documents/utils/document-ink'
import { formatCustomerTaxId } from '@/features/customers/services/customer-display'

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
/**
 * จำนวนเงิน columns (owner 2026-11-11): narrowed from their left edge to what an amount needs, still
 * right-aligned; the width goes to รายการ.
 */
const MONEY_ITEM_FIELDS = new Set(['amount', 'fine'])
/** Room for an amount up to 9,999,999.00 at the forms' 12px. */
const MONEY_COLUMN_TEXT_PX = 72
/** Room left beside the header text, on top of the cell's own padding. */
const FITTED_COLUMN_SPARE_PX = 8

const styleWidth = (style: string) => Number(/(?:^|[;\s"])width:\s*([\d.]+)px/.exec(style)?.[1] ?? NaN)
const stylePx = (style: string, prop: string) => Number(new RegExp(`${prop}:\\s*([\\d.]+)px`).exec(style)?.[1] ?? 0)
const setStyleWidth = (style: string, width: number) =>
  style.replace(/((?:^|[;\s"])width:\s*)[\d.]+px/, `$1${Math.round(width * 100) / 100}px`)

/**
 * A shop form drawn with one field per item cell ({{items.1.quantity}}): the จำนวน / หน่วย / การเช่า
 * columns are made as wide as their header text and their cells centred, the จำนวนเงิน column as wide as
 * an amount needs (still right-aligned); the width they give up goes to the รายการ column, so the table
 * keeps its size and every row moves together. The stored form is not changed. A table this cannot read cell by cell (merged cells, several header rows) is left as drawn.
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
  const centred = new Set<number>()
  let freed = 0
  fields.forEach((field, index) => {
    const money = MONEY_ITEM_FIELDS.has(field)
    if (!FITTED_ITEM_FIELDS.has(field) && !money) return
    const [, , attrs, content] = header[index]
    const style = /style="([^"]*)"/.exec(attrs)?.[1] ?? ''
    const oldWidth = styleWidth(style)
    const textWidth = styleWidth(/style="([^"]*)"/.exec(content)?.[1] ?? '')
    if (!Number.isFinite(oldWidth) || (!money && !Number.isFinite(textWidth))) return
    const needed = money ? Math.max(Number.isFinite(textWidth) ? textWidth : 0, MONEY_COLUMN_TEXT_PX) : textWidth
    const width = needed + stylePx(style, 'padding-left') + stylePx(style, 'padding-right') + FITTED_COLUMN_SPARE_PX
    if (money && width >= oldWidth) return
    newWidths.set(index, width)
    if (!money) centred.add(index)
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
        if (tag === 'td' && centred.has(index)) {
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
  signer: 'display:inline-block;max-width:100%;box-sizing:border-box;white-space:normal;overflow-wrap:anywhere;word-break:break-word;line-height:1.3;vertical-align:bottom',
  /** A shop detail written inside the form's own text line (bank lines): same font as the line, never wrapped. */
  inlineValue: 'white-space:nowrap',
} as const

/** Bill templates may put the Thai amount in parentheses; print the amount text without them. */
export function removeThaiAmountTextParentheses(template: string): string {
  return template.replace(
    /\(\s*(\{\{\s*(?:bill|return|fine)\.(?:grand_total_text|total_payable_text|total_text)\s*\}\})\s*\)/g,
    '$1'
  )
}

/**
 * The shop logo drawn in a form, on its own centre (owner 2026-11-20: "ขยายอีกนิด", then "ใช้หัวโลโก้และล่างโลโก้
 * อิงจากเส้นขอบ"): its top and bottom come to the frame's own padding (8.3px) from the frame's top line and the
 * line under the shop details — measured on the shop's form. The size is of the box the form drew; the app had
 * printed the logo smaller than that (held to its frame's width), so this is about 20% larger than before.
 */
const FORM_LOGO_SCALE = 0.96

function enlargeBusinessLogo(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (image) => {
    // The logo stored in the form itself (alt "โลโก้..."): its box grows; the box is centred in its frame.
    if (/\balt\s*=\s*(["'])[^"']*โลโก้/.test(image)) {
      // max-width: the app's own picture rule (max-width:100%) held the logo to its frame's width, so it did not grow
      return image.replace(/(\sstyle\s*=\s*")([^"]*)(")/i, (_m, open: string, style: string, close: string) =>
        `${open}${style.replace(/((?:^|;)\s*(?:width|height):\s*)([\d.]+)px/g, (_d, prop: string, px: string) =>
          `${prop}${Math.round(Number(px) * FORM_LOGO_SCALE * 1000) / 1000}px`)}; max-width:none; max-height:none${close}`
      )
    }
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
  /(<span\b[^>]*style="([^"]*)"[^>]*>)\{\{\s*customer\.address\s*\}\}​?(<\/span>\s*<\/div>\s*<div\b[^>]*>\s*<span\b[^>]*>\s*<\/span>\s*<span\b[^>]*>)\s*(<\/span>)/

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

/**
 * One standard font for every form (owner 2026-11-11: "ดูดี ดูสวย ดูมาตรฐาน"). The forms mixed Tahoma, Arial
 * (amounts) and Tahoma alone (signature dates); iPad / phones have no Tahoma, so they drew the forms in their
 * own font, wider or narrower than on the shop's computer. Now every part uses Tahoma, and where Tahoma is
 * missing the Thai web font Noto Sans Thai (loaded in app/globals.css) — never a random device font.
 */
export const FORM_FONT_FAMILY = "Tahoma, 'Noto Sans Thai', sans-serif"

function standardizeFormFont(html: string): string {
  return html.replace(/font-family\s*:\s*(?:&quot;[^&]*&quot;|'[^']*'|[^;"'<>}])+/gi, `font-family:${FORM_FONT_FAMILY}`)
}

/** Left and right paper margin of every form (owner 2026-11-11: 10 mm each side; the forms were drawn with 5 mm). */
export const FORM_SIDE_MARGIN_MM = 10
const PX_PER_MM = 96 / 25.4

/**
 * The form's A4 sheet (width 210mm) keeps its drawing; only its margins change. The sheet's left /
 * right padding becomes FORM_SIDE_MARGIN_MM and the drawing inside is scaled to the narrower width
 * (CSS zoom, so it also takes less room). The room the smaller drawing leaves is shared equally above
 * and below (owner 2026-11-11: top and bottom alike). The paper left and right is then made the same as
 * above and below (owner 2026-11-25: all four sides alike, top / bottom decide): the drawing is narrowed
 * about its centre (scaleX); its box stays FORM_SIDE_MARGIN_MM from each side, so iPad printing, which
 * centres that box, gives the same paper. Forms without that sheet are left as they are.
 */
function setFormSideMargins(html: string): string {
  const m = /<div style="([^"]*\bwidth:\s*210mm\b[^"]*)">(\s*<div style=")/.exec(html)
  if (!m) return html
  const style = m[1]
  const left = stylePx(style, 'padding-left')
  const right = stylePx(style, 'padding-right')
  const sheet = 210 * PX_PER_MM
  const inner = sheet - left - right
  const margin = FORM_SIDE_MARGIN_MM * PX_PER_MM
  if (!(inner > 0) || (Math.abs(left - margin) < 0.5 && Math.abs(right - margin) < 0.5)) return html
  const zoom = Math.round(((sheet - 2 * margin) / inner) * 10000) / 10000
  const side = margin.toFixed(4)
  const sheetHeight = 297 * PX_PER_MM
  const innerHeight = sheetHeight - stylePx(style, 'padding-top') - stylePx(style, 'padding-bottom')
  const verticalPx = Math.max(0, (sheetHeight - innerHeight * zoom) / 2)
  const vertical = verticalPx.toFixed(4)
  const narrow = Math.round(Math.min(1, (sheet - 2 * verticalPx) / (inner * zoom)) * 100000) / 100000
  const narrowStyle = narrow < 1 ? `transform:scaleX(${narrow}); ` : ''
  const sheetStyle = `${style}; padding-left:${side}px; padding-right:${side}px; padding-top:${vertical}px; padding-bottom:${vertical}px`
  return `${html.slice(0, m.index)}<div style="${sheetStyle}">${m[2]}zoom:${zoom}; ${narrowStyle}${html.slice(m.index + m[0].length)}`
}

/**
 * Text the form wrote itself on a line of fixed height stays on that line. With a slightly wider font
 * (another computer, the printer) it wrapped: the bank lines took 2 rows and the หมายเหตุ lines ran over
 * each other (owner 2026-11-11). Shop details from Settings ({{business.*}}) count as the form's text;
 * other fields keep their own rules.
 */
function keepFormTextOnItsLine(html: string): string {
  return html.replace(
    /<(div|span|p|h[1-6]|strong|b|td|th)\b([^>]*?)style="([^"]*)"([^>]*)>([^<]*)<\/\1>/g,
    (match, tag: string, before: string, style: string, after: string, text: string) => {
      if (!text.trim() || /\{\{(?!\s*business\.)/.test(text) || !/white-space:\s*pre-wrap/.test(style) || !/(?:^|;)\s*height:\s*[\d.]+px/.test(style)) return match
      const next = `${style.replace(/white-space:\s*pre-wrap/g, 'white-space:pre')}; overflow:visible`
      return `<${tag}${before}style="${next}"${after}>${text}</${tag}>`
    }
  )
}

/**
 * The empty brackets under a signature for the customer's name — "(            )" drawn with spaces —
 * wrapped or drifted apart (owner 2026-11-11). They are drawn as a centred pair with a fixed blank between.
 */
function centreEmptySignatureBrackets(html: string): string {
  return html.replace(
    /<(span|div)\b([^>]*?)style="([^"]*)"([^>]*)>\s*\(\s{3,}\)\s*<\/\1>/g,
    (match, tag: string, before: string, style: string, after: string) => {
      const width = styleWidth(style) - stylePx(style, 'padding-left') - stylePx(style, 'padding-right')
      if (!(width > 40)) return match
      // About as wide as the shop's own "( name )" beside it, and never wider than the line
      const blank = Math.round(Math.min(width - 24, 100) * 100) / 100
      return `<${tag}${before}style="${style}; white-space:nowrap; text-align:center; overflow:visible"${after}>(<span style="display:inline-block; width:${blank}px"></span>)</${tag}>`
    }
  )
}

/**
 * ลำดับ: the form sized each number box for the number it showed when drawn (one digit for rows 1–9),
 * so on later pages 21–29 printed as "2" (owner 2026-11-11). The number box takes the room it needs.
 */
function freeItemNumberWidth(html: string): string {
  return html.replace(/(<span\b[^>]*?style=")([^"]*)("[^>]*>\s*\{\{\s*items\.\d+\.no\s*\}\})/g, (_m, open: string, style: string, close: string) => {
    const next = style
      .replace(/(?:^|;)\s*(?:width|min-width|max-width):\s*[^;]*/g, '')
      .replace(/(?:^|;)\s*(?:overflow|overflow-x|text-overflow):\s*[^;]*/g, '')
    return `${open}${next}; width:auto; overflow:visible${close}`
  })
}

const withoutFixedHeight = (style: string) => style.replace(/(^|;)\s*(?:height|max-height):\s*[^;]*/g, '$1').replace(/;\s*;/g, ';')
const hasFixedHeight = (style: string) => /(?:^|;)\s*(?:height|max-height):/.test(style)

/**
 * Every field box (item rows, dates, totals, the amount in words, ...) keeps the fixed height it was drawn
 * with (14–15 px for 12–13 px text) and hides what does not fit, so the bottom of Thai text (สระล่าง ุ ู as in
 * "ศูนย์", ฤ) and of a wider font on another device was cut off (owner 2026-11-19 items, 2026-11-20 every field).
 * Every field — item rows included — is placed like the form's own text in the VAT row (owner 2026-11-20:
 * "ใช้การตั้งค่าตำแหน่งเหมือนแถวภาษีมูลค่าเพิ่ม สระอูไม่หายและไม่สูง"): it keeps the box it was drawn with, so
 * it stays level with the text beside it (ยอดรวม | 0.00) and low in its row, and only stops cutting at the
 * bottom; a text too long is still cut at the side.
 * Shop details ({{business.*}}) keep their own rule (keepFormTextOnItsLine), underlined details theirs
 * (clearUnderlines).
 */
function freeFieldHeight(html: string): string {
  return html.replace(/(<span\b[^>]*?style=")([^"]*)("[^>]*>\s*\(?\{\{\s*(?!business\.)([\w.]+)\s*\}\})/g, (match, open: string, style: string, close: string, field: string) => {
    if (!hasFixedHeight(style) || /border-bottom-style:/.test(style)) return match
    // An item cell (ลำดับ too, made a block like the rest) takes the height its line needs, so nothing of it is
    // cut, and sits 1px lower — as low in its row as the VAT row's text in its own (the cell still cuts a name
    // that is too long at the side).
    if (field.startsWith('items.')) {
      return `${open}${withoutFixedHeight(style)}; height:auto; display:block; position:relative; top:${ITEM_TEXT_DROP_PX}px${close}`
    }
    // Any other field keeps its box like the form's text beside it and is never cut (iPad: cutting only the
    // sides of a box is not reliable there, it cut the bottom too).
    if (!/overflow(?:-[xy])?:\s*hidden/.test(style)) return match
    return `${open}${style.replace(/(^|;)\s*overflow(?:-[xy])?:\s*hidden/g, '$1').replace(/;\s*;/g, ';')}; overflow:visible${close}`
  })
}

/** How much lower an item row's text sits than centred (owner 2026-11-20: "สูงไปนิดนึง ปรับลงมา", VAT row as the example). */
const ITEM_TEXT_DROP_PX = 1

/** Room between an underlined detail's text line and its line. */
const UNDERLINE_GAP_PX = 1

/**
 * An underlined detail (ชื่อลูกค้า, ที่อยู่, เบอร์โทร, ...): the line ran through the bottom of the text
 * (owner 2026-11-20). The text keeps a line as tall as the box was drawn and the line goes just under it, so
 * สระล่าง (ุ ู) sit right above the line like the VAT row's text above its line — not cut, not floating high.
 */
function clearUnderlines(html: string): string {
  return html.replace(/(<span\b[^>]*?style=")([^"]*border-bottom-style:\s*(?:dotted|dashed|solid)[^"]*)("[^>]*>)(\s*\{\{[^}]*\}\})?/g, (_m, open: string, style: string, close: string, field?: string) => {
    const height = Number(/(?:^|;)\s*height:\s*([\d.]+)px/.exec(style)?.[1])
    // An invisible character after the value: an empty detail (no tax ID) still has a text line, so it stays
    // level with its label like a filled one.
    const content = field ? `${field}​` : ''
    if (!(height > 0)) return `${open}${style}; padding-bottom:${UNDERLINE_GAP_PX}px${close}${content}`
    return `${open}${withoutFixedHeight(style)}; height:${height + UNDERLINE_GAP_PX}px; line-height:${height}px${close}${content}`
  })
}

/**
 * Frames and cells are drawn with lines; a nudge of less than 1px on one of them (the first row of the
 * totals moved 0.79px) put its line beside the next one, printed as a double / thicker line (owner
 * 2026-11-20). Such nudges are dropped so the lines meet; larger moves stay as drawn.
 */
function alignLinedBoxes(html: string): string {
  return html.replace(/(\sstyle=")([^"]*)"/g, (match, open: string, style: string) => {
    if (!/translate:/.test(style) || !/border-(?:top|right|bottom|left)-width:\s*[1-9]/.test(style)) return match
    const next = style.replace(/translate:\s*([^;]+)/, (_t, value: string) =>
      `translate:${value.trim().split(/\s+/).map((part) => (Math.abs(Number.parseFloat(part)) < 1 ? '0px' : part)).join(' ')}`
    )
    return `${open}${next}"`
  })
}

/**
 * The totals box (ยอดรวม | 0.00) is as wide as its widest label needs, the VAT row "ภาษีมูลค่าเพิ่ม 7%(VAT)"
 * (measured on the shop's form: 129.3px), and its amounts up to 9,999,999.00 — the same for every form,
 * including those without a VAT row (owner 2026-11-20).
 */
const TOTALS_LABEL_TEXT_PX = 130
const TOTALS_AMOUNT_TEXT_PX = 80

const openTagAt = (html: string, start: number) => html.slice(start, html.indexOf('>', start) + 1)
const styleOf = (tag: string) => /style="([^"]*)"/.exec(tag)?.[1] ?? ''
const firstPx = (value: string) => [...value.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]))

/** `style` moved `dx` px to the right (its translate, or a new one). */
function movedRight(style: string, dx: number): string {
  const round = (n: number) => Math.round(n * 10000) / 10000
  if (/translate:/.test(style)) {
    return style.replace(/translate:\s*([^;]+)/, (_m, value: string) => {
      const parts = value.trim().split(/\s+/)
      parts[0] = `${round(Number.parseFloat(parts[0]) + dx)}px`
      return `translate:${parts.join(' ')}`
    })
  }
  return `${style}; translate:${round(dx)}px 0px`
}

/** The nearest `<div` at or before `from` whose opening tag passes `test`. */
function divBefore(html: string, from: number, test: (tag: string) => boolean): number {
  let start = html.lastIndexOf('<div', from)
  while (start >= 0 && !test(openTagAt(html, start))) start = start === 0 ? -1 : html.lastIndexOf('<div', start - 1)
  return start
}

/**
 * Totals box, amount in words and หมายเหตุ (owner 2026-11-20): the totals box and the amount box below it
 * keep their right edge and lose what the totals do not need (the label | amount line moves with it); the
 * หมายเหตุ box beside them takes that room, keeping the row's own gap. Forms without these boxes stay as drawn.
 */
function fitTotalsBox(html: string): string {
  const field = html.search(/\{\{\s*(?:bill\.subtotal|return\.rent|fine\.damage)\s*\}\}/)
  if (field < 0) return html
  const twoColumns = /grid-template-columns:\s*([\d.]+)px\s+([\d.]+)px/
  const box = divBefore(html, field, (tag) => twoColumns.test(styleOf(tag)))
  const boxEnd = box >= 0 ? divBlockEnd(html, box) : -1
  if (boxEnd < 0) return html
  const boxStyle = styleOf(openTagAt(html, box))
  const [, aText, bText] = twoColumns.exec(boxStyle) as RegExpExecArray
  const firstCell = /<div\b[^>]*style="([^"]*)"/.exec(html.slice(box + openTagAt(html, box).length, boxEnd))?.[1] ?? ''
  const padding = stylePx(firstCell, 'padding-left') + stylePx(firstCell, 'padding-right')
  const label = TOTALS_LABEL_TEXT_PX + padding + FITTED_COLUMN_SPARE_PX
  const amount = TOTALS_AMOUNT_TEXT_PX + padding + FITTED_COLUMN_SPARE_PX
  const delta = Number(aText) + Number(bText) - label - amount
  const width = styleWidth(boxStyle)
  if (!(delta > 0) || !Number.isFinite(width)) return html
  const r = (n: number) => `${Math.round(n * 10000) / 10000}px`

  // The amount in words below: same right edge, narrower by the same amount
  const words = html.slice(boxEnd).search(/\{\{\s*(?:bill\.(?:grand_total_text|total_payable_text)|return\.total_payable_text|fine\.total_text)\s*\}\}/)
  const wordsBox = words < 0 ? -1 : divBefore(html, boxEnd + words, (tag) => /border-top-width:\s*[1-9]/.test(styleOf(tag)) && Number.isFinite(styleWidth(styleOf(tag))))
  if (wordsBox >= boxEnd) {
    const tag = openTagAt(html, wordsBox)
    const style = styleOf(tag)
    html = html.slice(0, wordsBox) + tag.replace(style, movedRight(setStyleWidth(style, styleWidth(style) - delta), delta)) + html.slice(wordsBox + tag.length)
  }

  // The totals box: narrower, moved right, its columns and cells resized
  const cellWidth = (text: string) => new RegExp(`((?:^|[;\\s"])width:\\s*)${text.replace('.', '\\.')}px`, 'g')
  const block = html.slice(box, boxEnd)
  const boxTag = openTagAt(html, box)
  const resized = boxTag.replace(boxStyle, movedRight(setStyleWidth(boxStyle, width - delta), delta).replace(twoColumns, `grid-template-columns:${r(label)} ${r(amount)}`)) +
    block.slice(boxTag.length).replace(cellWidth(aText), `$1${r(label)}`).replace(cellWidth(bText), `$1${r(amount)}`)
  html = html.slice(0, box) + resized + html.slice(boxEnd)

  // หมายเหตุ: the first box of the row the totals box sits in, widened up to the row's gap before the totals
  const row = divBefore(html, box - 1, (tag) => twoColumns.test(styleOf(tag)))
  if (row < 0) return html
  const rowStyle = styleOf(openTagAt(html, row))
  const firstColumn = Number(twoColumns.exec(rowStyle)?.[1])
  const notes = html.indexOf('<div', row + openTagAt(html, row).length)
  if (notes < 0 || notes >= box) return html
  const notesTag = openTagAt(html, notes)
  const notesStyle = styleOf(notesTag)
  const notesX = firstPx(/translate:\s*([^;]+)/.exec(notesStyle)?.[1] ?? '0px')[0] ?? 0
  const totalsX = firstPx(/translate:\s*([^;]+)/.exec(boxStyle)?.[1] ?? '0px')[0] ?? 0
  const notesWidth = firstColumn + totalsX + delta - notesX
  if (!Number.isFinite(notesWidth) || notesWidth <= styleWidth(notesStyle)) return html
  return html.slice(0, notes) + notesTag.replace(notesStyle, setStyleWidth(notesStyle, notesWidth)) + html.slice(notes + notesTag.length)
}

/** The block (from `<div` at `start`) up to its own closing `</div>`. */
function divBlockEnd(html: string, start: number): number {
  const tag = /<\/?div\b[^>]*>/g
  tag.lastIndex = start
  let depth = 0
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth === 0) return m.index + m[0].length
  }
  return -1
}

/**
 * The shop's details beside the logo (ชื่อร้าน, English name, address, phone, tax ID) are centred lines in
 * boxes as wide as the Thai name's. A line wider than its box (another device's font) ran off to the right
 * and was cut by the frame (owner 2026-11-20). Each line is centred on the Thai name's centre even when it
 * is wider, and nothing is cut.
 */
function centreShopDetailLines(html: string): string {
  const heading = html.search(/<h1\b/)
  if (heading < 0) return html
  let start = html.lastIndexOf('<div', heading)
  while (start >= 0 && !/^<div\b[^>]*style="[^"]*text-align:\s*center/.test(html.slice(start, html.indexOf('>', start) + 1))) {
    start = start === 0 ? -1 : html.lastIndexOf('<div', start - 1)
  }
  const end = start >= 0 ? divBlockEnd(html, start) : -1
  if (end < 0) return html
  const block = html
    .slice(start, end)
    .replace(/^(<div\b[^>]*style="[^"]*)"/, (_m, open: string) => `${open.replace(/overflow(?:-[xy])?:\s*hidden;?\s*/g, '')}; overflow:visible"`)
    .replace(/(<span\b[^>]*style="[^"]*white-space:\s*pre[^"]*display:\s*inline-block[^"]*)"/g, '$1; display:inline-flex; justify-content:center"')
  return html.slice(0, start) + block + html.slice(end)
}

/** An image whose picture comes from Settings (e.g. {{business.qr_url}}) and is not set there prints nothing. */
function hideEmptyImages(html: string): string {
  return html.replace(/<img\b[^>]*\ssrc\s*=\s*(["'])\s*\1[^>]*>/gi, '')
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

  // Print fixes that keep the shop's form as drawn (the stored form is not changed)
  let html = fitTotalsBox(alignLinedBoxes(clearUnderlines(freeFieldHeight(freeItemNumberWidth(
    keepFormTextOnItsLine(
      centreEmptySignatureBrackets(
        centreShopDetailLines(enlargeBusinessLogo(setFormSideMargins(standardizeFormFont(removeThaiAmountTextParentheses(templateSchema)))))
      )
    )
  )))))

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
  // Bank details and the QR come from Settings → ข้อมูลร้าน (owner 2026-11-11: never fixed in a form)
  replaceStyled(/\{\{\s*business\.bank_name\s*\}\}/g, fallbackBankName, DOCUMENT_FIELD_STYLE.inlineValue)
  replaceStyled(/\{\{\s*business\.bank_account_name\s*\}\}/g, fallbackAccountName, DOCUMENT_FIELD_STYLE.inlineValue)
  replaceStyled(/\{\{\s*business\.bank_account_number\s*\}\}/g, fallbackAccountNumber, DOCUMENT_FIELD_STYLE.inlineValue)
  replaceStyled(/\{\{\s*business\.promptpay\s*\}\}/g, fallbackPromptPay, DOCUMENT_FIELD_STYLE.inlineValue)
  replace(/\{\{\s*business\.logo_url\s*\}\}/g, biz.logoDataUrl || biz.logoUrl || '/logo.png')
  replace(/\{\{\s*business\.qr_url\s*\}\}/g, biz.bankQrDataUrl || '')
  html = hideEmptyImages(html)

  // Fitting fixes made while printing (the shop's form itself is not changed)
  html = centreFloatingDocumentDate(flowCustomerAddress(html, cust.address || ''))

  // Mapping customer fields
  replace(/\{\{\s*customer\.code\s*\}\}/g, cust.customerCode || '')
  replace(/\{\{\s*customer\.name\s*\}\}/g, cust.customerName || '')
  replace(/\{\{\s*customer\.company_name\s*\}\}/g, cust.companyName || cust.customerName || '')
  replace(/\{\{\s*customer\.phone\s*\}\}/g, cust.phone || '')
  replace(/\{\{\s*customer\.email\s*\}\}/g, cust.email || '')
  replace(/\{\{\s*customer\.address\s*\}\}/g, cust.address || '')
  replace(/\{\{\s*customer\.tax_id\s*\}\}/g, formatCustomerTaxId(cust.taxId))
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
  // Every form prints with no background colour, black ink and the VAT label clear of its line (owner 2026-11-12)
  return sanitizeDocumentHtml(applyDocumentInk(html))
}
