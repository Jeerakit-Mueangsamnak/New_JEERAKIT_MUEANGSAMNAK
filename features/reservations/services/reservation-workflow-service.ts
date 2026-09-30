import type { ActorInfo } from '@/lib/types/actor'
import {
  getProductAvailability,
  syncProductReservedStock,
} from '@/features/products/services/product-storage'
import {
  checkBackordersOnStockIncrease,
  markNotificationActionedByBackorder,
} from '@/features/notifications/services/notification-storage'
import {
  createReservation,
  expireReservation,
  loadReservations,
  type ReservationRecord,
} from '@/features/reservations/services/reservation-storage'
import {
  fulfillBackorder,
  type BackorderRecord,
} from '@/features/reservations/services/backorder-storage'
import {
  generateCorrelationId,
  recordAuditLog,
} from '@/features/audits/services/audit-storage'
import { loadSystemSettings } from '@/features/settings/services/settings-storage'

export interface FulfillBackorderWorkflowOptions {
  backorderId: string
  allocateQty?: number
  allocatedQty?: number
  notificationId?: string
  actor: ActorInfo
  correlationId?: string
}

/**
 * Explicit user-confirmed backorder allocation.
 * Invariants:
 * - NEVER auto-allocates silently.
 * - Deducts outstanding backorder quantity.
 * - Creates an ACTIVE Reservation for the allocated quantity.
 * - Synchronizes product reserved stock.
 * - Marks actionable notification as ACTIONED.
 * - Audits BACKORDER_ALLOCATE with shared correlationId.
 */
export function fulfillBackorderWorkflow(options: FulfillBackorderWorkflowOptions): {
  backorder: BackorderRecord
  reservation: ReservationRecord
  correlationId: string
  fulfilledBackorder?: BackorderRecord
  newReservation?: ReservationRecord
} {
  const correlationId = options.correlationId || generateCorrelationId()
  const actorUserId = options.actor.userId || 'system'
  const actorDisplayName = options.actor.displayName || 'ระบบ'
  const qtyToAllocate = Number(options.allocateQty ?? options.allocatedQty ?? 0)

  if (qtyToAllocate <= 0) {
    throw new Error('Allocate quantity must be greater than 0')
  }

  const { backorder: updatedBo } = fulfillBackorder(options.backorderId, qtyToAllocate)
  const reservation = createReservation({
    sourceType: updatedBo.sourceType,
    sourceId: updatedBo.sourceId,
    sourceNo: updatedBo.sourceNo,
    customerId: updatedBo.customerId,
    customerName: updatedBo.customerName,
    productId: updatedBo.productId,
    productCode: updatedBo.productCode,
    productName: updatedBo.productName,
    itemType: updatedBo.itemType,
    quantity: qtyToAllocate,
    startDate: updatedBo.startDate || new Date().toISOString().slice(0, 10),
    endDate: updatedBo.endDate || new Date().toISOString().slice(0, 10),
    correlationId,
  })

  syncProductReservedStock(updatedBo.productId)
  markNotificationActionedByBackorder(updatedBo.id, actorDisplayName)

  recordAuditLog({
    userId: actorUserId,
    displayName: actorDisplayName,
    action: 'BACKORDER_ALLOCATE',
    entityType: 'BACKORDER',
    entityId: updatedBo.id,
    before: { backorderNo: updatedBo.backorderNo, status: 'READY' },
    after: {
      backorderNo: updatedBo.backorderNo,
      allocatedQty: qtyToAllocate,
      outstandingQty: updatedBo.outstandingQty,
      status: updatedBo.status,
      reservationId: reservation.id,
    },
    correlationId,
  })

  return {
    backorder: updatedBo,
    reservation,
    correlationId,
    fulfilledBackorder: updatedBo,
    newReservation: reservation,
  }
}

export interface ExpireReservationsResult {
  expiredReservations: ReservationRecord[]
  correlationId: string
}

/**
 * Check and expire reservations based on centralized settings policy.
 * DISPATCHED reservations are never eligible for expiration.
 */
export function checkAndExpireReservations(
  currentDate?: string,
  actor?: ActorInfo,
  correlationId?: string
): ExpireReservationsResult {
  const corrId = correlationId || generateCorrelationId()
  const actorUserId = actor?.userId || 'system'
  const actorDisplayName = actor?.displayName || 'ระบบ'

  const settings = loadSystemSettings()
  const policy = settings.rentalBilling?.reservationExpiryPolicy || 'UNTIL_START_DATE'
  if (policy === 'MANUAL') {
    return { expiredReservations: [], correlationId: corrId }
  }

  const todayStr = currentDate || new Date().toISOString().slice(0, 10)
  const allReservations = loadReservations()
  const expired: ReservationRecord[] = []
  const affectedProductIds = new Set<string>()

  for (const resv of allReservations) {
    if (resv.status !== 'ACTIVE') continue

    let shouldExpire = false
    if (policy === 'UNTIL_START_DATE') {
      shouldExpire = Boolean(resv.startDate && todayStr >= resv.startDate)
    } else if (policy === 'DAYS_LIMIT') {
      const daysLimit = settings.rentalBilling?.reservationExpiryDays ?? 3
      const createdDateStr = resv.createdAt ? resv.createdAt.slice(0, 10) : todayStr
      const createdTime = new Date(createdDateStr).getTime()
      const compareTime = new Date(todayStr).getTime()
      const diffDays = (compareTime - createdTime) / (1000 * 60 * 60 * 24)
      shouldExpire = diffDays >= daysLimit
    }

    if (!shouldExpire) continue

    const updated = expireReservation(resv.id, `EXPIRED_BY_POLICY_${policy}`, corrId)
    if (!updated) continue

    expired.push(updated)
    affectedProductIds.add(resv.productId)
    recordAuditLog({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'RESERVATION_EXPIRE',
      entityType: 'RESERVATION',
      entityId: resv.id,
      before: { status: 'ACTIVE', reservationNo: resv.reservationNo },
      after: { status: 'EXPIRED', reservationNo: resv.reservationNo, policy },
      correlationId: corrId,
    })
  }

  for (const productId of affectedProductIds) {
    syncProductReservedStock(productId)
    const availability = getProductAvailability(productId)
    if (availability.availableForRange > 0) {
      checkBackordersOnStockIncrease(
        productId,
        availability.availableForRange,
        { userId: actorUserId, displayName: actorDisplayName },
        corrId
      )
    }
  }

  return { expiredReservations: expired, correlationId: corrId }
}
