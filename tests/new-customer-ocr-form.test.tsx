// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/features/customers/components/CustomerLineLink', () => ({ CustomerLineLink: () => null }))

// The scanner is replaced by one button that hands back a prepared OCR result.
const scan = vi.hoisted(() => ({ result: {} as Record<string, unknown> }))
vi.mock('@/features/customers/components/IDCardScannerModal', () => ({
  IDCardScannerModal: ({ onScanComplete }: { onScanComplete: (d: unknown) => void }) => (
    <button type="button" onClick={() => onScanComplete(scan.result)}>ส่งผลสแกน</button>
  ),
}))

import { NewCustomerModal } from '@/features/customers/components/NewCustomerModal'
import { EMPTY_PARSED_ID_CARD } from '@/lib/ocr/thai-id-parser'
import type { Customer } from '@/lib/types/rental-pos'

const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value

async function openForm(props: Partial<React.ComponentProps<typeof NewCustomerModal>> = {}) {
  const onSave = vi.fn(async () => true)
  const utils = await act(async () => render(<NewCustomerModal isOpen onClose={vi.fn()} onSave={onSave} {...props} />))
  return { onSave, ...utils }
}

async function runScan(result: Record<string, unknown>) {
  scan.result = { ...EMPTY_PARSED_ID_CARD, croppedImageDataUrl: 'data:image/jpeg;base64,AAAA', ...result }
  fireEvent.click(screen.getByRole('button', { name: /เปิดกล้องสแกนบัตร/ }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'ส่งผลสแกน' }))
  })
}

const submit = () => act(async () => {
  fireEvent.submit(document.querySelector('form')!)
})

describe('เพิ่มลูกค้าใหม่: ช่องว่างต้องว่างจริง และ OCR เติมเฉพาะที่อ่านได้', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] }))))
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('เปิดฟอร์มใหม่หลังแก้ไขลูกค้าคนก่อน: ทุกช่องว่าง ไม่มีข้อมูลคนก่อนค้าง', async () => {
    const previous = { id: 'c1', customerName: 'ลูกค้าคนก่อน', phone: '0811111111', houseNo: '5', moo: '2', idCardNumber: '1101700203451', birthDate: '1990-01-01' } as Customer
    const { rerender } = await openForm({ editingCustomer: previous })
    expect(value('ชื่อลูกค้า / ชื่อบริษัท')).toBe('ลูกค้าคนก่อน')
    await act(async () => {
      rerender(<NewCustomerModal isOpen={false} onClose={vi.fn()} onSave={vi.fn()} editingCustomer={null} />)
    })
    await act(async () => {
      rerender(<NewCustomerModal isOpen onClose={vi.fn()} onSave={vi.fn()} editingCustomer={null} />)
    })
    for (const label of ['ชื่อลูกค้า / ชื่อบริษัท', 'เบอร์โทรศัพท์หลัก', 'อีเมล', 'บ้านเลขที่', 'หมู่', 'รหัสไปรษณีย์', 'เลขบัตรประชาชน / เลขผู้เสียภาษี']) {
      expect(value(label), label).toBe('')
    }
  })

  it('ช่องว่างไม่มีข้อความตัวอย่าง (ไม่มีชื่อ/เบอร์/ที่อยู่สมมติ)', async () => {
    await openForm()
    for (const label of ['ชื่อลูกค้า / ชื่อบริษัท', 'เบอร์โทรศัพท์หลัก', 'เบอร์โทรศัพท์สำรอง', 'อีเมล', 'LINE ID', 'บ้านเลขที่', 'หมู่', 'รหัสไปรษณีย์', 'เลขบัตรประชาชน / เลขผู้เสียภาษี']) {
      expect(screen.getByLabelText(label).getAttribute('placeholder'), label).toBeNull()
    }
  })

  it('OCR กรอกทุกค่าที่อ่านได้ลงช่องที่ยังว่าง ไม่ทับที่พิมพ์ไว้ และไม่เติมรหัสไปรษณีย์', async () => {
    await openForm()
    fireEvent.change(screen.getByLabelText('ชื่อลูกค้า / ชื่อบริษัท'), { target: { value: 'ชื่อที่พิมพ์เอง' } })
    await runScan({ name: 'นาย ทดสอบ ระบบดี', idCardNumber: '1-1017-00203-45-1', houseNo: '99/1' })
    // The typed name stays; the card's name is offered to put in by hand.
    expect(value('ชื่อลูกค้า / ชื่อบริษัท')).toBe('ชื่อที่พิมพ์เอง')
    expect(value('เลขบัตรประชาชน / เลขผู้เสียภาษี')).toBe('1-1017-00203-45-1')
    expect(value('บ้านเลขที่')).toBe('99/1')
    expect(value('หมู่')).toBe('')
    expect(value('รหัสไปรษณีย์')).toBe('')
    const status = screen.getByRole('status', { name: 'ผลการอ่านบัตร' }).textContent || ''
    expect(status).toContain('อ่านได้: เลขบัตร, บ้านเลขที่')
    expect(status).toContain('ชื่อ-นามสกุล: นาย ทดสอบ ระบบดี')
    expect(status).toContain('อ่านไม่ได้ (เว้นว่างไว้)')
  })

  it('ช่องว่าง: ชื่อและที่อยู่ที่อ่านได้ถูกกรอกให้เลย และต้องติ๊กตรวจก่อนบันทึก', async () => {
    const { onSave } = await openForm()
    await runScan({ name: 'นาย ทดสอบ ระบบดี', houseNo: '99/1' })
    expect(value('ชื่อลูกค้า / ชื่อบริษัท')).toBe('นาย ทดสอบ ระบบดี')
    expect(value('บ้านเลขที่')).toBe('99/1')
    expect(screen.queryByRole('button', { name: /^ใส่ในช่อง/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('เบอร์โทรศัพท์หลัก'), { target: { value: '0812345678' } })
    await submit()
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('ติ๊กยืนยัน')

    fireEvent.click(screen.getByRole('checkbox', { name: /ฉันตรวจข้อมูลที่อ่านจากบัตรแล้ว/ }))
    await submit()
    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = (onSave.mock.calls[0] as unknown as [Customer])[0]
    expect(saved).toMatchObject({ customerName: 'นาย ทดสอบ ระบบดี', houseNo: '99/1', postalCode: '' })
    expect(saved.moo).toBeUndefined()
  })

  it('ช่องที่พิมพ์ไว้แล้วค่าไม่ตรงกับบัตร: เก็บค่าที่พิมพ์ไว้ และกดใส่ค่าจากบัตรเองได้', async () => {
    const { onSave } = await openForm()
    fireEvent.change(screen.getByLabelText('ชื่อลูกค้า / ชื่อบริษัท'), { target: { value: 'ลูกค้า ง' } })
    fireEvent.change(screen.getByLabelText('บ้านเลขที่'), { target: { value: '7' } })
    await runScan({ houseNo: '99/1', moo: '5' })
    expect(value('บ้านเลขที่')).toBe('7')
    expect(value('หมู่')).toBe('5')
    fireEvent.click(screen.getByRole('button', { name: 'ใส่ในช่องบ้านเลขที่' }))
    expect(value('บ้านเลขที่')).toBe('99/1')
    fireEvent.click(screen.getByRole('checkbox', { name: /ฉันตรวจข้อมูลที่อ่านจากบัตรแล้ว/ }))
    await submit()
    const saved = (onSave.mock.calls[0] as unknown as [Customer])[0]
    expect(saved).toMatchObject({ houseNo: '99/1', moo: '5' })
  })

  it('ลบค่าที่ OCR เติมออก: ช่องนั้นว่างและบันทึกเป็นค่าว่าง ไม่เติมกลับ', async () => {
    const { onSave } = await openForm()
    await runScan({ idCardNumber: '1-1017-00203-45-1', houseNo: '99/1' })
    fireEvent.change(screen.getByLabelText('ชื่อลูกค้า / ชื่อบริษัท'), { target: { value: 'ลูกค้า จ' } })
    fireEvent.change(screen.getByLabelText('เลขบัตรประชาชน / เลขผู้เสียภาษี'), { target: { value: '' } })
    expect(value('เลขบัตรประชาชน / เลขผู้เสียภาษี')).toBe('')
    fireEvent.click(screen.getByRole('checkbox', { name: /ฉันตรวจข้อมูลที่อ่านจากบัตรแล้ว/ }))
    await submit()
    const saved = (onSave.mock.calls[0] as unknown as [Customer])[0]
    expect(saved.idCardNumber).toBe('')
    expect(saved.address).toBe('เลขที่ 99/1')
  })

  it('OCR อ่านไม่สำเร็จ: แจ้งตรงๆ ไม่มีช่องไหนถูกเติม', async () => {
    await openForm()
    await runScan({ ocrFailed: true })
    expect(screen.getByRole('status', { name: 'ผลการอ่านบัตร' }).textContent).toContain('อ่านข้อมูลจากบัตรไม่สำเร็จ')
    for (const label of ['ชื่อลูกค้า / ชื่อบริษัท', 'เลขบัตรประชาชน / เลขผู้เสียภาษี', 'บ้านเลขที่']) expect(value(label)).toBe('')
    expect(screen.queryByRole('checkbox', { name: /ฉันตรวจข้อมูล/ })).toBeNull()
  })
})
