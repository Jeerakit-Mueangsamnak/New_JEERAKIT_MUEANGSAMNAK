import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SYSTEM_CONFIG } from '@/features/settings/services/settings-storage'

const query = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const select = vi.fn(() => ({ maybeSingle }))
  const eq = vi.fn(() => ({ select }))
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ update }))
  return { from, update, eq, select, maybeSingle }
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: query.from }),
}))

import { saveSharedSystemConfig } from '@/features/settings/api/settings-repository'

describe('shared settings repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    query.maybeSingle.mockResolvedValue({ data: { id: 'default' }, error: null })
  })

  it('confirms Supabase updated the shared settings row', async () => {
    await expect(saveSharedSystemConfig(DEFAULT_SYSTEM_CONFIG)).resolves.toBeUndefined()

    expect(query.from).toHaveBeenCalledWith('system_settings')
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      config_json: DEFAULT_SYSTEM_CONFIG,
    }))
    expect(query.eq).toHaveBeenCalledWith('id', 'default')
    expect(query.select).toHaveBeenCalledWith('id')
  })

  it('reports a missing or inaccessible shared settings row', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(saveSharedSystemConfig(DEFAULT_SYSTEM_CONFIG))
      .rejects.toThrow('ไม่พบแถวการตั้งค่าร่วมใน Supabase หรือไม่มีสิทธิ์แก้ไข')
  })

  it('surfaces Supabase update errors', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'permission denied' } })

    await expect(saveSharedSystemConfig(DEFAULT_SYSTEM_CONFIG))
      .rejects.toThrow('ไม่สามารถบันทึกการตั้งค่าร่วมลง Supabase ได้: permission denied')
  })
})
