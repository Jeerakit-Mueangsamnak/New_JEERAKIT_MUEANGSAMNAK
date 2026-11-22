import { liffText, readLiffRequest } from '@/lib/line/liff-request'
import { createSupabaseLineStore, type LiffDriverJob } from '@/lib/line/supabase-store'
import { stageLabel } from '@/lib/work-order-stages'
import { decodeJobPhoto, JOB_PHOTO_LIMIT } from '@/lib/line/job-photos'

/**
 * Driver job form (LIFF, owner 2026-11-13): LOAD the job, ACCEPT it, or record the next STEP with
 * a note and up to 3 photos. Public: the LINE ID token (checked with LINE) proves the driver, and
 * the database answers only for the driver the job was sent to.
 */
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAGE = /^[A-Z_]{2,20}$/
const MESSAGES: Record<string, string> = {
  SUSPENDED: 'สิทธิ์การใช้งานนี้ถูกระงับ กรุณาติดต่อเจ้าของร้าน',
  NOT_ASSIGNEE: 'งานนี้ไม่ได้ส่งถึง LINE นี้',
  NOT_FOUND: 'ไม่พบงานนี้',
  INVALID_STATE: 'งานนี้ถูกยกเลิกหรือเปลี่ยนคนขับแล้ว',
  NOT_ACCEPTED: 'กรุณากดรับงานก่อน',
  OUT_OF_ORDER: 'ขั้นตอนนี้ยังไม่ถึง หรือบันทึกไปแล้ว',
  ALREADY: 'บันทึกขั้นตอนนี้ไปแล้ว',
  INVALID_INPUT: 'ข้อมูลไม่ถูกต้อง (หมายเหตุไม่เกิน 500 ตัวอักษร รูปไม่เกิน 3 รูป)',
}

const fail = (result: string, status: number) => Response.json({ ok: false, result, message: MESSAGES[result] ?? 'ทำรายการไม่สำเร็จ' }, { status })

export async function POST(request: Request): Promise<Response> {
  const req = await readLiffRequest(request)
  if (!req.ok) return req.response
  const { body, lineUserId } = req
  const taskId = liffText(body.taskId, 40)
  const action = liffText(body.action, 10).toUpperCase()
  if (!UUID.test(taskId) || !['LOAD', 'ACCEPT', 'STEP'].includes(action)) return fail('NOT_FOUND', 400)

  const store = createSupabaseLineStore()
  const progress = async (stage: string, type?: string | null) => {
    try {
      await store.jobProgress?.(taskId, stage, stageLabel(stage, type))
    } catch {
      // the step itself is safe in the database; only the notice is lost
    }
  }
  const load = async (): Promise<LiffDriverJob> => store.driverJob(lineUserId, taskId)
  const answer = (job: LiffDriverJob, extra: Record<string, unknown> = {}) =>
    job.result === 'OK' ? Response.json({ ok: true, job, ...extra }) : fail(job.result, job.result === 'NOT_FOUND' ? 404 : 403)

  try {
    const job = await load()
    if (job.result !== 'OK' || action === 'LOAD') return answer(job)

    if (action === 'ACCEPT') {
      const r = await store.taskPostback(lineUserId, taskId, 'ACCEPT')
      if (r.result === 'ACCEPTED') await progress('ACCEPT', job.appointment?.type)
      else if (r.result !== 'ALREADY') return fail(r.result, 409)
      return answer(await load(), { message: 'รับงานแล้ว' })
    }

    // STEP: check the job and the photos before anything is stored
    const stage = liffText(body.stage, 20).toUpperCase()
    if (!STAGE.test(stage)) return fail('INVALID_INPUT', 400)
    if (job.task?.status === 'SENT') return fail('NOT_ACCEPTED', 409)
    if (!job.holds || job.task?.status !== 'ACCEPTED') return fail('INVALID_STATE', 409)
    const note = liffText(body.note, 501) || null
    if (note && note.length > 500) return fail('INVALID_INPUT', 400)
    const raw = Array.isArray(body.photos) ? body.photos : []
    if (raw.length > JOB_PHOTO_LIMIT) return fail('INVALID_INPUT', 400)
    const photos = raw.map(decodeJobPhoto)
    if (photos.some((p) => !p)) return fail('INVALID_INPUT', 400)

    const paths: string[] = []
    try {
      for (const p of photos) {
        if (!p) continue
        const path = `${taskId}/${crypto.randomUUID()}.${p.ext}`
        await store.uploadJobPhoto(path, p.bytes, p.type)
        paths.push(path)
      }
      const r = await store.taskStep(lineUserId, taskId, stage, { note, photos: paths })
      if (r.result !== 'STEP_DONE') {
        await store.removeJobPhotos(paths).catch(() => undefined)
        return fail(r.result, 409)
      }
      await progress(r.stage || stage, r.appointment_type ?? job.appointment?.type)
      return answer(await load(), { message: `บันทึก "${stageLabel(r.stage || stage, job.appointment?.type)}" แล้ว` })
    } catch (error) {
      await store.removeJobPhotos(paths).catch(() => undefined)
      throw error
    }
  } catch {
    return Response.json({ ok: false, message: 'ทำรายการไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 })
  }
}
