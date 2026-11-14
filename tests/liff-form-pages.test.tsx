// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/** Pages inside LINE (owner 2026-11-13) with LIFF replaced: what the driver / OWNER sees and sends. */

const TASK = '11111111-2222-4333-8444-555555555555'
// same object every render, like the real hook's state
const { liff, ready, postLiff } = vi.hoisted(() => {
  const liff = { isInClient: () => false, closeWindow: () => undefined, getIDToken: () => 'tok' }
  return { liff, ready: { phase: 'ready', liff }, postLiff: vi.fn() }
})
vi.mock('@/lib/line/use-liff', () => ({ useLiff: () => ready, postLiff }))

import LiffJobPage from '@/app/liff/job/page'
import LiffFinancePage from '@/app/liff/finance/page'

const job = (status: string, events: unknown[] = [], next: string | null = 'ACCEPT') => ({
  task: { id: TASK, title: 'ส่งนั่งร้าน บ้านคุณเอ', detail: 'ส่งก่อนเที่ยง', status },
  holds: true,
  appointment: { type: 'DELIVERY', start: '2031-06-01T02:00:00Z', place: '12 ถ.สายหนึ่ง', contact: 'คุณเอ', phone: '0811111111', description: null },
  items: [{ name: 'นั่งร้าน 1.7 ม.', qty: 20, unit: 'ชุด' }],
  events,
  next_stage: next,
})

beforeEach(() => {
  window.history.pushState({}, '', `/liff/job?task=${TASK}`)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('driver job form', () => {
  it('shows the job, the items and the steps; รับงาน sends ACCEPT for this job', async () => {
    postLiff.mockResolvedValueOnce({ ok: true, job: job('SENT') })
    render(<LiffJobPage />)
    expect(await screen.findByText('ส่งนั่งร้าน บ้านคุณเอ')).toBeTruthy()
    expect(screen.getByText('นั่งร้าน 1.7 ม.')).toBeTruthy()
    expect(screen.getByText('20 ชุด')).toBeTruthy()
    expect(screen.getByText('0811111111').closest('a')?.getAttribute('href')).toBe('tel:0811111111')
    expect(screen.getByText('12 ถ.สายหนึ่ง').closest('a')?.getAttribute('href')).toContain('google.com/maps')
    expect(screen.getByText('1. รับงาน')).toBeTruthy()
    expect(postLiff).toHaveBeenCalledWith(liff, '/api/line/liff-job', { taskId: TASK, action: 'LOAD' })

    postLiff.mockResolvedValueOnce({ ok: true, message: 'รับงานแล้ว', job: job('ACCEPTED', [{ stage: 'ACCEPT', status: 'DONE', timestamp: '2031-06-01T01:00:00Z' }], 'PREPARE') })
    fireEvent.click(screen.getByRole('button', { name: 'รับงาน' }))
    await waitFor(() => expect(postLiff).toHaveBeenLastCalledWith(liff, '/api/line/liff-job', { taskId: TASK, action: 'ACCEPT' }))
    expect(await screen.findByText('บันทึกขั้นตอน: เตรียม')).toBeTruthy()
    expect(screen.getByText('รับงานแล้ว')).toBeTruthy()
  })

  it('the next step is sent with the note; after saving the note box is empty again', async () => {
    postLiff.mockResolvedValueOnce({ ok: true, job: job('ACCEPTED', [{ stage: 'ACCEPT', status: 'DONE' }], 'PREPARE') })
    render(<LiffJobPage />)
    const box = (await screen.findByLabelText('หมายเหตุ')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'ของครบ 20 ชุด' } })
    postLiff.mockResolvedValueOnce({
      ok: true,
      message: 'บันทึก "เตรียม" แล้ว',
      job: job('ACCEPTED', [{ stage: 'ACCEPT', status: 'DONE' }, { stage: 'PREPARE', status: 'DONE', note: 'ของครบ 20 ชุด' }], 'PREPARED'),
    })
    fireEvent.click(screen.getByRole('button', { name: /บันทึก “เตรียม”/ }))
    await waitFor(() =>
      expect(postLiff).toHaveBeenLastCalledWith(liff, '/api/line/liff-job', { taskId: TASK, action: 'STEP', stage: 'PREPARE', note: 'ของครบ 20 ชุด', photos: [] })
    )
    expect(await screen.findByText('บันทึกขั้นตอน: เตรียมเสร็จ')).toBeTruthy()
    expect((screen.getByLabelText('หมายเหตุ') as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByText('ของครบ 20 ชุด')).toBeTruthy()
  })

  it('a job not sent to this LINE shows the reason only', async () => {
    postLiff.mockResolvedValueOnce({ ok: false, message: 'งานนี้ไม่ได้ส่งถึง LINE นี้' })
    render(<LiffJobPage />)
    expect(await screen.findByText('งานนี้ไม่ได้ส่งถึง LINE นี้')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('OWNER income / expense form', () => {
  it('an expense is sent with its fixed category code and shows the document number', async () => {
    postLiff.mockResolvedValueOnce({ ok: true, name: 'เจ้าของร้าน', incomeItems: ['ค่าเช่าที่'] })
    render(<LiffFinancePage />)
    expect(await screen.findByText('เจ้าของร้าน')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('หมวด'), { target: { value: 'FUEL' } })
    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท)'), { target: { value: '450.50' } })
    fireEvent.change(screen.getByLabelText('รายละเอียด'), { target: { value: 'เติมน้ำมัน' } })
    postLiff.mockResolvedValueOnce({ ok: true, docNo: 'EXP-13112569-001', amount: 450.5 })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() =>
      expect(postLiff).toHaveBeenLastCalledWith(liff, '/api/line/liff-finance', { action: 'SAVE', kind: 'EXPENSE', category: 'FUEL', amount: 450.5, channel: 'CASH', note: 'เติมน้ำมัน' })
    )
    expect(await screen.findByText(/EXP-13112569-001/)).toBeTruthy()
  })

  it('income uses the shop\'s income items; nothing is sent without a category or amount', async () => {
    postLiff.mockResolvedValueOnce({ ok: true, name: 'เจ้าของร้าน', incomeItems: ['ค่าเช่าที่'] })
    render(<LiffFinancePage />)
    await screen.findByText('เจ้าของร้าน')
    fireEvent.click(screen.getByRole('radio', { name: 'รายรับ' }))
    expect(screen.getByRole('option', { name: 'ค่าเช่าที่' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'ค่าน้ำมัน' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(await screen.findByText('กรุณาเลือกหมวด')).toBeTruthy()
    expect(postLiff).toHaveBeenCalledTimes(1)
  })

  it('a LINE that is not the OWNER\'s sees the reason only', async () => {
    postLiff.mockResolvedValueOnce({ ok: false, message: 'ฟอร์มนี้ใช้ได้เฉพาะ LINE ของเจ้าของร้านที่ผูกกับระบบแล้ว' })
    render(<LiffFinancePage />)
    expect(await screen.findByText(/ใช้ได้เฉพาะ LINE ของเจ้าของร้าน/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
