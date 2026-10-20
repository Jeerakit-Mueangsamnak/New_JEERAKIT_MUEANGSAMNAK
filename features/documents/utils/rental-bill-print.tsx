'use client'

import React from 'react'
import { RentalBillTemplate, type BillTemplateData } from '@/templates/rental-bill/RentalBillTemplate'
import { printReactDocuments } from '@/lib/print/print-react'
import type { FullBill } from '@/lib/types/rental-return'
import type { BusinessSettings } from '@/features/settings/types/settings-page.types'

/**
 * The one A4 rental-bill document: checkout, the bills list and the customer page all print and
 * preview through RentalBillTemplate, so a bill looks the same wherever it is printed.
 */

/** Shop details for the bill header — from Settings → ข้อมูลร้าน only (never made-up values). */
export function billBusinessFields(business: Partial<BusinessSettings> | undefined) {
  return {
    businessName: business?.businessName || '',
    businessAddress: business?.address || '',
    businessTaxId: business?.taxId || '',
    businessPhone: business?.phone || '',
  }
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

/** A saved bill (bills cache) as the template's data. */
export function fullBillToTemplateData(bill: FullBill, business: Partial<BusinessSettings> | undefined): BillTemplateData {
  return {
    ...billBusinessFields(business),
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
    })),
    subtotal: bill.subtotal ?? bill.grandTotal,
    discount: bill.discountAmount ?? 0,
    shippingFee: bill.shippingFee ?? 0,
    taxAmount: bill.taxAmount ?? 0,
    depositAmount: bill.heldDepositAmount ?? bill.paidDepositAmount ?? 0,
    grandTotal: bill.grandTotal,
    paidAmount: bill.paidAmount,
    outstandingAmount: bill.outstandingAmount,
    remark: bill.remark,
  }
}

export function printRentalBillDocument(data: BillTemplateData): boolean {
  return printReactDocuments([<RentalBillTemplate key={data.billNo} data={data} />], data.billNo)
}

export function printRentalBillA4(bill: FullBill, business: Partial<BusinessSettings> | undefined): boolean {
  return printRentalBillDocument(fullBillToTemplateData(bill, business))
}
