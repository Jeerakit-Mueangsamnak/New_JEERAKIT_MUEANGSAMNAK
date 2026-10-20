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
  /** VAT rate (%) of the document; null / undefined = no VAT. */
  vatRate?: number | null
  paidAmount?: number
  outstandingAmount?: number
  refundAmount?: number
  lateFee?: number
  damageFee?: number
  paymentMethod?: string
  checkStage?: 'DISPATCH' | 'RETURN'
  items?: Array<{
    code?: string
    name: string
    quantity: number
    deliveredQty?: number
    normalReturnedQty?: number
    remainingQty?: number
    outstandingQty?: number
    unit?: string
    price?: number
    rentalType?: string
    billableDays?: number
    lineTotal?: number
    returnedQty?: number
    normalQty?: number
    damagedQty?: number
    lostQty?: number
    damageFee?: number
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

/** "3 รอบ" / "2 วัน" / "ขาย" for the rental column of an item row. */
export function rentalTermLabel(rentalType?: string, periods?: number): string {
  if (rentalType === 'SALE') return 'ขาย'
  const n = Math.max(1, Number(periods) || 1)
  return rentalType === 'DAILY' ? `${n} วัน` : `${n} รอบ`
}

/** The 16 item rows of the quotation form (same grid as its header row). */
export function generateQuotationRowsHtml(
  items: Array<{ name: string; quantity?: number; unit?: string; price?: number; rentalType?: string; billableDays?: number; lineTotal?: number }> = []
): string {
  const widths = ['6%', '38%', '8%', '8%', '11%', '13%', '16%']
  return Array.from({ length: 16 }, (_, index) => {
    const item = items[index]
    const values = item
      ? [
          String(index + 1),
          escapeDocumentHtml(item.name),
          String(item.quantity ?? ''),
          escapeDocumentHtml(item.unit || ''),
          formatBahtCurrency(item.price),
          rentalTermLabel(item.rentalType, item.billableDays),
          formatBahtCurrency(item.lineTotal),
        ]
      : [String(index + 1), '', '', '', '', '', '']
    const align = ['center', 'left', 'center', 'center', 'right', 'center', 'right']
    const cells = widths
      .map((width, cellIndex) => {
        const borders = `${cellIndex < widths.length - 1 ? 'border-right:1px solid #64748b;' : ''}${index === 15 ? '' : 'border-bottom:1px solid #64748b;'}`
        return `<td style="width:${width};height:25px;${borders}text-align:${align[cellIndex]};padding:0 4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${values[cellIndex]}</td>`
      })
      .join('')
    return `<tr style="height:25px;">${cells}</tr>`
  }).join('')
}

export function formatBahtCurrency(val?: number | null): string {
  if (val === undefined || val === null || isNaN(val)) return '0.00'
  return val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Generate exactly 20 HTML table rows for itemized billing/rental/contract documents.
 * If actual items are fewer than 20, the remaining rows are rendered blank with full cell borders.
 */
export function generate20ItemRowsHtml(
  items: Array<{
    code?: string
    name: string
    quantity?: number
    deliveredQty?: number
    normalReturnedQty?: number
    returnedQty?: number
    damagedQty?: number
    lostQty?: number
    remainingQty?: number
    outstandingQty?: number
    unit?: string
    price?: number
    rentalType?: string
    billableDays?: number
    lineTotal?: number
  }> = [],
  tableType: 'STANDARD_BILL' | 'DELIVERY' | 'RETURN' | 'DAMAGE' | 'STATEMENT' | 'CONTRACT' | 'CHECK_DISPATCH' | 'CHECK_RETURN' = 'STANDARD_BILL'
): string {
  const TOTAL_ROWS = 20
  const rowsHtml: string[] = []

  for (let i = 0; i < TOTAL_ROWS; i++) {
    const item = items[i]
    const rowNum = i + 1

    if (item) {
      if (tableType === 'DELIVERY') {
        rowsHtml.push(`
          <tr class="h-[18px] border-b border-slate-300 text-[8.5px]">
            <td class="border-x border-slate-300 px-1 py-0.5 text-center font-mono">${rowNum}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 font-bold truncate max-w-[180px]">${escapeDocumentHtml(item.name)}</td>
            <td class="border-r border-slate-300 px-1 py-0.5 text-center font-mono font-bold">${item.quantity ?? 1}</td>
            <td class="border-r border-slate-300 px-1 py-0.5 text-center">${escapeDocumentHtml(item.unit || 'ชิ้น')}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-center font-mono font-bold">${item.deliveredQty ?? 0}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-slate-600 truncate max-w-[100px]">${escapeDocumentHtml(item.code || '-')}</td>
          </tr>
        `)
      } else if (tableType === 'CHECK_DISPATCH') {
        rowsHtml.push(`
          <tr class="h-[18px] border-b border-slate-300 text-[8.5px]">
            <td class="border-x border-slate-300 px-1 py-0.5 text-center font-mono">${rowNum}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 font-bold truncate max-w-[180px]">${escapeDocumentHtml(item.name)}</td>
            <td class="border-r border-slate-300 px-1 py-0.5 text-center font-mono">${item.quantity ?? 0}</td>
            <td class="border-r border-slate-300 px-1 py-0.5 text-center font-mono font-bold">${item.deliveredQty ?? 0}</td>
            <td class="border-r border-slate-300 px-1 py-0.5 text-center font-mono">${item.remainingQty ?? 0}</td>
            <td class="border-r border-slate-300 px-1 py-0.5 text-center">${escapeDocumentHtml(item.unit || 'ชิ้น')}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-slate-600 truncate max-w-[100px]">${escapeDocumentHtml(item.code || '-')}</td>
          </tr>
        `)
      } else if (tableType === 'CHECK_RETURN') {
        rowsHtml.push(`
          <tr class="h-[18px] border-b border-slate-300 text-[8.5px]">
            <td class="border-x border-slate-300 px-1 py-0.5 text-center font-mono">${rowNum}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 font-bold truncate max-w-[180px]">${escapeDocumentHtml(item.name)}</td>
            <td class="border-r border-slate-300 px-1 py-0.5 text-center font-mono">${item.deliveredQty ?? 0}</td>
            <td class="border-r border-slate-300 px-1 py-0.5 text-center font-mono font-bold">${item.normalReturnedQty ?? 0}</td>
            <td class="border-r border-slate-300 px-1 py-0.5 text-center font-mono">${item.damagedQty ?? 0}</td>
            <td class="border-r border-slate-300 px-1 py-0.5 text-center font-mono">${item.lostQty ?? 0}</td>
            <td class="border-r border-slate-300 px-1 py-0.5 text-center font-mono">${item.outstandingQty ?? 0}</td>
          </tr>
        `)
      } else if (tableType === 'RETURN') {
        rowsHtml.push(`
          <tr class="h-[18px] border-b border-slate-300 text-[8.5px]">
            <td class="border-x border-slate-300 px-1 py-0.5 text-center font-mono">${rowNum}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 font-bold truncate max-w-[170px]">${escapeDocumentHtml(item.name)}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-center font-mono font-bold">${item.quantity ?? 1}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-center text-emerald-700 font-bold">${item.quantity ?? 1}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-center text-amber-700 font-mono">0</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-center text-red-700 font-mono">0</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-right font-mono font-bold">฿0.00</td>
          </tr>
        `)
      } else if (tableType === 'STATEMENT') {
        rowsHtml.push(`
          <tr class="h-[18px] border-b border-slate-300 text-[8.5px]">
            <td class="border-x border-slate-300 px-1 py-0.5 text-center font-mono">${rowNum}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 font-mono text-center">${escapeDocumentHtml(item.code || '-')}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 font-bold truncate max-w-[160px]">${escapeDocumentHtml(item.name)}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-right font-mono font-bold">฿${formatBahtCurrency(item.lineTotal || 0)}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-right font-mono text-emerald-700">฿${formatBahtCurrency(item.lineTotal || 0)}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-right font-mono font-bold text-slate-800">฿0.00</td>
          </tr>
        `)
      } else {
        // STANDARD_BILL / CONTRACT / QUOTATION
        rowsHtml.push(`
          <tr class="h-[18px] border-b border-slate-300 text-[8.5px]">
            <td class="border-x border-slate-300 px-1 py-0.5 text-center font-mono">${rowNum}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 font-bold truncate max-w-[190px]">${escapeDocumentHtml(item.name)}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-center font-mono font-bold">${item.quantity ?? 1}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-center">${escapeDocumentHtml(item.unit || 'ชิ้น')}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-right font-mono">฿${formatBahtCurrency(item.price ?? 0)}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-center font-mono text-slate-600">${escapeDocumentHtml(item.rentalType === 'DAILY' ? `${item.billableDays || 1} วัน` : '1 รอบ')}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5 text-right font-mono font-bold">฿${formatBahtCurrency(item.lineTotal ?? ((item.price ?? 0) * (item.quantity ?? 1)))}</td>
          </tr>
        `)
      }
    } else {
      // Empty Blank Row
      if (tableType === 'DELIVERY') {
        rowsHtml.push(`
          <tr class="h-[18px] border-b border-slate-200 text-[8.5px] bg-white">
            <td class="border-x border-slate-300 px-1 py-0.5 text-center font-mono text-slate-300">${rowNum}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
          </tr>
        `)
      } else if (tableType === 'CHECK_DISPATCH' || tableType === 'CHECK_RETURN') {
        rowsHtml.push(`
          <tr class="h-[18px] border-b border-slate-200 text-[8.5px] bg-white">
            <td class="border-x border-slate-300 px-1 py-0.5 text-center font-mono text-slate-300">${rowNum}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
          </tr>
        `)
      } else if (tableType === 'RETURN') {
        rowsHtml.push(`
          <tr class="h-[18px] border-b border-slate-200 text-[8.5px] bg-white">
            <td class="border-x border-slate-300 px-1 py-0.5 text-center font-mono text-slate-300">${rowNum}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
          </tr>
        `)
      } else if (tableType === 'STATEMENT') {
        rowsHtml.push(`
          <tr class="h-[18px] border-b border-slate-200 text-[8.5px] bg-white">
            <td class="border-x border-slate-300 px-1 py-0.5 text-center font-mono text-slate-300">${rowNum}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
          </tr>
        `)
      } else {
        rowsHtml.push(`
          <tr class="h-[18px] border-b border-slate-200 text-[8.5px] bg-white">
            <td class="border-x border-slate-300 px-1 py-0.5 text-center font-mono text-slate-300">${rowNum}</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
            <td class="border-r border-slate-300 px-1.5 py-0.5">&nbsp;</td>
          </tr>
        `)
      }
    }
  }

  return rowsHtml.join('')
}

export function renderDocumentTemplate(
  templateSchema: string,
  customerSnapshot?: Partial<CustomerSnapshot> | null,
  docNo: string = 'DOC-PREVIEW-001',
  createdDate: string = new Date().toISOString().split('T')[0],
  customTerms: string = '',
  businessSettings?: Partial<BusinessSettings> | null,
  billSnapshot?: Partial<BillRenderSnapshot> | null,
  rawItems?: CustomerDocumentItem[]
): string {
  if (!templateSchema) return ''

  const cust = customerSnapshot || {}
  const biz = businessSettings || {}
  const bill = billSnapshot || {}

  let html = templateSchema

  const replace = (pattern: RegExp, value: unknown) => {
    html = html.replace(pattern, escapeDocumentHtml(value))
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
  replace(/\{\{\s*business\.authorized_person\s*\}\}/g, fallbackBizSigner)
  replace(/\{\{\s*business\.bank_name\s*\}\}/g, fallbackBankName)
  replace(/\{\{\s*business\.bank_account_name\s*\}\}/g, fallbackAccountName)
  replace(/\{\{\s*business\.bank_account_number\s*\}\}/g, fallbackAccountNumber)
  replace(/\{\{\s*business\.promptpay\s*\}\}/g, fallbackPromptPay)
  replace(/\{\{\s*business\.logo_url\s*\}\}/g, biz.logoDataUrl || biz.logoUrl || '')
  replace(/\{\{\s*business\.qr_url\s*\}\}/g, biz.bankQrDataUrl || '')

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
  replace(/\{\{\s*document\.site_name\s*\}\}/g, bill.siteName || cust.address || 'ตามที่อยู่ลูกค้า')
  replace(/\{\{\s*document\.custom_terms\s*\}\}/g, customTerms || '')
  replace(
    /\{\{\s*document\.check_stage\s*\}\}/g,
    bill.checkStage === 'RETURN' ? 'ตรวจเช็กตอนเก็บคืน' : 'ตรวจเช็กตอนส่ง'
  )
  const checkColumns = bill.checkStage === 'RETURN'
    ? ['จำนวนส่งมอบ', 'รับคืนปกติ', 'ชำรุด/ไม่พร้อมใช้', 'สูญหาย', 'คงค้างคืน']
    : ['จำนวนตามบิล', 'ส่งแล้ว', 'คงส่ง', 'หน่วย', 'รหัสสินค้า']
  checkColumns.forEach((label, index) => {
    replace(new RegExp(`\\{\\{\\s*document\\.check_col_${index + 1}\\s*\\}\\}`, 'g'), label)
  })

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
  replace(/\{\{\s*bill\.late_fee\s*\}\}/g, formatBahtCurrency(bill.lateFee ?? 0))
  replace(/\{\{\s*bill\.damage_fee\s*\}\}/g, formatBahtCurrency(bill.damageFee ?? 0))
  replace(/\{\{\s*bill\.payment_method\s*\}\}/g, bill.paymentMethod || '')

  // Dynamic 20-row table injection if tags are present
  const itemsForTable = bill.items || (rawItems ? rawItems.map(i => ({
    name: i.productName,
    quantity: i.quantity,
    unit: i.unit,
    price: i.normalPrice,
    lineTotal: (i.normalPrice || 0) * (i.quantity || 1)
  })) : [])

  if (html.includes('{{items.rows_quotation_16}}')) {
    html = html.replace(/\{\{\s*items\.rows_quotation_16\s*\}\}/g, generateQuotationRowsHtml(itemsForTable))
  }
  if (html.includes('{{items.rows_standard_20}}')) {
    html = html.replace(/\{\{\s*items\.rows_standard_20\s*\}\}/g, generate20ItemRowsHtml(itemsForTable, 'STANDARD_BILL'))
  }
  if (html.includes('{{items.rows_delivery_20}}')) {
    html = html.replace(/\{\{\s*items\.rows_delivery_20\s*\}\}/g, generate20ItemRowsHtml(itemsForTable, 'DELIVERY'))
  }
  if (html.includes('{{items.rows_check_20}}')) {
    const tableType = bill.checkStage === 'RETURN' ? 'CHECK_RETURN' : 'CHECK_DISPATCH'
    html = html.replace(/\{\{\s*items\.rows_check_20\s*\}\}/g, generate20ItemRowsHtml(itemsForTable, tableType))
  }

  if (bill.outstandingAmount === undefined || bill.outstandingAmount === null) {
    html = html.replace(/<div data-requires-outstanding[^>]*>[\s\S]*?<\/div>/, '')
  }
  if (html.includes('{{items.rows_return_20}}')) {
    html = html.replace(/\{\{\s*items\.rows_return_20\s*\}\}/g, generate20ItemRowsHtml(itemsForTable, 'RETURN'))
  }
  if (html.includes('{{items.rows_statement_20}}')) {
    html = html.replace(/\{\{\s*items\.rows_statement_20\s*\}\}/g, generate20ItemRowsHtml(itemsForTable, 'STATEMENT'))
  }

  return sanitizeDocumentHtml(html)
}
