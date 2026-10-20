'use server'

import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { lineDeliveryMode } from '@/lib/line/provider'

/**
 * LINE OA credentials (spec Settings › LINE). Stored in Supabase Vault by the OWNER-only RPCs
 * line_channel_set / line_channel_clear (migration 20261008160000_line_operations_v1); read
 * back only by service_role on the server. The browser gets "configured or not" — never a
 * value, and no error message ever repeats what was typed.
 */

export interface LineSecretStatus {
  lineTokenConfigured: boolean
  lineSecretConfigured: boolean
  /** false while Vault / the LINE migration is not available in this database. */
  available: boolean
  /** true only when the server runs with LINE_DELIVERY_MODE=live; otherwise nothing reaches LINE. */
  liveDelivery: boolean
}

const ERRORS: Array<[RegExp, string]> = [
  [/^FORBIDDEN/, 'เฉพาะเจ้าของระบบเท่านั้นที่จัดการข้อมูลลับได้'],
  [/^REASON_REQUIRED/, 'กรุณาระบุเหตุผล'],
  [/^LINE_CHANNEL_SECRET_FORMAT/, 'Channel Secret ไม่ถูกต้อง (ต้องเป็นตัวอักษร 0-9 a-f 32 ตัว)'],
  [/^LINE_ACCESS_TOKEN_FORMAT/, 'Channel Access Token ไม่ถูกต้อง'],
  [/^LINE_CREDENTIALS_REQUIRED/, 'กรุณากรอก Token หรือ Channel Secret ที่ต้องการบันทึก'],
  [/^LINE_VAULT_UNAVAILABLE|PGRST202|Could not find the function/, 'การเชื่อมต่อ LINE ยังไม่พร้อมในฐานข้อมูลนี้'],
]

function thaiError(raw: string | undefined): string {
  for (const [re, text] of ERRORS) if (re.test(raw || '')) return text
  return 'ทำรายการ LINE credentials ไม่สำเร็จ กรุณาลองใหม่'
}

function toStatus(data: unknown): LineSecretStatus {
  const s = (data ?? {}) as { vault?: boolean; secret_configured?: boolean; token_configured?: boolean }
  return {
    liveDelivery: lineDeliveryMode() === 'live',
    available: Boolean(s.vault),
    lineSecretConfigured: Boolean(s.secret_configured),
    lineTokenConfigured: Boolean(s.token_configured),
  }
}

export async function getLineSecretStatus(): Promise<LineSecretStatus> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('line_channel_status')
  if (error) {
    if (/PGRST202|Could not find the function/.test(`${error.code} ${error.message}`)) {
      return { available: false, lineSecretConfigured: false, lineTokenConfigured: false, liveDelivery: lineDeliveryMode() === 'live' }
    }
    throw new Error(thaiError(error.message))
  }
  return toStatus(data)
}

export async function saveLineSecrets(input: { lineToken?: string; lineSecret?: string }): Promise<LineSecretStatus> {
  if (!input || typeof input !== 'object') throw new Error('ข้อมูล LINE credentials ไม่ถูกต้อง')
  if (
    (input.lineToken !== undefined && typeof input.lineToken !== 'string') ||
    (input.lineSecret !== undefined && typeof input.lineSecret !== 'string')
  ) {
    throw new Error('รูปแบบ LINE credentials ไม่ถูกต้อง')
  }
  const lineToken = input.lineToken?.trim() || null
  const lineSecret = input.lineSecret?.trim() || null
  if (!lineToken && !lineSecret) throw new Error('กรุณากรอก Token หรือ Channel Secret ที่ต้องการบันทึก')
  if ((lineToken?.length ?? 0) > 1024 || (lineSecret?.length ?? 0) > 64) {
    throw new Error('LINE credentials มีความยาวเกินกำหนด')
  }
  // Same rules as line_channel_set; refused here so a mistyped value never leaves the server.
  if (lineSecret && !/^[0-9a-f]{32}$/.test(lineSecret)) throw new Error(thaiError('LINE_CHANNEL_SECRET_FORMAT'))
  if (lineToken && (lineToken.length < 20 || /\s/.test(lineToken))) throw new Error(thaiError('LINE_ACCESS_TOKEN_FORMAT'))

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('line_channel_set', { p_channel_secret: lineSecret, p_access_token: lineToken })
  if (error) throw new Error(thaiError(error.message))
  return toStatus(data)
}

/** Removes both credentials from Vault (OWNER, reason required, audited). */
export async function clearLineSecrets(reason: string): Promise<LineSecretStatus> {
  const why = typeof reason === 'string' ? reason.trim() : ''
  if (!why) throw new Error(thaiError('REASON_REQUIRED'))
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('line_channel_clear', { p_reason: why })
  if (error) throw new Error(thaiError(error.message))
  return toStatus(data)
}
