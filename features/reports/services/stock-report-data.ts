import { loadBills } from '@/features/bills/services/bill-storage'
import { loadProducts } from '@/features/products/services/product-storage'
import { isDateInRange, type ReportDateFilter } from './report-data-common'

// 4. STOCK & PRODUCTS REPORT DATA (Topics 14, 15, 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface StockReportData {
  totalStock: number
  availableStock: number
  rentedStock: number
  damagedStock: number
  lostStock: number
  utilizationRate: number
  totalSkuCount: number
  // Donut chart status
  statusProportions: Array<{
    label: string
    value: number
    color: string
    percentage: number
  }>
  // Category usage bar chart
  categoryUsage: Array<{
    category: string
    total: number
    available: number
    rented: number
    damaged: number
    lost: number
  }>
  // Damaged / Lost summary
  damagedItems: Array<{
    id: string
    code: string
    name: string
    category: string
    quantity: number
    unit: string
    estimatedFee: number
  }>
  lostItems: Array<{
    id: string
    code: string
    name: string
    category: string
    quantity: number
    unit: string
    estimatedLoss: number
  }>
  totalDamagedCost: number
  totalLostCost: number
  // Top & Bottom Products
  topProducts: Array<{
    id: string
    code: string
    name: string
    category: string
    revenue: number
    rentCount: number
    available: number
    total: number
  }>
  bottomProducts: Array<{
    id: string
    code: string
    name: string
    category: string
    revenue: number
    rentCount: number
    available: number
    total: number
  }>
  // Detailed Product Table
  productsTable: Array<{
    id: string
    code: string
    name: string
    category: string
    totalQuantity: number
    availableQuantity: number
    rentedQuantity: number
    damagedQuantity: number
    lostQuantity: number
    unit: string
    rentPrice: number
    salePrice: number
    revenue: number
    status: string
  }>
}

export function getStockReportData(filter: ReportDateFilter): StockReportData {
  const allProducts = loadProducts()
  const allBills = loadBills()

  // Calculate revenue earned by each product in the period
  const productRevenueMap = new Map<string, { revenue: number; rentCount: number }>()

  const inRangeBills = allBills.filter(
    (b) =>
      b.rentalStatus !== 'VOID' &&
      isDateInRange(b.billDate || b.rentalStartDate, filter.startDate, filter.endDate)
  )

  for (const b of inRangeBills) {
    for (const it of b.items || []) {
      const pid = it.productId
      if (!pid) continue
      const lineAmt = it.lineTotal ?? (it.quantity || 0) * (it.dailyRate || 0)
      const cur = productRevenueMap.get(pid) || { revenue: 0, rentCount: 0 }
      cur.revenue += lineAmt
      cur.rentCount += it.quantity || 1
      productRevenueMap.set(pid, cur)
    }
  }

  let totalStock = 0
  let availableStock = 0
  let rentedStock = 0
  let damagedStock = 0
  let lostStock = 0

  const catMap = new Map<
    string,
    { total: number; available: number; rented: number; damaged: number; lost: number }
  >()

  const damagedItems: StockReportData['damagedItems'] = []
  const lostItems: StockReportData['lostItems'] = []
  let totalDamagedCost = 0
  let totalLostCost = 0

  const productsTable: StockReportData['productsTable'] = []

  for (const p of allProducts) {
    const tot = p.totalQuantity || 0
    const avail = p.availableQuantity || 0
    const rent = p.rentedQuantity || 0
    const dam = p.damagedQuantity || 0
    const lost = p.lostQuantity || 0

    totalStock += tot
    availableStock += avail
    rentedStock += rent
    damagedStock += dam
    lostStock += lost

    // Category aggregation
    const cat = p.category || 'อื่นๆ'
    const catEntry = catMap.get(cat) || { total: 0, available: 0, rented: 0, damaged: 0, lost: 0 }
    catEntry.total += tot
    catEntry.available += avail
    catEntry.rented += rent
    catEntry.damaged += dam
    catEntry.lost += lost
    catMap.set(cat, catEntry)

    // Damaged / Lost checks
    if (dam > 0) {
      const fee = dam * (p.defaultDamageFee || 100)
      totalDamagedCost += fee
      damagedItems.push({
        id: p.id,
        code: p.code,
        name: p.name,
        category: cat,
        quantity: dam,
        unit: p.unit || 'ชิ้น',
        estimatedFee: fee,
      })
    }
    if (lost > 0) {
      const loss = lost * (p.defaultLossFee || p.salePrice || 500)
      totalLostCost += loss
      lostItems.push({
        id: p.id,
        code: p.code,
        name: p.name,
        category: cat,
        quantity: lost,
        unit: p.unit || 'ชิ้น',
        estimatedLoss: loss,
      })
    }

    const revInfo = productRevenueMap.get(p.id) || { revenue: 0, rentCount: 0 }

    productsTable.push({
      id: p.id,
      code: p.code,
      name: p.name,
      category: cat,
      totalQuantity: tot,
      availableQuantity: avail,
      rentedQuantity: rent,
      damagedQuantity: dam,
      lostQuantity: lost,
      unit: p.unit || 'ชิ้น',
      rentPrice: p.normalPrice || (p.rentPrice as any) || 0,
      salePrice: p.salePrice || 0,
      revenue: revInfo.revenue,
      status: p.status,
    })
  }

  const utilizationRate = totalStock > 0 ? Math.round((rentedStock / totalStock) * 100) : 0

  // Status proportions Donut
  const statusProportions = [
    {
      label: 'พร้อมใช้งาน',
      value: availableStock,
      color: '#10b981', // green
      percentage: totalStock > 0 ? Math.round((availableStock / totalStock) * 100) : 0,
    },
    {
      label: 'กำลังเช่า',
      value: rentedStock,
      color: '#3b82f6', // blue
      percentage: totalStock > 0 ? Math.round((rentedStock / totalStock) * 100) : 0,
    },
    {
      label: 'ชำรุดรอซ่อม',
      value: damagedStock,
      color: '#ef4444', // red
      percentage: totalStock > 0 ? Math.round((damagedStock / totalStock) * 100) : 0,
    },
    {
      label: 'สูญหาย',
      value: lostStock,
      color: '#f59e0b', // orange
      percentage: totalStock > 0 ? Math.round((lostStock / totalStock) * 100) : 0,
    },
  ]

  // Category usage Bar
  const categoryUsage = Array.from(catMap.entries()).map(([category, vals]) => ({
    category,
    ...vals,
  }))
  categoryUsage.sort((a, b) => b.total - a.total)

  // Top / Bottom Products
  const sortedByRev = [...productsTable].sort((a, b) => b.revenue - a.revenue)
  const topProducts = sortedByRev.slice(0, 5).map((p) => {
    const revInfo = productRevenueMap.get(p.id) || { revenue: 0, rentCount: 0 }
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      category: p.category,
      revenue: p.revenue,
      rentCount: revInfo.rentCount,
      available: p.availableQuantity,
      total: p.totalQuantity,
    }
  })

  const bottomProducts = sortedByRev
    .slice(-5)
    .reverse()
    .map((p) => {
      const revInfo = productRevenueMap.get(p.id) || { revenue: 0, rentCount: 0 }
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        category: p.category,
        revenue: p.revenue,
        rentCount: revInfo.rentCount,
        available: p.availableQuantity,
        total: p.totalQuantity,
      }
    })

  return {
    totalStock,
    availableStock,
    rentedStock,
    damagedStock,
    lostStock,
    utilizationRate,
    totalSkuCount: allProducts.length,
    statusProportions,
    categoryUsage,
    damagedItems,
    lostItems,
    totalDamagedCost,
    totalLostCost,
    topProducts,
    bottomProducts,
    productsTable,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
