import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/db/rpc', () => ({ rpc: mocks.rpc }))

import { dashboardAssigneeLookupEnabled, fetchDashboardAssigneeNames } from '@/features/dashboard/services/dashboard-assignee-service'

describe('dashboard appointment assignee lookup', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    mocks.rpc.mockReset()
  })

  it('is disabled when the feature flag is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_DASHBOARD_ASSIGNEES_RPC', undefined)

    expect(dashboardAssigneeLookupEnabled()).toBe(false)
    await expect(fetchDashboardAssigneeNames()).resolves.toEqual(new Map())
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('uses the RPC only when enabled and excludes blank names', async () => {
    vi.stubEnv('NEXT_PUBLIC_DASHBOARD_ASSIGNEES_RPC', 'true')
    mocks.rpc.mockResolvedValue([
      { appointment_id: 'appointment-1', assignee_id: 'user-1', assignee_name: '  Member One  ' },
      { appointment_id: 'appointment-2', assignee_id: 'user-2', assignee_name: '  ' },
    ])

    await expect(fetchDashboardAssigneeNames()).resolves.toEqual(
      new Map([['appointment-1', 'Member One']])
    )
    expect(mocks.rpc).toHaveBeenCalledWith('dashboard_today_appointment_assignees')
  })

  it('propagates RPC failures instead of silently hiding them', async () => {
    vi.stubEnv('NEXT_PUBLIC_DASHBOARD_ASSIGNEES_RPC', 'true')
    mocks.rpc.mockRejectedValue(new Error('RPC unavailable'))

    await expect(fetchDashboardAssigneeNames()).rejects.toThrow('RPC unavailable')
  })
})
