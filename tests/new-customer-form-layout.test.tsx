// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/features/customers/components/IDCardScannerModal', () => ({ IDCardScannerModal: () => null }))

import { NewCustomerModal } from '@/features/customers/components/NewCustomerModal'
import type { Customer } from '@/lib/types/rental-pos'

const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value

async function openForm(props: Partial<React.ComponentProps<typeof NewCustomerModal>> = {}) {
  const onSave = vi.fn(async () => true)
  await act(async () => {
    render(<NewCustomerModal isOpen onClose={vi.fn()} onSave={onSave} {...props} />)
  })
  return { onSave }
}
const submit = () => act(async () => {
  fireEvent.submit(document.querySelector('form')!)
})

describe('เพิ่มลูกค้าใหม่: ฟอร์มซ้าย-ขวาตามที่กำหนด', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] }))))
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('มีเฉพาะช่องที่กำหนด ช่องอื่นถูกลบออก', async () => {
    await openForm()
    for (const label of [
      'ชื่อลูกค้า / ชื่อบริษัท', 'เลขบัตรประชาชน / เลขผู้เสียภาษี', 'บ้านเลขที่', 'หมู่', 'ซอย', 'ถนน', 'รหัสไปรษณีย์',
      'เบอร์โทรศัพท์หลัก', 'เบอร์โทรศัพท์สำรอง', 'อีเมล', 'LINE ID',
    ]) expect(screen.getByLabelText(label), label).toBeTruthy()
    for (const select of ['จังหวัด', 'อำเภอ / เขต', 'ตำบล / แขวง']) expect(screen.getByRole('button', { name: select }), select).toBeTruthy()
    for (const gone of ['เลขประจำตัวผู้เสียภาษี']) {
      expect(screen.queryByLabelText(gone), gone).toBeNull()
    }
    expect(screen.queryByText('วันหมดอายุบัตร')).toBeNull()
    expect(screen.queryByText('วันเกิด')).toBeNull()
    expect(screen.queryByText(/พิมพ์ชื่ออำเภอ/)).toBeNull()
  })

  it('เลือกจังหวัด → อำเภอ → ตำบล ตามลำดับ: ระบบไม่เลือกให้เอง ได้รหัสไปรษณีย์ และบันทึกที่อยู่ครบ', async () => {
    const { onSave } = await openForm()
    await waitFor(() => expect(screen.queryByText('กำลังโหลดข้อมูลจังหวัด...')).toBeNull(), { timeout: 10000 })
    const pick = (label: string, option: string) => {
      fireEvent.click(screen.getByRole('button', { name: label }))
      fireEvent.change(screen.getByPlaceholderText('พิมพ์ค้นหา...'), { target: { value: option } })
      const button = screen.getAllByRole('option').find((b) => b.textContent?.startsWith(option))!
      fireEvent.click(button)
    }
    pick('จังหวัด', 'กาญจนบุรี')
    // Choosing a province picks nothing below it.
    expect(screen.getByRole('button', { name: 'อำเภอ / เขต' }).textContent).toContain('เลือกอำเภอ')
    expect(screen.getByRole('button', { name: 'ตำบล / แขวง' }).textContent).toContain('เลือกตำบล')
    pick('อำเภอ / เขต', 'เมืองกาญจนบุรี')
    pick('ตำบล / แขวง', 'ลาดหญ้า')
    expect(value('รหัสไปรษณีย์')).toMatch(/^\d{5}$/)

    fireEvent.change(screen.getByLabelText('ชื่อลูกค้า / ชื่อบริษัท'), { target: { value: 'ลูกค้า ทดสอบ' } })
    fireEvent.change(screen.getByLabelText('เบอร์โทรศัพท์หลัก'), { target: { value: '0812345678' } })
    fireEvent.change(screen.getByLabelText('บ้านเลขที่'), { target: { value: '145' } })
    await submit()
    const saved = (onSave.mock.calls[0] as unknown as [Customer])[0]
    expect(saved).toMatchObject({ subDistrict: 'ลาดหญ้า', district: 'เมืองกาญจนบุรี', province: 'กาญจนบุรี' })
    expect(saved.address).toContain('ต.ลาดหญ้า อ.เมืองกาญจนบุรี จ.กาญจนบุรี')
  })

  it('ช่องเดียวสำหรับเลขบัตร/เลขผู้เสียภาษี: บันทึกเป็นทั้งสองค่า', async () => {
    const { onSave } = await openForm()
    fireEvent.change(screen.getByLabelText('ชื่อลูกค้า / ชื่อบริษัท'), { target: { value: 'ลูกค้า ก' } })
    fireEvent.change(screen.getByLabelText('เบอร์โทรศัพท์หลัก'), { target: { value: '0812345678' } })
    fireEvent.change(screen.getByLabelText('บ้านเลขที่'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('เลขบัตรประชาชน / เลขผู้เสียภาษี'), { target: { value: '1101700203451' } })
    await submit()
    expect((onSave.mock.calls[0] as unknown as [Customer])[0]).toMatchObject({ idCardNumber: '1101700203451', taxId: '1101700203451' })
  })

  it('แก้ไขลูกค้าเดิม: ซอย ถนน วันหมดอายุบัตร วันเกิดที่เคยมี ยังอยู่ครบหลังบันทึก', async () => {
    const existing = {
      id: 'c1', customerName: 'ลูกค้าเดิม', phone: '081-111-1111', houseNo: '9', soi: 'สุขุมวิท 101', road: 'สุขุมวิท',
      idCardExpiry: '2030-01-01', birthDate: '1990-05-02', taxId: '1101700203451', isSuspended: false,
    } as Customer
    const { onSave } = await openForm({ editingCustomer: existing })
    // An old customer with only a tax ID shows it in the shared field.
    expect(value('เลขบัตรประชาชน / เลขผู้เสียภาษี')).toBe('1-1017-00203-45-1')
    await submit()
    const saved = (onSave.mock.calls[0] as unknown as [Customer])[0]
    expect(saved).toMatchObject({ soi: 'สุขุมวิท 101', road: 'สุขุมวิท', idCardExpiry: '2030-01-01', birthDate: '1990-05-02' })
    expect(saved.address).toContain('ซอย สุขุมวิท 101 ถนน สุขุมวิท')
  })

  it('ดับเบิ้ลคลิกรูปบัตร: แสดงรูปขนาดจริงเต็มจอ คลิกหรือ Esc ปิดเฉพาะรูป ไม่ปิดหน้าต่างลูกค้า', async () => {
    const onClose = vi.fn()
    await act(async () => {
      render(<NewCustomerModal isOpen onClose={onClose} onSave={vi.fn()} editingCustomer={{ id: 'c1', customerName: 'ก', phone: '0811111111', idCardImageUrl: 'data:image/jpeg;base64,AAAA', isSuspended: false } as Customer} />)
    })
    expect(screen.queryByRole('dialog', { name: 'รูปบัตรประชาชนขนาดจริง' })).toBeNull()
    fireEvent.doubleClick(screen.getByAltText('ID Card'))
    const preview = screen.getByRole('dialog', { name: 'รูปบัตรประชาชนขนาดจริง' })
    expect(within(preview).getByRole('img').getAttribute('src')).toBe('data:image/jpeg;base64,AAAA')
    fireEvent.click(preview)
    expect(screen.queryByRole('dialog', { name: 'รูปบัตรประชาชนขนาดจริง' })).toBeNull()

    fireEvent.doubleClick(screen.getByAltText('ID Card'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'รูปบัตรประชาชนขนาดจริง' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})
