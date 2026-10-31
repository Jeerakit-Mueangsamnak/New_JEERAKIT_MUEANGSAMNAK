import * as XLSX from 'xlsx'
import { PaperSize, Orientation } from '@/lib/types/document'
import { escapeDocumentHtml, sanitizeDocumentHtml } from '@/features/documents/utils/document-html'

export interface ConversionResult {
  success: boolean
  error?: string
  templateSchema?: string
  paperSize?: PaperSize
  orientation?: Orientation
  pageCount?: number
  detectedFields?: string[]
}

const SUPPORTED_EXTENSIONS = [
  'pdf', 'docx', 'xls', 'xlsx', 'csv', 'html', 'htm', 'txt'
]
// Old binary Word / RTF cannot be read reliably in the browser; ask for .docx or PDF instead.
const LEGACY_EXTENSIONS = ['doc', 'rtf']

/** File-picker accept list, kept next to the converter so both stay in sync. */
export const TEMPLATE_UPLOAD_ACCEPT = '.pdf,.docx,.xlsx,.xls,.csv,.html,.htm,.txt'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_PDF_PAGES = 30

const PAGE_BREAK_HTML = '<div class="doc-page-break" style="break-after:page;page-break-after:always;height:0"></div>'

/**
 * Standard placeholders recognized by the template rendering engine
 */
export const AVAILABLE_PLACEHOLDERS = [
  '{{business.name}}',
  '{{business.address}}',
  '{{business.tax_id}}',
  '{{business.phone}}',
  '{{business.email}}',
  '{{business.line_id}}',
  '{{business.description}}',
  '{{business.authorized_person}}',
  '{{business.bank_name}}',
  '{{business.bank_account_name}}',
  '{{business.bank_account_number}}',
  '{{business.promptpay}}',
  '{{document.number}}',
  '{{document.date}}',
  '{{document.valid_until}}',
  '{{document.rental_start_date}}',
  '{{document.rental_end_date}}',
  '{{document.site_name}}',
  '{{document.custom_terms}}',
  '{{customer.code}}',
  '{{customer.name}}',
  '{{customer.company_name}}',
  '{{customer.phone}}',
  '{{customer.email}}',
  '{{customer.address}}',
  '{{customer.tax_id}}',
  '{{customer.id_card}}',
  '{{customer.id_card_expire}}',
  '{{bill.no}}',
  '{{bill.subtotal}}',
  '{{bill.discount}}',
  '{{bill.shipping_fee}}',
  '{{bill.tax_amount}}',
  '{{bill.deposit_amount}}',
  '{{bill.grand_total}}',
  '{{bill.paid_amount}}',
  '{{bill.outstanding_amount}}',
  '{{bill.refund_amount}}',
  '{{bill.late_fee}}',
  '{{bill.damage_fee}}',
  '{{bill.payment_method}}',
  '{{items.rows_standard_20}}',
  '{{items.rows_delivery_20}}',
  '{{items.rows_return_20}}',
  '{{items.rows_statement_20}}',
]

export interface ConversionDeps {
  /** Injected in tests; the browser build loads pdf.js on demand. */
  renderPdfPages?: (buffer: ArrayBuffer, maxPages: number, totalBudgetChars?: number) => Promise<string[]>
}

/**
 * Room for the page images of one imported PDF: the shop library keeps a form in one database
 * field of at most 1 MB (document_templates.template_schema), with some left for the page HTML.
 */
export const PDF_IMAGES_BUDGET_CHARS = 1_000_000

function detectPlaceholders(text: string): string[] {
  return AVAILABLE_PLACEHOLDERS.filter((ph) => text.includes(ph))
}

/** Converted files keep their own content only; the shop header is not injected. */
function wrapConverted(bodyHtml: string, pageCount: number, detectedFields: string[]): ConversionResult {
  return {
    success: true,
    templateSchema: `<div class="template-document imported-document font-sans text-slate-900 text-[12px] leading-relaxed">${bodyHtml}</div>`,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount,
    detectedFields,
  }
}

/** Every sheet becomes one table; each sheet after the first starts on a new page. */
function parseExcel(buffer: ArrayBuffer): ConversionResult {
  const workbook = XLSX.read(buffer, { type: 'array' })
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return { success: false, error: 'ไม่พบ Sheet ในไฟล์ Excel' }
  }

  const sections: string[] = []
  let allText = ''
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' })
      .filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== ''))
    if (rows.length === 0) continue

    const body = rows.map((row, rowIndex) => {
      const tag = rowIndex === 0 ? 'th' : 'td'
      const cellClass = rowIndex === 0
        ? 'border border-slate-400 bg-slate-100 p-1.5 font-bold text-left'
        : 'border border-slate-400 p-1.5'
      return `<tr>${row.map((cell) => {
        const text = String(cell ?? '').trim()
        allText += `${text}\n`
        return `<${tag} class="${cellClass}">${text ? escapeDocumentHtml(text) : '&nbsp;'}</${tag}>`
      }).join('')}</tr>`
    }).join('')

    const heading = workbook.SheetNames.length > 1 ? `<h2 class="text-sm font-bold mb-2">${escapeDocumentHtml(sheetName)}</h2>` : ''
    sections.push(`${heading}<table class="w-full border-collapse text-[11px]">${body}</table>`)
  }

  if (sections.length === 0) return { success: false, error: 'ไฟล์ Excel ว่างเปล่า ไม่มีข้อมูล' }
  return wrapConverted(sections.join(PAGE_BREAK_HTML), sections.length, detectPlaceholders(allText))
}

/** Word → HTML with headings, lists, tables and images; Word page breaks become print page breaks. */
async function parseDocx(buffer: ArrayBuffer): Promise<ConversionResult> {
  const mammoth = await import('mammoth')
  const options = { styleMap: ["br[type='page'] => hr.doc-page-break"] }
  // Browser build reads `arrayBuffer`, Node (tests) reads `buffer`.
  const input = { arrayBuffer: buffer, buffer } as unknown as { arrayBuffer: ArrayBuffer }
  const { value } = await mammoth.convertToHtml(input, options)

  const html = value
    .replace(/<hr class="doc-page-break"\s*\/?>/g, PAGE_BREAK_HTML)
    .replace(/<h1>/g, '<h1 class="text-lg font-bold my-2">')
    .replace(/<h2>/g, '<h2 class="text-base font-bold my-2">')
    .replace(/<h3>/g, '<h3 class="text-sm font-bold my-1.5">')
    .replace(/<p>/g, '<p class="my-1">')
    .replace(/<ul>/g, '<ul class="list-disc pl-6 my-1">')
    .replace(/<ol>/g, '<ol class="list-decimal pl-6 my-1">')
    .replace(/<table>/g, '<table class="w-full border-collapse my-2">')
    .replace(/<td>/g, '<td class="border border-slate-400 p-1.5 align-top">')
    .replace(/<th>/g, '<th class="border border-slate-400 p-1.5 font-bold">')
    .replace(/<img /g, '<img class="max-w-full" ')

  const text = html.replace(/<[^>]+>/g, ' ')
  if (!text.trim() && !html.includes('<img')) {
    return { success: false, error: 'ไม่พบเนื้อหาในไฟล์ Word' }
  }
  const pageCount = (html.match(/doc-page-break/g) || []).length + 1
  return wrapConverted(html, pageCount, detectPlaceholders(text))
}

/** One image per PDF page, each on its own printed page. */
async function parsePdf(buffer: ArrayBuffer, deps: ConversionDeps): Promise<ConversionResult> {
  const render = deps.renderPdfPages
    ?? (await import('@/features/documents/utils/pdf-pages')).renderPdfPagesToImages
  const images = await render(buffer, MAX_PDF_PAGES, PDF_IMAGES_BUDGET_CHARS)
  if (images.length === 0) return { success: false, error: 'ไม่พบหน้าในไฟล์ PDF' }

  const pages = images.map((src, index) =>
    `<div class="imported-pdf-page"><img src="${src}" alt="หน้า ${index + 1}" style="width:100%;display:block" /></div>`
  )
  return wrapConverted(pages.join(PAGE_BREAK_HTML), images.length, [])
}

function parseText(raw: string, extension: string): ConversionResult {
  const text = raw.replace(/^﻿/, '')
  if (extension === 'html' || extension === 'htm') {
    const body = text.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? text
    const safe = sanitizeDocumentHtml(body)
    if (!safe.replace(/<[^>]+>/g, '').trim()) return { success: false, error: 'ไม่พบเนื้อหาในไฟล์ HTML' }
    return wrapConverted(safe, 1, detectPlaceholders(safe))
  }

  if (!text.trim()) return { success: false, error: 'ไฟล์ว่างเปล่า ไม่มีข้อความ' }
  const paragraphs = text.split(/\r?\n/).map((line) =>
    line.trim() ? `<p class="my-0.5 whitespace-pre-wrap">${escapeDocumentHtml(line)}</p>` : '<p class="my-0.5">&nbsp;</p>'
  ).join('')
  return wrapConverted(paragraphs, 1, detectPlaceholders(text))
}

/**
 * Reads the uploaded file in the browser and converts it to the internal HTML template.
 * Nothing is uploaded; the source buffer is dropped after conversion.
 */
export async function convertFileToInternalTemplate(
  file: File | { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> },
  deps: ConversionDeps = {}
): Promise<ConversionResult> {
  if (!file || !file.name) {
    return { success: false, error: 'กรุณาเลือกไฟล์ที่ต้องการแปลง' }
  }

  if (file.size === 0) {
    return { success: false, error: 'ไฟล์ที่อัปโหลดมีขนาด 0 byte (ไฟล์ว่างเปล่า)' }
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { success: false, error: 'ขนาดไฟล์เกินกำหนด (สูงสุด 10 MB)' }
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  if (LEGACY_EXTENSIONS.includes(extension)) {
    return {
      success: false,
      error: `ไฟล์ .${extension} รุ่นเก่าแปลงไม่ได้ กรุณาเปิดใน Word แล้วบันทึกเป็น .docx หรือ PDF ก่อน`,
    }
  }
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    return {
      success: false,
      error: `ไม่รองรับไฟล์สกุล .${extension} (รองรับ: PDF, DOCX, XLSX, XLS, CSV, HTML, TXT)`,
    }
  }

  try {
    const buffer = await file.arrayBuffer()
    if (extension === 'xlsx' || extension === 'xls' || extension === 'csv') return parseExcel(buffer)
    if (extension === 'docx') return await parseDocx(buffer)
    if (extension === 'pdf') return await parsePdf(buffer, deps)
    return parseText(new TextDecoder('utf-8').decode(buffer), extension)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : ''
    return {
      success: false,
      error: `แปลงไฟล์ไม่สำเร็จ: ${message || 'ไฟล์อาจเสียหรือมีรหัสผ่าน'}`,
    }
  }
}
