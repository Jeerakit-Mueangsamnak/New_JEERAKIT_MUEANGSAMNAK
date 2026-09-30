import type { FullBill, FullBillItem } from '@/lib/types/rental-return'
import type { ActorInfo } from '@/lib/types/actor'
import { loadBills, updateBill } from '@/features/bills/services/bill-storage'
import { recordBillPayment, recordExpense, getBillFinanceSummary } from '@/features/finance/services/finance-storage'
import { toSatang, toBaht, addSatang, subtractSatang, multiplySatang, calculateDepositSettlement } from '@/lib/money'
import { returnProductStock, loadProducts, validateStockInvariants } from '@/features/products/services/product-storage'
import { recordStockMovement } from '@/features/stock/services/stock-movement'
import { recordAuditLog, generateCorrelationId } from '@/features/audits/services/audit-storage'

export interface ReturnItemInput {
  rentalBillItemId: string
  productId: string
  normalQty: number
  damagedQty: number
  lostQty: number
  repairFeePerUnit?: number
  replacementFeePerUnit?: number
  note?: string
}

export interface ReturnDamageChargeInput {
  rentalBillItemId: string
  productId?: string
  damageCharge?: number
  lossCharge?: number
  damagedQty?: number
  repairFeePerUnit?: number
  actualDamageCharge?: number
  lostQty?: number
  replacementFeePerUnit?: number
  actualLossCharge?: number
  reason?: string
}

export interface ProcessReturnOptions {
  billId: string
  returnNo?: string
  items?: ReturnItemInput[]
  returnItems?: ReturnItemInput[]
  returnLines?: ReturnItemInput[]
  actualDamageCharges?: ReturnDamageChargeInput[]
  deductFromDeposit?: boolean
  isConfirmed?: boolean
  actor: ActorInfo
  collectedAmount?: number
  paymentMethod?: string
  correlationId?: string
}

export async function processReturnWorkflow(options: ProcessReturnOptions): Promise<{
  bill: FullBill
  correlationId: string
  returnNo: string
  totalDamageCharges: number
  totalDamageFee: number
  depositApplied: number
  depositRefund: number
  depositRefundDue: number
  additionalAmountDue: number
}> {
  const correlationId = options.correlationId || generateCorrelationId()
  const actorUserId = options.actor.userId || 'system'
  const actorDisplayName = options.actor.displayName || 'ระบบ'
  const returnNo = options.returnNo || `RT-${Date.now().toString().slice(-6)}`

  const currentBills = loadBills()
  const targetBill = currentBills.find((b) => b.id === options.billId)
  if (!targetBill) {
    throw new Error(`Bill ${options.billId} not found`)
  }

  // Return MUST happen only after actual dispatch
  if (targetBill.dispatchStatus === 'PENDING') {
    throw new Error(`ไม่สามารถรับคืนสินค้าได้เนื่องจากบิล ${targetBill.billNo} ยังไม่ได้ทำการส่งมอบสินค้า (Dispatch)`)
  }

  const returnItemsList = options.items || options.returnItems || options.returnLines || []
  const inspectionMap = new Map(returnItemsList.map((it) => [it.rentalBillItemId, it]))
  const allMasterProducts = loadProducts()

  // Pre-validate return quantities against outstandingQty before mutating ANY stock
  for (const it of returnItemsList) {
    const billItem = targetBill.items.find(
      (bi) => bi.rentalBillItemId === it.rentalBillItemId || (bi as any).id === it.rentalBillItemId
    )
    if (!billItem) {
      throw new Error(`ไม่พบรายการสินค้า ID "${it.rentalBillItemId}" ในบิล ${targetBill.billNo}`)
    }
    const normal = Math.max(0, it.normalQty || 0)
    const damaged = Math.max(0, it.damagedQty || 0)
    const lost = Math.max(0, it.lostQty || 0)
    const totalReturned = normal + damaged + lost
    if (totalReturned > billItem.outstandingQty) {
      throw new Error(
        `จำนวนรับคืน (${totalReturned}) เกินจำนวนคงค้างที่ต้องคืน (${billItem.outstandingQty}) สำหรับสินค้า "${billItem.productName}"`
      )
    }
  }

  // 1. Process Stock Return for each item
  for (const it of returnItemsList) {
    const billItem = targetBill.items.find((bi) => bi.rentalBillItemId === it.rentalBillItemId || (bi as any).id === it.rentalBillItemId)
    const prodId = it.productId || billItem?.productId
    if (!it.productId && prodId) {
      it.productId = prodId
    }

    const normal = Math.max(0, it.normalQty || 0)
    const damaged = Math.max(0, it.damagedQty || 0)
    const lost = Math.max(0, it.lostQty || 0)
    const totalReturned = normal + damaged + lost

    if (totalReturned > 0 && it.productId) {
      const allProdsBefore = loadProducts()
      const pBefore = allProdsBefore.find((p) => p.id === it.productId)

      returnProductStock(it.productId, normal, damaged, lost)

      const allProdsAfter = loadProducts()
      const pAfter = allProdsAfter.find((p) => p.id === it.productId)
      if (pAfter) validateStockInvariants(pAfter)

      if (normal > 0) {
        await recordStockMovement({
          type: 'RETURN',
          productId: it.productId,
          billId: targetBill.id,
          billLineId: it.rentalBillItemId,
          quantity: normal,
          beforeState: { availableQuantity: pBefore?.availableQuantity, rentedQuantity: pBefore?.rentedQuantity },
          afterState: { availableQuantity: pAfter?.availableQuantity, rentedQuantity: pAfter?.rentedQuantity },
          actor: { userId: actorUserId, displayName: actorDisplayName },
          correlationId,
          reason: 'รับคืนสินค้าสภาพปกติ (Return Normal)',
        })
      }

      if (damaged > 0) {
        await recordStockMovement({
          type: 'DAMAGE',
          productId: it.productId,
          billId: targetBill.id,
          billLineId: it.rentalBillItemId,
          quantity: damaged,
          beforeState: { damagedQuantity: pBefore?.damagedQuantity, rentedQuantity: pBefore?.rentedQuantity },
          afterState: { damagedQuantity: pAfter?.damagedQuantity, rentedQuantity: pAfter?.rentedQuantity },
          actor: { userId: actorUserId, displayName: actorDisplayName },
          correlationId,
          reason: 'รับคืนสินค้าสภาพชำรุด (Return Damaged)',
        })
      }

      if (lost > 0) {
        await recordStockMovement({
          type: 'LOST',
          productId: it.productId,
          billId: targetBill.id,
          billLineId: it.rentalBillItemId,
          quantity: lost,
          beforeState: { lostQuantity: pBefore?.lostQuantity, totalQuantity: pBefore?.totalQuantity },
          afterState: { lostQuantity: pAfter?.lostQuantity, totalQuantity: pAfter?.totalQuantity },
          actor: { userId: actorUserId, displayName: actorDisplayName },
          correlationId,
          reason: 'ตัดจำหน่ายสินค้าสูญหาย (Lost Write-off)',
        })
      }

      recordAuditLog({
        userId: actorUserId,
        displayName: actorDisplayName,
        action: 'STOCK_RETURN',
        entityType: 'STOCK',
        entityId: it.productId,
        before: {
          available: pBefore?.availableQuantity,
          rented: pBefore?.rentedQuantity,
          damaged: pBefore?.damagedQuantity,
          lost: pBefore?.lostQuantity,
        },
        after: {
          available: pAfter?.availableQuantity,
          rented: pAfter?.rentedQuantity,
          damaged: pAfter?.damagedQuantity,
          lost: pAfter?.lostQuantity,
          returnNo,
          normalQty: normal,
          damagedQty: damaged,
          lostQty: lost,
        },
        correlationId,
      })
    }
  }

  // 2. Update Bill Items Status and Quantities
  const updatedItems: FullBillItem[] = targetBill.items.map((billItem) => {
    const insp = inspectionMap.get(billItem.rentalBillItemId) || inspectionMap.get((billItem as any).id)
    if (!insp) {
      return billItem
    }

    const normal = Math.max(0, insp.normalQty || 0)
    const damaged = Math.max(0, insp.damagedQty || 0)
    const lost = Math.max(0, insp.lostQty || 0)
    const sessionReturned = normal + damaged + lost

    // Cumulative returnedQty maintains invariant: returnedQty + outstandingQty = dispatched quantity
    const newReturnedQty = (billItem.returnedQty || 0) + sessionReturned
    const newDamagedQty = (billItem.damagedQuantity || 0) + damaged
    const newLostQty = (billItem.lostQuantity || 0) + lost
    const newOutstandingQty = Math.max(0, (billItem.outstandingQty || 0) - sessionReturned)

    let itemStatus = billItem.status
    if (newOutstandingQty === 0) {
      itemStatus = 'RETURNED'
    } else if (newReturnedQty > 0 || newDamagedQty > 0 || newLostQty > 0) {
      itemStatus = 'PARTIAL_RETURNED'
    }

    return {
      ...billItem,
      returnedQty: newReturnedQty,
      damagedQuantity: newDamagedQty,
      lostQuantity: newLostQty,
      outstandingQty: newOutstandingQty,
      status: itemStatus,
    }
  })

  // 3. Determine Overall Bill Status (Evaluate rental items only)
  const rentalItems = updatedItems.filter((i) => i.rentalType !== 'SALE' && i.itemType !== 'SALE' && i.requiresReturn !== false)
  const totalRemainingOutstanding = rentalItems.reduce((sum, i) => sum + (i.outstandingQty || 0), 0)
  const isFullyReturned = rentalItems.every((i) => (i.outstandingQty || 0) === 0)
  const anyReturned = rentalItems.some((i) => (i.returnedQty || 0) > 0)
  const nextRentalStatus = isFullyReturned ? 'RETURNED' : (anyReturned ? 'PARTIAL_RETURNED' : targetBill.rentalStatus)

  // 4. Calculate Damage / Loss Fees using Money Core in Satang
  let totalDamageSatang = 0
  let totalDefaultSatang = 0

  for (const it of returnItemsList) {
    const chargeOverride = options.actualDamageCharges?.find(
      (c) => c.rentalBillItemId === it.rentalBillItemId || (it.productId && c.productId === it.productId)
    )
    const masterProd = allMasterProducts.find((p) => p.id === it.productId)

    const defaultRepairFee = Number(masterProd?.defaultDamageFee ?? masterProd?.defaultRepairFee ?? 0)
    const defaultLossFee = Number(masterProd?.defaultLossFee ?? masterProd?.defaultReplacementFee ?? 0)

    let repairFee = 0
    let lossFee = 0

    const damagedQty = Math.max(0, it.damagedQty || 0)
    const lostQty = Math.max(0, it.lostQty || 0)

    if (chargeOverride) {
      if (chargeOverride.actualDamageCharge !== undefined) {
        repairFee = damagedQty > 0 ? Number(chargeOverride.actualDamageCharge) / damagedQty : 0
      } else {
        repairFee = Number(chargeOverride.damageCharge ?? chargeOverride.repairFeePerUnit ?? defaultRepairFee)
      }

      if (chargeOverride.actualLossCharge !== undefined) {
        lossFee = lostQty > 0 ? Number(chargeOverride.actualLossCharge) / lostQty : 0
      } else {
        lossFee = Number(chargeOverride.lossCharge ?? chargeOverride.replacementFeePerUnit ?? defaultLossFee)
      }
    } else {
      repairFee = it.repairFeePerUnit !== undefined && it.repairFeePerUnit > 0
        ? it.repairFeePerUnit
        : defaultRepairFee

      lossFee = it.replacementFeePerUnit !== undefined && it.replacementFeePerUnit > 0
        ? it.replacementFeePerUnit
        : defaultLossFee
    }

    const itemDamageSatang = multiplySatang(toSatang(repairFee), damagedQty)
    const itemLossSatang = multiplySatang(toSatang(lossFee), lostQty)
    const itemDefaultDamageSatang = multiplySatang(toSatang(defaultRepairFee), damagedQty)
    const itemDefaultLossSatang = multiplySatang(toSatang(defaultLossFee), lostQty)

    totalDamageSatang = addSatang(totalDamageSatang, itemDamageSatang, itemLossSatang)
    totalDefaultSatang = addSatang(totalDefaultSatang, itemDefaultDamageSatang, itemDefaultLossSatang)

    if (itemDamageSatang > 0) {
      recordAuditLog({
        userId: actorUserId,
        displayName: actorDisplayName,
        action: 'DAMAGE_CHARGE',
        entityType: 'FINANCE',
        entityId: it.rentalBillItemId,
        billId: targetBill.id,
        before: null,
        after: {
          billId: targetBill.id,
          billNo: targetBill.billNo,
          productId: it.productId,
          productName: (it as any).productName || masterProd?.name || targetBill.items?.find((i: any) => i.id === it.rentalBillItemId)?.productName || '',
          quantity: damagedQty,
          defaultAmount: toBaht(itemDefaultDamageSatang),
          actualAmount: toBaht(itemDamageSatang),
          returnNo,
        },
        reason: 'บันทึกค่าปรับสินค้าชำรุด',
        correlationId,
      })
    }

    if (itemLossSatang > 0) {
      recordAuditLog({
        userId: actorUserId,
        displayName: actorDisplayName,
        action: 'LOSS_CHARGE',
        entityType: 'FINANCE',
        entityId: it.rentalBillItemId,
        billId: targetBill.id,
        before: null,
        after: {
          billId: targetBill.id,
          billNo: targetBill.billNo,
          productId: it.productId,
          productName: (it as any).productName || masterProd?.name || targetBill.items?.find((i: any) => i.id === it.rentalBillItemId)?.productName || '',
          quantity: lostQty,
          defaultAmount: toBaht(itemDefaultLossSatang),
          actualAmount: toBaht(itemLossSatang),
          returnNo,
        },
        reason: 'บันทึกค่าปรับสินค้าสูญหาย',
        correlationId,
      })
    }
  }

  const totalDamageFee = toBaht(totalDamageSatang)
  const totalDefaultCompensation = toBaht(totalDefaultSatang)

  // 5. Deposit Settlement strictly using Money Core
  const heldDepositBefore = Number(targetBill.heldDepositAmount || 0)
  let depositApplied = 0
  let depositRefundDue = 0
  let additionalAmountDue = 0
  let heldDepositAfter = heldDepositBefore
  let updatedDeposits = targetBill.deposits || []

  // Deposit is applied ONLY when explicitly confirmed by user
  if (options.deductFromDeposit && totalDamageFee > 0) {
    const settlement = calculateDepositSettlement(heldDepositBefore, totalDamageFee)
    depositApplied = settlement.appliedDeposit
    depositRefundDue = settlement.refundDue
    additionalAmountDue = settlement.balanceDue
    heldDepositAfter = toBaht(Math.max(0, subtractSatang(toSatang(heldDepositBefore), toSatang(depositApplied))))

    recordAuditLog({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'DEPOSIT_APPLY',
      entityType: 'FINANCE',
      entityId: targetBill.id,
      billId: targetBill.id,
      before: { billNo: targetBill.billNo, heldDeposit: heldDepositBefore },
      after: {
        billId: targetBill.id,
        billNo: targetBill.billNo,
        defaultAmount: totalDefaultCompensation,
        actualAmount: totalDamageFee,
        depositHeld: heldDepositBefore,
        depositApplied,
        refundDue: depositRefundDue,
        balanceDue: additionalAmountDue,
        returnNo,
      },
      reason: 'หักเงินมัดจำชำระค่าเสียหายตามการยืนยันของผู้ใช้',
      correlationId,
    })

    if (depositApplied > 0) {
      recordBillPayment({
        billId: targetBill.id,
        billNo: targetBill.billNo,
        amount: depositApplied,
        channel: 'หักจากเงินมัดจำ',
        customerName: targetBill.customerName,
        category: 'หักมัดจำชำระค่าเสียหาย',
        isDeposit: false,
        refNo: `TX-DEP-SETTLE-${returnNo}`,
        description: `หักชำระค่าเสียหายจากเงินมัดจำ ใบคืน ${returnNo}`,
        correlationId,
      })
    }

    if (depositRefundDue > 0) {
      recordExpense({
        billId: targetBill.id,
        billNo: targetBill.billNo,
        amount: depositRefundDue,
        channel: options.paymentMethod || 'โอนเงิน',
        category: 'คืนเงินมัดจำ',
        isDeposit: true,
        refNo: `TX-DEP-REFUND-${returnNo}`,
        description: `คืนเงินมัดจำส่วนที่เหลือ ใบคืน ${returnNo}`,
        correlationId,
      })

      recordAuditLog({
        userId: actorUserId,
        displayName: actorDisplayName,
        action: 'DEPOSIT_REFUND',
        entityType: 'FINANCE',
        entityId: targetBill.id,
        billId: targetBill.id,
        before: { billNo: targetBill.billNo, heldDeposit: heldDepositBefore },
        after: {
          billId: targetBill.id,
          billNo: targetBill.billNo,
          defaultAmount: totalDefaultCompensation,
          actualAmount: totalDamageFee,
          depositHeld: heldDepositBefore,
          depositApplied,
          refundDue: depositRefundDue,
          balanceDue: additionalAmountDue,
          returnNo,
        },
        reason: 'คืนเงินมัดจำส่วนที่เหลือจากการหักชำระค่าเสียหาย',
        correlationId,
      })
      heldDepositAfter = 0
    }

    updatedDeposits = (targetBill.deposits || []).map((dep) => ({
      ...dep,
      heldAmount: heldDepositAfter,
      appliedAmount: toBaht(addSatang(toSatang(dep.appliedAmount || 0), toSatang(depositApplied))),
      refundAmount: toBaht(addSatang(toSatang(dep.refundAmount || 0), toSatang(depositRefundDue))),
      status: (heldDepositAfter === 0 ? 'SETTLED' : dep.status) as any,
    }))
  } else if (!options.deductFromDeposit && totalDamageFee > 0) {
    additionalAmountDue = totalDamageFee
  }

  // 6. Handle any extra fee collected during return (cash / transfer / etc.)
  let extraCollected = 0
  if (options.collectedAmount && options.collectedAmount > 0) {
    extraCollected = options.collectedAmount
    const feeTx = recordBillPayment({
      billId: targetBill.id,
      billNo: targetBill.billNo,
      amount: extraCollected,
      channel: options.paymentMethod || 'เงินสด',
      customerName: targetBill.customerName,
      category: 'ค่าปรับ/ค่าชำรุด',
      isDeposit: false,
      refNo: `TX-RET-${returnNo}`,
      description: `รับชำระค่าปรับ/ชำรุด ใบคืนเลขที่ ${returnNo}`,
      correlationId,
    })

    recordAuditLog({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'PAYMENT_RECEIVE',
      entityType: 'FINANCE',
      entityId: feeTx.id,
      billId: targetBill.id,
      before: null,
      after: {
        billNo: targetBill.billNo,
        amount: extraCollected,
        returnNo,
      },
      correlationId,
    })
  }

  // 7. Calculate final financial figures on the bill using Central Financial Core
  const newGrandTotal = toBaht(addSatang(toSatang(targetBill.grandTotal || 0), toSatang(totalDamageFee)))
  const newBillAmount = newGrandTotal

  // Strictly reconcile Net Paid from transaction history
  const finSummary = getBillFinanceSummary(targetBill.id, targetBill.billNo)
  const newPaidAmount = finSummary.netPaid
  const newOutstanding = toBaht(Math.max(0, subtractSatang(toSatang(newGrandTotal), toSatang(newPaidAmount))))

  const updatedBill: FullBill = {
    ...targetBill,
    items: updatedItems,
    rentalStatus: nextRentalStatus,
    grandTotal: newGrandTotal,
    billAmount: newBillAmount,
    paidAmount: newPaidAmount,
    outstandingAmount: newOutstanding,
    heldDepositAmount: heldDepositAfter,
    depositApplied: toBaht(addSatang(toSatang(targetBill.depositApplied || 0), toSatang(depositApplied))),
    refundDueAmount: toBaht(addSatang(toSatang(targetBill.refundDueAmount || 0), toSatang(depositRefundDue))),
    paymentStatus: newOutstanding <= 0 ? 'PAID' : (newPaidAmount > 0 ? 'PARTIAL' : 'UNPAID'),
    deposits: updatedDeposits,
  }

  updateBill(updatedBill)

  recordAuditLog({
    userId: actorUserId,
    displayName: actorDisplayName,
    action: 'BILL_RETURN',
    entityType: 'BILL',
    entityId: updatedBill.id,
    before: {
      billNo: targetBill.billNo,
      rentalStatus: targetBill.rentalStatus,
    },
    after: {
      billNo: updatedBill.billNo,
      rentalStatus: nextRentalStatus,
      returnNo,
      remainingOutstanding: totalRemainingOutstanding,
      isFullyReturned,
      totalDamageFee,
      depositApplied,
      depositRefundDue,
      additionalAmountDue,
    },
    correlationId,
  })

  return {
    bill: updatedBill,
    correlationId,
    returnNo,
    totalDamageCharges: totalDamageFee,
    totalDamageFee,
    depositApplied,
    depositRefund: depositRefundDue,
    depositRefundDue,
    additionalAmountDue,
  }
}
