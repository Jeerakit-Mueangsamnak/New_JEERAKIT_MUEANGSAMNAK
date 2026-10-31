'use client'

import { useAuth } from '@/features/auth/contexts/AuthContext'
import type { ActionGrantCode } from '@/features/auth/services/permission-matrix'

/**
 * Every ACTIVE member may run every action, risky ones included (owner 2026-10-26, Master §4.2):
 * there are no per-person grants any more. The database still checks the member on every call.
 */
export function canRunAction(
  user: { status?: string } | null | undefined,
  _code: ActionGrantCode
): boolean {
  return user?.status === 'ACTIVE'
}

export function useActionPermission(): (code: ActionGrantCode) => boolean {
  const { user } = useAuth()
  return (code) => canRunAction(user, code)
}

export const NO_ACTION_PERMISSION_TITLE = 'ทำรายการนี้ไม่ได้ — บัญชียังไม่ได้รับอนุมัติหรือถูกระงับ'
