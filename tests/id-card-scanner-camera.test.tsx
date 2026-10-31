// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

vi.mock('@/features/customers/services/id-card-ocr', () => ({ scanIdCardPhoto: vi.fn() }))

import { IDCardScannerModal, cropRectForGuide } from '@/features/customers/components/IDCardScannerModal'

/** A camera whose permission prompt is still open: it answers only when `grant()` is called. */
function pendingCamera() {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  let grant: () => void = () => {}
  const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => (grant = () => resolve(stream))))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  return { stop, grant: () => grant(), getUserMedia }
}

afterEach(() => cleanup())

describe('ID card scanner camera (audit UX-14)', () => {
  it('closing the window while the camera prompt is open switches the camera off when it answers', async () => {
    const cam = pendingCamera()
    const view = render(<IDCardScannerModal isOpen onClose={() => {}} onScanComplete={() => {}} />)
    expect(cam.getUserMedia).toHaveBeenCalled()

    view.unmount() // the window closes before the person answers the prompt
    await act(async () => {
      cam.grant()
    })

    expect(cam.stop).toHaveBeenCalled()
  })

  it('switching to upload before the camera answers also switches it off', async () => {
    const cam = pendingCamera()
    const view = render(<IDCardScannerModal isOpen onClose={() => {}} onScanComplete={() => {}} />)
    view.rerender(<IDCardScannerModal isOpen={false} onClose={() => {}} onScanComplete={() => {}} />)
    await act(async () => {
      cam.grant()
    })
    expect(cam.stop).toHaveBeenCalled()
  })

  it('opens straight onto the camera with the card-shaped guide on screen', () => {
    pendingCamera()
    const view = render(<IDCardScannerModal isOpen onClose={() => {}} onScanComplete={() => {}} />)
    const guide = view.getByTestId('id-card-guide')
    expect(guide.className).toContain('aspect-[85.6/53.98]')
    expect(guide.className).toContain('w-3/4')
    expect(guide.textContent).toContain('วางบัตรประชาชนให้อยู่ในกรอบนี้')
  })
})

describe('snapshot = exactly the area inside the guide', () => {
  const frame = { width: 1920, height: 1080 }
  const round = (r: { x: number; y: number; width: number; height: number }) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)]))

  it('16:9 camera in a 16:9 box: the guide maps straight onto the frame', () => {
    const shown = { left: 100, top: 50, width: 800, height: 450 }
    const guide = { left: 200, top: 75, width: 600, height: 400 }
    // scale 800/1920 → each screen pixel is 2.4 frame pixels
    expect(round(cropRectForGuide(frame, shown, guide))).toEqual({ x: 240, y: 60, width: 1440, height: 960 })
  })

  it('4:3 camera shown with object-cover: the hidden top/bottom band is skipped', () => {
    const frame43 = { width: 1440, height: 1080 }
    const shown = { left: 0, top: 0, width: 800, height: 450 }
    const guide = { left: 100, top: 36, width: 600, height: 378 }
    // scale = max(800/1440, 450/1080) = 0.5556; shown frame is 600 high, 75 px hidden top and bottom
    expect(round(cropRectForGuide(frame43, shown, guide))).toEqual({ x: 180, y: 200, width: 1080, height: 680 })
  })

  it('without a measured guide it keeps the guide shape: centred, 75% wide, card proportion', () => {
    const r = cropRectForGuide(frame, { left: 0, top: 0, width: 0, height: 0 }, null)
    expect(Math.round(r.width)).toBe(1440)
    expect(Math.round(r.width / r.height * 1000)).toBe(1586)
    expect(Math.round(r.x)).toBe(240)
  })
})
