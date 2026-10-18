// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NotificationBell } from '@/components/common/NotificationBell'
import { setCachedNotifications, type ActionableNotification } from '@/features/notifications/services/notification-storage'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
const mockRpc = vi.hoisted(() => ({ rpc: vi.fn(async () => null), selectRows: vi.fn() }))
vi.mock('@/lib/db/rpc', () => mockRpc)
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

const BILL_ID = '11111111-1111-1111-1111-111111111111'
const n = (id: string, type: ActionableNotification['type'], sourceType?: string): ActionableNotification => ({
  id,
  type,
  title: `notice ${id}`,
  message: '',
  data: { sourceType, sourceId: sourceType === 'BILL' ? BILL_ID : undefined },
  status: 'UNREAD',
  createdAt: '2026-10-09T01:00:00Z',
})

describe('NotificationBell tabs (system / due work / bills / stock)', () => {
  afterEach(cleanup)

  it('groups notices into tabs and sends a bill from a bill notice', async () => {
    // the server fetch keeps the cache as is
    mockRpc.selectRows.mockRejectedValue(new Error('offline'))
    setCachedNotifications([
      n('a', 'APPOINTMENT_DUE', 'APPOINTMENT'),
      n('b', 'DELIVERY_DUE', 'BILL'),
      n('c', 'PAYMENT_DUE', 'BILL'),
      n('d', 'LOW_STOCK', 'PRODUCT'),
      n('e', 'OTHER'),
    ])
    render(<NotificationBell />)
    fireEvent.click(screen.getByRole('button', { name: 'การแจ้งเตือน' }))

    expect(screen.getByRole('button', { name: 'งานถึงกำหนด2' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'บิล1' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'สต็อก1' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'ระบบ1' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'สต็อก1' }))
    expect(screen.getByText('notice d')).toBeDefined()
    expect(screen.queryByText('notice a')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'บิล1' }))
    const row = screen.getByText('notice c').closest('div[class*="cursor-pointer"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'ส่งบิล' }))
    expect(mockPush).toHaveBeenCalledWith(`/bills?id=${BILL_ID}&send=line`)
  })
})
