import { refreshSharedTemplates } from '@/features/documents/services/template-library-storage'
import { MAIN_BILL_FORM_NAME, pickBillFormTemplate, printBillForm } from '@/features/documents/utils/transaction-print'
import type { DocumentTemplate } from '@/lib/types/document'
import type { FullBill } from '@/lib/types/rental-return'
import type { BusinessSettings } from '@/features/settings/types/settings-page.types'
import { isNoChargeBillLine } from '@/features/pos/services/accessory-rules'

/**
 * A bill as the shop's forms take it (จัดการเอกสาร › แบบฟอร์มบิล). Every bill is printed on a shop form;
 * the shop details come from Settings → ข้อมูลร้าน when the form is filled.
 */
export interface BillTemplateData {
  customerName: string
  customerAddress?: string
  customerPhone?: string
  customerTaxId?: string
  billNo: string
  billDate: string
  headerRentalDate?: string
  headerReturnDate?: string
  siteName?: string
  items: Array<{
    code?: string
    name: string
    quantity: number
    unit: string
    price: number
    rentalType: 'NORMAL' | 'DAILY' | 'SALE'
    usageCount?: number
    billableDays?: number
    dailyStartDate?: string
    dailyEndDate?: string
    lineTotal: number
    /** A rental the shop does not charge for: the form prints "-" for ราคา / การเช่า / จำนวนเงิน. */
    isNoCharge?: boolean
  }>
  subtotal: number
  discount: number
  shippingFee: number
  taxAmount: number
  /** VAT rate of this bill in percent (e.g. 7); unknown = no rate shown. */
  vatRatePercent?: number
  depositAmount: number
  grandTotal: number
  paidAmount: number
  outstandingAmount: number
  remark?: string
}

/** Days billed on a per-day line, read back from the server's line total. */
const billedDays = (item: FullBill['items'][number]): number | undefined => {
  const perDay = item.quantity * item.dailyRate
  if (item.rentalType !== 'DAILY' || !item.lineTotal || perDay <= 0) return undefined
  return Math.max(1, Math.round(item.lineTotal / perDay))
}

const templateRentalType = (type: FullBill['items'][number]['rentalType'], itemType?: string): 'NORMAL' | 'DAILY' | 'SALE' => {
  if (type === 'SALE' || itemType === 'SALE') return 'SALE'
  return type === 'DAILY' ? 'DAILY' : 'NORMAL'
}

/** A saved bill's "ไม่คิดเงิน" line: the product's rental method has no charge (see isNoChargeBillLine). */
const isNoChargeLine = (item: FullBill['items'][number]) =>
  item.itemType !== 'SALE' && isNoChargeBillLine({ ...item, isNoCharge: item.isChargeable === false ? true : undefined })

/** A saved bill (bills cache) as the form's data. */
export function fullBillToTemplateData(bill: FullBill): BillTemplateData {
  return {
    customerName: bill.customerName,
    customerAddress: bill.customerAddress,
    customerPhone: bill.customerPhone,
    billNo: bill.billNo,
    billDate: bill.billDate,
    headerRentalDate: bill.rentalStartDate,
    headerReturnDate: bill.scheduledReturnDate,
    siteName: bill.siteName,
    items: bill.items.map((item) => ({
      code: item.productCode,
      name: item.productName,
      quantity: item.quantity,
      unit: item.unit,
      price: item.dailyRate,
      rentalType: templateRentalType(item.rentalType, item.itemType),
      usageCount: item.usageCount,
      billableDays: billedDays(item),
      dailyStartDate: item.rentalStartDate,
      dailyEndDate: item.scheduledReturnDate,
      lineTotal: item.lineTotal ?? item.quantity * item.dailyRate,
      isNoCharge: isNoChargeLine(item),
    })),
    subtotal: bill.subtotal ?? bill.grandTotal,
    discount: bill.discountAmount ?? 0,
    shippingFee: bill.shippingFee ?? 0,
    taxAmount: bill.taxAmount ?? 0,
    vatRatePercent: bill.vatRatePercent,
    // The deposit agreed on the bill: received + still owed (the owed part is also in outstandingAmount)
    depositAmount: (bill.heldDepositAmount ?? bill.paidDepositAmount ?? 0) + (bill.depositOutstanding ?? 0),
    grandTotal: bill.grandTotal,
    paidAmount: bill.paidAmount,
    outstandingAmount: bill.outstandingAmount,
    remark: bill.remark,
  }
}

/** Reads the shop's forms and returns the main bill form (undefined = the shop has none usable). */
export async function loadMainBillForm(): Promise<DocumentTemplate | undefined> {
  return pickBillFormTemplate(await refreshSharedTemplates(), MAIN_BILL_FORM_NAME)
}

/** Shown when a bill cannot be printed because the shop's main bill form is missing. */
export const MAIN_BILL_FORM_MISSING = `ไม่พบแบบฟอร์มของ "${MAIN_BILL_FORM_NAME}" กรุณาเพิ่มที่เมนูจัดการเอกสาร`

/** A saved bill printed again on the shop's main bill form; false when there is no form or nothing to print. */
export async function printSavedBill(bill: FullBill, business: Partial<BusinessSettings> | undefined): Promise<boolean> {
  const form = await loadMainBillForm()
  return form ? printBillForm(fullBillToTemplateData(bill), business || {}, form) : false
}
