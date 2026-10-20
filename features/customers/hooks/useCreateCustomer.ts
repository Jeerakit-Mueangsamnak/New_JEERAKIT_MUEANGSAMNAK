'use client'

import { useCallback } from 'react'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { createCustomerAsync } from '@/features/customers/services/customer-storage'
import type { Customer } from '@/lib/types/rental-pos'

/**
 * Creates a customer; when the server finds one with the same name or phone, asks in the
 * app's confirm dialog (not the browser's) before saving it as a new customer.
 */
export function useCreateCustomer(): (customer: Customer) => Promise<Customer> {
  const confirm = useConfirm()
  return useCallback(
    (customer: Customer) =>
      createCustomerAsync(customer, () =>
        confirm({
          title: 'พบลูกค้าที่อาจซ้ำ',
          message: 'พบลูกค้าที่ชื่อหรือเบอร์โทรซ้ำกับที่มีอยู่แล้ว ต้องการบันทึกเป็นลูกค้าใหม่ต่อหรือไม่?',
          confirmLabel: 'บันทึกเป็นลูกค้าใหม่',
        })
      ),
    [confirm]
  )
}
