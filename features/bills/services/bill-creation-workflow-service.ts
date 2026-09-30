import type { FullBill } from '@/lib/types/rental-return'
import type { ActorInfo } from '@/lib/types/actor'
import type { SplitTenderInput } from '@/lib/types/bill-workflow'
import { loadBills, saveBills, saveBillToSupabase, trackBillPersistence } from '@/features/bills/services/bill-storage'
import { recordBillPayment, type StatementTransaction } from '@/features/finance/services/finance-storage'
import { rentProductStock, loadProducts, getProductAvailability, syncProductReservedStock, validateProductMode } from '@/features/products/services/product-storage'
import { createReservation, dispatchReservationsBySource, updateReservation, getReservationsBySource, type ReservationRecord } from '@/features/reservations/services/reservation-storage'
import { createBackorder, type BackorderRecord } from '@/features/reservations/services/backorder-storage'
import { markQuotationConverted, getQuotationById } from '@/features/quotations/services/quotation-storage'
import { recordAuditLog, generateCorrelationId } from '@/features/audits/services/audit-storage'

// ─── 1. CREATE BILL WITH SPLIT PAYMENT & DEPOSIT SEPARATION ───────────────────

export interface CreateBillOptions {
  bill?: FullBill
  billData?: Partial<FullBill>
  splitTenders?: SplitTenderInput[]
  paymentSplits?: Array<{ channel: string; amount: number; referenceNo?: string }>
  depositAmount?: number
  depositChannel?: string
  depositReferenceNo?: string
  actor: ActorInfo
  correlationId?: string
}

export function createBillWorkflow(options: CreateBillOptions): {
  bill: FullBill
  correlationId: string
  transactions: StatementTransaction[]
  reservations?: ReservationRecord[]
  backorders?: BackorderRecord[]
} {
  const correlationId = options.correlationId || generateCorrelationId()
  const actorUserId = options.actor.userId || 'system'
  const actorDisplayName = options.actor.displayName || 'ระบบ'
  const rawBill = options.bill || (options.billData as FullBill) || {}
  const incomingBill: FullBill = {
    ...rawBill,
    id: rawBill.id || `bill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    billNo: rawBill.billNo || `BILL-${Date.now()}`,
    billDate: rawBill.billDate || new Date().toISOString().slice(0, 10),
    customerName: rawBill.customerName || 'ลูกค้าทั่วไป',
    customerPhone: rawBill.customerPhone || '',
    rentalStartDate: rawBill.rentalStartDate || new Date().toISOString().slice(0, 10),
    scheduledReturnDate: rawBill.scheduledReturnDate || new Date().toISOString().slice(0, 10),
    heldDepositAmount: Number(rawBill.heldDepositAmount || options.depositAmount || rawBill.paidDepositAmount || 0),
    paidDepositAmount: Number(rawBill.paidDepositAmount || options.depositAmount || 0),
    paidAmount: Number(rawBill.paidAmount || 0),
    billAmount: Number(rawBill.billAmount || rawBill.grandTotal || 0),
    grandTotal: Number(rawBill.grandTotal || 0),
    outstandingAmount: Number(rawBill.outstandingAmount !== undefined ? rawBill.outstandingAmount : Math.max(0, (rawBill.grandTotal || 0) - (rawBill.paidAmount || 0))),
    paymentStatus: rawBill.paymentStatus || 'UNPAID',
    rentalStatus: rawBill.dispatchStatus === 'DISPATCHED'
      ? (rawBill.rentalStatus === 'CONFIRMED' ? 'RENTING' : (rawBill.rentalStatus || 'RENTING'))
      : (rawBill.rentalStatus === 'RENTING' ? 'CONFIRMED' : (rawBill.rentalStatus || 'CONFIRMED')),
    dispatchStatus: rawBill.dispatchStatus || 'PENDING',
    deposits: rawBill.deposits || [],
    items: rawBill.items || [],
  }
  const transactions: StatementTransaction[] = []

  if (incomingBill.quotationId) {
    const quote = getQuotationById(incomingBill.quotationId)
    if (quote) {
      if (quote.status === 'CONVERTED') {
        throw new Error(`ใบเสนอราคา ${quote.quotationNo || incomingBill.quotationId} ถูกแปลงเป็นบิลไปแล้ว ไม่สามารถแปลงซ้ำได้`)
      }
      if (!incomingBill.quotationNo) {
        incomingBill.quotationNo = quote.quotationNo
      }
    }
  }

  // Ensure dispatchStatus is set (default PENDING)
  const dispatchStatus = incomingBill.dispatchStatus || 'PENDING'

  const reservations: ReservationRecord[] = []
  const backorders: BackorderRecord[] = []

  const allProds = loadProducts()
  incomingBill.items = incomingBill.items.map((item) => {
    const prod = allProds.find((p) => p.id === item.productId)
    const isSale = item.rentalType === 'SALE' || (item as any).itemType === 'SALE'
    const itemMode: 'RENT' | 'SALE' = isSale ? 'SALE' : 'RENT'
    if (prod) {
      validateProductMode(prod, itemMode)
    }
    const requiresReturn = isSale ? false : (item.requiresReturn !== undefined ? item.requiresReturn : true)
    return {
      ...item,
      itemType: itemMode,
      rentalType: isSale ? 'SALE' : (item.rentalType || 'NORMAL'),
      requiresReturn,
      ...(isSale
        ? {
            orderedQty: item.orderedQty ?? item.quantity,
            reservedQty: item.reservedQty ?? item.quantity,
            deliveredQty: item.deliveredQty ?? 0,
            remainingQty: item.remainingQty ?? item.quantity,
            deliveryStatus: item.deliveryStatus ?? 'PENDING',
          }
        : {}),
    }
  })

  const hasSaleItems = incomingBill.items.some((i) => i.rentalType === 'SALE' || i.itemType === 'SALE')
  if (hasSaleItems && !incomingBill.deliveryStatus) {
    incomingBill.deliveryStatus = 'PENDING'
  }

  if (dispatchStatus === 'PENDING') {
    // 1. PENDING: Confirm ≠ Dispatch. Reserved ≠ Rented.
    // Do NOT increment rentedQuantity or permanently deduct SALE stock.
    // Create dated ReservationRecord and BackorderRecord if shortage.
    // If incoming bill has a quotationId, check if the quotation already holds ACTIVE reservations
    const quotationReservations = incomingBill.quotationId
      ? getReservationsBySource('QUOTATION', incomingBill.quotationId).filter((r) => r.status === 'ACTIVE')
      : []

    incomingBill.items.forEach((item) => {
      const isSale = item.rentalType === 'SALE' || item.itemType === 'SALE'
      const startDate = item.rentalStartDate || incomingBill.rentalStartDate
      const endDate = item.scheduledReturnDate || incomingBill.scheduledReturnDate

      // Check if this product was already reserved under the source quotation
      const matchingQuoteResvs = quotationReservations.filter((r) => r.productId === item.productId)
      const quoteResvQty = matchingQuoteResvs.reduce((sum, r) => sum + r.quantity, 0)

      let neededQty = item.quantity
      if (quoteResvQty > 0) {
        // Adopt the quotation reservation into this bill to avoid duplicate reservation
        const adoptQty = Math.min(neededQty, quoteResvQty)
        let remAdopt = adoptQty

        for (const qr of matchingQuoteResvs) {
          if (remAdopt <= 0) break
          if (qr.quantity <= remAdopt) {
            const adopted: ReservationRecord = {
              ...qr,
              sourceType: 'BILL',
              sourceId: incomingBill.id,
              sourceNo: incomingBill.billNo,
              correlationId,
            }
            updateReservation(adopted)
            reservations.push(adopted)
            remAdopt -= qr.quantity
          } else {
            const adopted: ReservationRecord = {
              ...qr,
              quantity: remAdopt,
              sourceType: 'BILL',
              sourceId: incomingBill.id,
              sourceNo: incomingBill.billNo,
              correlationId,
            }
            updateReservation(adopted)
            reservations.push(adopted)

            const remainingQuoteQty = qr.quantity - remAdopt
            createReservation({
              sourceType: 'QUOTATION',
              sourceId: qr.sourceId,
              sourceNo: qr.sourceNo,
              customerId: qr.customerId,
              customerName: qr.customerName,
              productId: qr.productId,
              productCode: qr.productCode,
              productName: qr.productName,
              itemType: qr.itemType,
              quantity: remainingQuoteQty,
              startDate: qr.startDate,
              endDate: qr.endDate,
              correlationId,
            })
            remAdopt = 0
          }
        }
        neededQty -= adoptQty
      }

      if (neededQty > 0) {
        const avail = getProductAvailability(item.productId, startDate, endDate)
        const availableForRange = avail.availableForRange

        if (availableForRange >= neededQty) {
          const resv = createReservation({
            sourceType: 'BILL',
            sourceId: incomingBill.id,
            sourceNo: incomingBill.billNo,
            customerId: incomingBill.customerId || 'general-customer',
            customerName: incomingBill.customerName,
            productId: item.productId,
            productCode: item.productCode || item.productId,
            productName: item.productName,
            itemType: isSale ? 'SALE' : 'RENT',
            quantity: neededQty,
            startDate,
            endDate,
            correlationId,
          })
          reservations.push(resv)
          /* Reservation handled in db */
        } else {
          const fulfillableQty = Math.max(0, availableForRange)
          const shortageQty = neededQty - fulfillableQty

          if (fulfillableQty > 0) {
            const resv = createReservation({
              sourceType: 'BILL',
              sourceId: incomingBill.id,
              sourceNo: incomingBill.billNo,
              customerId: incomingBill.customerId || 'general-customer',
              customerName: incomingBill.customerName,
              productId: item.productId,
              productCode: item.productCode || item.productId,
              productName: item.productName,
              itemType: isSale ? 'SALE' : 'RENT',
              quantity: fulfillableQty,
              startDate,
              endDate,
              correlationId,
            })
            reservations.push(resv)
            /* Reservation handled in db */
          }

          if (shortageQty > 0) {
            const bo = createBackorder({
              sourceType: 'BILL',
              sourceId: incomingBill.id,
              sourceNo: incomingBill.billNo,
              customerId: incomingBill.customerId || 'general-customer',
              customerName: incomingBill.customerName,
              productId: item.productId,
              productCode: item.productCode || item.productId,
              productName: item.productName,
              itemType: isSale ? 'SALE' : 'RENT',
              requestedQty: item.quantity,
              outstandingQty: shortageQty,
              startDate,
              endDate,
              notes: `สร้างจากบิล ${incomingBill.billNo} (ขอ ${item.quantity}, จองได้ ${item.quantity - shortageQty}, ค้าง ${shortageQty})`,
              correlationId,
            })
            backorders.push(bo)
          }
        }
      }

      syncProductReservedStock(item.productId)

      recordAuditLog({
        userId: actorUserId,
        displayName: actorDisplayName,
        action: 'STOCK_RESERVE',
        entityType: 'STOCK',
        entityId: item.productId,
        before: { productId: item.productId },
        after: {
          quantity: item.quantity,
          billNo: incomingBill.billNo,
          dispatchStatus: 'PENDING',
        },
        correlationId,
      })
    })

    if (incomingBill.quotationId) {
      // markQuotationConverted is called at the end of the function
    }
  } else {
    // 2. DISPATCHED: Stock is physically handed over.
    const rentStockItems = incomingBill.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      isSale: item.rentalType === 'SALE',
    }))
    rentProductStock(rentStockItems)

    incomingBill.items.forEach((item) => {
      const isSale = item.rentalType === 'SALE'
      syncProductReservedStock(item.productId)

      recordAuditLog({
        userId: actorUserId,
        displayName: actorDisplayName,
        action: isSale ? 'STOCK_SALE' : 'STOCK_RENT',
        entityType: 'STOCK',
        entityId: item.productId,
        before: { productId: item.productId },
        after: {
          quantity: item.quantity,
          billNo: incomingBill.billNo,
          dispatchStatus: 'DISPATCHED',
        },
        correlationId,
      })
    })

    if (incomingBill.quotationId) {
      dispatchReservationsBySource('QUOTATION', incomingBill.quotationId, correlationId)
      // markQuotationConverted is called at the end of the function
    }
  }

  // 2. Separate Deposit Transaction
  const depositAmount = Number(incomingBill.heldDepositAmount || incomingBill.paidDepositAmount || options.depositAmount || 0)
  if (depositAmount > 0 && incomingBill.paymentStatus !== 'UNPAID') {
    const depChannel = options.depositChannel || options.splitTenders?.[0]?.paymentMethod || options.paymentSplits?.[0]?.channel || 'โอนเงิน'
    const depTx = recordBillPayment({
      billId: incomingBill.id,
      billNo: incomingBill.billNo,
      amount: depositAmount,
      channel: depChannel,
      customerName: incomingBill.customerName,
      category: 'เงินมัดจำ',
      isDeposit: true,
      refNo: options.depositReferenceNo,
      description: `รับเงินมัดจำ บิลเลขที่ ${incomingBill.billNo}`,
      correlationId,
    })
    transactions.push(depTx)

    recordAuditLog({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'DEPOSIT_RECEIVE',
      entityType: 'FINANCE',
      entityId: depTx.id,
      before: null,
      after: {
        billNo: incomingBill.billNo,
        amount: depositAmount,
        category: 'เงินมัดจำ',
        isDeposit: true,
      },
      correlationId,
    })
  }

  // 3. Payment Transactions (Split payment supported: 1 channel = 1 transaction)
  const normalizedSplits = options.splitTenders
    ? options.splitTenders.map((t) => ({ channel: t.paymentMethod, amount: t.amount, referenceNo: t.referenceNo }))
    : options.paymentSplits || []

  if (normalizedSplits.length > 0) {
    const validTenders = normalizedSplits.filter((t) => Number(t.amount || 0) > 0)
    for (const tender of validTenders) {
      const tx = recordBillPayment({
        billId: incomingBill.id,
        billNo: incomingBill.billNo,
        amount: Number(tender.amount),
        channel: tender.channel,
        customerName: incomingBill.customerName,
        category: 'ค่าเช่าอุปกรณ์',
        isDeposit: false,
        refNo: tender.referenceNo ? `TX-${incomingBill.billNo}-${tender.referenceNo}` : undefined,
        description: `รับชำระเงิน (${tender.channel}) บิลเลขที่ ${incomingBill.billNo}`,
        correlationId,
      })
      transactions.push(tx)

      recordAuditLog({
        userId: actorUserId,
        displayName: actorDisplayName,
        action: 'PAYMENT_RECEIVE',
        entityType: 'FINANCE',
        entityId: tx.id,
        before: null,
        after: {
          billNo: incomingBill.billNo,
          amount: tender.amount,
          channel: tender.channel,
        },
        correlationId,
      })
    }
  } else if (incomingBill.paidAmount > 0 && incomingBill.paymentStatus !== 'UNPAID') {
    // Single revenue payment (Financial Core: paidAmount is strictly bill payment without deposit; handle legacy combined)
    let revAmount = incomingBill.paidAmount
    if (depositAmount > 0 && incomingBill.paidAmount > incomingBill.grandTotal && incomingBill.paidAmount === (incomingBill.grandTotal + depositAmount)) {
      revAmount = incomingBill.grandTotal
    }
    if (revAmount > 0) {
      const tx = recordBillPayment({
        billId: incomingBill.id,
        billNo: incomingBill.billNo,
        amount: revAmount,
        channel: 'โอนเงิน',
        customerName: incomingBill.customerName,
        category: 'ค่าเช่าอุปกรณ์',
        isDeposit: false,
        description: `รับชำระเงิน บิลเลขที่ ${incomingBill.billNo}`,
        correlationId,
      })
      transactions.push(tx)

      recordAuditLog({
        userId: actorUserId,
        displayName: actorDisplayName,
        action: 'PAYMENT_RECEIVE',
        entityType: 'FINANCE',
        entityId: tx.id,
        before: null,
        after: {
          billNo: incomingBill.billNo,
          amount: revAmount,
        },
        correlationId,
      })
    }
  }

  // 4. Save Bill
  const finalBill: FullBill = {
    ...incomingBill,
    reservationId: incomingBill.reservationId || (reservations[0]?.id),
    dispatchStatus,
  }

  const currentBills = loadBills()
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
    trackBillPersistence(saveBillToSupabase(finalBill))
  } else {
    saveBills([finalBill, ...currentBills.filter((b) => b.id !== finalBill.id)])
  }

  recordAuditLog({
    userId: actorUserId,
    displayName: actorDisplayName,
    action: 'BILL_CREATE',
    entityType: 'BILL',
    entityId: finalBill.id,
    before: null,
    after: {
      billNo: finalBill.billNo,
      customerName: finalBill.customerName,
      grandTotal: finalBill.grandTotal,
      paidAmount: finalBill.paidAmount,
      outstandingAmount: finalBill.outstandingAmount,
      rentalStatus: finalBill.rentalStatus,
      paymentStatus: finalBill.paymentStatus,
      dispatchStatus: finalBill.dispatchStatus,
    },
    correlationId,
  })

  if (finalBill.quotationId) {
    markQuotationConverted(finalBill.quotationId, finalBill.id, correlationId)
    recordAuditLog({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'QUOTATION_CONVERT_BILL',
      entityType: 'QUOTATION',
      entityId: finalBill.quotationId,
      before: null,
      after: {
        quotationId: finalBill.quotationId,
        quotationNo: finalBill.quotationNo,
        billId: finalBill.id,
        billNo: finalBill.billNo,
      },
      correlationId,
    })
  }

  return { bill: finalBill, correlationId, transactions, reservations, backorders }
}
