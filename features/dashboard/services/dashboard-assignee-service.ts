import { rpc } from '@/lib/db/rpc'

interface DashboardAssigneeRow {
  appointment_id: string
  assignee_id: string
  assignee_name: string | null
}

export function dashboardAssigneeLookupEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DASHBOARD_ASSIGNEES_RPC === 'true'
}

export async function fetchDashboardAssigneeNames(): Promise<Map<string, string>> {
  if (!dashboardAssigneeLookupEnabled()) return new Map()

  const rows = await rpc<DashboardAssigneeRow[]>('dashboard_today_appointment_assignees')
  return new Map(
    (rows ?? [])
      .filter((row) => row.assignee_name?.trim())
      .map((row) => [row.appointment_id, row.assignee_name!.trim()])
  )
}
