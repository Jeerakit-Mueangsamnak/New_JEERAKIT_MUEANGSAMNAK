'use server'

import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMenuCode, normalizeMemberStatus } from '@/features/auth/services/permissions'
import type { MemberStatus, UserRole } from '@/lib/types/rental-pos'

/**
 * OWNER member management (Master v4.3.1 §4): approve/suspend, role, menu access, PIN reset.
 * Every call runs with the signed-in user's own session, so the database decides:
 * RLS limits what can be read, and the owner_set_member_* RPCs re-check OWNER,
 * require a reason, lock rows, and write the audit log in the same transaction.
 */

export interface MemberActionResult<T = unknown> {
  success: boolean
  error?: string
  warning?: string
  data?: T
}

export interface MemberRecord {
  userId: string
  username: string
  email: string
  displayName: string
  role: UserRole
  status: MemberStatus
  menus: string[]
  /** Risky actions the OWNER granted (member_action_grants). */
  actions: string[]
  createdAt: string | null
}

export interface MemberList {
  members: MemberRecord[]
  /** false while the database has no member_action_grants table yet (migration not applied). */
  actionGrantsAvailable: boolean
}

const RPC_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'เฉพาะเจ้าของร้านเท่านั้นที่ทำรายการนี้ได้',
  REASON_REQUIRED: 'กรุณาระบุเหตุผล',
  CANNOT_CHANGE_SELF: 'ไม่สามารถเปลี่ยนสถานะหรือระดับสิทธิ์ของบัญชีตัวเองได้',
  LAST_OWNER: 'ต้องมีเจ้าของร้านที่ใช้งานได้อย่างน้อย 1 คน',
  MEMBER_NOT_FOUND: 'ไม่พบผู้ใช้งานนี้',
  MEMBER_NOT_ACTIVE: 'ต้องอนุมัติผู้ใช้งานก่อนจึงจะตั้งเป็นเจ้าของร้านได้',
  OWNER_HAS_ALL_MENUS: 'เจ้าของร้านเข้าได้ทุกเมนูอยู่แล้ว',
  OWNER_HAS_ALL_ACTIONS: 'เจ้าของร้านทำได้ทุกรายการอยู่แล้ว',
  UNKNOWN_ACTION: 'มีสิทธิ์การทำรายการที่ระบบไม่รู้จัก',
  UNKNOWN_OR_OWNER_ONLY_MENU: 'มีเมนูที่ระบบไม่รู้จักหรือเป็นเมนูเฉพาะเจ้าของร้าน',
  PIN_NOT_SET: 'ผู้ใช้งานนี้ยังไม่ได้ตั้ง PIN',
  INVALID_STATUS: 'สถานะไม่ถูกต้อง',
  INVALID_ROLE: 'ระดับสิทธิ์ไม่ถูกต้อง',
}

function toThaiError(message: string | undefined): string {
  const key = Object.keys(RPC_ERROR_MESSAGES).find((code) => (message || '').startsWith(code))
  return key ? RPC_ERROR_MESSAGES[key] : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
}

/** Reason is optional (owner decision 2026-10-22); the server records a fixed marker when empty. */
function optionalReason(reason?: string): string | null {
  const trimmed = (reason || '').trim()
  return trimmed ? trimmed : null
}

export async function listMembers(): Promise<MemberActionResult<MemberList>> {
  try {
    const supabase = await createServerSupabase()

    // RLS: an OWNER sees every profile and menu grant; anyone else sees only their own rows
    const [{ data: profiles, error: profileError }, { data: grants, error: grantError }, actionResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, email, display_name, first_name, last_name, role, status, is_approved, created_at')
        .order('created_at', { ascending: true }),
      supabase.from('user_menu_access').select('user_id, menu_code'),
      supabase.from('member_action_grants').select('user_id, action_code'),
    ])
    // Before the action-grants migration is applied the table does not exist: show no grants.
    const actionTableMissing = ['PGRST205', '42P01'].includes(actionResult.error?.code || '')
    if (actionResult.error && !actionTableMissing) {
      console.error('listMembers failed:', actionResult.error.message)
      return { success: false, error: 'โหลดรายชื่อผู้ใช้งานไม่สำเร็จ' }
    }
    const actionsByUser = new Map<string, string[]>()
    for (const row of (actionResult.data || []) as Array<{ user_id: string; action_code: string }>) {
      actionsByUser.set(row.user_id, [...(actionsByUser.get(row.user_id) || []), row.action_code])
    }

    if (profileError || grantError) {
      console.error('listMembers failed:', profileError?.message || grantError?.message)
      return { success: false, error: 'โหลดรายชื่อผู้ใช้งานไม่สำเร็จ' }
    }

    const grantsByUser = new Map<string, string[]>()
    for (const row of grants || []) {
      const codes = grantsByUser.get(row.user_id) || []
      codes.push(row.menu_code)
      grantsByUser.set(row.user_id, codes)
    }

    const members: MemberRecord[] = (profiles || []).map((p) => ({
      userId: p.id,
      username: p.username || '',
      email: p.email || '',
      displayName:
        p.display_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.username || p.email || '',
      role: p.role === 'OWNER' ? 'OWNER' : 'USER',
      status: normalizeMemberStatus(p.status, p.is_approved),
      menus: (grantsByUser.get(p.id) || []).filter(isMenuCode),
      actions: actionsByUser.get(p.id) || [],
      createdAt: p.created_at || null,
    }))

    return { success: true, data: { members, actionGrantsAvailable: !actionTableMissing } }
  } catch (err: unknown) {
    console.error('listMembers unexpected error:', err)
    return { success: false, error: 'โหลดรายชื่อผู้ใช้งานไม่สำเร็จ' }
  }
}

async function callOwnerRpc(
  fn: 'owner_set_member_status' | 'owner_set_member_role' | 'owner_reset_member_pin',
  args: Record<string, unknown>
): Promise<MemberActionResult> {
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc(fn, args)
    if (error) {
      console.error(`${fn} failed:`, error.message)
      return { success: false, error: toThaiError(error.message) }
    }
    return { success: true, data }
  } catch (err: unknown) {
    console.error(`${fn} unexpected error:`, err)
    return { success: false, error: 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }
  }
}

export async function setMemberStatus(
  userId: string,
  status: Exclude<MemberStatus, 'PENDING'>,
  reason?: string
): Promise<MemberActionResult> {
  const cleanReason = optionalReason(reason)
  if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
    return { success: false, error: RPC_ERROR_MESSAGES.INVALID_STATUS }
  }
  return callOwnerRpc('owner_set_member_status', { p_user_id: userId, p_status: status, p_reason: cleanReason })
}

export async function setMemberRole(userId: string, role: UserRole, reason?: string): Promise<MemberActionResult> {
  const cleanReason = optionalReason(reason)
  if (role !== 'OWNER' && role !== 'USER') {
    return { success: false, error: RPC_ERROR_MESSAGES.INVALID_ROLE }
  }
  return callOwnerRpc('owner_set_member_role', { p_user_id: userId, p_role: role, p_reason: cleanReason })
}

/** Forgotten or blocked PIN of a USER: the OWNER clears it; the member sets a new one. Audited. */
export async function resetMemberPin(userId: string, reason?: string): Promise<MemberActionResult> {
  const cleanReason = optionalReason(reason)
  return callOwnerRpc('owner_reset_member_pin', { p_user_id: userId, p_reason: cleanReason })
}

/** Permanently removes only an unapproved USER account; historical profile references remain protected by the database. */
export async function deletePendingMember(userId: string): Promise<MemberActionResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return { success: false, error: 'รหัสผู้ใช้งานไม่ถูกต้อง' }
  }

  try {
    const supabase = await createServerSupabase()
    const { data: { user: actor }, error: authError } = await supabase.auth.getUser()
    if (authError || !actor) return { success: false, error: RPC_ERROR_MESSAGES.FORBIDDEN }

    const { data: owner, error: ownerError } = await supabase
      .from('profiles')
      .select('role, status, is_approved')
      .eq('id', actor.id)
      .maybeSingle()
    if (ownerError || owner?.role !== 'OWNER' || owner.status !== 'ACTIVE' || owner.is_approved !== true) {
      return { success: false, error: RPC_ERROR_MESSAGES.FORBIDDEN }
    }

    const { data: target, error: targetError } = await supabase
      .from('profiles')
      .select('id, role, status, username, email, display_name, created_at')
      .eq('id', userId)
      .maybeSingle()
    if (targetError) {
      console.error('deletePendingMember profile lookup failed:', targetError.message)
      return { success: false, error: 'ตรวจสอบบัญชีพนักงานไม่สำเร็จ กรุณาลองใหม่' }
    }
    if (!target) return { success: false, error: RPC_ERROR_MESSAGES.MEMBER_NOT_FOUND }
    if (target.id === actor.id) return { success: false, error: RPC_ERROR_MESSAGES.CANNOT_CHANGE_SELF }
    if (target.role !== 'USER' || target.status !== 'PENDING') {
      return { success: false, error: 'ลบได้เฉพาะพนักงานที่ยังรออนุมัติ' }
    }

    const admin = createAdminClient()
    const { error: deleteError } = await admin.auth.admin.deleteUser(target.id)
    if (deleteError) {
      console.error('deletePendingMember Auth deletion failed:', deleteError.message)
      return {
        success: false,
        error: 'ลบบัญชีไม่สำเร็จ บัญชีนี้อาจมีรายการที่ต้องเก็บประวัติไว้ หรือฐานข้อมูลยังไม่ได้ติดตั้งการลบบัญชีที่รออนุมัติ',
      }
    }

    const { error: auditError } = await supabase.rpc('owner_audit_pending_member_delete', {
      p_user_id: target.id,
      p_before: {
        role: target.role,
        status: target.status,
        username: target.username,
        email: target.email,
        display_name: target.display_name,
        created_at: target.created_at,
      },
    })
    if (auditError) {
      console.error('deletePendingMember audit failed after account deletion:', auditError.message)
      return {
        success: true,
        warning: 'ลบบัญชีแล้ว แต่บันทึกประวัติการลบไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบ',
      }
    }

    return { success: true }
  } catch (err: unknown) {
    console.error('deletePendingMember unexpected error:', err)
    return { success: false, error: 'ลบบัญชีไม่สำเร็จ กรุณาลองใหม่' }
  }
}