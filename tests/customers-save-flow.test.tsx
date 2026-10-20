// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), rows: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ order: () => ({}) }) }) }),
}))
vi.mock('@/lib/db/rpc', () => ({
  rpc: mocks.rpc,
  selectRows: mocks.rows,
  isDbError: () => false,
}))
vi.mock('@/features/documents/api/customer-document-repository', () => ({
  uploadCustomerImage: mocks.upload,
  fetchCustomerDocuments: vi.fn(async () => []),
  getDocumentFileUrl: vi.fn(),
}))
vi.mock('@/features/customers/components/CustomerLineLink', () => ({ CustomerLineLink: () => null }))
vi.mock('@/features/customers/components/IDCardScannerModal', () => ({ IDCardScannerModal: () => null }))

import {
  createCustomerAsync,
  deleteCustomerAsync,
  isIdCardUploadError,
  setCachedCustomers,
  updateCustomerAsync,
} from '@/features/customers/services/customer-storage'
import { NewCustomerModal } from '@/features/customers/components/NewCustomerModal'
import type { Customer } from '@/lib/types/rental-pos'

const ID = '11111111-2222-4333-8444-555555555555'
const row = (active = true) => ({
  id: ID, customer_code: 'CUST-1', name: 'ลูกค้า ก', phone: '0811111111', address: '', customer_type: 'INDIVIDUAL',
  tax_id: null, email: null, contact_person: null, note: null, active, account_status: 'ACTIVE', contact_details: {},
  created_at: '2026-10-01T00:00:00Z',
})
const customer = (over: Partial<Customer> = {}): Customer =>
  ({ id: ID, customerCode: 'CUST-1', customerName: 'ลูกค้า ก', phone: '0811111111', address: '', status: 'ACTIVE', isSuspended: false, ...over }) as Customer
const callsOf = (name: string) => mocks.rpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1])

describe('ข้อมูลลูกค้า › การบันทึก', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue(row())
    mocks.rows.mockResolvedValue([row()])
    setCachedCustomers([customer()])
  })
  afterEach(cleanup)

  it('แก้ไข / หมายเหตุ: ส่งเหตุผลที่พิมพ์เป็น p_reason', async () => {
    await updateCustomerAsync(customer({ note: 'โน้ต' }), '  ลูกค้าเปลี่ยนเบอร์  ')
    expect(callsOf('customer_update')[0]).toMatchObject({ p_customer_id: ID, p_reason: 'ลูกค้าเปลี่ยนเบอร์' })
    expect(callsOf('customer_set_active')).toHaveLength(0)
  })

  it('ระงับสิทธิ์: ส่งเหตุผลไปทั้ง customer_update และ customer_set_active', async () => {
    await updateCustomerAsync(customer({ isSuspended: true, status: 'INACTIVE' }), 'ค้างชำระ')
    expect(callsOf('customer_update')[0].p_reason).toBe('ค้างชำระ')
    expect(callsOf('customer_set_active')[0]).toEqual({ p_customer_id: ID, p_active: false, p_reason: 'ค้างชำระ' })
  })

  it('ปลดระงับลูกค้าที่โหลดมาเป็น INACTIVE: เปิดใช้งานกลับจริง', async () => {
    setCachedCustomers([customer({ isSuspended: true, status: 'INACTIVE' })])
    await updateCustomerAsync(customer({ isSuspended: false, status: 'ACTIVE' }), 'ชำระแล้ว')
    expect(callsOf('customer_set_active')[0]).toEqual({ p_customer_id: ID, p_active: true, p_reason: 'ชำระแล้ว' })
  })

  it('ลบลูกค้า: ปิดใช้งาน (ไม่ลบจริง) พร้อมเหตุผล', async () => {
    await deleteCustomerAsync(ID, ' ลูกค้าเลิกกิจการ ')
    expect(callsOf('customer_set_active')[0]).toEqual({ p_customer_id: ID, p_active: false, p_reason: 'ลูกค้าเลิกกิจการ' })
  })

  it('สร้างลูกค้าสำเร็จแต่อัปโหลดบัตรไม่ผ่าน: แจ้งว่าบันทึกแล้ว และไม่สร้างซ้ำ', async () => {
    mocks.upload.mockRejectedValue(new Error('storage down'))
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['x']) })))
    const err = await createCustomerAsync(customer({ id: 'c_new', idCardImageUrl: 'data:image/png;base64,AAA' })).catch((e) => e)
    vi.unstubAllGlobals()
    expect(isIdCardUploadError(err)).toBe(true)
    expect(err.saved.id).toBe(ID)
    expect(callsOf('customer_create')).toHaveLength(1)
  })
})

describe('ข้อมูลลูกค้า › ฟอร์มเพิ่ม/แก้ไข', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] }))))
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  const submit = async (result: boolean) => {
    const onSave = vi.fn(async () => result)
    const onClose = vi.fn()
    await act(async () => {
      render(<NewCustomerModal isOpen onClose={onClose} onSave={onSave} />)
    })
    fireEvent.change(screen.getByPlaceholderText('เช่น คุณสมชาย ใจดี / บจก. เจียรกิจ เมืองสำนัก'), { target: { value: 'ลูกค้า ข' } })
    await act(async () => {
      fireEvent.submit(document.querySelector('form')!)
    })
    return { onSave, onClose }
  }

  it('บันทึกไม่สำเร็จ (onSave = false): ฟอร์มยังเปิดอยู่', async () => {
    const { onSave, onClose } = await submit(false)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('บันทึกสำเร็จ: ปิดฟอร์ม', async () => {
    const { onClose } = await submit(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('แก้ไขโดยไม่ใส่เหตุผล: ไม่บันทึก', async () => {
    const onSave = vi.fn(async () => true)
    await act(async () => {
      render(<NewCustomerModal isOpen onClose={vi.fn()} onSave={onSave} editingCustomer={customer()} />)
    })
    await act(async () => {
      fireEvent.submit(document.querySelector('form')!)
    })
    expect(onSave).not.toHaveBeenCalled()
  })
})
