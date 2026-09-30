import { loadBills } from '@/features/bills/services/bill-storage'
import { loadQuotations } from '@/features/quotations/services/quotation-storage'
import { generateTimeBuckets, isDateInRange, toLocalDateString, type ReportDateFilter } from './report-data-common'

// 2. SALES, RENTAL & DOCUMENTS REPORT DATA (Topics 5, 6, 9, 10, 11)
// ─────────────────────────────────────────────────────────────────────────────

export interface SalesRentalReportData {
  // Topic 5: Sales
  salesRevenue: number
  salesUnits: number
  salesCount: number
  // Topic 6: Rental
  rentalRevenue: number
  rentalCount: number
  // Topic 9: Bills
  totalBillsCount: number
  totalBillsValue: number
  totalBillsPaid: number
  totalBillsOutstanding: number
  billStatusList: Array<{
    status: string
    label: string
    count: number
    amount: number
    color: string
  }>
  // Topic 10: Quotations Funnel
  totalQuotationsCount: number
  totalQuotationsValue: number
  quotationConversionRate: number
  quotationFunnel: Array<{
    stage: 'draft' | 'sent' | 'accepted' | 'converted'
    label: string
    count: number
    value: number
    percentage: number
    color: string
  }>
  // Topic 11: Active Rentals
  activeRentalsCount: number
  overdueRentalsCount: number
  activeRentals: Array<{
    id: string
    billNo: string
    customerName: string
    customerPhone?: string
    rentalStartDate: string
    scheduledReturnDate: string
    isOverdue: boolean
    daysOverdue: number
    itemsCount: number
    depositAmount: number
    grandTotal: number
    rentalStatus: string
  }>
  // Bar Chart: Sales vs Rental trend
  salesVsRentalTrend: Array<{
    label: string
    sales: number
    rental: number
    total: number
  }>
  // Detailed Table
  detailedRecords: Array<{
    id: string
    docNo: string
    type: 'BILL' | 'QUOTATION'
    subType: 'SALE' | 'RENTAL' | 'MIXED'
    date: string
    customerName: string
    customerPhone?: string
    itemsSummary: string
    amount: number
    status: string
  }>
}

export function getSalesRentalReportData(filter: ReportDateFilter): SalesRentalReportData {
  const allBills = loadBills()
  const allQuotations = loadQuotations()
  const todayStr = toLocalDateString(new Date())

  const inRangeBills = allBills.filter(
    (b) =>
      b.rentalStatus !== 'VOID' &&
      isDateInRange(b.billDate || b.rentalStartDate, filter.startDate, filter.endDate)
  )

  const inRangeQuotes = allQuotations.filter((q) =>
    isDateInRange(q.quotationDate, filter.startDate, filter.endDate)
  )

  // Topic 5 & 6: Sales vs Rental breakdown
  let salesRevenue = 0
  let salesUnits = 0
  let salesCount = 0
  let rentalRevenue = 0
  let rentalCount = 0

  let totalBillsValue = 0
  let totalBillsPaid = 0
  let totalBillsOutstanding = 0

  const statusCountMap: Record<string, { count: number; amount: number }> = {
    DRAFT: { count: 0, amount: 0 },
    RENTING: { count: 0, amount: 0 },
    PARTIAL_RETURNED: { count: 0, amount: 0 },
    RETURNED: { count: 0, amount: 0 },
    CLOSED: { count: 0, amount: 0 },
    CANCELLED: { count: 0, amount: 0 },
  }

  for (const b of inRangeBills) {
    totalBillsValue += b.grandTotal || 0
    totalBillsPaid += b.paidAmount || 0
    totalBillsOutstanding += b.outstandingAmount || 0

    const st = b.rentalStatus || 'DRAFT'
    if (statusCountMap[st]) {
      statusCountMap[st].count++
      statusCountMap[st].amount += b.grandTotal || 0
    }

    let hasSale = false
    let hasRental = false

    for (const it of b.items || []) {
      const isSale = it.rentalType === 'SALE' || it.requiresReturn === false
      const lineAmt = it.lineTotal ?? (it.quantity || 0) * (it.dailyRate || 0)

      if (isSale) {
        hasSale = true
        salesRevenue += lineAmt
        salesUnits += it.quantity || 0
      } else {
        hasRental = true
        rentalRevenue += lineAmt
      }
    }

    if (hasSale) salesCount++
    if (hasRental) rentalCount++
  }

  // Bill Status List
  const billStatusList = [
    {
      status: 'RENTING',
      label: 'กำลังเช่า',
      count: (statusCountMap.RENTING?.count || 0) + (statusCountMap.PARTIAL_RETURNED?.count || 0),
      amount: (statusCountMap.RENTING?.amount || 0) + (statusCountMap.PARTIAL_RETURNED?.amount || 0),
      color: '#3b82f6', // blue
    },
    {
      status: 'RETURNED',
      label: 'คืนครบแล้ว / ปิดบิล',
      count: (statusCountMap.RETURNED?.count || 0) + (statusCountMap.CLOSED?.count || 0),
      amount: (statusCountMap.RETURNED?.amount || 0) + (statusCountMap.CLOSED?.amount || 0),
      color: '#10b981', // green
    },
    {
      status: 'DRAFT',
      label: 'ฉบับร่าง',
      count: statusCountMap.DRAFT?.count || 0,
      amount: statusCountMap.DRAFT?.amount || 0,
      color: '#64748b', // slate
    },
    {
      status: 'CANCELLED',
      label: 'ยกเลิก',
      count: statusCountMap.CANCELLED?.count || 0,
      amount: statusCountMap.CANCELLED?.amount || 0,
      color: '#ef4444', // red
    },
  ]

  // Topic 10: Quotations Funnel (ร่าง → ส่ง → ยืนยัน → เป็นบิล)
  let quoteDraft = 0
  let quoteSent = 0
  let quoteAccepted = 0
  let quoteConverted = 0
  let totalQuoteValue = 0

  for (const q of inRangeQuotes) {
    const val = q.grandTotal || 0
    totalQuoteValue += val
    if (q.status === 'DRAFT') quoteDraft++
    else if (q.status === 'SENT' || q.status === 'WAITING') quoteSent++
    else if (q.status === 'ACCEPTED') quoteAccepted++
    else if (q.status === 'CONVERTED') quoteConverted++
  }

  const totalQuotes = inRangeQuotes.length
  const quotationConversionRate = totalQuotes > 0 ? Math.round((quoteConverted / totalQuotes) * 100) : 0

  const quotationFunnel = [
    {
      stage: 'draft' as const,
      label: '1. ร่างใบเสนอราคา',
      count: quoteDraft,
      value: inRangeQuotes.filter((q) => q.status === 'DRAFT').reduce((s, q) => s + (q.grandTotal || 0), 0),
      percentage: totalQuotes > 0 ? Math.round((quoteDraft / totalQuotes) * 100) : 0,
      color: '#64748b', // slate
    },
    {
      stage: 'sent' as const,
      label: '2. ส่งแล้ว / รอพิจารณา',
      count: quoteSent,
      value: inRangeQuotes
        .filter((q) => q.status === 'SENT' || q.status === 'WAITING')
        .reduce((s, q) => s + (q.grandTotal || 0), 0),
      percentage: totalQuotes > 0 ? Math.round((quoteSent / totalQuotes) * 100) : 0,
      color: '#3b82f6', // blue
    },
    {
      stage: 'accepted' as const,
      label: '3. ยืนยัน / อนุมัติ',
      count: quoteAccepted,
      value: inRangeQuotes.filter((q) => q.status === 'ACCEPTED').reduce((s, q) => s + (q.grandTotal || 0), 0),
      percentage: totalQuotes > 0 ? Math.round((quoteAccepted / totalQuotes) * 100) : 0,
      color: '#8b5cf6', // purple
    },
    {
      stage: 'converted' as const,
      label: '4. แปลงเป็นบิลแล้ว',
      count: quoteConverted,
      value: inRangeQuotes.filter((q) => q.status === 'CONVERTED').reduce((s, q) => s + (q.grandTotal || 0), 0),
      percentage: totalQuotes > 0 ? Math.round((quoteConverted / totalQuotes) * 100) : 0,
      color: '#10b981', // green
    },
  ]

  // Topic 11: Active Rentals (Current)
  const activeRentals: SalesRentalReportData['activeRentals'] = []
  let overdueRentalsCount = 0

  for (const b of allBills) {
    if (b.rentalStatus === 'RENTING' || b.rentalStatus === 'PARTIAL_RETURNED') {
      const retDate = (b.scheduledReturnDate || b.rentalStartDate || '').split('T')[0]
      const isOverdue = !!retDate && retDate < todayStr
      let daysOverdue = 0
      if (isOverdue && retDate) {
        overdueRentalsCount++
        const diff = new Date(todayStr).getTime() - new Date(retDate).getTime()
        daysOverdue = Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)))
      }

      activeRentals.push({
        id: b.id,
        billNo: b.billNo,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        rentalStartDate: b.rentalStartDate,
        scheduledReturnDate: b.scheduledReturnDate,
        isOverdue,
        daysOverdue,
        itemsCount: b.items?.length || 0,
        depositAmount: b.heldDepositAmount || 0,
        grandTotal: b.grandTotal,
        rentalStatus: b.rentalStatus,
      })
    }
  }
  activeRentals.sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1
    if (!a.isOverdue && b.isOverdue) return 1
    return new Date(a.scheduledReturnDate).getTime() - new Date(b.scheduledReturnDate).getTime()
  })

  // Sales vs Rental Trend
  const buckets = generateTimeBuckets(filter.startDate, filter.endDate, filter.granularity)
  const bucketMap = new Map<string, { sales: number; rental: number }>()
  for (const b of buckets) {
    bucketMap.set(b.key, { sales: 0, rental: 0 })
  }

  for (const b of inRangeBills) {
    const rawDate = b.billDate || b.rentalStartDate || ''
    const clean = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate.slice(0, 10)
    const key = filter.granularity === 'daily' ? clean : clean.slice(0, 7)
    const entry = bucketMap.get(key)
    if (entry) {
      for (const it of b.items || []) {
        const isSale = it.rentalType === 'SALE' || it.requiresReturn === false
        const lineAmt = it.lineTotal ?? (it.quantity || 0) * (it.dailyRate || 0)
        if (isSale) entry.sales += lineAmt
        else entry.rental += lineAmt
      }
    }
  }

  const salesVsRentalTrend = buckets.map((b) => {
    const val = bucketMap.get(b.key) || { sales: 0, rental: 0 }
    return {
      label: b.label,
      sales: val.sales,
      rental: val.rental,
      total: val.sales + val.rental,
    }
  })

  // Detailed Table Records
  const detailedRecords: SalesRentalReportData['detailedRecords'] = []
  for (const b of inRangeBills) {
    const items = b.items || []
    const hasSale = items.some((i) => i.rentalType === 'SALE')
    const hasRent = items.some((i) => i.rentalType !== 'SALE')
    const subType = hasSale && hasRent ? 'MIXED' : hasSale ? 'SALE' : 'RENTAL'
    const itemsSummary = items.map((i) => `${i.productName} (${i.quantity})`).slice(0, 2).join(', ') + (items.length > 2 ? ` +${items.length - 2}` : '')

    detailedRecords.push({
      id: b.id,
      docNo: b.billNo,
      type: 'BILL',
      subType,
      date: b.billDate || b.rentalStartDate,
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      itemsSummary: itemsSummary || 'ไม่มีรายการ',
      amount: b.grandTotal,
      status: b.rentalStatus,
    })
  }

  for (const q of inRangeQuotes) {
    const items = q.items || []
    const itemsSummary = items.map((i) => `${i.productName} (${i.quantity})`).slice(0, 2).join(', ') + (items.length > 2 ? ` +${items.length - 2}` : '')

    detailedRecords.push({
      id: q.id,
      docNo: q.quotationNo,
      type: 'QUOTATION',
      subType: 'RENTAL',
      date: q.quotationDate,
      customerName: q.customerName,
      customerPhone: q.phone,
      itemsSummary: itemsSummary || 'ไม่มีรายการ',
      amount: q.grandTotal,
      status: q.status,
    })
  }

  detailedRecords.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return {
    salesRevenue,
    salesUnits,
    salesCount,
    rentalRevenue,
    rentalCount,
    totalBillsCount: inRangeBills.length,
    totalBillsValue,
    totalBillsPaid,
    totalBillsOutstanding,
    billStatusList,
    totalQuotationsCount: totalQuotes,
    totalQuotationsValue: totalQuoteValue,
    quotationConversionRate,
    quotationFunnel,
    activeRentalsCount: activeRentals.length,
    overdueRentalsCount,
    activeRentals,
    salesVsRentalTrend,
    detailedRecords,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
