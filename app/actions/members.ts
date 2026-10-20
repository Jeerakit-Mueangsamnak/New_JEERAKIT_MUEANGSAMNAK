'use server'

import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { isMenuCode, GRANTABLE_MENUS, normalizeMemberStatus } from '@/features/auth/services/permissions'
import { GRANTABLE_ACTIONS } from '@/features/auth/services/permission-matrix'
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

function requireReason(reason: string): string | null {
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
  fn: 'owner_set_member_status' | 'owner_set_member_role' | 'owner_set_member_menus' | 'owner_set_member_actions' | 'owner_reset_member_pin',
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
  reason: string
): Promise<MemberActionResult> {
  const cleanReason = requireReason(reason)
  if (!cleanReason) return { success: false, error: RPC_ERROR_MESSAGES.REASON_REQUIRED }
  if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
    return { success: false, error: RPC_ERROR_MESSAGES.INVALID_STATUS }
  }
  return callOwnerRpc('owner_set_member_status', { p_user_id: userId, p_status: status, p_reason: cleanReason })
}

export async function setMemberRole(userId: string, role: UserRole, reason: string): Promise<MemberActionResult> {
  const cleanReason = requireReason(reason)
  if (!cleanReason) return { success: false, error: RPC_ERROR_MESSAGES.REASON_REQUIRED }
  if (role !== 'OWNER' && role !== 'USER') {
    return { success: false, error: RPC_ERROR_MESSAGES.INVALID_ROLE }
  }
  return callOwnerRpc('owner_set_member_role', { p_user_id: userId, p_role: role, p_reason: cleanReason })
}

/** Replaces the member's menu set (owner-only menus can never be granted). */
export async function setMemberMenus(
  userId: string,
  codes: string[],
  reason: string
): Promise<MemberActionResult> {
  const cleanReason = requireReason(reason)
  if (!cleanReason) return { success: false, error: RPC_ERROR_MESSAGES.REASON_REQUIRED }
  const grantable = new Set<string>(GRANTABLE_MENUS.map((m) => m.code))
  if (!codes.every((c) => isMenuCode(c) && grantable.has(c))) {
    return { success: false, error: RPC_ERROR_MESSAGES.UNKNOWN_OR_OWNER_ONLY_MENU }
  }
  return callOwnerRpc('owner_set_member_menus', {
    p_user_id: userId,
    p_menus: Array.from(new Set(codes)),
    p_reason: cleanReason,
  })
}

/** Replaces the USER's granted risky actions (OWNER only on the server, audited). */
export async function setMemberActions(userId: string, codes: string[], reason: string): Promise<MemberActionResult> {
  const cleanReason = requireReason(reason)
  if (!cleanReason) return { success: false, error: RPC_ERROR_MESSAGES.REASON_REQUIRED }
  const known = new Set<string>(GRANTABLE_ACTIONS)
  if (!codes.every((c) => known.has(c))) return { success: false, error: RPC_ERROR_MESSAGES.UNKNOWN_ACTION }
  return callOwnerRpc('owner_set_member_actions', {
    p_user_id: userId,
    p_actions: Array.from(new Set(codes)),
    p_reason: cleanReason,
  })
}

/** Forgotten or blocked PIN of a USER: the OWNER clears it; the member sets a new one. Audited. */
export async function resetMemberPin(userId: string, reason: string): Promise<MemberActionResult> {
  const cleanReason = requireReason(reason)
  if (!cleanReason) return { success: false, error: RPC_ERROR_MESSAGES.REASON_REQUIRED }
  return callOwnerRpc('owner_reset_member_pin', { p_user_id: userId, p_reason: cleanReason })
}
