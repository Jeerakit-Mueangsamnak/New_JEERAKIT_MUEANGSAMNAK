'use server'

import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BACKUP_GROUPS, isBackupGroupId, type BackupGroupId, type BackupTable } from '@/features/settings/utils/backup-groups'

/**
 * ตั้งค่าระบบ › สำรองข้อมูล (owner 2026-11-15). Only an ACTIVE OWNER may run it. The rows are read on the
 * server with the admin key, because some tables (LINE contacts, document counters) are closed to the browser;
 * the key itself never leaves the server, only the rows go back as the backup file.
 */
export interface ShopBackup {
  format: 'jeerakit-shop-backup'
  version: 1
  createdAt: string
  /** Bangkok dates YYYY-MM-DD; null = no limit on that side */
  range: { from: string | null; to: string | null }
  groups: BackupGroupId[]
  tables: Record<string, unknown[]>
}

export type BackupResult = { success: true; backup: ShopBackup } | { success: false; error: string }

const PAGE_SIZE = 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

/** Start of a Bangkok day, as an ISO time. */
const bangkokDayStart = (date: string) => new Date(`${date}T00:00:00+07:00`)

type AdminClient = ReturnType<typeof createAdminClient>

async function readTable(admin: AdminClient, table: BackupTable, fromIso: string | null, toIso: string | null): Promise<unknown[]> {
  const rows: unknown[] = []
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = admin.from(table.name).select('*')
    if (table.dated && fromIso) query = query.gte('created_at', fromIso)
    if (table.dated && toIso) query = query.lt('created_at', toIso)
    for (const key of table.order) query = query.order(key, { ascending: true })
    const { data, error } = await query.range(start, start + PAGE_SIZE - 1)
    if (error) throw new Error(`${table.name}: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

export async function exportShopBackup(input: { groups: string[]; from?: string | null; to?: string | null }): Promise<BackupResult> {
  const groups = Array.from(new Set(input.groups ?? [])).filter(isBackupGroupId)
  if (groups.length === 0) return { success: false, error: 'กรุณาเลือกข้อมูลที่ต้องการสำรองอย่างน้อย 1 รายการ' }

  const from = input.from || null
  const to = input.to || null
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return { success: false, error: 'วันที่ไม่ถูกต้อง' }
  if (from && to && from > to) return { success: false, error: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' }

  try {
    const supabase = await createServerSupabase()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'กรุณาเข้าสู่ระบบใหม่' }
    const { data: me, error: meError } = await supabase
      .from('profiles')
      .select('role, status, is_approved')
      .eq('id', user.id)
      .maybeSingle()
    if (meError || me?.role !== 'OWNER' || me.status !== 'ACTIVE' || me.is_approved !== true) {
      return { success: false, error: 'สำรองข้อมูลได้เฉพาะเจ้าของร้าน' }
    }

    const fromIso = from ? bangkokDayStart(from).toISOString() : null
    // "to" counts the whole day: rows before the start of the next Bangkok day
    const toIso = to ? new Date(bangkokDayStart(to).getTime() + DAY_MS).toISOString() : null

    const admin = createAdminClient()
    const tables: Record<string, unknown[]> = {}
    for (const group of BACKUP_GROUPS) {
      if (!groups.includes(group.id)) continue
      for (const table of group.tables) tables[table.name] = await readTable(admin, table, fromIso, toIso)
    }

    return {
      success: true,
      backup: { format: 'jeerakit-shop-backup', version: 1, createdAt: new Date().toISOString(), range: { from, to }, groups, tables },
    }
  } catch (err: unknown) {
    console.error('exportShopBackup failed:', err)
    return { success: false, error: 'สำรองข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }
  }
}
