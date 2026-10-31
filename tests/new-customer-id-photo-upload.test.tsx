// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/features/customers/components/CustomerLineLink', () => ({ CustomerLineLink: () => null }))
vi.mock('@/features/customers/components/IDCardScannerModal', () => ({
  IDCardScannerModal: () => <div role="dialog" aria-label="หน้าต่างกล้อง" />,
}))
const ocr = vi.hoisted(() => ({
  scanIdCardPhoto: vi.fn(),
  readIdCardPhotoFile: vi.fn(),
}))
vi.mock('@/features/customers/services/id-card-ocr', () => ({
  ID_CARD_PHOTO_ACCEPT: 'image/jpeg,image/png,image/webp',
  scanIdCardPhoto: ocr.scanIdCardPhoto,
  readIdCardPhotoFile: ocr.readIdCardPhotoFile,
}))

import { NewCustomerModal } from '@/features/customers/components/NewCustomerModal'
import { EMPTY_PARSED_ID_CARD } from '@/lib/ocr/thai-id-parser'

const PHOTO = 'data:image/jpeg;base64,AAAA'
const open = () => act(async () => {
  render(<NewCustomerModal isOpen onClose={vi.fn()} onSave={vi.fn(async () => true)} />)
})
const choose = (file: File) => act(async () => {
  fireEvent.change(screen.getByLabelText('อัปโหลดรูปบัตรประชาชน'), { target: { files: [file] } })
})

describe('เพิ่มลูกค้าใหม่: ปุ่มกล้องและปุ่มอัปโหลดรูปบัตรด้านบนหน้าต่าง', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })))
    ocr.readIdCardPhotoFile.mockReset().mockResolvedValue(PHOTO)
    ocr.scanIdCardPhoto.mockReset().mockResolvedValue({ ...EMPTY_PARSED_ID_CARD, idCardNumber: '1-1017-00203-45-1', croppedImageDataUrl: PHOTO })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('มีปุ่มละหนึ่งปุ่ม: เปิดกล้องสแกนบัตร และอัปโหลดรูปบัตร (ไม่มีปุ่มซ้ำกลางฟอร์ม)', async () => {
    await open()
    expect(screen.getAllByRole('button', { name: /เปิดกล้อง/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /อัปโหลดรูปบัตร/ })).toHaveLength(1)
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1)
    expect(screen.queryByText(/เลือกไฟล์รูป/)).toBeNull()
  })

  it('กดอัปโหลดรูปบัตร: เปิดคลังรูป/ไฟล์ของเครื่องทันที', async () => {
    await open()
    const input = screen.getByLabelText('อัปโหลดรูปบัตรประชาชน') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: /อัปโหลดรูปบัตร/ }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(input.accept).toBe('image/jpeg,image/png,image/webp')
  })

  it('เลือกรูปแล้วอ่านบัตรให้ทันที: เติมค่าที่ยืนยันได้ และเก็บรูปบัตรไว้', async () => {
    await open()
    await choose(new File(['x'], 'card.jpg', { type: 'image/jpeg' }))
    expect(ocr.scanIdCardPhoto).toHaveBeenCalledWith(PHOTO, expect.any(Function))
    expect((screen.getByLabelText('เลขบัตรประชาชน / เลขผู้เสียภาษี') as HTMLInputElement).value).toBe('1-1017-00203-45-1')
    expect(screen.getByRole('status', { name: 'ผลการอ่านบัตร' }).textContent).toContain('อ่านได้: เลขบัตร')
    expect(screen.getByAltText('ID Card').getAttribute('src')).toBe(PHOTO)
    expect(screen.getByText(/card\.jpg/)).toBeTruthy()
  })

  it('ไฟล์ที่ไม่ใช่รูป JPG/PNG/WebP: แจ้งเตือน ไม่ส่งไปอ่าน', async () => {
    ocr.readIdCardPhotoFile.mockResolvedValue(null)
    await open()
    await choose(new File(['x'], 'card.pdf', { type: 'application/pdf' }))
    expect(screen.getByRole('alert').textContent).toContain('JPG, PNG หรือ WebP')
    expect(ocr.scanIdCardPhoto).not.toHaveBeenCalled()
  })

  it('กดเปิดกล้องสแกนบัตร: เปิดหน้าต่างกล้อง', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /เปิดกล้องสแกนบัตร/ }))
    expect(screen.getByRole('dialog', { name: 'หน้าต่างกล้อง' })).toBeTruthy()
  })
})
