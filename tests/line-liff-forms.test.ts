import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Forms inside LINE (LIFF, owner 2026-11-13): driver job form + OWNER income / expense form. */

const TASK = '11111111-2222-4333-8444-555555555555'
const LINE_USER = 'U' + 'a'.repeat(32)

const verify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/line/liff', () => ({ verifyLiffIdToken: verify }))
const store = vi.hoisted(() => ({
  driverJob: vi.fn(),
  taskPostback: vi.fn(),
  taskStep: vi.fn(),
  jobProgress: vi.fn(async () => undefined),
  uploadJobPhoto: vi.fn(async () => undefined),
  removeJobPhotos: vi.fn(async () => undefined),
  ownerFinanceForm: vi.fn(),
  financeEntry: vi.fn(),
}))
vi.mock('@/lib/line/supabase-store', () => ({ createSupabaseLineStore: () => store }))

import { POST as jobPost } from '@/app/api/line/liff-job/route'
import { POST as financePost } from '@/app/api/line/liff-finance/route'
import { decodeJobPhoto, JOB_PHOTO_MAX_BYTES } from '@/lib/line/job-photos'
import { liffUrl } from '@/lib/line/liff-links'
import { driverTaskMessages } from '@/lib/line/templates'

const req = (url: string, body: Record<string, unknown>) =>
  new Request(`http://x${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: 'tok', ...body }) })
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64')
const job = (status: string, extra: Record<string, unknown> = {}) => ({
  result: 'OK',
  task: { id: TASK, title: 'ส่งของ', detail: null, status },
  holds: true,
  appointment: { type: 'DELIVERY' },
  items: [],
  events: [],
  next_stage: 'PREPARE',
  ...extra,
})

beforeEach(() => {
  vi.stubEnv('LINE_LOGIN_CHANNEL_ID', '1234567890')
  verify.mockResolvedValue({ ok: true, lineUserId: LINE_USER, name: 'คนขับ' })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('LIFF links', () => {
  it('one LIFF app, the form is the path after the id; no id = no link', () => {
    expect(liffUrl('job', { task: TASK }, 'LIFF-1')).toBe(`https://liff.line.me/LIFF-1/job?task=${TASK}`)
    expect(liffUrl('bind', { t: 'LINK-ABC', k: 'DRIVER' }, 'LIFF-1')).toBe('https://liff.line.me/LIFF-1/bind?t=LINK-ABC&k=DRIVER')
    expect(liffUrl('finance', {}, 'LIFF-1')).toBe('https://liff.line.me/LIFF-1/finance')
    expect(liffUrl('finance', {}, '')).toBeNull()
  })

  it('the driver job card gets "เปิดฟอร์มงาน" only when the form link exists', () => {
    const withForm = JSON.stringify(driverTaskMessages(TASK, { ผู้สั่ง: 'ร้าน', เรื่อง: 'ส่งของ' }, undefined, { when: 'x', formUrl: `https://liff.line.me/L/job?task=${TASK}` }))
    expect(withForm).toContain('เปิดฟอร์มงาน')
    expect(withForm).toContain(`https://liff.line.me/L/job?task=${TASK}`)
    expect(JSON.stringify(driverTaskMessages(TASK, { ผู้สั่ง: 'ร้าน', เรื่อง: 'ส่งของ' }, undefined, { when: 'x' }))).not.toContain('เปิดฟอร์มงาน')
  })

  it('job photos: jpeg / png / webp data only, at most 2 MB', () => {
    expect(decodeJobPhoto(PHOTO)).toMatchObject({ ext: 'jpg', type: 'image/jpeg' })
    expect(decodeJobPhoto('data:image/gif;base64,AAAA')).toBeNull()
    expect(decodeJobPhoto('data:text/html;base64,AAAA')).toBeNull()
    expect(decodeJobPhoto(42)).toBeNull()
    expect(decodeJobPhoto('data:image/png;base64,' + 'A'.repeat(Math.ceil((JOB_PHOTO_MAX_BYTES + 10) / 3) * 4))).toBeNull()
  })
})

describe('driver job form endpoint', () => {
  it('without LINE Login set up, or with a bad LINE token, nothing is read', async () => {
    vi.stubEnv('LINE_LOGIN_CHANNEL_ID', '')
    expect((await jobPost(req('/api/line/liff-job', { taskId: TASK, action: 'LOAD' }))).status).toBe(503)
    vi.stubEnv('LINE_LOGIN_CHANNEL_ID', '1234567890')
    verify.mockResolvedValue({ ok: false, error: 'TOKEN_INVALID' })
    expect((await jobPost(req('/api/line/liff-job', { taskId: TASK, action: 'LOAD' }))).status).toBe(401)
    expect(store.driverJob).not.toHaveBeenCalled()
  })

  it('another LINE than the job\'s driver gets nothing', async () => {
    store.driverJob.mockResolvedValue({ result: 'NOT_ASSIGNEE' })
    const res = await jobPost(req('/api/line/liff-job', { taskId: TASK, action: 'LOAD' }))
    expect(res.status).toBe(403)
    expect(store.driverJob).toHaveBeenCalledWith(LINE_USER, TASK)
  })

  it('รับงาน accepts the job and tells the shop', async () => {
    store.driverJob.mockResolvedValueOnce(job('SENT')).mockResolvedValueOnce(job('ACCEPTED'))
    store.taskPostback.mockResolvedValue({ result: 'ACCEPTED' })
    const body = await (await jobPost(req('/api/line/liff-job', { taskId: TASK, action: 'ACCEPT' }))).json()
    expect(body).toMatchObject({ ok: true, job: { task: { status: 'ACCEPTED' } } })
    expect(store.jobProgress).toHaveBeenCalledWith(TASK, 'ACCEPT', 'รับงาน')
  })

  it('a step stores the photos under the job, then records the step with the note and their paths', async () => {
    store.driverJob.mockResolvedValue(job('ACCEPTED'))
    store.taskStep.mockResolvedValue({ result: 'STEP_DONE', stage: 'PREPARE', appointment_type: 'DELIVERY' })
    const res = await jobPost(req('/api/line/liff-job', { taskId: TASK, action: 'STEP', stage: 'prepare', note: ' ของครบ ', photos: [PHOTO, PHOTO] }))
    expect(res.status).toBe(200)
    expect(store.uploadJobPhoto).toHaveBeenCalledTimes(2)
    const paths = store.taskStep.mock.calls[0][3].photos as string[]
    expect(paths).toHaveLength(2)
    paths.forEach((p) => expect(p).toMatch(new RegExp(`^${TASK}/[0-9a-f-]{36}\\.jpg$`)))
    expect(store.taskStep).toHaveBeenCalledWith(LINE_USER, TASK, 'PREPARE', { note: 'ของครบ', photos: paths })
    expect(store.jobProgress).toHaveBeenCalledWith(TASK, 'PREPARE', 'เตรียม')
  })

  it('a refused step removes the photos it stored', async () => {
    store.driverJob.mockResolvedValue(job('ACCEPTED'))
    store.taskStep.mockResolvedValue({ result: 'OUT_OF_ORDER', next_stage: 'PREPARE' })
    const res = await jobPost(req('/api/line/liff-job', { taskId: TASK, action: 'STEP', stage: 'TRANSIT', photos: [PHOTO] }))
    expect(res.status).toBe(409)
    expect(store.removeJobPhotos).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^${TASK}/`))])
    expect(store.jobProgress).not.toHaveBeenCalled()
  })

  it('before รับงาน, on another driver\'s job, with 4 photos or a non-photo: nothing is stored', async () => {
    store.driverJob.mockResolvedValue(job('SENT'))
    expect((await jobPost(req('/api/line/liff-job', { taskId: TASK, action: 'STEP', stage: 'PREPARE', photos: [PHOTO] }))).status).toBe(409)
    store.driverJob.mockResolvedValue(job('ACCEPTED', { holds: false }))
    expect((await jobPost(req('/api/line/liff-job', { taskId: TASK, action: 'STEP', stage: 'PREPARE', photos: [PHOTO] }))).status).toBe(409)
    store.driverJob.mockResolvedValue(job('ACCEPTED'))
    expect((await jobPost(req('/api/line/liff-job', { taskId: TASK, action: 'STEP', stage: 'PREPARE', photos: [PHOTO, PHOTO, PHOTO, PHOTO] }))).status).toBe(400)
    expect((await jobPost(req('/api/line/liff-job', { taskId: TASK, action: 'STEP', stage: 'PREPARE', photos: ['data:text/html;base64,AAAA'] }))).status).toBe(400)
    expect((await jobPost(req('/api/line/liff-job', { taskId: 'not-a-task', action: 'LOAD' }))).status).toBe(400)
    expect(store.uploadJobPhoto).not.toHaveBeenCalled()
    expect(store.taskStep).not.toHaveBeenCalled()
  })
})

describe('OWNER income / expense form endpoint', () => {
  it('opens only for the OWNER\'s LINE and gives the income quick items', async () => {
    store.ownerFinanceForm.mockResolvedValueOnce({ result: 'NOT_OWNER' })
    expect((await financePost(req('/api/line/liff-finance', { action: 'LOAD' }))).status).toBe(403)
    store.ownerFinanceForm.mockResolvedValueOnce({ result: 'OK', name: 'เจ้าของ', income_items: ['ค่าเช่าที่', ''] })
    expect(await (await financePost(req('/api/line/liff-finance', { action: 'LOAD' }))).json()).toEqual({ ok: true, name: 'เจ้าของ', incomeItems: ['ค่าเช่าที่'] })
  })

  it('saves straight into finance with the amount rounded to satang', async () => {
    store.financeEntry.mockResolvedValue({ result: 'OK', doc_no: 'EXP-1', amount: 450.51 })
    const body = await (
      await financePost(req('/api/line/liff-finance', { action: 'SAVE', kind: 'expense', category: 'FUEL', amount: 450.505, channel: 'cash', note: ' น้ำมัน ' }))
    ).json()
    expect(body).toMatchObject({ ok: true, docNo: 'EXP-1' })
    expect(store.financeEntry).toHaveBeenCalledWith(LINE_USER, { kind: 'EXPENSE', category: 'FUEL', amount: 450.51, channel: 'CASH', note: 'น้ำมัน' })
  })

  it('bad values are refused before the database; a non-owner save is refused', async () => {
    for (const bad of [
      { kind: 'GIFT', category: 'x', amount: 10, channel: 'CASH' },
      { kind: 'INCOME', category: 'x', amount: 0, channel: 'CASH' },
      { kind: 'INCOME', category: 'x', amount: '10', channel: 'CASH' },
      { kind: 'INCOME', category: 'x', amount: 10, channel: 'CARD' },
      { kind: 'INCOME', category: ' ', amount: 10, channel: 'CASH' },
    ]) {
      expect((await financePost(req('/api/line/liff-finance', { action: 'SAVE', ...bad }))).status).toBe(400)
    }
    expect(store.financeEntry).not.toHaveBeenCalled()
    store.financeEntry.mockResolvedValue({ result: 'NOT_OWNER' })
    expect((await financePost(req('/api/line/liff-finance', { action: 'SAVE', kind: 'INCOME', category: 'x', amount: 10, channel: 'CASH' }))).status).toBe(403)
  })
})
