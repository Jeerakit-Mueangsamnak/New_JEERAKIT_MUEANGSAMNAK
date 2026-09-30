import { loadBills } from '@/features/bills/services/bill-storage'
import { loadQuotations } from '@/features/quotations/services/quotation-storage'
import { loadProducts } from '@/features/products/services/product-storage'
import { loadReservations } from '@/features/reservations/services/reservation-storage'
import { formatCurrency, generateTimeBuckets, isDateInRange, toLocalDateString, type ReportDateFilter } from './report-data-common'

// 3. OPERATIONS REPORT DATA (Topics 12, 13, 20)
// ─────────────────────────────────────────────────────────────────────────────

export interface ActionItem {
  id: string
  category: 'OVERDUE_RETURN' | 'DEBT_FOLLOWUP' | 'DAMAGED_STOCK' | 'LOST_STOCK' | 'LOW_STOCK' | 'PENDING_QUOTE'
  priority: 'high' | 'medium' | 'info'
  title: string
  refNo: string
  customerName?: string
  customerPhone?: string
  date?: string
  status: string
  suggestedHandler: string
}

export interface OperationsReportData {
  dispatchCount: number
  returnCount: number
  activeReservationsCount: number
  actionItemsCount: number
  // Operations Trend Chart
  operationsTrend: Array<{
    label: string
    dispatches: number
    returns: number
    reservations: number
  }>
  // Topic 13: Reservations
  reservations: Array<{
    id: string
    reservationNo: string
    productName: string
    quantity: number
    customerName: string
    startDate: string
    endDate: string
    sourceType: string
    sourceNo: string
    status: string
  }>
  // Topic 20: Action Items
  actionItems: ActionItem[]
  // Operations History Table
  historyRecords: Array<{
    id: string
    date: string
    event: 'DISPATCH' | 'RETURN' | 'RESERVATION'
    refNo: string
    customerName: string
    itemsCount: number
    handler: string
    status: string
  }>
}

export function getOperationsReportData(filter: ReportDateFilter): OperationsReportData {
  const allBills = loadBills()
  const allReservations = loadReservations()
  const allProducts = loadProducts()
  const allQuotations = loadQuotations()
  const todayStr = toLocalDateString(new Date())

  // Topic 12: Dispatch & Return counts in period
  let dispatchCount = 0
  let returnCount = 0

  const buckets = generateTimeBuckets(filter.startDate, filter.endDate, filter.granularity)
  const bucketMap = new Map<string, { dispatches: number; returns: number; reservations: number }>()
  for (const b of buckets) {
    bucketMap.set(b.key, { dispatches: 0, returns: 0, reservations: 0 })
  }

  const historyRecords: OperationsReportData['historyRecords'] = []

  for (const b of allBills) {
    if (b.rentalStatus === 'VOID' || b.rentalStatus === 'CANCELLED') continue

    // Dispatch check
    const dispDate = b.rentalStartDate
    if (isDateInRange(dispDate, filter.startDate, filter.endDate)) {
      dispatchCount++
      const clean = dispDate.includes('T') ? dispDate.split('T')[0] : dispDate.slice(0, 10)
      const key = filter.granularity === 'daily' ? clean : clean.slice(0, 7)
      const entry = bucketMap.get(key)
      if (entry) entry.dispatches++

      historyRecords.push({
        id: `disp-${b.id}`,
        date: dispDate,
        event: 'DISPATCH',
        refNo: b.billNo,
        customerName: b.customerName,
        itemsCount: b.items?.length || 0,
        handler: 'เจ้าหน้าที่จัดส่ง / มอบสินค้า',
        status: b.dispatchStatus === 'DISPATCHED' ? 'ส่งมอบแล้ว' : 'รอส่งมอบ',
      })
    }

    // Return check
    const retDate = b.actualReturnDate || (b.rentalStatus === 'RETURNED' || b.rentalStatus === 'CLOSED' ? b.scheduledReturnDate : null)
    if (retDate && isDateInRange(retDate, filter.startDate, filter.endDate)) {
      returnCount++
      const clean = retDate.includes('T') ? retDate.split('T')[0] : retDate.slice(0, 10)
      const key = filter.granularity === 'daily' ? clean : clean.slice(0, 7)
      const entry = bucketMap.get(key)
      if (entry) entry.returns++

      historyRecords.push({
        id: `ret-${b.id}`,
        date: retDate,
        event: 'RETURN',
        refNo: b.billNo,
        customerName: b.customerName,
        itemsCount: b.items?.reduce((s, i) => s + (i.returnedQty || 0), 0) || 0,
        handler: 'เจ้าหน้าที่ตรวจรับสินค้าคืน',
        status: 'รับคืนแล้ว',
      })
    }
  }

  // Topic 13: Reservations
  const inRangeReservations = allReservations.filter((r) =>
    r.status === 'ACTIVE' || isDateInRange(r.startDate || r.createdAt, filter.startDate, filter.endDate)
  )

  for (const r of allReservations) {
    if (isDateInRange(r.startDate || r.createdAt, filter.startDate, filter.endDate)) {
      const clean = (r.startDate || r.createdAt).split('T')[0]
      const key = filter.granularity === 'daily' ? clean : clean.slice(0, 7)
      const entry = bucketMap.get(key)
      if (entry) entry.reservations++
    }
  }

  const reservations = inRangeReservations.map((r) => ({
    id: r.id,
    reservationNo: r.reservationNo,
    productName: r.productName,
    quantity: r.quantity,
    customerName: r.customerName,
    startDate: r.startDate,
    endDate: r.endDate,
    sourceType: r.sourceType === 'QUOTATION' ? 'ใบเสนอราคา' : 'บิลเช่า',
    sourceNo: r.sourceNo,
    status: r.status,
  }))

  // Topic 20: Action Items (งาน / จุดที่ต้องจัดการ)
  const actionItems: ActionItem[] = []

  // 1. Overdue Rentals
  for (const b of allBills) {
    if (b.rentalStatus === 'RENTING' || b.rentalStatus === 'PARTIAL_RETURNED') {
      const retDate = (b.scheduledReturnDate || b.rentalStartDate || '').split('T')[0]
      if (retDate && retDate < todayStr) {
        actionItems.push({
          id: `act-overdue-${b.id}`,
          category: 'OVERDUE_RETURN',
          priority: 'high',
          title: `งานเช่าเกินกำหนดส่งคืน (${retDate})`,
          refNo: b.billNo,
          customerName: b.customerName,
          customerPhone: b.customerPhone,
          date: retDate,
          status: 'เกินกำหนด',
          suggestedHandler: 'ฝ่ายรับคืน / ติดตามลูกค้า',
        })
      }
    }
  }

  // 2. Unpaid Debt follow-up
  for (const b of allBills) {
    if (b.rentalStatus !== 'VOID' && b.rentalStatus !== 'CANCELLED' && (b.outstandingAmount || 0) > 0) {
      actionItems.push({
        id: `act-debt-${b.id}`,
        category: 'DEBT_FOLLOWUP',
        priority: 'medium',
        title: `มียอดค้างชำระ ฿${formatCurrency(b.outstandingAmount)}`,
        refNo: b.billNo,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        date: b.billDate,
        status: 'ค้างชำระ',
        suggestedHandler: 'ฝ่ายบัญชี / การเงิน',
      })
    }
  }

  // 3. Damaged / Lost products
  for (const p of allProducts) {
    if ((p.damagedQuantity || 0) > 0) {
      actionItems.push({
        id: `act-dam-${p.id}`,
        category: 'DAMAGED_STOCK',
        priority: 'high',
        title: `สินค้าชำรุด ${p.damagedQuantity} ${p.unit || 'ชิ้น'} รอส่งซ่อม`,
        refNo: p.code,
        customerName: p.name,
        status: 'รอซ่อม',
        suggestedHandler: 'ฝ่ายคลังสินค้า / ช่างเทคนิค',
      })
    }
    if ((p.lostQuantity || 0) > 0) {
      actionItems.push({
        id: `act-lost-${p.id}`,
        category: 'LOST_STOCK',
        priority: 'medium',
        title: `สินค้าสูญหาย ${p.lostQuantity} ${p.unit || 'ชิ้น'} รอตัดบัญชี`,
        refNo: p.code,
        customerName: p.name,
        status: 'สูญหาย',
        suggestedHandler: 'ฝ่ายบัญชี / สต็อก',
      })
    }
    if ((p.availableQuantity || 0) <= (p.minimumStock || 0) && (p.totalQuantity || 0) > 0) {
      actionItems.push({
        id: `act-low-${p.id}`,
        category: 'LOW_STOCK',
        priority: 'medium',
        title: `สต็อกต่ำกว่าเกณฑ์ เหลือ ${p.availableQuantity}/${p.totalQuantity} ${p.unit || 'ชิ้น'}`,
        refNo: p.code,
        customerName: p.name,
        status: 'สต็อกต่ำ',
        suggestedHandler: 'ฝ่ายจัดซื้อ / สต็อก',
      })
    }
  }

  // 4. Pending Quotations
  for (const q of allQuotations) {
    if (q.status === 'SENT' || q.status === 'WAITING') {
      actionItems.push({
        id: `act-quote-${q.id}`,
        category: 'PENDING_QUOTE',
        priority: 'info',
        title: `ใบเสนอราคารอการยืนยัน ยอด ฿${formatCurrency(q.grandTotal)}`,
        refNo: q.quotationNo,
        customerName: q.customerName,
        customerPhone: q.phone,
        date: q.quotationDate,
        status: 'รอการตอบรับ',
        suggestedHandler: 'ฝ่ายขาย / ประสานงาน',
      })
    }
  }

  // Sort action items: high > medium > info
  const priorityRank = { high: 0, medium: 1, info: 2 }
  actionItems.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])

  // Trend mapping
  const operationsTrend = buckets.map((b) => {
    const val = bucketMap.get(b.key) || { dispatches: 0, returns: 0, reservations: 0 }
    return {
      label: b.label,
      dispatches: val.dispatches,
      returns: val.returns,
      reservations: val.reservations,
    }
  })

  historyRecords.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return {
    dispatchCount,
    returnCount,
    activeReservationsCount: reservations.filter((r) => r.status === 'ACTIVE').length,
    actionItemsCount: actionItems.length,
    operationsTrend,
    reservations,
    actionItems,
    historyRecords,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
