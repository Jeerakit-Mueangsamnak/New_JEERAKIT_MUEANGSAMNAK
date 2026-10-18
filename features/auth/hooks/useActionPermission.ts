'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { ACTION_PERMISSIONS, actionAccess, type ActionGrantCode } from '@/features/auth/services/permission-matrix'

/**
 * UI hint only: whether the signed-in member may run a risky action (menu + OWNER grant).
 * The database still checks menu -> grant -> PIN on every call (public._require_action);
 * buttons use this only to show the action as unavailable instead of failing on the server.
 */
export function canRunAction(
  user: { role?: string; menus?: readonly string[] } | null | undefined,
  grants: readonly string[],
  code: ActionGrantCode
): boolean {
  if (!user) return false
  const action = ACTION_PERMISSIONS.find((a) => a.grant === code)
  if (!action) return false
  return actionAccess(user.role === 'OWNER' ? 'OWNER' : 'USER', user.menus ?? [], action, grants) === 'ALLOWED'
}

export function useActionPermission(): (code: ActionGrantCode) => boolean {
  const { user } = useAuth()
  const [grants, setGrants] = useState<string[]>([])
  const userId = user?.id
  const isOwner = user?.role === 'OWNER'

  useEffect(() => {
    let active = true
    if (!userId || isOwner) {
      setGrants([])
      return
    }
    // RLS: a member reads only their own grants.
    void createClient()
      .from('member_action_grants')
      .select('action_code')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (active) setGrants((data ?? []).map((r: { action_code: string }) => r.action_code))
      })
    return () => {
      active = false
    }
  }, [userId, isOwner])

  return (code) => canRunAction(user, grants, code)
}

export const NO_ACTION_PERMISSION_TITLE = 'ไม่มีสิทธิ์ทำรายการนี้ — ให้เจ้าของร้านเปิดสิทธิ์ที่หน้า จัดการสิทธิ์'
