import { loadRevenueLedger, loadTransactions, type StatementTransaction } from '@/features/finance/services/finance-storage'
import { loadBills } from '@/features/bills/services/bill-storage'
import { loadSystemSettings } from '@/features/settings/services/settings-storage'
import { calculateGrowth, generateTimeBuckets, getPreviousPeriod, isDateInRange, localDayOf, type ReportDateFilter } from './report-data-common'

// 1. FINANCE REPORT DATA (Topics 1, 2, 3, 7, 8, 18)
// ─────────────────────────────────────────────────────────────────────────────

export interface FinanceReportData {
  totalIncome: number
  totalExpense: number
  netIncome: number
  incomeCount: number
  expenseCount: number
  // Comparison with previous period
  prevTotalIncome: number
  prevTotalExpense: number
  prevNetIncome: number
  incomeGrowth: number | null
  expenseGrowth: number | null
  netIncomeGrowth: number | null
  // Topic 7: Outstanding Debt
  totalOutstanding: number
  debtorCount: number
  debtorBills: Array<{
    id: string
    billNo: string
    customerName: string
    customerPhone?: string
    billDate: string
    dueDate?: string
    scheduledReturnDate: string
    grandTotal: number
    paidAmount: number
    outstandingAmount: number
    daysOverdue: number
  }>
  // Topic 8: Deposits — the stated deposit on bills only; the system never records a deposit
  // being received or returned (Master §18), so there is no "deposit in / out" figure.
  billDepositAmount: number
  billsWithDepositCount: number
  // Revenue per mode (Master §31) from the finance ledger, by the day it was recorded
  // (bill confirmed / charge confirmed / other income saved), VAT excluded.
  revenueByClass: Array<{ revenueClass: string; label: string; amount: number }>
  revenueTotal: number
  // Topic 18: Payment Channels
  paymentChannels: Array<{
    channel: string
    amount: number
    count: number
    percentage: number
    color: string
  }>
  // Trend Points for Historical Chart
  trendData: Array<{
    label: string
    income: number
    expense: number
    net: number
  }>
  // Transactions Table
  transactions: StatementTransaction[]
}

const CHANNEL_COLORS: Record<string, string> = {
  // Keys are the channel names the statement uses (finance-repository METHOD_TH).
  โอนเงิน: '#10b981', // emerald
  เงินสด: '#3b82f6', // blue
  บัตร: '#8b5cf6', // purple
  QR: '#06b6d4', // cyan
  'อื่น ๆ': '#64748b', // slate
}

const REVENUE_CLASS_ORDER = [
  'SALE', 'RENTAL', 'DELIVERY_FEE', 'INSTALLATION_FEE', 'SERVICE_FEE', 'DAMAGE', 'LOST', 'ADDITIONAL',
  'ADJUSTMENT', 'OTHER', 'DISCOUNT', 'VAT_INCLUDED',
]

const REVENUE_CLASS_LABELS: Record<string, string> = {
  SALE: 'ขายสินค้า',
  RENTAL: 'ค่าเช่า',
  DELIVERY_FEE: 'ค่าขนส่ง',
  INSTALLATION_FEE: 'ค่าติดตั้ง',
  SERVICE_FEE: 'ค่าบริการ',
  DAMAGE: 'ค่าเสียหาย',
  LOST: 'ค่าสินค้าสูญหาย',
  ADDITIONAL: 'ค่าใช้จ่ายเพิ่ม',
  ADJUSTMENT: 'ปรับยอดบิล',
  OTHER: 'รายรับอื่น',
  DISCOUNT: 'ส่วนลด',
  VAT_INCLUDED: 'หัก VAT (ราคารวม VAT)',
}

export function getFinanceReportData(filter: ReportDateFilter): FinanceReportData {
  const allTxs = loadTransactions()
  const allBills = loadBills()
  const { prevStart, prevEnd } = getPreviousPeriod(filter.startDate, filter.endDate)

  // Current period transactions
  const inRangeTxs = allTxs.filter((t) => isDateInRange(t.dateTime, filter.startDate, filter.endDate))
  const prevTxs = allTxs.filter((t) => isDateInRange(t.dateTime, prevStart, prevEnd))

  // Topic 1, 2, 3
  let totalIncome = 0
  let totalExpense = 0
  let incomeCount = 0
  let expenseCount = 0

  const channelMap: Record<string, { amount: number; count: number }> = {}

  for (const t of inRangeTxs) {
    if (t.type === 'INCOME') {
      const amt = t.incomeAmount || 0
      totalIncome += amt
      incomeCount++

      const ch = t.channel || 'โอนเงิน'
      if (!channelMap[ch]) channelMap[ch] = { amount: 0, count: 0 }
      channelMap[ch].amount += amt
      channelMap[ch].count++
    } else if (t.type === 'EXPENSE') {
      const amt = t.expenseAmount || 0
      totalExpense += amt
      expenseCount++
    }
  }

  const netIncome = totalIncome - totalExpense

  // Previous period calculations
  let prevTotalIncome = 0
  let prevTotalExpense = 0
  for (const t of prevTxs) {
    if (t.type === 'INCOME') prevTotalIncome += t.incomeAmount || 0
    else if (t.type === 'EXPENSE') prevTotalExpense += t.expenseAmount || 0
  }
  const prevNetIncome = prevTotalIncome - prevTotalExpense

  const incomeGrowth = calculateGrowth(totalIncome, prevTotalIncome)
  const expenseGrowth = calculateGrowth(totalExpense, prevTotalExpense)
  const netIncomeGrowth = calculateGrowth(netIncome, prevNetIncome)

  // Topic 7: Outstanding Debt (ลูกหนี้ค้าง)
  const timezone = loadSystemSettings().timezone || 'Asia/Bangkok'
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  const todayStr = `${todayParts.year}-${todayParts.month}-${todayParts.day}`
  const debtorBills: FinanceReportData['debtorBills'] = []
  let totalOutstanding = 0

  // Same bill set as the dashboard: drafts are not bills yet; cancelled / void bills owe nothing.
  const countsAsBill = (b: (typeof allBills)[number]) => {
    const s = b.serverStatus || b.rentalStatus
    return s !== 'DRAFT' && s !== 'CANCELLED' && s !== 'VOID'
  }

  for (const b of allBills) {
    if (!countsAsBill(b)) continue
    const out = b.outstandingAmount || 0
    if (out > 0) {
      totalOutstanding += out
      const dueDate = (b.dueDate || '').split('T')[0]
      const isOverdue = dueDate && dueDate < todayStr
      let daysOverdue = 0
      if (isOverdue && dueDate) {
        const todayDay = Date.parse(`${todayStr}T00:00:00Z`)
        const dueDay = Date.parse(`${dueDate}T00:00:00Z`)
        daysOverdue = Math.max(0, Math.floor((todayDay - dueDay) / (24 * 60 * 60 * 1000)))
      }

      debtorBills.push({
        id: b.id,
        billNo: b.billNo,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        billDate: b.billDate,
        dueDate: b.dueDate,
        scheduledReturnDate: b.scheduledReturnDate,
        grandTotal: b.grandTotal,
        paidAmount: b.paidAmount,
        outstandingAmount: out,
        daysOverdue,
      })
    }
  }
  debtorBills.sort((a, b) => b.outstandingAmount - a.outstandingAmount)

  // The bill field records a stated deposit amount, not proof of cash held.
  let billDepositAmount = 0
  let billsWithDepositCount = 0
  for (const b of allBills) {
    if (!countsAsBill(b)) continue
    const statedDeposit = b.heldDepositAmount || 0
    if (statedDeposit > 0) {
      billDepositAmount += statedDeposit
      billsWithDepositCount++
    }
  }

  const revenueMap = new Map<string, number>()
  for (const e of loadRevenueLedger()) {
    if (!isDateInRange(e.occurredAt, filter.startDate, filter.endDate)) continue
    revenueMap.set(e.revenueClass, (revenueMap.get(e.revenueClass) || 0) + e.amount)
  }
  const revenueByClass = REVENUE_CLASS_ORDER.filter((c) => Math.abs(revenueMap.get(c) || 0) >= 0.005).map((c) => ({
    revenueClass: c,
    label: REVENUE_CLASS_LABELS[c] || c,
    amount: Math.round((revenueMap.get(c) || 0) * 100) / 100,
  }))
  for (const [c, amount] of revenueMap) {
    if (!REVENUE_CLASS_ORDER.includes(c) && Math.abs(amount) >= 0.005) {
      revenueByClass.push({ revenueClass: c, label: c, amount: Math.round(amount * 100) / 100 })
    }
  }
  const revenueTotal = Math.round(revenueByClass.reduce((s, r) => s + r.amount, 0) * 100) / 100

  // Topic 18: Payment Channels
  const paymentChannels: FinanceReportData['paymentChannels'] = Object.entries(channelMap).map(
    ([channel, val]) => ({
      channel,
      amount: val.amount,
      count: val.count,
      percentage: totalIncome > 0 ? Math.round((val.amount / totalIncome) * 100) : 0,
      color: CHANNEL_COLORS[channel] || '#64748b',
    })
  )
  paymentChannels.sort((a, b) => b.amount - a.amount)

  // Time Series Trend Data
  const buckets = generateTimeBuckets(filter.startDate, filter.endDate, filter.granularity)
  const bucketMap = new Map<string, { income: number; expense: number }>()
  for (const b of buckets) {
    bucketMap.set(b.key, { income: 0, expense: 0 })
  }

  for (const t of inRangeTxs) {
    const clean = localDayOf(t.dateTime)
    const key = filter.granularity === 'daily' ? clean : clean.slice(0, 7)
    const entry = bucketMap.get(key)
    if (entry) {
      if (t.type === 'INCOME') entry.income += t.incomeAmount || 0
      else if (t.type === 'EXPENSE') entry.expense += t.expenseAmount || 0
    }
  }

  const trendData = buckets.map((b) => {
    const val = bucketMap.get(b.key) || { income: 0, expense: 0 }
    return {
      label: b.label,
      income: val.income,
      expense: val.expense,
      net: val.income - val.expense,
    }
  })

  // Sorted transactions
  const sortedTxs = [...inRangeTxs].sort(
    (a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime()
  )

  return {
    totalIncome,
    totalExpense,
    netIncome,
    incomeCount,
    expenseCount,
    prevTotalIncome,
    prevTotalExpense,
    prevNetIncome,
    incomeGrowth,
    expenseGrowth,
    netIncomeGrowth,
    totalOutstanding,
    debtorCount: debtorBills.length,
    debtorBills,
    billDepositAmount,
    billsWithDepositCount,
    revenueByClass,
    revenueTotal,
    paymentChannels,
    trendData,
    transactions: sortedTxs,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
