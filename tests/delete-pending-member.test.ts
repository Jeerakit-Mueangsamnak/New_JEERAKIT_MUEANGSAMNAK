import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  actor: { id: '00000000-0000-4000-8000-000000000001' } as { id: string } | null,
  profiles: new Map<string, Record<string, unknown>>(),
  authError: null as { message: string } | null,
  profileError: null as { message: string } | null,
  deleteError: null as { message: string; code?: string } | null,
  deleteUser: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: fake.actor }, error: fake.authError }) },
    from: () => {
      let id = ''
      const builder = {
        select: () => builder,
        eq: (_column: string, value: string) => {
          id = value
          return builder
        },
        maybeSingle: async () => ({
          data: fake.profileError ? null : fake.profiles.get(id) ?? null,
          error: fake.profileError,
        }),
      }
      return builder
    },
    rpc: fake.rpc,
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { deleteUser: fake.deleteUser } },
  }),
}))

import { deletePendingMember } from '@/app/actions/members'

const OWNER_ID = '00000000-0000-4000-8000-000000000001'
const TARGET_ID = '00000000-0000-4000-8000-000000000002'

beforeEach(() => {
  fake.actor = { id: OWNER_ID }
  fake.profiles = new Map([
    [OWNER_ID, { id: OWNER_ID, role: 'OWNER', status: 'ACTIVE', is_approved: true }],
    [TARGET_ID, {
      id: TARGET_ID,
      role: 'USER',
      status: 'PENDING',
      username: 'pending-staff',
      email: 'pending@example.test',
      display_name: 'พนักงานใหม่',
      created_at: '2026-11-10T00:00:00Z',
    }],
  ])
  fake.authError = null
  fake.profileError = null
  fake.deleteError = null
  fake.deleteUser.mockReset().mockResolvedValue({ error: null })
  fake.rpc.mockReset().mockResolvedValue({ error: null, data: { deleted: true } })
})

describe('deletePendingMember', () => {
  it('allows an active owner to delete only a pending user and records the deletion', async () => {
    const result = await deletePendingMember(TARGET_ID)

    expect(result).toEqual({ success: true })
    expect(fake.deleteUser).toHaveBeenCalledWith(TARGET_ID)
    expect(fake.rpc).toHaveBeenCalledWith('owner_audit_pending_member_delete', expect.objectContaining({
      p_user_id: TARGET_ID,
      p_before: expect.objectContaining({ status: 'PENDING', role: 'USER' }),
    }))
  })

  it('rejects a caller who is not an active owner without calling the Admin API', async () => {
    fake.profiles.set(OWNER_ID, { id: OWNER_ID, role: 'USER', status: 'ACTIVE', is_approved: true })

    const result = await deletePendingMember(TARGET_ID)

    expect(result.success).toBe(false)
    expect(fake.deleteUser).not.toHaveBeenCalled()
  })

  it.each(['ACTIVE', 'SUSPENDED'] as const)('refuses a %s user without deleting their account', async (status) => {
    fake.profiles.set(TARGET_ID, { ...fake.profiles.get(TARGET_ID), status })

    const result = await deletePendingMember(TARGET_ID)

    expect(result).toMatchObject({ success: false, error: 'ลบได้เฉพาะพนักงานที่ยังรออนุมัติ' })
    expect(fake.deleteUser).not.toHaveBeenCalled()
  })

  it('reports an Admin API failure and does not report success', async () => {
    fake.deleteUser.mockResolvedValue({ error: { message: 'Database error deleting user', code: '23503' } })

    const result = await deletePendingMember(TARGET_ID)

    expect(result.success).toBe(false)
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('reports a warning if account deletion succeeds but audit logging fails', async () => {
    fake.rpc.mockResolvedValue({ error: { message: 'audit unavailable' }, data: null })

    const result = await deletePendingMember(TARGET_ID)

    expect(result).toMatchObject({
      success: true,
      warning: 'ลบบัญชีแล้ว แต่บันทึกประวัติการลบไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบ',
    })
  })
})
