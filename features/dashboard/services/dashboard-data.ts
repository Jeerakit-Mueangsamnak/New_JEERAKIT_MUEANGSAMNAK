import { StatementTransaction } from '@/features/finance/services/finance-storage'
import { FullBill } from '@/features/bills/services/bill-storage'
import { Appointment, Product } from '@/lib/types/rental-pos'
import { getBillItemAmounts, getBillRevenueAmount } from '@/features/bills/services/bill-reporting'
import { ReservationRecord } from '@/features/reservations/services/reservation-storage'
import { ActionableNotification } from '@/features/notifications/services/notification-storage'
import { isLowStock } from '@/features/products/utils/low-stock'
import { APPOINTMENT_STATUS_META } from '@/features/appointments/appointment-status'

export interface DashboardTaskItem {
  id: string
  time: string
  type: 'DISPATCH' | 'RETURN' | 'FOLLOWUP' | 'INSPECT' | 'PREPARE'
  typeLabel: string
  typeBadgeColor: string
  billNo: string
  customerName: string
  itemsSummary: string
  quantity: number
  status: string
  statusColor: string
  assignee: string
  remark: string
}

export interface StockUrgentItem {
  id: string
  time: string
  workType: string
  workBadgeColor: string
  productName: string
  quantity: number
  unit: string
  status: string
  statusColor: string
  assignee: string
  remark: string
}

export interface DashboardMetrics {
  // Financial
  totalIncome: number
  totalExpense: number
  netIncome: number
  netCashReceived: number
  outstandingReceivable: number
  depositBalance: number
  debtorCount: number
  depositCount: number

  // Operations & Additional Assets Metrics (Items 6-10)
  salesRevenue: number
  rentalRevenue: number
  inProgressBillsCount: number
  activeRentalsCount: number
  todayTasksCount: number
  todayDeliveriesCount: number
  todayReturnsCount: number

  // Stock
  availableStock: number
  rentedOrReservedStock: number
  rentedStock: number
  reservedStock: number
  damagedOrLostStock: number
  damagedStock: number
  lostStock: number
  pendingBillDeliveryItemCount: number

  // Urgent Notifications
  urgentTasks: ActionableNotification[]

  // Asset Status Breakdown for Bar Chart
  assetStatusData: Array<{ label: string; count: number; color: string }>

  // Time Series (Income & Expense over recent 7 days)
  recentTrend: Array<{
    date: string
    displayDate: string
    income: number
    expense: number
  }>

  // Income Breakdown by Category (Image 1 Donut)
  incomeBreakdownData: Array<{
    label: string
    value: number
    color: string
    percentage: number
  }>

  // Bill Status Counts (Image 1 Bar)
  billStatusCounts: {
    paid: number
    inProgress: number
    overdue: number
    cancelled: number
  }

  // Deposit vs Debt Donut (Image 1 Donut)
  depositVsDebtData: Array<{
    label: string
    value: number
    color: string
    percentage: number
  }>

  // Today's Key Tasks / Table (Image 1 List & Table)
  todayKeyTasks: DashboardTaskItem[]

  // Stock Category Breakdown for Stock View Bar Chart
  categoryStockData: Array<{
    category: string
    total: number
    available: number
    rented: number
    damaged: number
  }>

  // Donut Stock Proportions
  stockDonutData: Array<{
    label: string
    value: number
    color: string
    percentage: number
  }>

  // Top Rented Products
  topRentedProducts: Array<{
    id: string
    code: string
    name: string
    rentalCount: number
    revenue: number
  }>

  // 7-Day Reservation Trend (Image 2 Bar)
  billFulfillmentTrendData: Array<{
    date: string
    displayDate: string
    incomingQty: number
    outgoingQty: number
  }>

  // Stock Alerts Summary (Image 2 Right List)
  stockAlertsSummary: {
    damagedCount: number
    lowStockCount: number
    overdueCount: number
    pendingBillDeliveryItemCount: number
    outgoingDispatchCount: number
  }

  // Stock Urgent Tasks Table (Image 2 Bottom Table)
  stockUrgentList: StockUrgentItem[]

  // Business Analytics: bill value excluding VAT and net receipts by month
  monthlyTrend: Array<{
    month: string
    revenue: number
    receivedAmount: number
    billsCount: number
  }>

  // Top Revenue Products (Image 3 Right Ranking Table)
  topRevenueProducts: Array<{
    id: string
    code: string
    name: string
    type: string
    revenue: number
    percentage: number
  }>

  // Top Customers
  topCustomers: Array<{
    id: string
    name: string
    phone?: string
    billsCount: number
    billedAmount: number
    vatAmount: number
    receivedAmount: number
    outstandingAmount: number
    percentage: number
  }>

  // Payment Channels Breakdown
  paymentChannelsData: Array<{
    channel: string
    label: string
    amount: number
    percentage: number
    color: string
  }>

  // Growth Rate & Top Summary Metrics
  growthRate: number | null
  currentMonthRevenue: number
  topProductMetric: {
    name: string
    revenue: number
    type: string
  }
  topCustomerMetric: {
    count: number
    totalBilled: number
    percentage: number
  }
  topChannelMetric: {
    name: string
    amount: number
    percentage: number
  }
}

const THAI_MONTH_ABBR = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
]

export function computeDashboardMetrics(
  transactions: StatementTransaction[],
  bills: FullBill[],
  products: Product[],
  reservations: ReservationRecord[],
  notifications: ActionableNotification[],
  appointments: Appointment[] = [],
  appointmentAssigneeNames: ReadonlyMap<string, string> = new Map(),
  timezone = 'Asia/Bangkok',
  now = new Date()
): DashboardMetrics {
  const zonedParts = (date: Date) =>
    Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).map((part) => [part.type, part.value]))
  const dateString = (date: Date) => {
    const p = zonedParts(date)
    return `${p.year}-${p.month}-${p.day}`
  }
  const zonedDateString = (value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '' : dateString(date)
  }
  const monthKey = (date: Date) => dateString(date).slice(0, 7)
  const todayStr = dateString(now)
  const currentMonthKey = todayStr.slice(0, 7)
  const billMonthKey = (bill: FullBill) =>
    bill.confirmedAt ? monthKey(new Date(bill.confirmedAt)) : (bill.billDate || '').slice(0, 7)

  // 1. Finance Metrics from finance-storage
  let totalIncome = 0
  let totalExpense = 0
  let refundTotal = 0

  transactions.forEach((tx) => {
    if (tx.isDeposit) return
    totalIncome += Number(tx.incomeAmount) || 0
    totalExpense += Number(tx.expenseAmount) || 0
    if (tx.type === 'EXPENSE' && tx.category === 'คืนเงินลูกค้า') {
      refundTotal += Number(tx.expenseAmount) || 0
    }
  })
  const netCashReceived = totalIncome - refundTotal
  const netIncome = totalIncome - totalExpense

  // 2. Active Bills Receivable (ห้ามนับ DRAFT / CANCELLED / VOID)
  let outstandingReceivable = 0
  const activeBills = bills.filter((b) => {
    const s = b.serverStatus || b.rentalStatus
    return s !== 'DRAFT' && s !== 'CANCELLED' && s !== 'VOID'
  })

  const debtorBills = activeBills.filter((b) => (b.outstandingAmount || 0) > 0)
  debtorBills.forEach((b) => {
    outstandingReceivable += b.outstandingAmount || 0
  })
  const debtorCount = debtorBills.length

  // deposit_amount is informational on the bill and must not be treated as received revenue.
  const depositBalance = activeBills.reduce((sum, bill) => sum + (Number(bill.heldDepositAmount) || 0), 0)
  const depositCount = activeBills.filter((b) => (Number(b.heldDepositAmount) || 0) > 0).length

  // 2.1 Operations Metrics (Items 6 - 10)
  let salesRevenue = 0
  let rentalRevenue = 0
  activeBills.filter((bill) => billMonthKey(bill) === currentMonthKey).forEach((bill) => {
    getBillItemAmounts(bill).forEach(({ item, amount }) => {
      if (item.rentalType === 'SALE' || item.requiresReturn === false) salesRevenue += amount
      else rentalRevenue += amount
    })
  })

  // 8. บิลที่กำลังดำเนินการ
  const inProgressBills = activeBills.filter(
    (b) => b.rentalStatus === 'RENTING' || b.rentalStatus === 'PARTIAL_RETURNED'
  )
  const inProgressBillsCount = inProgressBills.length

  // 9. งานเช่าปัจจุบัน
  let activeRentalsCount = 0
  activeBills.forEach((b) => {
    b.items.forEach((it) => {
      if (it.status === 'RENTING' || it.status === 'PARTIAL_RETURNED') {
        activeRentalsCount += 1
      }
    })
  })
  if (activeRentalsCount === 0 && inProgressBillsCount > 0) {
    inProgressBills.forEach((b) => {
      b.items.forEach((it) => {
        if (it.requiresReturn !== false && it.rentalType !== 'SALE') {
          activeRentalsCount += 1
        }
      })
    })
  }

  // Today's work comes only from saved appointments, never inferred from bill dates.
  const todayAppointments = appointments.filter((appointment) => appointment.date === todayStr)
  const countedTodayAppointments = todayAppointments.filter(
    (appointment) => !['CANCELLED', 'NO_SHOW', 'RESCHEDULED'].includes(appointment.status)
  )
  const todayDeliveriesCount = countedTodayAppointments.filter((appointment) => appointment.type === 'DELIVERY').length
  const todayReturnsCount = countedTodayAppointments.filter((appointment) => appointment.type === 'RETURN').length
  const todayTasksCount = countedTodayAppointments.length

  // 3. Stock Metrics from Products
  let availableStock = 0
  let rentedStock = 0
  let reservedStock = 0
  let damagedStock = 0
  let lostStock = 0

  products.forEach((p) => {
    availableStock += p.availableQuantity || 0
    rentedStock += p.rentedQuantity || 0
    reservedStock += p.reservedQuantity || 0
    damagedStock += p.damagedQuantity || 0
    lostStock += p.lostQuantity || 0
  })

  // Bill lines awaiting delivery are distinct from quotation reservations in stock_balances.
  const pendingBillDeliveryItems = reservations.filter((r) => r.status === 'ACTIVE')
  const pendingBillDeliveryItemCount = pendingBillDeliveryItems.length

  const rentedOrReservedStock = rentedStock + reservedStock
  const damagedOrLostStock = damagedStock + lostStock

  // 5. Urgent Tasks from notifications
  const urgentTasks = notifications
    .filter((n) => n.status === 'UNREAD' || n.status === 'READ')
    .slice(0, 8)

  // 6. Asset Status Data
  const assetStatusData = [
    { label: 'พร้อมให้เช่า', count: availableStock, color: '#10b981' },
    { label: 'กำลังเช่า', count: rentedStock, color: '#3b82f6' },
    { label: 'จองคิว', count: reservedStock, color: '#8b5cf6' },
    { label: 'ชำรุด', count: damagedStock, color: '#f59e0b' },
    { label: 'สูญหาย', count: lostStock, color: '#ef4444' },
  ]

  // 7. Recent 7 Days Income & Expense Trend
  const last7Days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const [year, month, day] = todayStr.split('-').map(Number)
    last7Days.push(new Date(Date.UTC(year, month - 1, day - i)).toISOString().slice(0, 10))
  }

  const trendMap: Record<string, { income: number; expense: number }> = {}
  last7Days.forEach((dateStr) => {
    trendMap[dateStr] = { income: 0, expense: 0 }
  })

  transactions.forEach((tx) => {
    const dateStr = tx.dateTime ? zonedDateString(tx.dateTime) : ''
    if (trendMap[dateStr]) {
      if (!tx.isDeposit) {
        trendMap[dateStr].income += Number(tx.incomeAmount) || 0
        trendMap[dateStr].expense += Number(tx.expenseAmount) || 0
      }
    }
  })

  const recentTrend = last7Days.map((dateStr) => {
    const parts = dateStr.split('-')
    const day = parseInt(parts[2], 10)
    const month = parseInt(parts[1], 10) - 1
    const displayDate = `${day} ${THAI_MONTH_ABBR[month] || ''}`
    return {
      date: dateStr,
      displayDate,
      income: trendMap[dateStr].income,
      expense: trendMap[dateStr].expense,
    }
  })

  // 8. Income Breakdown Data (Donut in View 1)
  const totalBreakdownSum = rentalRevenue + salesRevenue
  const safeBreakdownSum = totalBreakdownSum > 0 ? totalBreakdownSum : 1

  const incomeBreakdownData = [
    {
      label: 'มูลค่าสินค้าเช่า (ไม่รวม VAT)',
      value: rentalRevenue,
      color: '#10b981', // green
      percentage: Math.round((rentalRevenue / safeBreakdownSum) * 100),
    },
    {
      label: 'มูลค่าสินค้าขาย (ไม่รวม VAT)',
      value: salesRevenue,
      color: '#3b82f6', // blue
      percentage: Math.round((salesRevenue / safeBreakdownSum) * 100),
    },
  ]

  // 9. Bill Status Breakdown (Bar in View 1)
  const paidBillsCount = activeBills.filter((b) => b.paymentStatus === 'PAID').length
  const overdueBillsCount = activeBills.filter((b) => {
    const isOverdue = b.scheduledReturnDate && b.scheduledReturnDate.slice(0, 10) < todayStr
    return isOverdue && (b.rentalStatus === 'RENTING' || b.rentalStatus === 'PARTIAL_RETURNED')
  }).length
  const cancelledBillsCount = bills.filter((b) => b.rentalStatus === 'CANCELLED' || b.rentalStatus === 'VOID').length
  const inProgressStatusCount = Math.max(0, inProgressBillsCount - overdueBillsCount)

  const billStatusCounts = {
    paid: paidBillsCount,
    inProgress: inProgressStatusCount,
    overdue: overdueBillsCount,
    cancelled: cancelledBillsCount,
  }

  // 10. Deposit vs Debt Donut (Donut in View 1)
  const totalDepDebt = depositBalance + outstandingReceivable
  const safeDepDebt = totalDepDebt > 0 ? totalDepDebt : 1
  const depositVsDebtData = [
    {
      label: 'เงินมัดจำ',
      value: depositBalance,
      color: '#8b5cf6', // purple
      percentage: Math.round((depositBalance / safeDepDebt) * 100),
    },
    {
      label: 'ลูกหนี้ค้างชำระ',
      value: outstandingReceivable,
      color: '#f59e0b', // amber
      percentage: Math.round((outstandingReceivable / safeDepDebt) * 100),
    },
  ]

  // 11. Today's Key Tasks are actual appointment rows, including their saved status/time.
  const todayKeyTasks: DashboardTaskItem[] = [...todayAppointments]
    .sort((a, b) => `${a.startTime}|${a.id}`.localeCompare(`${b.startTime}|${b.id}`))
    .map((appointment) => {
      const isDelivery = appointment.type === 'DELIVERY'
      const isReturn = appointment.type === 'RETURN'
      const isInspection = appointment.type === 'INSPECTION'
      const type = isDelivery ? 'DISPATCH' : isReturn ? 'RETURN' : isInspection ? 'INSPECT' : 'FOLLOWUP'
      const typeLabel = isDelivery ? 'ส่งมอบ' : isReturn ? 'รับคืน' : isInspection ? 'ตรวจสอบ' : 'นัดหมาย'
      const typeBadgeColor = isDelivery
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
        : isReturn
          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
          : isInspection
            ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
      const statusColors: Record<string, string> = {
        DRAFT: 'text-slate-500',
        SCHEDULED: 'text-amber-500',
        CONFIRMED: 'text-cyan-500',
        IN_PROGRESS: 'text-blue-500',
        COMPLETED: 'text-emerald-500',
        CANCELLED: 'text-slate-500',
        NO_SHOW: 'text-rose-500',
        RESCHEDULED: 'text-purple-500',
      }
      return {
        id: appointment.id,
        time: appointment.startTime || '—',
        type,
        typeLabel,
        typeBadgeColor,
        billNo: appointment.billNo || '-',
        customerName: appointment.customerName || appointment.contactPerson || '-',
        itemsSummary: appointment.title,
        quantity: 0,
        status: APPOINTMENT_STATUS_META[appointment.status]?.label || appointment.status,
        statusColor: statusColors[appointment.status] || 'text-slate-500',
        assignee: appointment.assigneeId
          ? appointmentAssigneeNames.get(appointment.id) || 'ไม่สามารถแสดงชื่อได้'
          : 'ยังไม่มอบหมาย',
        remark: appointment.details || appointment.location || '',
      }
    })

  // 12. Stock Categories Breakdown
  const catMap: Record<string, { total: number; available: number; rented: number; damaged: number }> = {}
  products.forEach((p) => {
    const cat = p.category || 'ทั่วไป'
    if (!catMap[cat]) {
      catMap[cat] = { total: 0, available: 0, rented: 0, damaged: 0 }
    }
    catMap[cat].total += p.totalQuantity || 0
    catMap[cat].available += p.availableQuantity || 0
    catMap[cat].rented += p.rentedQuantity || 0
    catMap[cat].damaged += (p.damagedQuantity || 0) + (p.lostQuantity || 0)
  })

  const categoryStockData = Object.entries(catMap).map(([category, data]) => ({
    category,
    ...data,
  }))

  // 13. Stock Donut Proportions
  const totalStockSum = availableStock + rentedStock + reservedStock + damagedStock + lostStock
  const safeTotalStock = totalStockSum > 0 ? totalStockSum : 1
  const stockDonutData = [
    {
      label: 'พร้อมใช้',
      value: availableStock,
      color: '#10b981', // green
      percentage: Math.round((availableStock / safeTotalStock) * 100),
    },
    {
      label: 'กำลังเช่า',
      value: rentedStock,
      color: '#3b82f6', // blue
      percentage: Math.round((rentedStock / safeTotalStock) * 100),
    },
    {
      label: 'จองคิว',
      value: reservedStock,
      color: '#8b5cf6', // purple
      percentage: Math.round((reservedStock / safeTotalStock) * 100),
    },
    {
      label: 'ชำรุด/สูญหาย',
      value: damagedOrLostStock,
      color: '#ef4444', // red
      percentage: Math.round((damagedOrLostStock / safeTotalStock) * 100),
    },
  ]

  // 14. 7-Day Reservation Trend (View 2 Middle Bar)
  const billFulfillmentTrendData = last7Days.map((dateStr) => {
    const parts = dateStr.split('-')
    const day = parseInt(parts[2], 10)
    const month = parseInt(parts[1], 10) - 1
    const displayDate = `${day} ${THAI_MONTH_ABBR[month] || ''}`

    // Outgoing (dispatch due on that date)
    const outgoingQty = activeBills.reduce((sum, bill) =>
      sum + bill.items.reduce((lineSum, item) =>
        lineSum + (item.rentalStartDate === dateStr ? Number(item.remainingQty) || 0 : 0), 0), 0)

    // Return obligations are taken from each bill line, not the whole bill quantity.
    const incomingQty = activeBills.reduce((sum, bill) =>
      sum + bill.items.reduce((lineSum, item) =>
        lineSum + (item.scheduledReturnDate === dateStr ? Number(item.outstandingQty) || 0 : 0), 0), 0)

    return {
      date: dateStr,
      displayDate,
      incomingQty: incomingQty || 0,
      outgoingQty: outgoingQty || 0,
    }
  })

  // 15. Stock Alerts Summary (View 2 Right List)
  const pendingBillDispatchCount = activeBills.filter((bill) => bill.dispatchStatus !== 'DELIVERED').length
  const stockAlertsSummary = {
    damagedCount: damagedStock,
    lowStockCount: products.filter(isLowStock).length,
    overdueCount: overdueBillsCount,
    pendingBillDeliveryItemCount,
    outgoingDispatchCount: pendingBillDispatchCount,
  }

  // 16. Stock Urgent Tasks Table (View 2 Bottom Table)
  const stockUrgentList: StockUrgentItem[] = []

  // Damaged items inspection
  const damagedProducts = products.filter((p) => (p.damagedQuantity || 0) > 0)
  damagedProducts.forEach((p) => {
    stockUrgentList.push({
      id: `damaged-${p.id}`,
      time: '—',
      workType: 'ตรวจสอบสินค้าชำรุด',
      workBadgeColor: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
      productName: p.name,
      quantity: p.damagedQuantity || 0,
      unit: p.unit || 'ชิ้น',
      status: 'ชำรุด',
      statusColor: 'text-rose-500',
      assignee: '—',
      remark: 'จำนวนชำรุดตามข้อมูลสต็อก',
    })
  })

  // Low stock alerts
  const lowStockProducts = products.filter(isLowStock)
  lowStockProducts.forEach((p) => {
    stockUrgentList.push({
      id: `low-${p.id}`,
      time: '—',
      workType: 'สต็อกใกล้หมด',
      workBadgeColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      productName: p.name,
      quantity: p.availableQuantity || 0,
      unit: p.unit || 'ชิ้น',
      status: 'ถึงจุดสั่งซื้อ',
      statusColor: 'text-amber-500',
      assignee: '—',
      remark: `คงเหลือ ${p.availableQuantity} จากจุดสั่งซื้อ ${p.minimumStock} ${p.unit || 'ชิ้น'}`,
    })
  })

  // Overdue returns
  activeBills
    .filter((b) => b.scheduledReturnDate && b.scheduledReturnDate.slice(0, 10) < todayStr && (b.rentalStatus === 'RENTING' || b.rentalStatus === 'PARTIAL_RETURNED'))
    .forEach((b) => {
      const outstandingItems = b.items.filter((item) => item.requiresReturn && (item.outstandingQty || 0) > 0)
      const firstItem = outstandingItems[0]
      stockUrgentList.push({
        id: `overdue-${b.id}`,
        time: '—',
        workType: 'ครบกำหนดคืน (เกินกำหนด)',
        workBadgeColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        productName: firstItem?.productName || 'สินค้าเช่า',
        quantity: outstandingItems.reduce((sum, item) => sum + (item.outstandingQty || 0), 0),
        unit: firstItem?.unit || 'ชิ้น',
        status: 'เกินกำหนด',
        statusColor: 'text-amber-500',
        assignee: '—',
        remark: `มีรายการคงค้างในบิล ${b.billNo}`,
      })
    })

  // Active reservations
  pendingBillDeliveryItems.slice(0, 2).forEach((r) => {
    stockUrgentList.push({
      id: `resv-${r.id}`,
      time: '—',
      workType: 'รอส่งมอบตามบิล',
      workBadgeColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
      productName: r.productName,
      quantity: r.quantity || 1,
      unit: 'ชิ้น',
      status: 'รอส่งมอบ',
      statusColor: 'text-blue-500',
      assignee: '—',
      remark: `วันที่เริ่มเช่าตามบิล ${r.startDate || '—'}`,
    })
  })

  // Pending deliveries
  activeBills
    .filter((b) => b.dispatchStatus !== 'DELIVERED')
    .slice(0, 2)
    .forEach((b) => {
      const openItems = b.items.filter((item) => (item.remainingQty || 0) > 0)
      const firstItem = openItems[0]
      stockUrgentList.push({
        id: `dispatch-${b.id}`,
        time: '—',
        workType: 'เตรียมส่งมอบ (จองออก)',
        workBadgeColor: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        productName: firstItem?.productName || 'สินค้าเช่า',
        quantity: openItems.reduce((sum, item) => sum + (item.remainingQty || 0), 0),
        unit: firstItem?.unit || 'ชิ้น',
        status: 'รอส่งมอบ',
        statusColor: 'text-blue-500',
        assignee: '—',
        remark: `บิล ${b.billNo} รอส่งมอบ`,
      })
    })

  // 17. Top products: recent confirmed bills, prorated bill discount and VAT-excluded values.
  const [currentYear, currentMonthNumber] = currentMonthKey.split('-').map(Number)
  const recentSixMonths = new Set(
    Array.from({ length: 6 }, (_, index) =>
      new Date(Date.UTC(currentYear, currentMonthNumber - 1 - index, 1)).toISOString().slice(0, 7)
    )
  )
  const recentBills = activeBills.filter((bill) => recentSixMonths.has(billMonthKey(bill)))
  const productAgg: Record<string, { id: string; code: string; name: string; type: string; rentalCount: number; revenue: number }> = {}
  recentBills.forEach((bill) => {
    getBillItemAmounts(bill).forEach(({ item, amount }) => {
      const pid = item.productId || item.productName
      if (!productAgg[pid]) {
        productAgg[pid] = {
          id: item.productId,
          code: item.productCode || '',
          name: item.productName,
          type: item.rentalType === 'SALE' || item.requiresReturn === false ? 'ขาย' : 'เช่า',
          rentalCount: 0,
          revenue: 0,
        }
      }
      if (item.rentalType !== 'SALE' && item.requiresReturn !== false) {
        productAgg[pid].rentalCount += Number(item.quantity) || 0
      }
      productAgg[pid].revenue += amount
    })
  })

  const sortedProducts = Object.values(productAgg).filter((product) => product.revenue > 0).sort((a, b) => b.revenue - a.revenue)
  const totalProductsRevenue = sortedProducts.reduce((sum, p) => sum + p.revenue, 0)
  const safeProdRev = totalProductsRevenue > 0 ? totalProductsRevenue : 1

  const topRevenueProducts = sortedProducts.slice(0, 5).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    type: p.type,
    revenue: p.revenue,
    percentage: Math.round((p.revenue / safeProdRev) * 1000) / 10,
  }))

  const topRentedProducts = Object.values(productAgg)
    .filter((product) => product.rentalCount > 0)
    .sort((a, b) => b.rentalCount - a.rentalCount)
    .slice(0, 5)

  // 18. Customer totals are keyed by the actual customer foreign key, never by a display name.
  const custAgg: Record<string, {
    id: string
    name: string
    phone?: string
    billsCount: number
    billedAmount: number
    vatAmount: number
    receivedAmount: number
    outstandingAmount: number
  }> = {}
  activeBills.forEach((b) => {
    if (!b.customerId) return
    if (!custAgg[b.customerId]) {
      custAgg[b.customerId] = {
        id: b.customerId,
        name: b.customerName || 'ไม่พบชื่อลูกค้า',
        phone: b.customerPhone || undefined,
        billsCount: 0,
        billedAmount: 0,
        vatAmount: 0,
        receivedAmount: 0,
        outstandingAmount: 0,
      }
    }
    const customer = custAgg[b.customerId]
    customer.billsCount += 1
    customer.billedAmount += getBillRevenueAmount(b)
    customer.vatAmount += Number(b.taxAmount) || 0
    customer.receivedAmount += Number(b.paidAmount) || 0
    customer.outstandingAmount += Number(b.outstandingAmount) || 0
  })

  const sortedCustomers = Object.values(custAgg).sort((a, b) => b.billedAmount - a.billedAmount)
  const totalCustomerBilled = sortedCustomers.reduce((sum, customer) => sum + customer.billedAmount, 0)
  const safeCustomerBilled = totalCustomerBilled > 0 ? totalCustomerBilled : 1

  const topCustomers = sortedCustomers.slice(0, 5).map((c) => ({
    ...c,
    percentage: Math.round((c.billedAmount / safeCustomerBilled) * 1000) / 10,
  }))

  // 19. Payment channel mix uses received bill payments (gross, before refunds).
  const channelMap: Record<string, number> = {}
  let totalChannelIncome = 0

  transactions.forEach((tx) => {
    if (!tx.isDeposit && tx.billId && tx.category === 'รับชำระบิล' && tx.type === 'INCOME' && tx.incomeAmount > 0) {
      const ch = tx.channel || 'เงินสด'
      channelMap[ch] = (channelMap[ch] || 0) + tx.incomeAmount
      totalChannelIncome += tx.incomeAmount
    }
  })

  const CHANNEL_COLOR_PALETTE = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#64748b']
  const paymentChannelsData = Object.entries(channelMap).map(([channel, amount], idx) => ({
    channel,
    label: channel === 'CASH' ? 'เงินสด' : channel === 'TRANSFER' ? 'โอนธนาคาร' : channel === 'CREDIT_CARD' ? 'บัตรเครดิต/เดบิต' : channel === 'CHEQUE' ? 'เช็ค' : channel,
    amount,
    percentage: totalChannelIncome > 0 ? Math.round((amount / totalChannelIncome) * 100) : 0,
    color: CHANNEL_COLOR_PALETTE[idx % CHANNEL_COLOR_PALETTE.length],
  }))

  // 20. Last six months: bill value excluding VAT vs net bill receipts by payment date.
  const monthlyMap: Record<string, { revenue: number; receivedAmount: number; billsCount: number }> = {}
  for (const key of [...recentSixMonths].sort()) {
    monthlyMap[key] = { revenue: 0, receivedAmount: 0, billsCount: 0 }
  }

  activeBills.forEach((b) => {
    const key = billMonthKey(b)
    if (monthlyMap[key]) {
      monthlyMap[key].revenue += getBillRevenueAmount(b)
      monthlyMap[key].billsCount += 1
    }
  })

  transactions.forEach((tx) => {
    if (tx.isDeposit || !tx.billId) return
    const key = tx.dateTime ? zonedDateString(tx.dateTime).slice(0, 7) : ''
    if (!monthlyMap[key]) return
    if (tx.category === 'รับชำระบิล' && tx.type === 'INCOME') monthlyMap[key].receivedAmount += Number(tx.incomeAmount) || 0
    if (tx.category === 'คืนเงินลูกค้า' && tx.type === 'EXPENSE') monthlyMap[key].receivedAmount -= Number(tx.expenseAmount) || 0
  })

  const monthlyTrend = Object.entries(monthlyMap).map(([mKey, val]) => {
    const [yearStr, monthStr] = mKey.split('-')
    const monthIdx = parseInt(monthStr, 10) - 1
    const yearBE = parseInt(yearStr, 10) + 543
    return {
      month: `${THAI_MONTH_ABBR[monthIdx]} ${String(yearBE).slice(-2)}`,
      revenue: val.revenue,
      receivedAmount: val.receivedAmount,
      billsCount: val.billsCount,
    }
  })

  // 21. Growth Rate Calculation (Compare this month vs last month)
  let growthRate: number | null = 0
  let currentMonthRevenue = monthlyMap[currentMonthKey]?.revenue || 0
  const monthlyKeys = Object.keys(monthlyMap)
  if (monthlyKeys.length >= 2) {
    const prevMonthRev = monthlyMap[monthlyKeys[monthlyKeys.length - 2]].revenue
    if (prevMonthRev > 0) {
      growthRate = Math.round(((currentMonthRevenue - prevMonthRev) / prevMonthRev) * 100)
    } else if (currentMonthRevenue > 0) growthRate = null
    else growthRate = null
  }

  // Summary helper metrics
  const topProductMetric = topRevenueProducts[0]
    ? { name: topRevenueProducts[0].name, revenue: topRevenueProducts[0].revenue, type: topRevenueProducts[0].type }
    : { name: 'ไม่มีข้อมูล', revenue: 0, type: 'เช่า' }

  const topCustomerSum = topCustomers.reduce((sum, c) => sum + c.billedAmount, 0)
  const topCustomerMetric = {
    count: topCustomers.length,
    totalBilled: topCustomerSum,
    percentage: safeCustomerBilled > 0 ? Math.round((topCustomerSum / safeCustomerBilled) * 100) : 0,
  }

  const topChannel = paymentChannelsData.sort((a, b) => b.amount - a.amount)[0]
  const topChannelMetric = topChannel
    ? { name: topChannel.label, amount: topChannel.amount, percentage: topChannel.percentage }
    : { name: 'ไม่มีข้อมูล', amount: 0, percentage: 0 }

  return {
    totalIncome,
    totalExpense,
    netIncome,
    netCashReceived,
    outstandingReceivable,
    depositBalance,
    debtorCount,
    depositCount,
    salesRevenue,
    rentalRevenue,
    inProgressBillsCount,
    activeRentalsCount,
    todayTasksCount,
    todayDeliveriesCount,
    todayReturnsCount,
    availableStock,
    rentedOrReservedStock,
    rentedStock,
    reservedStock,
    damagedOrLostStock,
    damagedStock,
    lostStock,
    pendingBillDeliveryItemCount,
    urgentTasks,
    assetStatusData,
    recentTrend,
    incomeBreakdownData,
    billStatusCounts,
    depositVsDebtData,
    todayKeyTasks,
    categoryStockData,
    stockDonutData,
    topRentedProducts,
    billFulfillmentTrendData,
    stockAlertsSummary,
    stockUrgentList,
    monthlyTrend,
    topRevenueProducts,
    topCustomers,
    paymentChannelsData,
    growthRate,
    currentMonthRevenue,
    topProductMetric,
    topCustomerMetric,
    topChannelMetric,
  }
}
