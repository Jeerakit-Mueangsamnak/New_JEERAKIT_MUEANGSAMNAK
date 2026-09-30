import type { FullBill, FullBillItem } from '@/lib/types/rental-return'
import type { BillRevisionRecord } from '@/lib/types/rental-pos'
import type { ActorInfo } from '@/lib/types/actor'
import { loadBills, updateBill, addBill } from '@/features/bills/services/bill-storage'
import { adjustProductStockDelta, loadProducts } from '@/features/products/services/product-storage'
import { recordAuditLog, generateCorrelationId } from '@/features/audits/services/audit-storage'

export interface RevisedItemInput {
  rentalBillItemId?: string
  productId: string
  productName: string
  rentalType: 'NORMAL' | 'DAILY' | 'SALE'
  quantity: number
  returnedQty?: number
  outstandingQty?: number
  unitPrice: number
  usageCount?: number
  dailyStartDate?: string
  dailyEndDate?: string
  scheduledReturnDate?: string
  action?: 'UPDATE' | 'ADD' | 'REMOVE'
  addRounds?: number
  unitName?: string
}

export interface ProcessBillRevisionOptions {
  billId: string
  mode: 'CORRECTION' | 'EXTENSION' | string
  reason: string
  headerRentalDate?: string
  headerReturnDate?: string
  discountAmount?: number
  shippingFee?: number
  items?: RevisedItemInput[]
  newSubtotal?: number
  newGrandTotal?: number
  extensionDays?: number
  extensionFee?: number
  actor: ActorInfo
  correlationId?: string
}

export function processBillRevisionWorkflow(options: ProcessBillRevisionOptions): {
  bill: FullBill
  correlationId: string
  revisionRecord: BillRevisionRecord
  originalBill?: FullBill
  extensionBill?: FullBill
} {
  const correlationId = options.correlationId || generateCorrelationId()
  const actorUserId = options.actor.userId || 'system'
  const actorDisplayName = options.actor.displayName || 'ระบบ'
  const trimmedReason = options.reason.trim()

  if (!trimmedReason) {
    throw new Error('Reason is strictly required for bill revision')
  }

  const currentBills = loadBills()
  const originalBill = currentBills.find((b) => b.id === options.billId)
  if (!originalBill) {
    throw new Error(`Bill ${options.billId} not found`)
  }

  // 1. Calculate Stock Deltas & apply stock adjustments
  const stockDeltas: Array<{ productId: string; productName: string; quantityDelta: number }> = []

  const rawItems: RevisedItemInput[] = options.items || (originalBill.items ? originalBill.items.map((it) => ({
    rentalBillItemId: it.rentalBillItemId,
    productId: it.productId,
    productName: it.productName,
    rentalType: (it.rentalType as any) || 'NORMAL',
    quantity: it.quantity,
    returnedQty: it.returnedQty,
    outstandingQty: it.outstandingQty,
    unitPrice: it.dailyRate || 0,
    unitName: it.unit,
    dailyStartDate: it.rentalStartDate,
    dailyEndDate: it.scheduledReturnDate,
    usageCount: it.usageCount || 1,
    action: 'UPDATE' as const,
  })) : [])

  // Active revised items (filter out REMOVE)
  const activeItems = rawItems.filter((it) => it.action !== 'REMOVE')

  // Map original quantities
  const originalItemQtyMap = new Map<string, number>()
  originalBill.items.forEach((it) => {
    originalItemQtyMap.set(it.productId, (originalItemQtyMap.get(it.productId) || 0) + it.quantity)
  })

  // Map revised quantities
  const revisedItemQtyMap = new Map<string, number>()
  activeItems.forEach((it) => {
    revisedItemQtyMap.set(it.productId, (revisedItemQtyMap.get(it.productId) || 0) + it.quantity)
  })

  // Calculate delta for each product
  const allProductIds = new Set([...originalItemQtyMap.keys(), ...revisedItemQtyMap.keys()])
  for (const prodId of allProductIds) {
    const oldQty = originalItemQtyMap.get(prodId) || 0
    const newQty = revisedItemQtyMap.get(prodId) || 0
    const delta = newQty - oldQty // positive = more rented/sold; negative = fewer

    if (delta !== 0) {
      adjustProductStockDelta(prodId, delta)
      const p = loadProducts().find((prod) => prod.id === prodId)
      stockDeltas.push({
        productId: prodId,
        productName: p?.name || prodId,
        quantityDelta: delta,
      })

      recordAuditLog({
        userId: actorUserId,
        displayName: actorDisplayName,
        action: 'STOCK_REVISION',
        entityType: 'STOCK',
        entityId: prodId,
        before: { billNo: originalBill.billNo, quantity: oldQty },
        after: { billNo: originalBill.billNo, quantity: newQty, quantityDelta: delta },
        reason: trimmedReason,
        correlationId,
      })
    }
  }

  // 2. Calculate Financial Recalculation
  const calculatedSubtotal = options.newSubtotal !== undefined
    ? options.newSubtotal
    : options.extensionFee !== undefined
      ? options.extensionFee
      : activeItems.reduce((sum, item) => {
          if (item.rentalType === 'DAILY') {
            const d1 = new Date(item.dailyStartDate || options.headerRentalDate || '2026-01-01')
            const d2 = new Date(item.dailyEndDate || options.headerReturnDate || '2026-01-01')
            const days = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000))
            return sum + item.quantity * item.unitPrice * days
          }
          if (item.rentalType === 'SALE') {
            return sum + item.quantity * item.unitPrice
          }
          return sum + item.quantity * item.unitPrice * (item.usageCount || 1)
        }, 0)

  const discount = options.discountAmount !== undefined ? options.discountAmount : (originalBill.discountAmount || 0)
  const shipping = options.shippingFee !== undefined ? options.shippingFee : (originalBill.shippingFee || 0)
  // Grand total strictly EXCLUDES deposit!
  const newGrandTotal = options.newGrandTotal !== undefined
    ? options.newGrandTotal
    : options.extensionFee !== undefined
      ? options.extensionFee
      : Math.max(0, calculatedSubtotal - discount + shipping)

  const oldGrandTotal = originalBill.grandTotal
  const oldPaidAmount = originalBill.paidAmount || 0
  const grandTotalDelta = newGrandTotal - oldGrandTotal

  // If new total is less than paid amount, calculate refund-due (DO NOT delete payments!)
  let newOutstanding = 0
  let refundDue = 0
  let paymentStatus = originalBill.paymentStatus

  if (newGrandTotal > oldPaidAmount) {
    newOutstanding = newGrandTotal - oldPaidAmount
    refundDue = 0
    paymentStatus = oldPaidAmount > 0 ? 'PARTIAL' : 'UNPAID'
  } else if (newGrandTotal < oldPaidAmount) {
    newOutstanding = 0
    refundDue = oldPaidAmount - newGrandTotal
    paymentStatus = 'PAID'
  } else {
    newOutstanding = 0
    refundDue = 0
    paymentStatus = 'PAID'
  }

  // 3. Build Revised Items
  const finalBillItems: FullBillItem[] = activeItems.map((it, idx) => {
    const existing = originalBill.items.find((orig) => orig.rentalBillItemId === it.rentalBillItemId)
    const returned = existing ? (existing.returnedQty || 0) : 0
    const damaged = existing ? (existing.damagedQuantity || 0) : 0
    const lost = existing ? (existing.lostQuantity || 0) : 0
    const outstanding = it.rentalType === 'SALE' ? 0 : Math.max(0, it.quantity - (returned + damaged + lost))

    let lineTotal = it.quantity * it.unitPrice
    if (it.rentalType === 'DAILY') {
      const d1 = new Date(it.dailyStartDate || options.headerRentalDate || '2026-01-01')
      const d2 = new Date(it.dailyEndDate || options.headerReturnDate || '2026-01-01')
      const days = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000))
      lineTotal = it.quantity * it.unitPrice * days
    } else if (it.rentalType === 'NORMAL') {
      lineTotal = it.quantity * it.unitPrice * (it.usageCount || 1)
    }

    return {
      rentalBillItemId: it.rentalBillItemId || `rbi-${Date.now()}-${idx}`,
      productId: it.productId,
      productCode: existing?.productCode || '',
      productName: it.productName,
      quantity: it.quantity,
      returnedQty: returned,
      damagedQuantity: damaged,
      lostQuantity: lost,
      outstandingQty: outstanding,
      dailyRate: it.unitPrice,
      unit: it.unitName || existing?.unit || 'ชิ้น',
      defaultRepairFee: existing?.defaultRepairFee || 0,
      defaultReplacementFee: existing?.defaultReplacementFee || 0,
      requiresReturn: it.rentalType !== 'SALE',
      rentalStartDate: it.dailyStartDate || options.headerRentalDate || originalBill.rentalStartDate,
      scheduledReturnDate: it.dailyEndDate || options.headerReturnDate || originalBill.scheduledReturnDate,
      rentalType: it.rentalType,
      usageCount: it.usageCount,
      lineTotal,
      status: outstanding === 0 ? 'RETURNED' : returned > 0 ? 'PARTIAL_RETURNED' : 'RENTING',
    }
  })

  // 4. Handle EXTENSION vs CORRECTION mode
  const revNo = (originalBill.revisions?.length || 0) + 1

  if (options.mode === 'EXTENSION') {
    // Mode: EXTENSION -> Do NOT overwrite original bill!
    // Original bill becomes EXTENDED. Create new linked extension bill.
    const extBillNo = `${originalBill.billNo}-EXT${revNo}`
    const extBillId = `bill-ext-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    const extensionBill: FullBill = {
      id: extBillId,
      billNo: extBillNo,
      billDate: new Date().toISOString().slice(0, 10),
      customerId: originalBill.customerId,
      customerName: originalBill.customerName,
      customerPhone: originalBill.customerPhone,
      customerAddress: originalBill.customerAddress,
      siteName: originalBill.siteName,
      originalBillId: originalBill.id,
      parentBillId: originalBill.id,
      rentalStartDate: options.headerRentalDate || originalBill.scheduledReturnDate,
      scheduledReturnDate: options.headerReturnDate || originalBill.scheduledReturnDate,
      rentalStatus: 'RENTING',
      dispatchStatus: 'DISPATCHED',
      subtotal: calculatedSubtotal,
      discountAmount: discount,
      shippingFee: shipping,
      billAmount: newGrandTotal,
      grandTotal: newGrandTotal,
      paidAmount: 0,
      outstandingAmount: newGrandTotal,
      paymentStatus: 'UNPAID',
      heldDepositAmount: 0,
      paidDepositAmount: 0,
      deposits: [],
      items: finalBillItems,
      remark: [originalBill.remark, `ต่อสัญญาจากบิล ${originalBill.billNo}: ${trimmedReason}`].filter(Boolean).join(' | '),
    }

    const revisionRecord: BillRevisionRecord = {
      id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      revisionNo: revNo,
      timestamp: new Date().toISOString(),
      userId: actorUserId,
      displayName: actorDisplayName,
      reason: trimmedReason,
      mode: 'EXTENSION',
      before: {
        grandTotal: originalBill.grandTotal,
        subtotal: originalBill.subtotal,
        paidAmount: originalBill.paidAmount,
        outstandingAmount: originalBill.outstandingAmount,
        items: originalBill.items,
      },
      after: {
        grandTotal: originalBill.grandTotal,
        subtotal: originalBill.subtotal,
        paidAmount: originalBill.paidAmount,
        outstandingAmount: originalBill.outstandingAmount,
        items: originalBill.items,
        extensionBillNo: extBillNo,
        extensionBillId: extBillId,
      } as any,
      stockDeltas,
      financialDelta: {
        grandTotalDelta: 0,
        outstandingDelta: 0,
        refundDueDelta: 0,
      },
      correlationId,
    }

    const updatedOriginalBill: FullBill = {
      ...originalBill,
      rentalStatus: 'EXTENDED',
      revisions: [...(originalBill.revisions || []), revisionRecord],
    }

    updateBill(updatedOriginalBill)
    addBill(extensionBill)

    recordAuditLog({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'BILL_EXTENSION',
      entityType: 'BILL',
      entityId: extensionBill.id,
      before: { originalBillNo: originalBill.billNo, rentalStatus: originalBill.rentalStatus },
      after: {
        extensionBillNo: extBillNo,
        originalBillNo: originalBill.billNo,
        rentalStatus: 'RENTING',
        originalStatusAfter: 'EXTENDED',
      },
      correlationId,
    })

    return {
      bill: extensionBill,
      originalBill: updatedOriginalBill,
      correlationId,
      revisionRecord,
      extensionBill,
    }
  }

  // Default: Mode CORRECTION / REVISION on existing bill
  const revisionRecord: BillRevisionRecord = {
    id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    revisionNo: revNo,
    timestamp: new Date().toISOString(),
    userId: actorUserId,
    displayName: actorDisplayName,
    reason: trimmedReason,
    mode: options.mode,
    before: {
      grandTotal: oldGrandTotal,
      subtotal: originalBill.subtotal,
      paidAmount: oldPaidAmount,
      outstandingAmount: originalBill.outstandingAmount,
      items: originalBill.items,
    },
    after: {
      grandTotal: newGrandTotal,
      subtotal: calculatedSubtotal,
      paidAmount: oldPaidAmount,
      outstandingAmount: newOutstanding,
      items: finalBillItems,
    },
    stockDeltas,
    financialDelta: {
      grandTotalDelta,
      outstandingDelta: newOutstanding - (originalBill.outstandingAmount || 0),
      refundDueDelta: refundDue,
    },
    correlationId,
  }

  // Update Bill with Revision History
  const updatedBill: FullBill = {
    ...originalBill,
    rentalStartDate: options.headerRentalDate || originalBill.rentalStartDate,
    scheduledReturnDate: options.headerReturnDate || originalBill.scheduledReturnDate,
    subtotal: calculatedSubtotal,
    discountAmount: discount,
    shippingFee: shipping,
    billAmount: newGrandTotal,
    grandTotal: newGrandTotal,
    outstandingAmount: newOutstanding,
    refundDue: refundDue,
    refundDueAmount: refundDue,
    paymentStatus,
    items: finalBillItems,
    revisions: [...(originalBill.revisions || []), revisionRecord],
    remark: [originalBill.remark, `แก้ไขบิล: ${trimmedReason}`].filter(Boolean).join(' | '),
  }

  updateBill(updatedBill)

  recordAuditLog({
    userId: actorUserId,
    displayName: actorDisplayName,
    action: 'BILL_REVISION',
    entityType: 'BILL',
    entityId: updatedBill.id,
    before: {
      billNo: originalBill.billNo,
      grandTotal: oldGrandTotal,
      outstandingAmount: originalBill.outstandingAmount,
      paymentStatus: originalBill.paymentStatus,
    },
    after: {
      billNo: updatedBill.billNo,
      grandTotal: newGrandTotal,
      outstandingAmount: newOutstanding,
      refundDueAmount: refundDue,
      paymentStatus,
      revisionNo: revisionRecord.revisionNo,
    },
    reason: trimmedReason,
    correlationId,
  })

  return { bill: updatedBill, correlationId, revisionRecord }
}
