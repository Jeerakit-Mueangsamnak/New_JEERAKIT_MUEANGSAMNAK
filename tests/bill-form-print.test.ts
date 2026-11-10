import { describe, expect, it } from 'vitest'
import {
  billFormDocumentNames,
  isBillFormTemplate,
  pickBillFormTemplate,
  pickQuotationPrintTemplate,
  renderBillFormPagesHtml,
  renderQuotationA4PagesHtml,
  renderReturnFormPagesHtml,
  type ReturnFormData,
  FINE_FORM_NAME,
  fineFormTotals,
  renderFineFormPagesHtml,
  type FineFormData,
} from '@/features/documents/utils/transaction-print'
import type { DocumentName } from '@/features/documents/api/template-library-repository'
import type { Quotation } from '@/lib/types/rental-pos'
import type { DocumentTemplate } from '@/lib/types/document'
import type { BillTemplateData } from '@/features/documents/utils/rental-bill-print'
import { renderDocumentTemplate } from '@/features/documents/utils/documentRenderer'

// A shop form that draws its own 20 item rows, like the JEERAKIT ใบส่งของ/ใบเสร็จรับเงิน.
const rows = Array.from({ length: 20 }, (_, i) =>
  `<tr><td>{{items.${i + 1}.no}}</td><td>{{items.${i + 1}.name}}</td><td>{{items.${i + 1}.quantity}}</td><td>{{items.${i + 1}.unit}}</td><td>{{items.${i + 1}.price}}</td><td>{{items.${i + 1}.rental}}</td><td>{{items.${i + 1}.amount}}</td></tr>`
).join('')
const schema = `<div><span>{{document.number}}</span><span>{{document.date}}</span><span>{{document.rental_end_date}}</span>`
  + `<table><tbody>${rows}</tbody></table>`
  + `<span id="sub">{{bill.subtotal}}</span><span id="dep">{{bill.deposit_amount}}</span><span id="due">{{bill.total_payable}}</span>`
  + `<span id="words">({{bill.total_payable_text}})</span><span id="page">{{document.page}}</span></div>`

const form = (over: Partial<DocumentTemplate> = {}): DocumentTemplate => ({
  id: 'tpl-1',
  name: 'ใบส่งของ/ใบเสร็จรับเงิน',
  category: 'ใบส่งของ/ใบเสร็จรับเงิน',
  targetGroup: 'BILL',
  source: 'CONVERTED_IMPORT',
  fileType: 'HTML',
  templateSchema: schema,
  paperSize: 'A4',
  orientation: 'PORTRAIT',
  pageCount: 1,
  version: 1,
  isDefault: false,
  ...over,
}) as DocumentTemplate

const bill = (itemCount: number): BillTemplateData => ({
  customerName: 'ลูกค้า ก', billNo: 'B-001', billDate: '2026-11-07', headerRentalDate: '2026-11-07', headerReturnDate: '2026-11-20',
  items: Array.from({ length: itemCount }, (_, i) => ({
    name: `สินค้า ${i + 1}`, quantity: 2, unit: 'ชิ้น', price: 10,
    rentalType: i === 0 ? 'DAILY' : 'NORMAL', usageCount: 3, billableDays: 5, lineTotal: 60,
  })),
  subtotal: 1000, discount: 0, shippingFee: 0, taxAmount: 0, depositAmount: 500, grandTotal: 1000.1,
  paidAmount: 0, outstandingAmount: 1000.1,
})

describe('บิลพิมพ์ด้วยแบบฟอร์มของร้าน (POS › ประเภทเอกสาร)', () => {
  it('ยอดที่ต้องชำระ = ยอดบิล + ค่ามัดจำ เหมือนหน้าชำระเงิน และตัวอักษรตรงกัน', () => {
    const [page] = renderBillFormPagesHtml(bill(3), {}, form())
    expect(page).toContain('<span id="due">1,500.10</span>')
    expect(page).toContain('<span id="dep">500.00</span>')
    expect(page).toContain('หนึ่งพันห้าร้อยบาทสิบสตางค์')
    expect(page).not.toContain('(หนึ่งพันห้าร้อยบาทสิบสตางค์)')
    expect(page).toContain('<span id="page">1/1</span>')
    expect(page).toContain('7 พฤศจิกายน 2569')
    expect(page).toContain('20 พฤศจิกายน 2569')
  })

  it('เติมรายการลงช่องของฟอร์มเอง: ลำดับ ชื่อ จำนวน หน่วย ราคา การเช่า จำนวนเงิน แถวที่ไม่มีของเว้นว่าง', () => {
    const [page] = renderBillFormPagesHtml(bill(2), {}, form())
    expect(page).toContain('<tr><td>1</td><td>สินค้า 1</td><td>2</td><td>ชิ้น</td><td>10.00</td><td>5 วัน</td><td>60.00</td></tr>')
    expect(page).toContain('<tr><td>2</td><td>สินค้า 2</td><td>2</td><td>ชิ้น</td><td>10.00</td><td>3 รอบ</td><td>60.00</td></tr>')
    expect(page).toContain('<tr><td>3</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>')
    expect(page).not.toContain('{{')
  })

  it('สินค้าวิธีคิดราคา "ไม่คิดเงิน" (owner 2026-11-09): แสดงเฉพาะจำนวนและหน่วย ราคา/หน่วย การเช่า และจำนวนเงินเป็น "-"', () => {
    const data = bill(2)
    data.items[1] = { ...data.items[1], name: 'น็อต 12นิ้ว', price: 0, lineTotal: 0, isNoCharge: true, unit: 'ตัว' }
    const [page] = renderBillFormPagesHtml(data, {}, form())
    expect(page).toContain('<tr><td>2</td><td>น็อต 12นิ้ว</td><td>2</td><td>ตัว</td><td>-</td><td>-</td><td>-</td></tr>')
    // a charged line of the same bill keeps its figures
    expect(page).toContain('<tr><td>1</td><td>สินค้า 1</td><td>2</td><td>ชิ้น</td><td>10.00</td><td>5 วัน</td><td>60.00</td></tr>')
  })

  it('สินค้าเช่ารายวัน: ต่อท้ายชื่อด้วยวันเริ่มเช่าและกำหนดคืน (วัน เดือนย่อ พ.ศ.)', () => {
    const data = bill(2)
    data.items[0] = { ...data.items[0], name: 'นั่งร้าน 1.7(ชุด)', dailyStartDate: '2026-11-09', dailyEndDate: '2026-11-15' }
    data.items[1] = { ...data.items[1], dailyStartDate: '2026-11-09', dailyEndDate: '2026-11-15' }
    const [page] = renderBillFormPagesHtml(data, {}, form())
    expect(page).toContain('<td>นั่งร้าน 1.7(ชุด)(เริ่มเช่า 9 พ.ย. 2569 กำหนดคืน 15 พ.ย. 2569)</td>')
    expect(page).toContain('<td>สินค้า 2</td>')
  })

  it('จัดการหมายเหตุ ผู้ลงนาม เลขบัญชี โลโก้ และวงเล็บยอดเงินภาษาไทยในแบบฟอร์มบิล', () => {
    const html = renderDocumentTemplate(
      '<div><img src="{{business.logo_url}}" style="display:block;width:100%;height:auto;max-height:125px;object-fit:contain;">'
        + '<div>{{document.custom_terms}}</div><span>{{business.bank_name}}</span><span>{{business.bank_account_number}}</span>'
        + '<span>{{business.authorized_person}}</span><b>({{bill.total_payable_text}})</b></div>',
      {},
      'B-001',
      '10 พ.ย. 2569',
      'บรรทัดแรก\nบรรทัดสอง',
      {
        bankName: 'ธนาคารตัวอย่าง',
        bankAccountNumber: '123-456-7890',
        authorizedPerson: 'ผู้มีอำนาจลงนาม',
        logoUrl: '/shop-logo.png',
      },
      { grandTotal: 1250, totalPayable: 1250 }
    )

    expect(html).toContain('max-height:150px !important')
    expect(html).toContain('white-space:pre-line')
    expect(html).toContain('line-height:1.45')
    expect(html).toContain('white-space:nowrap')
    expect(html).toContain('overflow-wrap:anywhere')
    expect(html).toContain('<b>หนึ่งพันสองร้อยห้าสิบบาทถ้วน</b>')
    expect(html).not.toContain('(หนึ่งพันสองร้อยห้าสิบบาทถ้วน)')
  })

  it('คอลัมน์ จำนวน หน่วย การเช่า: กว้างเท่าหัวตาราง ข้อความอยู่กลาง ส่วนที่เหลือไปที่รายการ', () => {
    const th = (w: number, text: number, label: string) =>
      `<th style="text-align:center; width:${w}px; padding-left:4px; padding-right:4px"><span style="display:inline-block; width:${text}px">${label}</span></th>`
    const td = (w: number, field: string) =>
      `<td style="text-align:right; width:${w}px; padding-left:4px; padding-right:4px"><span style="display:block; width:${w - 8}px; max-width:100%">{{items.1.${field}}}</span></td>`
    const head = `<tr>${th(40, 20, 'ลำดับ')}${th(280, 30, 'รายการ')}${th(64, 30, 'จำนวน')}${th(60, 25, 'หน่วย')}${th(80, 25, 'ราคา')}${th(94, 40, 'การเช่า')}${th(128, 50, 'จำนวนเงิน')}</tr>`
    const body = `<tr>${td(40, 'no')}${td(280, 'name')}${td(64, 'quantity')}${td(60, 'unit')}${td(80, 'price')}${td(94, 'rental')}${td(128, 'amount')}</tr>`
    const [page] = renderBillFormPagesHtml(bill(1), {}, form({ templateSchema: `<div>{{document.number}}<table><thead>${head}</thead><tbody>${body}</tbody></table></div>` }))
    // จำนวน 30+8+8 = 46, หน่วย 25+16 = 41, การเช่า 40+16 = 56 → รายการ ได้เพิ่ม 18+19+38 = 75
    expect(page).toContain('<td style="text-align:center; width:46px; padding-left:4px; padding-right:4px"><span style="display:block; width:38px; max-width:100%">2</span></td>')
    expect(page).toContain('<td style="text-align:center; width:41px;')
    expect(page).toContain('<td style="text-align:center; width:56px;')
    expect(page).toContain('<th style="text-align:center; width:355px;')
    expect(page).toContain('<td style="text-align:right; width:355px; padding-left:4px; padding-right:4px"><span style="display:block; width:347px;')
    // ราคา และ จำนวนเงิน คงเดิม
    expect(page).toContain('<td style="text-align:right; width:80px;')
    expect(page).toContain('<td style="text-align:right; width:128px;')
  })

  it('เกิน 20 รายการ: หน้าใหม่บนฟอร์มเดิม ลำดับต่อกัน ยอดเงินอยู่หน้าสุดท้ายเท่านั้น', () => {
    const pages = renderBillFormPagesHtml(bill(25), {}, form())
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain('<span id="page">1/2</span>')
    expect(pages[0]).toContain('<span id="due"></span>')
    expect(pages[0]).toContain('<span id="words"></span>')
    expect(pages[1]).toContain('<tr><td>21</td><td>สินค้า 21</td>')
    expect(pages[1]).toContain('<span id="due">1,500.10</span>')
    expect(pages[1]).toContain('<span id="page">2/2</span>')
  })

  it('ใบเสนอราคาแบบฟอร์มร้าน: ยอดที่ต้องชำระรวมมัดจำ', () => {
    const qForm = form({ id: 'tpl-q', name: 'ใบเสนอราคา', category: 'ใบเสนอราคา' })
    expect(pickQuotationPrintTemplate([form(), qForm])?.id).toBe('tpl-q')
    const q = {
      id: 'q1', quotationNo: 'QT-1', quotationDate: '2026-11-07', customerId: 'c1', customerName: 'ลูกค้า ก', phone: '081', customerAddress: '', customerTaxId: '',
      items: [{ productName: 'แบบคาน', quantity: 4, unitName: 'แผ่น', unitPrice: 10, rentalType: 'NORMAL', usageCountOrDays: 3 }],
      subtotal: 120, discountAmount: 0, shippingFee: 0, taxAmount: 0, depositAmount: 500, grandTotal: 120, vatEnabled: false,
    } as unknown as Quotation
    const [page] = renderQuotationA4PagesHtml(q, {}, qForm)
    expect(page).toContain('<tr><td>1</td><td>แบบคาน</td><td>4</td><td>แผ่น</td><td>10.00</td><td>3 รอบ</td><td>120.00</td></tr>')
    expect(page).toContain('<span id="due">620.00</span>')
    expect(page).toContain('QT-1')
  })

  it('สถานที่จัดส่ง: ใช้เฉพาะที่พิมพ์ในบิล ไม่ดึงที่อยู่ลูกค้ามาใส่', () => {
    const t = form({ templateSchema: '<div>{{document.number}}<span id="site">{{document.site_name}}</span></div>' })
    const withAddress = { ...bill(1), customerAddress: '99 ถนนลูกค้า' }
    expect(renderBillFormPagesHtml(withAddress, {}, t)[0]).toContain('<span id="site"></span>')
    expect(renderBillFormPagesHtml({ ...withAddress, siteName: ' หน้างาน <A> ' }, {}, t)[0]).toContain('<span id="site">หน้างาน &lt;A&gt;</span>')
  })

  it('ใช้ได้เฉพาะฟอร์มแท็บแบบฟอร์มบิลที่มีช่องข้อมูล (PDF ที่เป็นภาพทั้งหน้าใช้ไม่ได้)', () => {
    expect(isBillFormTemplate(form())).toBe(true)
    expect(isBillFormTemplate(form({ templateSchema: '<div><img src="x" alt="หน้า 1"></div>' }))).toBe(false)
    expect(isBillFormTemplate(form({ targetGroup: 'CUSTOMER' }))).toBe(false)
  })

  it('เลือกฟอร์มตามชื่อเอกสาร: ตัวที่ตั้งเป็นค่าเริ่มต้นก่อน ไม่งั้นตัวใหม่สุด', () => {
    const newest = form({ id: 'tpl-new' })
    const older = form({ id: 'tpl-old' })
    expect(pickBillFormTemplate([newest, older], 'ใบส่งของ/ใบเสร็จรับเงิน')?.id).toBe('tpl-new')
    expect(pickBillFormTemplate([newest, form({ id: 'tpl-def', isDefault: true })], 'ใบส่งของ/ใบเสร็จรับเงิน')?.id).toBe('tpl-def')
    expect(pickBillFormTemplate([newest], 'บิลเช่า/ขาย')).toBeUndefined()
    expect(pickBillFormTemplate([newest], '')).toBeUndefined()
  })

  it('ดร็อปดาวน์ตะกร้า: เฉพาะชื่อในแท็บแบบฟอร์มบิลที่มีฟอร์มพิมพ์ได้', () => {
    const names = [
      { id: '1', targetGroup: 'BILL' as const, name: 'ใบส่งของ/ใบเสร็จรับเงิน' },
      { id: '2', targetGroup: 'BILL' as const, name: 'ใบแจ้งหนี้' },
      { id: '3', targetGroup: 'CUSTOMER' as const, name: 'สัญญาเช่า' },
    ]
    expect(billFormDocumentNames(names, [form()])).toEqual(['ใบส่งของ/ใบเสร็จรับเงิน'])
    // ใบรับคืนบางส่วน / ใบเช็คของ are printed from จัดการบิล, never offered in the POS cart
    const billPageNames = [
      { id: '4', targetGroup: 'BILL' as const, name: 'ใบรับคืนบางส่วน' },
      { id: '5', targetGroup: 'BILL' as const, name: 'ใบเช็คของ' },
    ]
    const billPageForms = billPageNames.map((n) => form({ id: `tpl-${n.id}`, name: n.name, category: n.name }))
    expect(billFormDocumentNames(billPageNames, billPageForms)).toEqual([])
  })
})

describe('ใบรับคืนบางส่วน (แบบฟอร์มร้าน, เอกสารเดียวรวมการชำระเงิน)', () => {
  const returnRows = Array.from({ length: 20 }, (_, i) =>
    `<tr><td>{{items.${i + 1}.no}}</td><td>{{items.${i + 1}.name}}</td><td>{{items.${i + 1}.returned}}</td><td>{{items.${i + 1}.normal}}</td><td>{{items.${i + 1}.damaged}}</td><td>{{items.${i + 1}.lost}}</td><td>{{items.${i + 1}.damage_fee}}</td></tr>`
  ).join('')
  const returnForm = form({
    id: 'tpl-ret', name: 'ใบรับคืนบางส่วน', category: 'ใบรับคืนบางส่วน',
    templateSchema: `<div><span id="no">{{document.number}}</span><span id="date">{{document.date}}</span><span id="due-date">{{document.rental_end_date}}</span><table><tbody>${returnRows}</tbody></table>`
      + `<span id="rent">{{return.rent}}</span><span id="damage">{{return.damage}}</span><span id="paid">{{return.paid_before}}</span>`
      + `<span id="dep">{{return.deposit_applied}}</span><span id="due">{{return.total_payable}}</span><span id="got">{{return.collected}}</span>`
      + `<span id="words">({{return.total_payable_text}})</span><span id="page">{{document.page}}</span></div>`,
  })
  const data = (itemCount: number): ReturnFormData => ({
    slipNo: 'RT-001', returnDate: '2026-11-19', scheduledReturnDate: '2026-11-20', rentalStartDate: '2026-11-07',
    customerName: 'ลูกค้า ก',
    items: Array.from({ length: itemCount }, (_, i) => ({ name: `สินค้า ${i + 1}`, returnedQty: 10, normalQty: 7, damagedQty: 2, lostQty: 1, damageFee: 450 })),
    rentFee: 2400, damageFee: 450, paidBefore: 1000, depositApplied: 500, collected: 1350,
  })

  it('ตาราง: ลำดับ รายการ คืนครั้งนี้ ปกติ ชำรุด หาย ค่าเสียหาย; ยอด: ค่าเช่า ค่าเสียหาย ชำระแล้ว หักมัดจำ ยอดที่ต้องชำระ รับชำระครั้งนี้', () => {
    const [page] = renderReturnFormPagesHtml(data(1), {}, returnForm)
    expect(page).toContain('<tr><td>1</td><td>สินค้า 1</td><td>10</td><td>7</td><td>2</td><td>1</td><td>450.00</td></tr>')
    expect(page).toContain('<tr><td>2</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>')
    expect(page).toContain('<span id="rent">2,400.00</span>')
    expect(page).toContain('<span id="damage">450.00</span>')
    expect(page).toContain('<span id="paid">1,000.00</span>')
    expect(page).toContain('<span id="dep">500.00</span>')
    // ยอดที่ต้องชำระ = 2,400 + 450 − 1,000 − 500
    expect(page).toContain('<span id="due">1,350.00</span>')
    expect(page).toContain('<span id="got">1,350.00</span>')
    expect(page).toContain('หนึ่งพันสามร้อยห้าสิบบาทถ้วน')
    expect(page).not.toContain('(หนึ่งพันสามร้อยห้าสิบบาทถ้วน)')
    expect(page).toContain('<span id="no">RT-001</span>')
    expect(page).toContain('<span id="date">19 พฤศจิกายน 2569</span>')
    expect(page).toContain('<span id="due-date">20 พฤศจิกายน 2569</span>')
    expect(page).not.toContain('{{')
  })

  it('ยอดที่ต้องชำระไม่ติดลบ เมื่อชำระไว้เกินแล้ว', () => {
    const [page] = renderReturnFormPagesHtml({ ...data(1), paidBefore: 5000, collected: 0 }, {}, returnForm)
    expect(page).toContain('<span id="due">0.00</span>')
  })

  it('เกิน 20 รายการ: ต่อหน้าใหม่บนฟอร์มเดิม ลำดับต่อกัน ยอดเงินอยู่หน้าสุดท้าย', () => {
    const pages = renderReturnFormPagesHtml(data(21), {}, returnForm)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain('<span id="rent"></span>')
    expect(pages[0]).toContain('<span id="words"></span>')
    expect(pages[0]).toContain('<span id="page">1/2</span>')
    expect(pages[1]).toContain('<tr><td>21</td><td>สินค้า 21</td><td>10</td>')
    expect(pages[1]).toContain('<span id="due">1,350.00</span>')
  })
})

describe('ใบชำระค่าปรับ (สินค้าหาย / ชำรุด ตอนรับคืน)', () => {
  const fineRows = Array.from({ length: 20 }, (_, i) =>
    `<tr><td>{{items.${i + 1}.no}}</td><td>{{items.${i + 1}.name}}</td><td>{{items.${i + 1}.delivered}}</td><td>{{items.${i + 1}.normal}}</td><td>{{items.${i + 1}.lost}}</td><td>{{items.${i + 1}.damaged}}</td><td>{{items.${i + 1}.fine_rate}}</td><td>{{items.${i + 1}.fine}}</td></tr>`
  ).join('')
  const fineForm = form({
    id: 'tpl-fine', name: FINE_FORM_NAME, category: FINE_FORM_NAME,
    templateSchema: `<div>{{document.number}}<table><tbody>${fineRows}</tbody></table>`
      + '<b id="d">{{fine.damage}}</b><b id="l">{{fine.lost}}</b><b id="t">{{fine.total}}</b><i>({{fine.total_text}})</i><span id="page">{{document.page}}</span></div>',
  })
  const fineData = (lines: FineFormData['lines']): FineFormData => ({ slipNo: 'RT-1', returnDate: '2026-11-09', customerName: 'ลูกค้า ก', lines })
  const line = (over: Partial<FineFormData['lines'][number]> = {}) => ({
    name: 'แบบเสา', deliveredQty: 10, normalQty: 6, damagedQty: 0, lostQty: 0, repairFeePerUnit: 100, replacementFeePerUnit: 500, ...over,
  })

  it('หนึ่งแถวต่อประเภทค่าปรับ: ชำรุดและหายของรายการเดียวกันแยกแถว อัตราของแต่ละแถวตรงกับประเภท', () => {
    const [page] = renderFineFormPagesHtml(fineData([line({ damagedQty: 2, lostQty: 1 }), line({ name: 'ข้อต่อ', deliveredQty: 4, normalQty: 4 })]), {}, fineForm)
    expect(page).toContain('<tr><td>1</td><td>แบบเสา</td><td>10</td><td>6</td><td></td><td>2</td><td>100.00</td><td>200.00</td></tr>')
    expect(page).toContain('<tr><td>2</td><td>แบบเสา</td><td></td><td></td><td>1</td><td></td><td>500.00</td><td>500.00</td></tr>')
    expect(page).not.toContain('ข้อต่อ')
    expect(page).toContain('<b id="d">200.00</b><b id="l">500.00</b><b id="t">700.00</b><i>เจ็ดร้อยบาทถ้วน</i>')
  })

  it('ไม่มีค่าปรับ = ไม่มีหน้า; เกิน 20 แถวต่อหน้าใหม่ ยอดรวมอยู่หน้าสุดท้าย', () => {
    expect(renderFineFormPagesHtml(fineData([line()]), {}, fineForm)).toEqual([])
    const pages = renderFineFormPagesHtml(fineData(Array.from({ length: 21 }, (_, i) => line({ name: `ไม้ ${i + 1}`, lostQty: 1 }))), {}, fineForm)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain('<b id="t"></b>')
    expect(pages[1]).toContain('<tr><td>21</td><td>ไม้ 21</td>')
    expect(pages[1]).toContain('<b id="t">10,500.00</b>')
    expect(pages[1]).toContain('<span id="page">2/2</span>')
  })

  it('ยอดรวมค่าปรับตรงกับสูตรของตารางรับคืน (ชำรุด × ค่าซ่อม + หาย × ค่าทดแทน)', () => {
    expect(fineFormTotals([line({ damagedQty: 3, lostQty: 2 })])).toEqual({ damage: 300, lost: 1000, total: 1300 })
  })

  it('ใบชำระค่าปรับไม่อยู่ในรายการประเภทเอกสารของตะกร้า POS', () => {
    const names = [{ name: FINE_FORM_NAME, targetGroup: 'BILL' }, { name: 'ใบส่งของ/ใบเสร็จรับเงิน', targetGroup: 'BILL' }] as DocumentName[]
    expect(billFormDocumentNames(names, [fineForm, form()])).toEqual(['ใบส่งของ/ใบเสร็จรับเงิน'])
  })
})

describe('ที่อยู่ลูกค้ายาว + วันที่ใต้ช่องลงชื่อ (owner 2026-11-11)', () => {
  // Same shape as the shop's forms: address row, then an empty dotted line under it
  const addressForm =
    '<div style="font-size:12px; font-family:Tahoma"><div style="display:grid"><span>ที่อยู่:</span>' +
    '<span style="font-weight:400; white-space:pre; width:110px; padding-left:5px; padding-right:5px; overflow-x:hidden; text-overflow:ellipsis">{{customer.address}}</span></div>' +
    '<div style="display:grid"><span style="display:block"></span><span style="font-weight:400; width:200px; text-overflow:ellipsis"></span></div></div>'
  const lines = (html: string) =>
    Array.from(html.matchAll(/<span style="font-weight:400[^"]*">([^<]*)<\/span>/g), (m) => m[1])

  it('a long address carries on to the dotted line below, split between words, nothing lost', () => {
    const address = 'เลขที่ 4/2 หมู่ 5 ซอย - ถนน - ต.หนองหล่ม อ.ห้างฉัตร จ.ลำปาง 52190'
    const [first, second] = lines(renderDocumentTemplate(addressForm, { address }))
    expect(first.length).toBeGreaterThan(0)
    expect(second.length).toBeGreaterThan(0)
    expect(`${first} ${second}`).toBe(address)
  })

  it('a short address stays on its own line', () => {
    expect(lines(renderDocumentTemplate(addressForm, { address: 'เลขที่ 9' }))).toEqual(['เลขที่ 9', ''])
  })

  it('the floating date under a signature is centred on its box; the header date is untouched', () => {
    const html = renderDocumentTemplate(
      '<span style="width:134px; white-space:nowrap">{{document.date}}</span>' +
        '<div style="position:absolute; width:104px; white-space:nowrap; overflow:visible">วันที่ {{document.date}}</div>',
      {},
      'DOC-1',
      '11 พฤศจิกายน 2569'
    )
    expect(html).toContain('<span style="width:134px; white-space:nowrap">11 พฤศจิกายน 2569</span>')
    expect(html).toMatch(/position:\s*absolute[^"]*;\s*display:\s*flex;\s*justify-content:\s*center;\s*text-align:\s*center">วันที่ 11 พฤศจิกายน 2569<\/div>/)
  })
})