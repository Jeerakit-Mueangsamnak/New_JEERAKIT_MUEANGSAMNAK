'use server'

import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** LINE integration is a later phase (Master v4.3.1 §36.1): its secrets table is not created yet. */
const LINE_NOT_READY = 'การเชื่อมต่อ LINE จะเปิดใช้ในเฟสถัดไป'
/** Switch on together with the system_secrets table (LINE phase); until then never query it. */
const LINE_ENABLED = false
const isMissingTable = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === 'PGRST205' || error.code === '42P01' || /Could not find the table|does not exist/i.test(error.message || '')))

async function getAuthorizedAdminClient() {
  const serverClient = await createServerSupabase()
  const { data: { user }, error: authError } = await serverClient.auth.getUser()
  if (authError) throw new Error('ไม่สามารถตรวจสอบสิทธิ์ผู้ใช้ได้')
  if (!user) throw new Error('กรุณาเข้าสู่ระบบก่อนจัดการข้อมูลลับ')

  const adminClient = createAdminClient()
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw new Error('ไม่สามารถตรวจสอบสิทธิ์ผู้ดูแลระบบได้')
  if (profile?.role !== 'OWNER') throw new Error('เฉพาะเจ้าของระบบเท่านั้นที่จัดการข้อมูลลับได้')
  return adminClient
}

export async function getLineSecretStatus(): Promise<{
  lineTokenConfigured: boolean
  lineSecretConfigured: boolean
}> {
  const adminClient = await getAuthorizedAdminClient()
  if (!LINE_ENABLED) return { lineTokenConfigured: false, lineSecretConfigured: false }
  const { data, error } = await adminClient
    .from('system_secrets')
    .select('line_channel_access_token, line_channel_secret')
    .eq('id', 'default')
    .maybeSingle()

  if (isMissingTable(error)) return { lineTokenConfigured: false, lineSecretConfigured: false }
  if (error) throw new Error('ไม่สามารถตรวจสอบสถานะ LINE credentials ได้')
  return {
    lineTokenConfigured: Boolean(data?.line_channel_access_token),
    lineSecretConfigured: Boolean(data?.line_channel_secret),
  }
}

export async function saveLineSecrets(input: {
  lineToken?: string
  lineSecret?: string
}): Promise<void> {
  if (!input || typeof input !== 'object') throw new Error('ข้อมูล LINE credentials ไม่ถูกต้อง')
  if (
    (input.lineToken !== undefined && typeof input.lineToken !== 'string') ||
    (input.lineSecret !== undefined && typeof input.lineSecret !== 'string')
  ) {
    throw new Error('รูปแบบ LINE credentials ไม่ถูกต้อง')
  }
  const lineToken = input.lineToken?.trim()
  const lineSecret = input.lineSecret?.trim()
  if (!lineToken && !lineSecret) throw new Error('กรุณากรอก Token หรือ Channel Secret ที่ต้องการบันทึก')
  if ((lineToken?.length ?? 0) > 4096 || (lineSecret?.length ?? 0) > 4096) {
    throw new Error('LINE credentials มีความยาวเกินกำหนด')
  }

  const adminClient = await getAuthorizedAdminClient()
  if (!LINE_ENABLED) throw new Error(LINE_NOT_READY)
  const values: Record<string, string> = { id: 'default' }
  if (lineToken) values.line_channel_access_token = lineToken
  if (lineSecret) values.line_channel_secret = lineSecret

  const { error } = await adminClient.from('system_secrets').upsert(values)
  if (isMissingTable(error)) throw new Error(LINE_NOT_READY)
  if (error) throw new Error('ไม่สามารถบันทึก LINE credentials ได้')
}

export async function clearLineSecrets(): Promise<void> {
  const adminClient = await getAuthorizedAdminClient()
  if (!LINE_ENABLED) throw new Error(LINE_NOT_READY)
  const { error } = await adminClient
    .from('system_secrets')
    .update({ line_channel_access_token: null, line_channel_secret: null })
    .eq('id', 'default')

  if (isMissingTable(error)) throw new Error(LINE_NOT_READY)
  if (error) throw new Error('ไม่สามารถลบ LINE credentials ได้')
}
