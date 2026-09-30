import { loadBills } from '@/features/bills/services/bill-storage'
import { loadCustomers } from '@/features/customers/services/customer-storage'
import { calculateGrowth, generateTimeBuckets, getPreviousPeriod, isDateInRange, type ReportDateFilter } from './report-data-common'

// 5. BUSINESS ANALYTICS REPORT DATA (Topics 4, 17, 19)
// ─────────────────────────────────────────────────────────────────────────────

export interface BusinessReportData {
  // Topic 4: Growth
  currentRevenue: number
  previousRevenue: number
  revenueGrowth: number

  currentOrders: number
  previousOrders: number
  orderGrowth: number

  currentAvgTicket: number
  previousAvgTicket: number
  avgTicketGrowth: number

  currentActiveCustomers: number
  previousActiveCustomers: number
  customerGrowth: number

  // Topic 17: Top Customers
  topCustomers: Array<{
    rank: number
    customerId: string
    customerName: string
    customerPhone?: string
    companyName?: string
    totalSpend: number
    ordersCount: number
    outstandingDebt: number
    lastOrderDate: string
    tier: 'VIP' | 'Regular' | 'New'
  }>

  // Topic 19: Revenue Trend Chart
  revenueTrend: Array<{
    label: string
    revenue: number
    orders: number
  }>

  // Detailed Ranking Table
  customerRankings: Array<{
    rank: number
    customerName: string
    phone: string
    company: string
    totalSpend: number
    ordersCount: number
    outstandingDebt: number
    firstOrderDate: string
    lastOrderDate: string
  }>
}

export function getBusinessReportData(filter: ReportDateFilter): BusinessReportData {
  const allBills = loadBills()
  const allCustomers = loadCustomers()
  const { prevStart, prevEnd } = getPreviousPeriod(filter.startDate, filter.endDate)

  // Bills in range
  const curBills = allBills.filter(
    (b) =>
      b.rentalStatus !== 'VOID' &&
      b.rentalStatus !== 'CANCELLED' &&
      isDateInRange(b.billDate || b.rentalStartDate, filter.startDate, filter.endDate)
  )

  const prevBills = allBills.filter(
    (b) =>
      b.rentalStatus !== 'VOID' &&
      b.rentalStatus !== 'CANCELLED' &&
      isDateInRange(b.billDate || b.rentalStartDate, prevStart, prevEnd)
  )

  // Current Metrics
  const currentRevenue = curBills.reduce((s, b) => s + (b.grandTotal || 0), 0)
  const currentOrders = curBills.length
  const currentAvgTicket = currentOrders > 0 ? Math.round(currentRevenue / currentOrders) : 0
  const curCustomerIds = new Set(curBills.map((b) => b.customerId || b.customerName).filter(Boolean))
  const currentActiveCustomers = curCustomerIds.size

  // Previous Metrics
  const previousRevenue = prevBills.reduce((s, b) => s + (b.grandTotal || 0), 0)
  const previousOrders = prevBills.length
  const previousAvgTicket = previousOrders > 0 ? Math.round(previousRevenue / previousOrders) : 0
  const prevCustomerIds = new Set(prevBills.map((b) => b.customerId || b.customerName).filter(Boolean))
  const previousActiveCustomers = prevCustomerIds.size

  // Growth percentages
  const revenueGrowth = calculateGrowth(currentRevenue, previousRevenue)
  const orderGrowth = calculateGrowth(currentOrders, previousOrders)
  const avgTicketGrowth = calculateGrowth(currentAvgTicket, previousAvgTicket)
  const customerGrowth = calculateGrowth(currentActiveCustomers, previousActiveCustomers)

  // Topic 17: Customer Aggregation
  const customerStatsMap = new Map<
    string,
    {
      customerId: string
      customerName: string
      customerPhone?: string
      companyName?: string
      totalSpend: number
      ordersCount: number
      outstandingDebt: number
      firstOrderDate: string
      lastOrderDate: string
    }
  >()

  for (const b of curBills) {
    const key = b.customerId || b.customerName || 'Unknown'
    const cur = customerStatsMap.get(key) || {
      customerId: b.customerId || '',
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      companyName: b.siteName,
      totalSpend: 0,
      ordersCount: 0,
      outstandingDebt: 0,
      firstOrderDate: b.billDate || b.rentalStartDate || '',
      lastOrderDate: b.billDate || b.rentalStartDate || '',
    }

    cur.totalSpend += b.grandTotal || 0
    cur.ordersCount++
    cur.outstandingDebt += b.outstandingAmount || 0

    const date = b.billDate || b.rentalStartDate || ''
    if (date) {
      if (!cur.firstOrderDate || date < cur.firstOrderDate) cur.firstOrderDate = date
      if (!cur.lastOrderDate || date > cur.lastOrderDate) cur.lastOrderDate = date
    }

    customerStatsMap.set(key, cur)
  }

  // Cross-reference with Customer Storage for company/phone
  for (const c of allCustomers) {
    const cur = customerStatsMap.get(c.id) || customerStatsMap.get(c.customerName)
    if (cur) {
      if (!cur.companyName && c.companyName) cur.companyName = c.companyName
      if (!cur.customerPhone && c.phone) cur.customerPhone = c.phone
    }
  }

  const customerList = Array.from(customerStatsMap.values())
  customerList.sort((a, b) => b.totalSpend - a.totalSpend)

  const topCustomers: BusinessReportData['topCustomers'] = customerList.slice(0, 10).map((c, idx) => {
    let tier: 'VIP' | 'Regular' | 'New' = 'Regular'
    if (c.totalSpend >= 50000 || c.ordersCount >= 5) tier = 'VIP'
    else if (c.ordersCount === 1) tier = 'New'

    return {
      rank: idx + 1,
      customerId: c.customerId,
      customerName: c.customerName,
      customerPhone: c.customerPhone,
      companyName: c.companyName,
      totalSpend: c.totalSpend,
      ordersCount: c.ordersCount,
      outstandingDebt: c.outstandingDebt,
      lastOrderDate: c.lastOrderDate,
      tier,
    }
  })

  const customerRankings: BusinessReportData['customerRankings'] = customerList.map((c, idx) => ({
    rank: idx + 1,
    customerName: c.customerName,
    phone: c.customerPhone || '-',
    company: c.companyName || '-',
    totalSpend: c.totalSpend,
    ordersCount: c.ordersCount,
    outstandingDebt: c.outstandingDebt,
    firstOrderDate: c.firstOrderDate,
    lastOrderDate: c.lastOrderDate,
  }))

  // Topic 19: Revenue Trend Chart
  const buckets = generateTimeBuckets(filter.startDate, filter.endDate, filter.granularity)
  const bucketMap = new Map<string, { revenue: number; orders: number }>()
  for (const b of buckets) {
    bucketMap.set(b.key, { revenue: 0, orders: 0 })
  }

  for (const b of curBills) {
    const rawDate = b.billDate || b.rentalStartDate || ''
    const clean = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate.slice(0, 10)
    const key = filter.granularity === 'daily' ? clean : clean.slice(0, 7)
    const entry = bucketMap.get(key)
    if (entry) {
      entry.revenue += b.grandTotal || 0
      entry.orders++
    }
  }

  const revenueTrend = buckets.map((b) => {
    const val = bucketMap.get(b.key) || { revenue: 0, orders: 0 }
    return {
      label: b.label,
      revenue: val.revenue,
      orders: val.orders,
    }
  })

  return {
    currentRevenue,
    previousRevenue,
    revenueGrowth,
    currentOrders,
    previousOrders,
    orderGrowth,
    currentAvgTicket,
    previousAvgTicket,
    avgTicketGrowth,
    currentActiveCustomers,
    previousActiveCustomers,
    customerGrowth,
    topCustomers,
    revenueTrend,
    customerRankings,
  }
}
