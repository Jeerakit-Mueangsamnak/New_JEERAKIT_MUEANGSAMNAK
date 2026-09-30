/**
 * Centralized Bill Workflow Service
 *
 * Single source of truth for all Bill lifecycle mutations:
 * - Creation with Split Payments & Deposit separation
 * - Return Inspection with precise Normal/Damaged/Lost stock updates
 * - Bill Revision with version tracking, stock delta, and refund-due calculations
 * - Safe Cancellation/Void without hard delete or blind stock returns
 * - Deposit & Payment Refunds
 * - Seamless linkage to Audit Service via correlationId
 */

import { FullBill, FullBillItem } from '@/lib/types/rental-return'
import { RentalStatus } from '@/lib/types/rental-pos'
import type { ActorInfo } from '@/lib/types/actor'
export type { ActorInfo } from '@/lib/types/actor'
import type { SplitTenderInput } from '@/lib/types/bill-workflow'
export type { SplitTenderInput } from '@/lib/types/bill-workflow'
import { createBillWorkflow } from '@/features/bills/services/bill-creation-workflow-service'
import {
  loadBills,
  saveBills,
  updateBill,
  saveBillToSupabase,
  trackBillPersistence,
  dbBillToFullBill,
} from '@/features/bills/services/bill-storage'
import {
  recordExpense,
  addTransaction,
  StatementTransaction,
} from '@/features/finance/services/finance-storage'
import { createClient } from '@/lib/supabase/client'
import {
  rentProductStock,
  loadProducts,
  syncProductReservedStock,
  validateStockInvariants,
} from '@/features/products/services/product-storage'
import { recordStockMovement } from '@/features/stock/services/stock-movement'
import {
  dispatchReservationsBySource,
  releaseReservationsBySource,
  ReservationRecord,
} from '@/features/reservations/services/reservation-storage'
import {
  cancelBackordersBySource,
  BackorderRecord,
} from '@/features/reservations/services/backorder-storage'
import {
  recordAuditLog,
  generateCorrelationId,
} from '@/features/audits/services/audit-storage'

export { createBillWorkflow }
export type { CreateBillOptions } from '@/features/bills/services/bill-creation-workflow-service'

// ─── 1.05 DRAFT BILL WORKFLOWS ────────────────────────────────────────────────

export interface SaveDraftBillOptions {
  bill?: FullBill
  billData?: Partial<FullBill>
  actor: ActorInfo
  correlationId?: string
}

/**
 * Save or update a bill in DRAFT state.
 * Invariants:
 * - rentalStatus strictly 'DRAFT'.
 * - paymentStatus strictly 'UNPAID'.
 * - dispatchStatus strictly 'PENDING'.
 * - Does NOT create finance transactions.
 * - Does NOT reserve stock or create reservations.
 * - Does NOT alter physical inventory.
 * - Audits BILL_DRAFT_SAVE with correlationId.
 */
export function saveDraftBillWorkflow(options: SaveDraftBillOptions): {
  bill: FullBill
  correlationId: string
} {
  const correlationId = options.correlationId || generateCorrelationId()
  const actorUserId = options.actor.userId || 'system'
  const actorDisplayName = options.actor.displayName || 'ระบบ'
  const rawBill = options.bill || (options.billData as FullBill) || {}

  const draftBill: FullBill = {
    ...rawBill,
    id: rawBill.id || `bill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    billNo: rawBill.billNo || `BILL-${Date.now()}`,
    billDate: rawBill.billDate || new Date().toISOString().slice(0, 10),
    customerName: rawBill.customerName || 'ลูกค้าทั่วไป',
    customerPhone: rawBill.customerPhone || '',
    rentalStartDate: rawBill.rentalStartDate || new Date().toISOString().slice(0, 10),
    scheduledReturnDate: rawBill.scheduledReturnDate || new Date().toISOString().slice(0, 10),
    rentalStatus: 'DRAFT',
    paymentStatus: 'UNPAID',
    dispatchStatus: 'PENDING',
    paidAmount: 0,
    paidDepositAmount: 0,
    heldDepositAmount: Number(rawBill.heldDepositAmount || rawBill.paidDepositAmount || (rawBill as any).depositAmount || 0),
    grandTotal: Number(rawBill.grandTotal || 0),
    outstandingAmount: Number(rawBill.grandTotal || 0),
    items: rawBill.items || [],
  }

  const currentBills = loadBills()
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
    trackBillPersistence(saveBillToSupabase(draftBill))
  } else {
    saveBills([draftBill, ...currentBills.filter((b) => b.id !== draftBill.id)])
  }

  recordAuditLog({
    userId: actorUserId,
    displayName: actorDisplayName,
    action: 'BILL_DRAFT_SAVE',
    entityType: 'BILL',
    entityId: draftBill.id,
    before: null,
    after: {
      billNo: draftBill.billNo,
      customerName: draftBill.customerName,
      grandTotal: draftBill.grandTotal,
      rentalStatus: 'DRAFT',
      paymentStatus: 'UNPAID',
      dispatchStatus: 'PENDING',
      itemCount: draftBill.items.length,
    },
    correlationId,
  })

  return { bill: draftBill, correlationId }
}

export interface ConfirmDraftBillOptions {
  billId: string
  splitTenders?: SplitTenderInput[]
  paymentSplits?: Array<{ channel: string; amount: number; referenceNo?: string }>
  depositAmount?: number
  depositChannel?: string
  depositReferenceNo?: string
  dispatchStatus?: 'PENDING' | 'DISPATCHED'
  actor: ActorInfo
  correlationId?: string
}

/**
 * Confirm an existing DRAFT bill into an active RENTING/CLOSED bill.
 * Invariants:
 * - Operates on the exact same bill ID (no duplicate bill creation).
 * - Transitions rentalStatus from DRAFT -> RENTING (or CLOSED).
 * - Executes stock reservations/dispatch and payments centrally.
 * - Audits BILL_CONFIRM with shared correlationId.
 */
export function confirmDraftBillWorkflow(options: ConfirmDraftBillOptions): {
  bill: FullBill
  correlationId: string
  transactions: StatementTransaction[]
  reservations?: ReservationRecord[]
  backorders?: BackorderRecord[]
} {
  const correlationId = options.correlationId || generateCorrelationId()
  const currentBills = loadBills()
  const targetBill = currentBills.find((b) => b.id === options.billId)
  if (!targetBill) {
    throw new Error(`Bill ${options.billId} not found`)
  }
  if (targetBill.rentalStatus !== 'DRAFT') {
    throw new Error(`Bill ${targetBill.billNo} is not in DRAFT status (current: ${targetBill.rentalStatus})`)
  }

  const hasRentalItems = targetBill.items.some((i) => i.rentalType !== 'SALE' && i.requiresReturn !== false)
  const dispatchStatus = options.dispatchStatus || targetBill.dispatchStatus || 'PENDING'
  const targetRentalStatus: RentalStatus = dispatchStatus === 'DISPATCHED'
    ? (hasRentalItems ? 'RENTING' : 'CLOSED')
    : 'CONFIRMED'

  const normalizedSplits = options.splitTenders
    ? options.splitTenders.map((t) => ({ channel: t.paymentMethod, amount: t.amount, referenceNo: t.referenceNo }))
    : options.paymentSplits || []
  const totalPaidInSplits = normalizedSplits.reduce((sum, s) => sum + Number(s.amount || 0), 0)
  const paidAmount = totalPaidInSplits > 0 ? totalPaidInSplits : (targetBill.paidAmount || 0)
  const heldDeposit = Number(options.depositAmount !== undefined ? options.depositAmount : (targetBill.heldDepositAmount || 0))
  const grandTotal = Number(targetBill.grandTotal || 0)
  const outstandingAmount = Math.max(0, grandTotal - paidAmount)
  const paymentStatus = paidAmount >= grandTotal ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID'

  const billToConfirm: FullBill = {
    ...targetBill,
    rentalStatus: targetRentalStatus,
    dispatchStatus,
    paidAmount,
    heldDepositAmount: heldDeposit,
    paidDepositAmount: heldDeposit,
    outstandingAmount,
    paymentStatus,
  }

  const result = createBillWorkflow({
    bill: billToConfirm,
    splitTenders: options.splitTenders,
    paymentSplits: options.paymentSplits,
    depositAmount: heldDeposit,
    depositChannel: options.depositChannel,
    depositReferenceNo: options.depositReferenceNo,
    actor: options.actor,
    correlationId,
  })

  recordAuditLog({
    userId: options.actor.userId || 'system',
    displayName: options.actor.displayName || 'ระบบ',
    action: 'BILL_CONFIRM',
    entityType: 'BILL',
    entityId: result.bill.id,
    before: { billNo: targetBill.billNo, rentalStatus: 'DRAFT' },
    after: {
      billNo: result.bill.billNo,
      rentalStatus: result.bill.rentalStatus,
      dispatchStatus: result.bill.dispatchStatus,
      paidAmount: result.bill.paidAmount,
    },
    correlationId,
  })

  return result
}


// ─── 1.1 DISPATCH BILL WORKFLOW ───────────────────────────────────────────────

export interface DispatchBillOptions {
  billId: string
  actor: ActorInfo
  correlationId?: string
  deliveries?: Array<{
    rentalBillItemId: string
    deliveredQty: number
  }>
}

/**
 * Dispatch a bill (transitions PENDING -> DISPATCHED).
 * Invariants:
 * - Idempotent: Repeat calls do not re-deduct physical stock.
 * - Atomic validation: All items checked before any stock mutation.
 * - Transitions active reservations to DISPATCHED.
 * - Deducts physical stock: RENT -> increments rentedQuantity, SALE -> deducts totalQuantity.
 * - Syncs product reservedQuantity and checks non-negative stock invariants.
 * - Supports Partial Sale Delivery.
 * - Mixed bills: Keeps RENT and SALE statuses independent.
 */
export async function dispatchBillWorkflow(options: DispatchBillOptions): Promise<{
  bill: FullBill
  correlationId: string
  dispatchedReservations: ReservationRecord[]
}> {
  const correlationId = options.correlationId || generateCorrelationId()
  const actorUserId = options.actor.userId || 'system'
  const actorDisplayName = options.actor.displayName || 'ระบบ'

  const currentBills = loadBills()
  const targetBill = currentBills.find((b) => b.id === options.billId)
  if (!targetBill) {
    throw new Error(`Bill ${options.billId} not found`)
  }
  if (targetBill.rentalStatus === 'CANCELLED' || targetBill.rentalStatus === 'VOID') {
    throw new Error(`Cannot dispatch cancelled or voided bill`)
  }

  const hasSaleItems = targetBill.items.some((i) => i.rentalType === 'SALE' || i.itemType === 'SALE' || i.requiresReturn === false)

  // Idempotency: If already fully dispatched and no partial delivery requested, return existing bill safely
  if (targetBill.dispatchStatus === 'DISPATCHED') {
    const allSaleDone = !hasSaleItems || targetBill.deliveryStatus === 'DELIVERED'
    if (allSaleDone && !options.deliveries) {
      return { bill: targetBill, correlationId, dispatchedReservations: [] }
    }
  }

  // Pre-calculate needed quantities per item and validate before mutating ANY state (Atomic validation)
  const neededByProduct = new Map<string, number>()
  for (const item of targetBill.items) {
    const isSale = item.rentalType === 'SALE' || item.itemType === 'SALE'
    let toDeduct = 0
    if (isSale) {
      const deliv = options.deliveries?.find(
        (d) => d.rentalBillItemId === item.rentalBillItemId || d.rentalBillItemId === (item as any).id
      )
      const ordered = item.orderedQty ?? item.quantity
      const currentDelivered = item.deliveredQty ?? 0
      const remaining = item.remainingQty !== undefined ? item.remainingQty : Math.max(0, ordered - currentDelivered)
      toDeduct = deliv !== undefined ? deliv.deliveredQty : (targetBill.dispatchStatus === 'DISPATCHED' ? 0 : remaining)
      if (deliv && deliv.deliveredQty > remaining) {
        throw new Error(
          `จำนวนส่งมอบ (${deliv.deliveredQty}) เกินจำนวนคงค้างที่ต้องส่ง (${remaining}) สำหรับสินค้า "${item.productName}"`
        )
      }
    } else {
      toDeduct = targetBill.dispatchStatus === 'DISPATCHED' ? 0 : item.quantity
    }
    if (toDeduct > 0) {
      neededByProduct.set(item.productId, (neededByProduct.get(item.productId) || 0) + toDeduct)
    }
  }

  const allProds = loadProducts()
  for (const [prodId, neededQty] of neededByProduct.entries()) {
    const prod = allProds.find((p) => p.id === prodId)
    if (!prod) {
      throw new Error(`ไม่พบข้อมูลสินค้า ID "${prodId}" ในระบบ`)
    }
    const avail = prod.availableQuantity ?? 0
    if (avail < neededQty) {
      throw new Error(
        `สินค้า "${prod.name}" (รหัส: ${prod.code || prod.id}) สต็อกไม่เพียงพอสำหรับการส่งมอบ (ต้องการ ${neededQty}, มีพร้อมใช้ ${avail})`
      )
    }
  }

  // 1. Transition active reservations to DISPATCHED
  const dispatchedReservations = [
    ...dispatchReservationsBySource('BILL', targetBill.id, correlationId),
    ...(targetBill.quotationId ? dispatchReservationsBySource('QUOTATION', targetBill.quotationId, correlationId) : []),
  ]

  // 2. Deduct physical stock & log stock movements
  const updatedItems: FullBillItem[] = []
  for (const item of targetBill.items) {
    const isSale = item.rentalType === 'SALE' || item.itemType === 'SALE'
    if (isSale) {
      const deliv = options.deliveries?.find(
        (d) => d.rentalBillItemId === item.rentalBillItemId || d.rentalBillItemId === (item as any).id
      )
      const ordered = item.orderedQty ?? item.quantity
      const currentDelivered = item.deliveredQty ?? 0
      const remaining = item.remainingQty !== undefined ? item.remainingQty : Math.max(0, ordered - currentDelivered)
      const deliverQty = deliv !== undefined ? deliv.deliveredQty : (targetBill.dispatchStatus === 'DISPATCHED' ? 0 : remaining)

      if (deliverQty > 0) {
        const prodBefore = loadProducts().find((p) => p.id === item.productId)
        rentProductStock(item.productId, deliverQty, true)
        syncProductReservedStock(item.productId)
        const prodAfter = loadProducts().find((p) => p.id === item.productId)
        if (prodAfter) validateStockInvariants(prodAfter)

        await recordStockMovement({
          type: 'SALE',
          productId: item.productId,
          billId: targetBill.id,
          billLineId: item.rentalBillItemId || (item as any).id,
          quantity: deliverQty,
          beforeState: {
            availableQuantity: prodBefore?.availableQuantity,
            totalQuantity: prodBefore?.totalQuantity,
          },
          afterState: {
            availableQuantity: prodAfter?.availableQuantity,
            totalQuantity: prodAfter?.totalQuantity,
          },
          actor: { userId: actorUserId, displayName: actorDisplayName },
          correlationId,
          reason: 'ส่งมอบสินค้าขาย (Sale Delivery)',
        })

        recordAuditLog({
          userId: actorUserId,
          displayName: actorDisplayName,
          action: 'STOCK_SALE',
          entityType: 'STOCK',
          entityId: item.productId,
          before: { productId: item.productId, dispatchStatus: item.deliveryStatus || 'PENDING' },
          after: {
            quantity: deliverQty,
            billNo: targetBill.billNo,
            deliveryStatus: 'DELIVERED',
          },
          correlationId,
        })

        const newDelivered = currentDelivered + deliverQty
        const newRemaining = Math.max(0, ordered - newDelivered)
        const itemDeliveryStatus = newRemaining === 0 ? 'DELIVERED' : 'PARTIAL_DELIVERED'

        updatedItems.push({
          ...item,
          orderedQty: ordered,
          deliveredQty: newDelivered,
          remainingQty: newRemaining,
          deliveryStatus: itemDeliveryStatus,
          status: itemDeliveryStatus === 'DELIVERED' ? 'DELIVERED' : 'PARTIAL_DELIVERED',
        })
        continue
      }
      updatedItems.push(item)
      continue
    } else {
      // RENT item
      if (targetBill.dispatchStatus !== 'DISPATCHED') {
        const prodBefore = loadProducts().find((p) => p.id === item.productId)
        rentProductStock(item.productId, item.quantity, false)
        syncProductReservedStock(item.productId)
        const prodAfter = loadProducts().find((p) => p.id === item.productId)
        if (prodAfter) validateStockInvariants(prodAfter)

        await recordStockMovement({
          type: 'RENT',
          productId: item.productId,
          billId: targetBill.id,
          billLineId: item.rentalBillItemId || (item as any).id,
          quantity: item.quantity,
          beforeState: {
            availableQuantity: prodBefore?.availableQuantity,
            rentedQuantity: prodBefore?.rentedQuantity,
            totalQuantity: prodBefore?.totalQuantity,
          },
          afterState: {
            availableQuantity: prodAfter?.availableQuantity,
            rentedQuantity: prodAfter?.rentedQuantity,
            totalQuantity: prodAfter?.totalQuantity,
          },
          actor: { userId: actorUserId, displayName: actorDisplayName },
          correlationId,
          reason: 'ส่งมอบสินค้าเช่า (Rent Dispatch)',
        })

        recordAuditLog({
          userId: actorUserId,
          displayName: actorDisplayName,
          action: 'STOCK_RENT',
          entityType: 'STOCK',
          entityId: item.productId,
          before: { productId: item.productId, dispatchStatus: 'PENDING' },
          after: {
            quantity: item.quantity,
            billNo: targetBill.billNo,
            dispatchStatus: 'DISPATCHED',
          },
          correlationId,
        })

        updatedItems.push({
          ...item,
          status: 'RENTING',
        })
        continue
      }
      updatedItems.push(item)
      continue
    }
  }

  // 3. Reconcile statuses independently for Mixed Bills
  const rentalItems = updatedItems.filter((i) => i.rentalType !== 'SALE' && i.itemType !== 'SALE' && i.requiresReturn !== false)
  const saleItems = updatedItems.filter((i) => i.rentalType === 'SALE' || i.itemType === 'SALE' || i.requiresReturn === false)

  const hasRental = rentalItems.length > 0
  const hasSale = saleItems.length > 0

  const allSaleDelivered = hasSale && saleItems.every((i) => (i.remainingQty ?? 0) === 0 && (i.deliveredQty ?? 0) >= (i.orderedQty ?? i.quantity))
  const anySaleDelivered = hasSale && saleItems.some((i) => (i.deliveredQty ?? 0) > 0)
  const saleDeliveryStatus = allSaleDelivered ? 'DELIVERED' : (anySaleDelivered ? 'PARTIAL_DELIVERED' : 'PENDING')

  let nextRentalStatus: RentalStatus = targetBill.rentalStatus
  let nextDispatchStatus = targetBill.dispatchStatus

  if (hasRental) {
    nextRentalStatus = 'RENTING'
    nextDispatchStatus = 'DISPATCHED'
  } else {
    // Only SALE items in this bill
    nextDispatchStatus = allSaleDelivered ? 'DISPATCHED' : (anySaleDelivered ? 'PARTIAL_DELIVERED' : 'PENDING')
    nextRentalStatus = allSaleDelivered ? 'CLOSED' : 'CONFIRMED'
  }

  const updatedBill: FullBill = {
    ...targetBill,
    items: updatedItems,
    dispatchStatus: nextDispatchStatus as any,
    deliveryStatus: hasSale ? saleDeliveryStatus : undefined,
    rentalStatus: nextRentalStatus,
  }

  updateBill(updatedBill)

  recordAuditLog({
    userId: actorUserId,
    displayName: actorDisplayName,
    action: 'BILL_DISPATCH',
    entityType: 'BILL',
    entityId: updatedBill.id,
    before: { billNo: targetBill.billNo, dispatchStatus: targetBill.dispatchStatus, rentalStatus: targetBill.rentalStatus },
    after: { billNo: updatedBill.billNo, dispatchStatus: updatedBill.dispatchStatus, rentalStatus: updatedBill.rentalStatus },
    correlationId,
  })

  return { bill: updatedBill, correlationId, dispatchedReservations }
}

// ─── 2. SPLIT PAYMENT WORKFLOW ───────────────────────────────────────────────

export interface ProcessSplitPaymentOptions {
  billId: string
  requestId?: string
  tenders?: SplitTenderInput[]
  splits?: Array<{ channel?: string; paymentMethod?: string; amount: number; referenceNo?: string }>
  actor: ActorInfo
  paymentDate?: string
  correlationId?: string
}

export interface ProcessSplitPaymentResult {
  bill: FullBill
  correlationId: string
  transactions: StatementTransaction[]
  batchId?: string
  receiptNo?: string
  tenders?: SplitTenderInput[]
  isIdempotentReplay?: boolean
}

export async function processSplitPaymentWorkflow(
  options: ProcessSplitPaymentOptions
): Promise<ProcessSplitPaymentResult> {
  const correlationId = options.correlationId || generateCorrelationId()
  const actorUserId = options.actor.userId || 'system'
  const actorDisplayName = options.actor.displayName || 'ระบบ'
  const requestId = options.requestId || generateCorrelationId()

  const rawTenders = options.tenders || (options.splits || []).map((s) => ({
    paymentMethod: s.paymentMethod || s.channel || 'เงินสด',
    amount: s.amount,
    referenceNo: s.referenceNo,
    cashReceived: s.amount,
  }))
  const validTenders = rawTenders.filter((t) => Number(t.amount || 0) > 0)
  const totalPayment = validTenders.reduce((sum, t) => sum + Number(t.amount || 0), 0)

  if (totalPayment <= 0) {
    throw new Error('Total payment amount must be greater than 0')
  }

  // Create deterministic payload hash for idempotency comparison
  const payloadHash = JSON.stringify({
    billId: options.billId,
    tenders: validTenders
      .map((t) => ({
        method: t.paymentMethod,
        amount: Number(t.amount),
        ref: t.referenceNo || '',
      }))
      .sort((a, b) => a.method.localeCompare(b.method)),
  })

  const supabase = createClient()
  const { data, error } = await supabase.rpc('process_split_payment_rpc', {
    p_bill_id: options.billId,
    p_request_id: requestId,
    p_payload_hash: payloadHash,
    p_tenders: validTenders.map((t) => ({
      paymentMethod: t.paymentMethod,
      amount: Number(t.amount),
      referenceNo: t.referenceNo || '',
      cashReceived: Number(t.cashReceived || t.amount),
    })),
    p_payment_date: options.paymentDate ? new Date(options.paymentDate).toISOString() : new Date().toISOString(),
    p_actor_user_id: actorUserId,
    p_actor_display_name: actorDisplayName,
    p_correlation_id: correlationId,
  })

  if (error) {
    // Strictly throw error - do not silently fallback to localStorage
    throw new Error(`การรับชำระเงินล้มเหลว: ${error.message}`)
  }

  if (!data || data.status === 'ERROR') {
    throw new Error(`การรับชำระเงินล้มเหลว: ${data?.message || 'ไม่สามารถประมวลผลธุรกรรมได้'}`)
  }

  const updatedBill = dbBillToFullBill(data.bill)
  const transactions: StatementTransaction[] = Array.isArray(data.transactions)
    ? data.transactions.map((tx: any) => ({
        id: tx.id,
        dateTime: options.paymentDate || new Date().toISOString(),
        refNo: tx.refNo || tx.ref_no || `TX-${updatedBill.billNo}`,
        type: 'INCOME' as const,
        category: 'ค่าเช่าอุปกรณ์',
        description: `รับชำระเงิน (${tx.channel}) บิลเลขที่ ${updatedBill.billNo}`,
        customerName: updatedBill.customerName,
        incomeAmount: Number(tx.amount || tx.income_amount || 0),
        expenseAmount: 0,
        runningBalance: 0,
        channel: tx.channel,
        billId: updatedBill.id,
        billNo: updatedBill.billNo,
        correlationId,
        isDeposit: false,
      }))
    : []

  // Update local memory cache with confirmed DB data
  updateBill(updatedBill)
  for (const tx of transactions) {
    // RPC already persisted this ledger row atomically; cache it without writing again.
    addTransaction(tx, { persist: false })
  }

  return {
    bill: updatedBill,
    correlationId,
    transactions,
    batchId: data.batch_id,
    receiptNo: data.receipt_no,
    tenders: validTenders,
    isIdempotentReplay: data.status === 'IDEMPOTENT_REPLAY',
  }
}

export async function fetchLatestPaymentBatch(billId: string): Promise<{
  paymentNo: string
  receiptNo: string
  totalAmount: number
  outstandingAfter: number
  paidAmountAfter: number
  tenders: SplitTenderInput[]
} | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('payment_batches')
    .select('*')
    .eq('bill_id', billId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  return {
    paymentNo: data.id,
    receiptNo: data.receipt_no,
    totalAmount: Number(data.total_amount || 0),
    outstandingAfter: Number(data.outstanding_after || 0),
    paidAmountAfter: Number(data.paid_amount_after || 0),
    tenders: Array.isArray(data.tenders) ? data.tenders : [],
  }
}

// ─── 3. RETURN WORKFLOW (NORMAL, DAMAGED, LOST) ──────────────────────────────

export { processReturnWorkflow } from '@/features/bills/services/return-workflow-service'
export type { ProcessReturnOptions, ReturnDamageChargeInput, ReturnItemInput } from '@/features/bills/services/return-workflow-service'

// ─── 4. BILL REVISION WORKFLOW ───────────────────────────────────────────────

export { processBillRevisionWorkflow } from '@/features/bills/services/bill-revision-workflow-service'
export type { ProcessBillRevisionOptions, RevisedItemInput } from '@/features/bills/services/bill-revision-workflow-service'

// ─── 5. CANCEL / VOID BILL WORKFLOW ──────────────────────────────────────────

export interface CancelBillOptions {
  billId: string
  reason: string
  actor: ActorInfo
  actionType?: 'CANCEL' | 'VOID'
  correlationId?: string
}

export function cancelOrVoidBillWorkflow(options: CancelBillOptions): {
  bill: FullBill
  correlationId: string
  refundTransaction?: StatementTransaction
  releasedReservations?: ReservationRecord[]
} {
  const correlationId = options.correlationId || generateCorrelationId()
  const actorUserId = options.actor.userId || 'system'
  const actorDisplayName = options.actor.displayName || 'ระบบ'
  const trimmedReason = options.reason.trim()
  const actionType = options.actionType || 'CANCEL'

  if (!trimmedReason) {
    throw new Error('Reason is required for cancelling or voiding a bill')
  }

  const currentBills = loadBills()
  const targetBill = currentBills.find((b) => b.id === options.billId)
  if (!targetBill) {
    throw new Error(`Bill ${options.billId} not found`)
  }

  // Dispatch Check:
  // "ถ้ายังไม่ Dispatch/ส่งมอบ: Cancel แล้วสามารถ Release Reservation/คืน Stock ที่ถูกกันไว้ได้"
  // "ถ้าสินค้าถูกส่งหรือปล่อยเช่าแล้ว: ห้าม Cancel แล้วเพิ่ม Available กลับทันที"
  // "Void เพียงอย่างเดียวห้ามทำให้สินค้าที่อยู่กับลูกค้ากลับ Available"
  const isDispatched = targetBill.dispatchStatus === 'DISPATCHED'
  let releasedReservations: ReservationRecord[] = []

  if (!isDispatched) {
    // Release active reservations and backorders
    const billResvs = releaseReservationsBySource('BILL', targetBill.id, trimmedReason, correlationId)
    const quoteResvs = targetBill.quotationId
      ? releaseReservationsBySource('QUOTATION', targetBill.quotationId, trimmedReason, correlationId)
      : []
    releasedReservations = [...billResvs, ...quoteResvs]
    cancelBackordersBySource('BILL', targetBill.id, trimmedReason)

    targetBill.items.forEach((item) => {
      syncProductReservedStock(item.productId)

      /* Reservation release handled in db */

      recordAuditLog({
        userId: actorUserId,
        displayName: actorDisplayName,
        action: 'STOCK_RELEASE',
        entityType: 'STOCK',
        entityId: item.productId,
        before: { billNo: targetBill.billNo, quantity: item.quantity },
        after: { status: 'RELEASED', dispatchStatus: 'PENDING' },
        reason: trimmedReason,
        correlationId,
      })
    })
  }

  // Handle existing payments: DO NOT delete original payments! Create refund/reversal transaction
  let refundTransaction: StatementTransaction | undefined
  const paid = targetBill.paidAmount || 0
  if (paid > 0) {
    refundTransaction = recordExpense({
      refNo: `REFUND-${targetBill.billNo}`,
      amount: paid,
      customerName: targetBill.customerName,
      billId: targetBill.id,
      billNo: targetBill.billNo,
      category: 'คืนเงินยกเลิกบิล',
      description: `คืนเงินจากการยกเลิกบิล ${targetBill.billNo}: ${trimmedReason}`,
      correlationId,
      isDeposit: false,
    })

    recordAuditLog({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'PAYMENT_REFUND',
      entityType: 'FINANCE',
      entityId: refundTransaction.id,
      before: { billNo: targetBill.billNo, paidAmount: paid },
      after: {
        refNo: refundTransaction.refNo,
        refundAmount: paid,
        reason: trimmedReason,
      },
      reason: trimmedReason,
      correlationId,
    })
  }

  // Handle deposit refund if held
  const heldDeposit = targetBill.heldDepositAmount || 0
  if (heldDeposit > 0) {
    const depRefundTx = recordExpense({
      refNo: `DEP-REFUND-${targetBill.billNo}`,
      amount: heldDeposit,
      customerName: targetBill.customerName,
      billId: targetBill.id,
      billNo: targetBill.billNo,
      category: 'คืนเงินมัดจำ',
      description: `คืนมัดจำจากการยกเลิกบิล ${targetBill.billNo}: ${trimmedReason}`,
      correlationId,
      isDeposit: true,
    })

    recordAuditLog({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'DEPOSIT_REFUND',
      entityType: 'FINANCE',
      entityId: depRefundTx.id,
      before: { billNo: targetBill.billNo, heldDepositAmount: heldDeposit },
      after: {
        refNo: depRefundTx.refNo,
        refundAmount: heldDeposit,
      },
      reason: trimmedReason,
      correlationId,
    })
  }

  const nextRentalStatus = actionType === 'VOID' ? 'VOID' : 'CANCELLED'
  const nextPaymentStatus = paid > 0 ? 'REFUNDED' : targetBill.paymentStatus

  const updatedBill: FullBill = {
    ...targetBill,
    rentalStatus: nextRentalStatus,
    paymentStatus: nextPaymentStatus,
    cancelledAt: new Date().toISOString(),
    cancelReason: trimmedReason,
    outstandingAmount: 0,
    heldDepositAmount: 0,
    depositRefunded: (targetBill.depositRefunded || 0) + heldDeposit,
    remark: [targetBill.remark, `${actionType === 'VOID' ? 'โมฆะ' : 'ยกเลิก'}บิล: ${trimmedReason}`].filter(Boolean).join(' | '),
  }

  updateBill(updatedBill)

  recordAuditLog({
    userId: actorUserId,
    displayName: actorDisplayName,
    action: actionType === 'VOID' ? 'BILL_VOID' : 'BILL_CANCEL',
    entityType: 'BILL',
    entityId: updatedBill.id,
    before: {
      billNo: targetBill.billNo,
      rentalStatus: targetBill.rentalStatus,
      paymentStatus: targetBill.paymentStatus,
      grandTotal: targetBill.grandTotal,
      paidAmount: targetBill.paidAmount,
    },
    after: {
      billNo: updatedBill.billNo,
      rentalStatus: nextRentalStatus,
      paymentStatus: nextPaymentStatus,
      cancelReason: trimmedReason,
      stockRestored: !isDispatched,
    },
    reason: trimmedReason,
    correlationId,
  })

  return { bill: updatedBill, correlationId, refundTransaction, releasedReservations }
}

export { processDepositRefundWorkflow, processPaymentRefundWorkflow } from '@/features/bills/services/bill-refund-workflow-service'
export type { ProcessDepositRefundOptions, ProcessPaymentRefundOptions, ProcessPaymentRefundResult } from '@/features/bills/services/bill-refund-workflow-service'

// Reservation-domain workflows live outside the bill lifecycle service.
export {
  checkAndExpireReservations,
  fulfillBackorderWorkflow,
} from '@/features/reservations/services/reservation-workflow-service'
export type {
  ExpireReservationsResult,
  FulfillBackorderWorkflowOptions,
} from '@/features/reservations/services/reservation-workflow-service'
