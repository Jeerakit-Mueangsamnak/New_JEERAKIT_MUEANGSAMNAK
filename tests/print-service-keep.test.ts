// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { printHtml } from '@/lib/print/print-service'

afterEach(() => vi.useRealTimers())

describe('พิมพ์: เอกสารต้องอยู่จนกว่าหน้าต่างพิมพ์สร้างตัวอย่างเสร็จ (owner 2026-11-11)', () => {
  it('the printed document stays after "afterprint"; the next print replaces it', async () => {
    vi.useFakeTimers()
    window.print = vi.fn()
    printHtml('<p id="doc-1">บิลแรก</p>', { title: 'BL-1' })
    await vi.runAllTimersAsync()
    window.dispatchEvent(new Event('afterprint'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(document.getElementById('doc-1')).not.toBeNull()
    expect(document.title).not.toBe('BL-1')

    printHtml('<p id="doc-2">บิลที่สอง</p>')
    expect(document.getElementById('doc-1')).toBeNull()
    expect(document.getElementById('doc-2')).not.toBeNull()
    expect(document.querySelectorAll('#central-print-target')).toHaveLength(1)
  })

  it('leaving the page removes it', () => {
    printHtml('<p id="doc-3">x</p>')
    window.dispatchEvent(new Event('pagehide'))
    expect(document.getElementById('central-print-target')).toBeNull()
  })
})
