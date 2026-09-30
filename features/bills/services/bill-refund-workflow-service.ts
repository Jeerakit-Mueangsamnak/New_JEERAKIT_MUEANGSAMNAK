import type { FullBill } from '@/lib/types/rental-return'
import type { ActorInfo } from '@/lib/types/actor'
import { loadBills, updateBill, dbBillToFullBill } from '@/features/bills/services/bill-storage'
import { recordExpense, getBillFinanceSummary, loadTransactions, saveTransactions, type StatementTransaction } from '@/features/finance/services/finance-storage'
import { createClient } from '@/lib/supabase/client'
import { toSatang, toBaht, addSatang, subtractSatang } from '@/lib/money'
import { recordAuditLog, generateCorrelationId } from '@/features/audits/services/audit-storage'

// ─── 6. DEPOSIT REFUND WORKFLOW ──────────────────────────────────────────────

export interface ProcessDepositRefundOptions {
  billId: string
  amount: number
  channel: string
  referenceNo?: string
  note?: string
  depositId?: string
  actor: ActorInfo
  correlationId?: string
}

export function processDepositRefundWorkflow(options: ProcessDepositRefundOptions): {
  bill: FullBill
  correlationId: string
  transaction: StatementTransaction
  refundTx: StatementTransaction
} {
  const correlationId = options.correlationId || generateCorrelationId()
  const actorUserId = options.actor.userId || 'system'
  const actorDisplayName = options.actor.displayName || 'ระบบ'

  const currentBills = loadBills()
  const targetBill = currentBills.find((b) => b.id === options.billId)
  if (!targetBill) {
    throw new Error(`Bill ${options.billId} not found`)
  }

  const currentHeld = targetBill.heldDepositAmount || 0
  if (options.amount <= 0 || options.amount > currentHeld) {
    throw new Error(`Refund amount (${options.amount}) exceeds held deposit (฿${currentHeld})`)
  }

  const tx = recordExpense({
    refNo: options.referenceNo || `DEP-REF-${Date.now().toString().slice(-6)}`,
    amount: options.amount,
    channel: options.channel,
    customerName: targetBill.customerName,
    category: 'คืนเงินมัดจำ',
    description: options.note || `คืนเงินมัดจำ บิลเลขที่ ${targetBill.billNo}`,
    billId: targetBill.id,
    billNo: targetBill.billNo,
    isDeposit: true,
    correlationId,
  })

  recordAuditLog({
    userId: actorUserId,
    displayName: actorDisplayName,
    action: 'DEPOSIT_REFUND',
    entityType: 'FINANCE',
    entityId: tx.id,
    before: { billNo: targetBill.billNo, heldDepositAmount: currentHeld },
    after: {
      refNo: tx.refNo,
      amount: options.amount,
      remainingHeld: currentHeld - options.amount,
    },
    correlationId,
  })

  // Update deposits array if matching deposit exists
  const updatedDeposits = (targetBill.deposits || []).map((dep) => {
    if (options.depositId && dep.id === options.depositId) {
      const newHeld = Math.max(0, dep.heldAmount - options.amount)
      return {
        ...dep,
        heldAmount: newHeld,
        refundAmount: (dep.refundAmount || 0) + options.amount,
        status: newHeld <= 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      }
    }
    return dep
  })

  const newHeld = Math.max(0, currentHeld - options.amount)
  const updatedBill: FullBill = {
    ...targetBill,
    heldDepositAmount: newHeld,
    depositRefunded: (targetBill.depositRefunded || 0) + options.amount,
    deposits: updatedDeposits,
  }

  updateBill(updatedBill)

  recordAuditLog({
    userId: actorUserId,
    displayName: actorDisplayName,
    action: 'BILL_DEPOSIT_UPDATE',
    entityType: 'BILL',
    entityId: updatedBill.id,
    before: { billNo: targetBill.billNo, heldDepositAmount: currentHeld },
    after: { billNo: updatedBill.billNo, heldDepositAmount: newHeld, refunded: options.amount },
    correlationId,
  })

  return { bill: updatedBill, correlationId, transaction: tx, refundTx: tx }
}

// ─── 7. PAYMENT REFUND WORKFLOW ──────────────────────────────────────────────

export interface ProcessPaymentRefundOptions {
  billId: string
  amount: number
  channel?: string
  reason: string
  referenceNo?: string
  originalTxId?: string
  actor: ActorInfo
  correlationId?: string
}

export interface ProcessPaymentRefundResult {
  bill: FullBill
  correlationId: string
  transaction: StatementTransaction
  refundTx: StatementTransaction
}

export function processPaymentRefundWorkflow(
  options: ProcessPaymentRefundOptions
): ProcessPaymentRefundResult & PromiseLike<ProcessPaymentRefundResult> {
  const correlationId = options.correlationId || generateCorrelationId()
  const actorUserId = options.actor.userId || 'system'
  const actorDisplayName = options.actor.displayName || 'ระบบ'
  const trimmedReason = options.reason?.trim()

  if (options.amount <= 0) {
    throw new Error('INVALID_AMOUNT: Refund amount must be greater than 0')
  }

  if (!trimmedReason) {
    throw new Error('REASON_REQUIRED: Reason is strictly required for payment refund')
  }

  const currentBills = loadBills()
  const targetBill = currentBills.find((b) => b.id === options.billId)
  if (!targetBill) {
    throw new Error(`Bill ${options.billId} not found`)
  }

  // Enforce cumulative refund limit using Money Core in Satang
  const summary = getBillFinanceSummary(targetBill.id, targetBill.billNo)
  const refundAmountSatang = toSatang(options.amount)
  const netPaidSatang = toSatang(summary.netPaid)

  if (refundAmountSatang > netPaidSatang) {
    throw new Error(
      `Refund amount (${options.amount}) exceeds available net paid revenue of ฿${summary.netPaid}`
    )
  }

  let effectiveChannel = options.channel

  // Validate original transaction if provided
  if (options.originalTxId) {
    const origTx = summary.transactions.find(
      (t) => t.id === options.originalTxId && t.type === 'INCOME' && !t.isDeposit
    )
    if (!origTx) {
      throw new Error(
        `ORIGINAL_TX_NOT_FOUND: Original payment transaction ${options.originalTxId} not found for bill ${targetBill.billNo}`
      )
    }

    const priorRefundsSatang = summary.transactions
      .filter((t) => t.originalTxId === options.originalTxId && t.type === 'EXPENSE' && !t.isDeposit)
      .reduce((sum, t) => addSatang(sum, toSatang(t.expenseAmount)), 0)

    const origAmountSatang = toSatang(origTx.incomeAmount)
    if (addSatang(priorRefundsSatang, refundAmountSatang) > origAmountSatang) {
      const remainingBaht = toBaht(Math.max(0, origAmountSatang - priorRefundsSatang))
      throw new Error(
        `REFUND_EXCEEDS_ORIGINAL_TX: Refund amount (${options.amount}) exceeds remaining amount of original payment (฿${remainingBaht} available)`
      )
    }

    if (!effectiveChannel) {
      effectiveChannel = origTx.channel
    }
  }

  effectiveChannel = effectiveChannel || 'โอนเงิน'

  // Pre-calculate local fallback state using Satang integer math
  const newNetPaidSatang = Math.max(0, subtractSatang(netPaidSatang, refundAmountSatang))
  const newPaidAmount = toBaht(newNetPaidSatang)
  const newOutstanding = toBaht(Math.max(0, subtractSatang(toSatang(targetBill.grandTotal), newNetPaidSatang)))
  const newPaymentStatus = newPaidAmount <= 0 ? 'REFUNDED' : 'REFUND_PARTIAL'

  // Create local transaction
  const localTx = recordExpense({
    refNo: options.referenceNo || `PAY-REF-${Date.now().toString().slice(-6)}`,
    amount: options.amount,
    channel: effectiveChannel,
    customerName: targetBill.customerName,
    category: 'คืนเงินลูกค้า',
    description: `คืนเงินรับชำระ บิลเลขที่ ${targetBill.billNo}: ${trimmedReason}`,
    billId: targetBill.id,
    billNo: targetBill.billNo,
    originalTxId: options.originalTxId,
    isDeposit: false,
    correlationId,
  })

  recordAuditLog({
    userId: actorUserId,
    displayName: actorDisplayName,
    action: 'PAYMENT_REFUND',
    entityType: 'FINANCE',
    entityId: localTx.id,
    billId: targetBill.id,
    before: { billNo: targetBill.billNo, netPaid: summary.netPaid },
    after: {
      refNo: localTx.refNo,
      amount: options.amount,
      netPaidRemaining: newPaidAmount,
      reason: trimmedReason,
      originalTxId: options.originalTxId,
      channel: effectiveChannel,
    },
    reason: trimmedReason,
    correlationId,
  })

  const localUpdatedBill: FullBill = {
    ...targetBill,
    paidAmount: newPaidAmount,
    outstandingAmount: newOutstanding,
    paymentStatus: newPaymentStatus,
  }
  updateBill(localUpdatedBill)

  recordAuditLog({
    userId: actorUserId,
    displayName: actorDisplayName,
    action: 'BILL_PAYMENT_UPDATE',
    entityType: 'BILL',
    entityId: localUpdatedBill.id,
    billId: targetBill.id,
    before: {
      billNo: targetBill.billNo,
      paidAmount: targetBill.paidAmount,
      outstandingAmount: targetBill.outstandingAmount,
      paymentStatus: targetBill.paymentStatus,
    },
    after: {
      billNo: localUpdatedBill.billNo,
      paidAmount: newPaidAmount,
      outstandingAmount: newOutstanding,
      paymentStatus: newPaymentStatus,
    },
    reason: trimmedReason,
    correlationId,
  })

  const localResult: ProcessPaymentRefundResult = {
    bill: localUpdatedBill,
    correlationId,
    transaction: localTx,
    refundTx: localTx,
  }

  // Primary Database RPC execution when running with Supabase backend
  const supabase = createClient()
  const rpcPromise = (async (): Promise<ProcessPaymentRefundResult> => {
    try {
      const { data, error } = await supabase.rpc('process_payment_refund_rpc', {
        p_bill_id: targetBill.id,
        p_original_tx_id: options.originalTxId || null,
        p_amount: options.amount,
        p_channel: effectiveChannel,
        p_reason: trimmedReason,
        p_actor_user_id: actorUserId,
        p_actor_display_name: actorDisplayName,
        p_correlation_id: correlationId,
      })

      if (error) {
        if (error.message.includes('FORBIDDEN') || error.message.includes('REFUND_EXCEEDS')) {
          throw new Error(error.message)
        }
        return localResult
      }

      if (data && data.status === 'SUCCESS') {
        const dbBill = data.bill ? dbBillToFullBill(data.bill) : localUpdatedBill
        const dbTx: StatementTransaction = {
          id: data.refund_tx_id || localTx.id,
          dateTime: new Date().toISOString(),
          refNo: data.ref_no || localTx.refNo,
          type: 'EXPENSE',
          category: 'คืนเงินลูกค้า',
          description: `คืนเงินรับชำระ บิลเลขที่ ${targetBill.billNo}: ${trimmedReason}`,
          customerName: targetBill.customerName,
          incomeAmount: 0,
          expenseAmount: Number(data.amount || options.amount),
          runningBalance: 0,
          channel: data.channel || effectiveChannel,
          billId: targetBill.id,
          billNo: targetBill.billNo,
          originalTxId: options.originalTxId,
          correlationId,
          isDeposit: false,
        }

        // Reconcile local storage using authoritative DB result (prevent duplicate transactions)
        const allTxs = loadTransactions().filter((t) => t.id !== localTx.id && t.id !== dbTx.id)
        saveTransactions([dbTx, ...allTxs])
        updateBill(dbBill)

        return {
          bill: dbBill,
          correlationId,
          transaction: dbTx,
          refundTx: dbTx,
        }
      }

      return localResult
    } catch (err: any) {
      if (err?.message?.includes('FORBIDDEN') || err?.message?.includes('REFUND_EXCEEDS')) {
        throw err
      }
      return localResult
    }
  })()

  // Return hybrid result that works synchronously and as a Thenable
  return Object.assign(localResult, {
    then<TResult1 = ProcessPaymentRefundResult, TResult2 = never>(
      onfulfilled?: ((value: ProcessPaymentRefundResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      return rpcPromise.then(onfulfilled, onrejected)
    },
    catch<TResult = never>(
      onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
    ): Promise<ProcessPaymentRefundResult | TResult> {
      return rpcPromise.catch(onrejected)
    },
    finally(onfinally?: (() => void) | null): Promise<ProcessPaymentRefundResult> {
      return rpcPromise.finally(onfinally)
    },
  })
}
