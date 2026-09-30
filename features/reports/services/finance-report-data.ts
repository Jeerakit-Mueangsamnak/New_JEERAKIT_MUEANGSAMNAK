import { loadTransactions, type StatementTransaction } from '@/features/finance/services/finance-storage'
import { loadBills } from '@/features/bills/services/bill-storage'
import { calculateGrowth, generateTimeBuckets, getPreviousPeriod, isDateInRange, toLocalDateString, type ReportDateFilter } from './report-data-common'

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
  incomeGrowth: number
  expenseGrowth: number
  netIncomeGrowth: number
  // Topic 7: Outstanding Debt
  totalOutstanding: number
  debtorCount: number
  debtorBills: Array<{
    id: string
    billNo: string
    customerName: string
    customerPhone?: string
    billDate: string
    scheduledReturnDate: string
    grandTotal: number
    paidAmount: number
    outstandingAmount: number
    daysOverdue: number
  }>
  // Topic 8: Deposits
  depositReceived: number
  depositRefunded: number
  netDepositChange: number
  currentlyHeldDeposit: number
  activeDepositBillsCount: number
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
  โอนเงิน: '#10b981', // emerald
  เงินสด: '#3b82f6', // blue
  บัตรเครดิต: '#8b5cf6', // purple
  'QR Code': '#06b6d4', // cyan
  เช็ค: '#f59e0b', // amber
  อื่นๆ: '#64748b', // slate
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
  let depositReceived = 0
  let depositRefunded = 0

  const channelMap: Record<string, { amount: number; count: number }> = {}

  for (const t of inRangeTxs) {
    const isDep = t.isDeposit || t.category === 'เงินมัดจำ' || t.category === 'คืนเงินมัดจำ'

    if (t.type === 'INCOME') {
      const amt = t.incomeAmount || 0
      totalIncome += amt
      incomeCount++
      if (isDep) depositReceived += amt

      const ch = t.channel || 'โอนเงิน'
      if (!channelMap[ch]) channelMap[ch] = { amount: 0, count: 0 }
      channelMap[ch].amount += amt
      channelMap[ch].count++
    } else if (t.type === 'EXPENSE') {
      const amt = t.expenseAmount || 0
      totalExpense += amt
      expenseCount++
      if (isDep) depositRefunded += amt
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
  const todayStr = toLocalDateString(new Date())
  const debtorBills: FinanceReportData['debtorBills'] = []
  let totalOutstanding = 0

  for (const b of allBills) {
    if (b.rentalStatus === 'CANCELLED' || b.rentalStatus === 'VOID') continue
    const out = b.outstandingAmount || 0
    if (out > 0) {
      totalOutstanding += out
      const retDate = (b.scheduledReturnDate || b.rentalStartDate || '').split('T')[0]
      const isOverdue = retDate && retDate < todayStr
      let daysOverdue = 0
      if (isOverdue && retDate) {
        const diff = new Date(todayStr).getTime() - new Date(retDate).getTime()
        daysOverdue = Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)))
      }

      debtorBills.push({
        id: b.id,
        billNo: b.billNo,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        billDate: b.billDate,
        scheduledReturnDate: b.scheduledReturnDate,
        grandTotal: b.grandTotal,
        paidAmount: b.paidAmount,
        outstandingAmount: out,
        daysOverdue,
      })
    }
  }
  debtorBills.sort((a, b) => b.outstandingAmount - a.outstandingAmount)

  // Topic 8: Held Deposits across active bills
  let currentlyHeldDeposit = 0
  let activeDepositBillsCount = 0
  for (const b of allBills) {
    if (b.rentalStatus === 'CANCELLED' || b.rentalStatus === 'VOID') continue
    const held = b.heldDepositAmount || 0
    if (held > 0) {
      currentlyHeldDeposit += held
      activeDepositBillsCount++
    }
  }

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
    const clean = t.dateTime.includes('T') ? t.dateTime.split('T')[0] : t.dateTime.slice(0, 10)
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
    depositReceived,
    depositRefunded,
    netDepositChange: depositReceived - depositRefunded,
    currentlyHeldDeposit,
    activeDepositBillsCount,
    paymentChannels,
    trendData,
    transactions: sortedTxs,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
