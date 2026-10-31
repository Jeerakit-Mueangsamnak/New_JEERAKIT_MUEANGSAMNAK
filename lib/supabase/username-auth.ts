import 'server-only'

import { createAdminClient, validateSupabaseAdminConfig } from '@/lib/supabase/admin'
import { normalizeMemberStatus } from '@/features/auth/services/permissions'
import type { MemberStatus } from '@/lib/types/rental-pos'

// Owner decision 2026-10-26 (Master §4.1): a wrong sign-in password is simply refused — the app
// keeps no attempt count and never locks the account. A forgotten password is reset with the
// Supabase e-mail link (ลืมรหัสผ่าน). The wait/lock ladder belongs to the PIN (Master §4.3).
export const WRONG_CREDENTIALS = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'

export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@+/, '').toLowerCase()
}

export async function resolveUsernameToEmail(username: string): Promise<{
  success: boolean
  email?: string
  /** Only meaningful once the password has been verified; never reveal it before */
  memberStatus?: MemberStatus
  error?: string
}> {
  try {
    const cleanUsername = normalizeUsername(username || '')
    if (!cleanUsername) {
      return { success: false, error: WRONG_CREDENTIALS }
    }

    const configCheck = validateSupabaseAdminConfig()
    if (!configCheck.isValid) {
      return {
        success: false,
        error: configCheck.error || 'การตั้งค่า Supabase ไม่ถูกต้อง กรุณาตรวจสอบ Environment Variables',
      }
    }

    const adminClient = createAdminClient()
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, email, username, status, is_approved')
      .eq('username', cleanUsername)
      .maybeSingle()

    if (profileError) {
      console.error('Supabase profile lookup error:', profileError)
      // PGRST205 (PostgREST) / 42P01 (Postgres): public.profiles does not exist — migrations not applied
      if (profileError.code === 'PGRST205' || profileError.code === '42P01') {
        return {
          success: false,
          error: 'ฐานข้อมูล Supabase ยังไม่มีตาราง profiles (ยังไม่ได้ apply migration) กรุณาติดต่อผู้ดูแลระบบ',
        }
      }
      return { success: false, error: 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล Supabase' }
    }

    if (profile?.email) {
      return {
        success: true,
        email: profile.email,
        memberStatus: normalizeMemberStatus(profile.status, profile.is_approved),
      }
    }

    return { success: false, error: WRONG_CREDENTIALS }
  } catch (err: unknown) {
    console.error('Error resolving username to email:', err)
    const msg = err instanceof Error ? err.message : 'การตั้งค่า Supabase ไม่ถูกต้อง กรุณาตรวจสอบระบบ'
    if (msg.includes('Supabase') || msg.includes('KEY') || msg.includes('URL')) {
      return { success: false, error: msg }
    }
    return { success: false, error: WRONG_CREDENTIALS }
  }
}
