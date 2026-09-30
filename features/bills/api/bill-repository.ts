import { createClient } from '@/lib/supabase/client'
import { FullBill } from '@/lib/types/rental-return'

/**
 * Canonical Supabase persistence adapter for Bill data.
 *
 * Stage 2 rule:
 * - FullBill is the canonical application/persistence contract.
 * - public.bills.items (JSONB) is the canonical persisted item payload for runtime.
 * - This repository is the only module that performs direct CRUD against public.bills.
 * - Cache management and domain rules stay outside this repository.
 */

export function dbBillToFullBill(row: any): FullBill {
  const refundDue = Number(row.refund_due || 0)

  return {
    id: row.id,
    customerId: row.customer_id || undefined,
    billNo: row.bill_no,
    billDate: row.bill_date,
    customerName: row.customer_name,
    customerPhone: row.customer_phone || '',
    customerAddress: row.customer_address || undefined,
    siteName: row.site_name || undefined,
    rentalStartDate: row.rental_start_date,
    scheduledReturnDate: row.scheduled_return_date,
    actualReturnDate: row.actual_return_date || undefined,
    heldDepositAmount: Number(row.held_deposit_amount || 0),
    paidDepositAmount: Number(row.paid_deposit_amount || 0),
    depositRefunded: Number(row.deposit_refunded || 0),
    depositApplied: Number(row.deposit_applied || 0),
    deposits: Array.isArray(row.deposits) ? row.deposits : [],
    subtotal: Number(row.subtotal || 0),
    discountAmount: Number(row.discount_amount || 0),
    shippingFee: Number(row.shipping_fee || 0),
    taxAmount: Number(row.tax_amount || 0),
    billAmount: Number(
      row.bill_amount !== undefined && row.bill_amount !== null
        ? row.bill_amount
        : row.grand_total || 0
    ),
    grandTotal: Number(row.grand_total || 0),
    paidAmount: Number(row.paid_amount || 0),
    outstandingAmount: Number(row.outstanding_amount || 0),
    rentalStatus: row.rental_status,
    paymentStatus: row.payment_status,
    dispatchStatus: row.dispatch_status || undefined,
    deliveryStatus: row.delivery_status || undefined,
    refundDue,
    refundDueAmount: refundDue,
    items: Array.isArray(row.items) ? row.items : [],
    remark: row.remark || undefined,
    quotationId: row.quotation_id || undefined,
    quotationNo: row.quotation_no || undefined,
    reservationId: row.reservation_id || undefined,
    originalBillId: row.original_bill_id || undefined,
    parentBillId: row.parent_bill_id || undefined,
    closedAt: row.closed_at || undefined,
    cancelledAt: row.cancelled_at || undefined,
    cancelReason: row.cancel_reason || undefined,
    revisions: Array.isArray(row.revisions) ? row.revisions : undefined,
  }
}

export function fullBillToDbBill(bill: FullBill): Record<string, unknown> {
  return {
    id: bill.id,
    bill_no: bill.billNo,
    bill_date: bill.billDate || new Date().toISOString().slice(0, 10),
    customer_id: bill.customerId || null,
    customer_name: bill.customerName,
    customer_phone: bill.customerPhone || null,
    customer_address: bill.customerAddress || null,
    site_name: bill.siteName || null,
    rental_start_date: bill.rentalStartDate || new Date().toISOString().slice(0, 10),
    scheduled_return_date: bill.scheduledReturnDate || new Date().toISOString().slice(0, 10),
    actual_return_date: bill.actualReturnDate || null,
    subtotal: bill.subtotal ?? bill.grandTotal,
    discount_amount: bill.discountAmount ?? 0,
    shipping_fee: bill.shippingFee ?? 0,
    tax_amount: bill.taxAmount ?? 0,
    bill_amount: bill.billAmount ?? bill.grandTotal,
    grand_total: bill.grandTotal,
    paid_amount: bill.paidAmount,
    outstanding_amount: bill.outstandingAmount,
    held_deposit_amount: bill.heldDepositAmount ?? 0,
    paid_deposit_amount: bill.paidDepositAmount ?? 0,
    deposit_refunded: bill.depositRefunded ?? 0,
    deposit_applied: bill.depositApplied ?? 0,
    rental_status: bill.rentalStatus,
    payment_status: bill.paymentStatus,
    dispatch_status: bill.dispatchStatus || 'PENDING',
    delivery_status: bill.deliveryStatus || 'PENDING',
    quotation_id: bill.quotationId || null,
    quotation_no: bill.quotationNo || null,
    reservation_id: bill.reservationId || null,
    original_bill_id: bill.originalBillId || null,
    parent_bill_id: bill.parentBillId || null,
    closed_at: bill.closedAt || null,
    cancelled_at: bill.cancelledAt || null,
    cancel_reason: bill.cancelReason || null,
    refund_due: bill.refundDueAmount ?? bill.refundDue ?? 0,
    items: bill.items || [],
    deposits: bill.deposits || [],
    revisions: bill.revisions || [],
    remark: bill.remark || null,
    updated_at: new Date().toISOString(),
  }
}

export async function fetchBillsFromSupabase(): Promise<FullBill[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('bills')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`ไม่สามารถดึงข้อมูลบิลจาก Supabase ได้: ${error.message}`)
  }

  return (data || []).map(dbBillToFullBill)
}

export async function fetchBillByIdFromSupabase(id: string): Promise<FullBill | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('bills')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`ไม่สามารถดึงข้อมูลบิล ${id} จาก Supabase ได้: ${error.message}`)
  }

  return data ? dbBillToFullBill(data) : null
}

export async function saveBillToSupabase(bill: FullBill): Promise<FullBill> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('bills')
    .upsert(fullBillToDbBill(bill))
    .select('*')
    .single()

  if (error) {
    throw new Error(`ไม่สามารถบันทึกบิล ${bill.billNo} ลง Supabase ได้: ${error.message}`)
  }

  return dbBillToFullBill(data)
}

export async function deleteBillFromSupabase(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('bills').delete().eq('id', id)

  if (error) {
    throw new Error(`ไม่สามารถลบบิลจาก Supabase ได้: ${error.message}`)
  }
}
