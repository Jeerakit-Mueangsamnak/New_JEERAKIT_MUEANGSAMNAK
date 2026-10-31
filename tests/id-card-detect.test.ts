import { describe, expect, it } from 'vitest'
import {
  CARD_RATIO,
  SHARPNESS_MIN,
  cardSharpness,
  findCardQuad,
  quadShift,
  toGray,
  warpQuad,
  type Point,
  type Quad,
  type RgbaImage,
} from '@/features/customers/utils/card-detect'

const W = 360
const H = 203
/** The on-screen guide in a 360 × 203 frame: centred, 75% wide, card shaped. */
const GUIDE = { x: 45, y: (H - 270 / CARD_RATIO) / 2, width: 270, height: 270 / CARD_RATIO }

function inside(p: Point, q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4]
    const c = Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))
    if (c === 0) continue
    if (sign === 0) sign = c
    else if (c !== sign) return false
  }
  return true
}

function cardCorners(cx: number, cy: number, width: number, angleDeg: number): Quad {
  const h = width / CARD_RATIO
  const t = (angleDeg * Math.PI) / 180
  const pts = [[-width / 2, -h / 2], [width / 2, -h / 2], [width / 2, h / 2], [-width / 2, h / 2]]
  return pts.map(([x, y]) => ({ x: cx + x * Math.cos(t) - y * Math.sin(t), y: cy + x * Math.sin(t) + y * Math.cos(t) })) as Quad
}

/** A light card (with dark "text" stripes) on a dark table. */
function scene(card: Quad, { background = 40, cardTone = 210, text = true } = {}): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = background + ((x * 7 + y * 13) % 5) // a little noise
      if (inside({ x: x + 0.5, y: y + 0.5 }, card)) {
        v = cardTone
        // broken text lines in the middle of the card
        if (text && y % 9 < 2 && x % 14 < 9 && Math.abs(x - W / 2) < 90 && Math.abs(y - H / 2) < 40) v = 60
      }
      const o = (y * W + x) * 4
      data[o] = data[o + 1] = data[o + 2] = v
      data[o + 3] = 255
    }
  }
  return { data, width: W, height: H }
}

const gray = (img: RgbaImage) => toGray(img.data, img.width, img.height)

describe('finding the card edges', () => {
  it('finds a straight card inside the guide, corners within 3 px', () => {
    const card = cardCorners(W / 2, H / 2, 250, 0)
    const quad = findCardQuad(gray(scene(card)), GUIDE)
    expect(quad).not.toBeNull()
    expect(quadShift(quad!, card)).toBeLessThan(3)
  })

  it('finds a card turned 6° and moved off centre', () => {
    const card = cardCorners(W / 2 + 10, H / 2 - 6, 240, 6)
    const quad = findCardQuad(gray(scene(card)), GUIDE)
    expect(quad).not.toBeNull()
    expect(quadShift(quad!, card)).toBeLessThan(3)
  })

  it('a dark card on a light table works too (edge sign does not matter)', () => {
    const card = cardCorners(W / 2, H / 2, 250, -4)
    const quad = findCardQuad(gray(scene(card, { background: 220, cardTone: 70, text: false })), GUIDE)
    expect(quad).not.toBeNull()
    expect(quadShift(quad!, card)).toBeLessThan(3)
  })

  it('no card → nothing found (no guessing)', () => {
    const empty = cardCorners(-500, -500, 10, 0)
    expect(findCardQuad(gray(scene(empty)), GUIDE)).toBeNull()
  })

  it('a card far smaller than the guide is not taken as the card', () => {
    const small = cardCorners(W / 2, H / 2, 110, 0)
    expect(findCardQuad(gray(scene(small)), GUIDE)).toBeNull()
  })
})

describe('straightening and sharpness', () => {
  it('straightening an upright card gives the same picture back', () => {
    const img = scene(cardCorners(W / 2, H / 2, 250, 0))
    const rect: Quad = [{ x: 100, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 150 }, { x: 100, y: 150 }]
    const out = warpQuad(img, rect, 100, 100)
    for (const [u, v] of [[0, 0], [37, 51], [99, 99]]) {
      expect(out[(v * 100 + u) * 4]).toBe(img.data[((50 + v) * W + 100 + u) * 4])
    }
  })

  it('a turned card comes out level: the text stripes run straight across', () => {
    const card = cardCorners(W / 2, H / 2, 250, 8)
    const img = scene(card)
    const out = toGray(warpQuad(img, findCardQuad(gray(img), GUIDE)!, 250, Math.round(250 / CARD_RATIO)), 250, Math.round(250 / CARD_RATIO))
    // the four corners of the straightened card are card colour, not table
    for (const [x, y] of [[4, 4], [245, 4], [4, 153], [245, 153]]) expect(out.data[y * 250 + x]).toBeGreaterThan(150)
  })

  it('a sharp card passes the blur check, a blurred one does not', () => {
    const card = cardCorners(W / 2, H / 2, 250, 0)
    const sharpImg = scene(card)
    const blurred = boxBlur(sharpImg, 4)
    expect(cardSharpness(sharpImg, card)).toBeGreaterThan(SHARPNESS_MIN)
    expect(cardSharpness(blurred, card)).toBeLessThan(SHARPNESS_MIN)
  })
})

function boxBlur(img: RgbaImage, r: number): RgbaImage {
  const out = new Uint8ClampedArray(img.data.length)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy))
        s += img.data[(yy * W + xx) * 4]; n++
      }
      const o = (y * W + x) * 4
      out[o] = out[o + 1] = out[o + 2] = s / n
      out[o + 3] = 255
    }
  }
  return { data: out, width: W, height: H }
}
