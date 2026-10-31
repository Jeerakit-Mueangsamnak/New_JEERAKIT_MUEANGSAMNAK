/**
 * Card finder for the ID-card camera, in plain TypeScript (no image library): finds the four
 * edges of the card near the on-screen guide, straightens the card (perspective warp) and tells
 * whether the picture is sharp enough to read. All coordinates are pixels of the image given.
 */

export type Point = { x: number; y: number }
/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point]
export interface Rect { x: number; y: number; width: number; height: number }
export interface GrayImage { data: Float32Array; width: number; height: number }
export interface RgbaImage { data: Uint8ClampedArray; width: number; height: number }

/** Width the camera frame is shrunk to before looking for the card (fast enough for iPad). */
export const DETECT_WIDTH = 360
/** Size the straightened card is checked for sharpness at. */
export const SHARPNESS_SIZE = { width: 428, height: 270 } as const
/** Laplacian variance at SHARPNESS_SIZE below which the picture counts as blurred. */
export const SHARPNESS_MIN = 60
/** Thai ID card: 85.6 × 53.98 mm. */
export const CARD_RATIO = 85.6 / 53.98

const EDGE_MIN = 40 // gradient (Sobel) that counts as "edge here"
const EDGE_MEAN_MIN = 50 // average gradient along a real card edge
const EDGE_COVERAGE_MIN = 0.7 // share of the edge that must be visible
const MAX_TILT = 0.25 // about 14° each way
const SAMPLES = 40

export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]
  return { data, width, height }
}

function sobel(img: GrayImage): { gx: Float32Array; gy: Float32Array } {
  const { data: d, width: w, height: h } = img
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const tl = d[i - w - 1], t = d[i - w], tr = d[i - w + 1]
      const l = d[i - 1], r = d[i + 1]
      const bl = d[i + w - 1], b = d[i + w], br = d[i + w + 1]
      gx[i] = tr + 2 * r + br - tl - 2 * l - bl
      gy[i] = bl + 2 * b + br - tl - 2 * t - tr
    }
  }
  return { gx, gy }
}

interface Edge { a: Point; b: Point; mean: number; coverage: number }

/**
 * The strongest straight edge in a band: 'h' = a top/bottom edge (band on y, span on x),
 * 'v' = a left/right edge (band on x, span on y). Only the gradient across the line counts.
 */
function bestEdge(
  g: { gx: Float32Array; gy: Float32Array },
  w: number,
  h: number,
  dir: 'h' | 'v',
  band: [number, number],
  span: [number, number],
): Edge | null {
  const limit = dir === 'h' ? h - 2 : w - 2
  const lo = Math.max(1, Math.round(band[0]))
  const hi = Math.min(limit, Math.round(band[1]))
  const [s0, s1] = span
  const length = s1 - s0
  if (hi <= lo || length <= 4) return null
  const maxDelta = Math.floor(MAX_TILT * length)
  let best: Edge | null = null
  for (let p0 = lo; p0 <= hi; p0++) {
    for (let p1 = Math.max(lo, p0 - maxDelta); p1 <= Math.min(hi, p0 + maxDelta); p1++) {
      const a = dir === 'h' ? { x: s0, y: p0 } : { x: p0, y: s0 }
      const b = dir === 'h' ? { x: s1, y: p1 } : { x: p1, y: s1 }
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      const nx = -dy / len
      const ny = dx / len
      let sum = 0
      let hits = 0
      for (let k = 0; k < SAMPLES; k++) {
        const t = (k + 0.5) / SAMPLES
        const x = Math.round(a.x + dx * t)
        const y = Math.round(a.y + dy * t)
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue
        const i = y * w + x
        const v = Math.min(255, Math.abs(g.gx[i] * nx + g.gy[i] * ny))
        sum += v
        if (v >= EDGE_MIN) hits++
      }
      const mean = sum / SAMPLES
      if (!best || mean > best.mean) best = { a, b, mean, coverage: hits / SAMPLES }
    }
  }
  return best && best.mean >= EDGE_MEAN_MIN && best.coverage >= EDGE_COVERAGE_MIN ? best : null
}

function intersect(e1: Edge, e2: Edge): Point | null {
  const { a: p1, b: p2 } = e1
  const { a: p3, b: p4 } = e2
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x)
  if (Math.abs(d) < 1e-6) return null
  const c1 = p1.x * p2.y - p1.y * p2.x
  const c2 = p3.x * p4.y - p3.y * p4.x
  return { x: (c1 * (p3.x - p4.x) - (p1.x - p2.x) * c2) / d, y: (c1 * (p3.y - p4.y) - (p1.y - p2.y) * c2) / d }
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y)

function isConvex(q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (cross === 0) return false
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return true
}

function quadArea(q: Quad): number {
  let s = 0
  for (let i = 0; i < 4; i++) s += q[i].x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * q[i].y
  return Math.abs(s) / 2
}

/**
 * The card's four corners, looked for around `guide` (the on-screen card frame, in the same
 * pixels as `img`), or null when no card-shaped outline is clearly there.
 */
export function findCardQuad(img: GrayImage, guide: Rect): Quad | null {
  const { width: w, height: h } = img
  const g = sobel(img)
  const { x: gx, y: gy, width: gw, height: gh } = guide
  const xSpan: [number, number] = [gx + gw * 0.15, gx + gw * 0.85]
  const ySpan: [number, number] = [gy + gh * 0.15, gy + gh * 0.85]
  const top = bestEdge(g, w, h, 'h', [gy - gh * 0.2, gy + gh * 0.3], xSpan)
  const bottom = bestEdge(g, w, h, 'h', [gy + gh * 0.7, gy + gh * 1.2], xSpan)
  const left = bestEdge(g, w, h, 'v', [gx - gw * 0.15, gx + gw * 0.25], ySpan)
  const right = bestEdge(g, w, h, 'v', [gx + gw * 0.75, gx + gw * 1.15], ySpan)
  if (!top || !bottom || !left || !right) return null
  const tl = intersect(top, left)
  const tr = intersect(top, right)
  const br = intersect(bottom, right)
  const bl = intersect(bottom, left)
  if (!tl || !tr || !br || !bl) return null
  const quad: Quad = [tl, tr, br, bl]
  if (!isConvex(quad)) return null
  const ratio = (dist(tl, tr) + dist(bl, br)) / (dist(tl, bl) + dist(tr, br))
  if (ratio < CARD_RATIO * 0.8 || ratio > CARD_RATIO * 1.25) return null
  if (quadArea(quad) < gw * gh * 0.4) return null
  return quad
}

export const scaleQuad = (q: Quad, s: number): Quad => q.map((p) => ({ x: p.x * s, y: p.y * s })) as Quad

/** Largest distance any corner moved between two finds. */
export const quadShift = (a: Quad, b: Quad) => Math.max(...a.map((p, i) => dist(p, b[i])))

/** Homography taking output pixels (outW × outH rectangle) to the quad in the source image. */
function homography(q: Quad, outW: number, outH: number): number[] {
  const dst: Point[] = [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }]
  const m: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i]
    const { x, y } = q[i]
    m.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x])
    m.push([0, 0, 0, u, v, 1, -u * y, -v * y, y])
  }
  for (let c = 0; c < 8; c++) {
    let pivot = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r
    ;[m[c], m[pivot]] = [m[pivot], m[c]]
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = m[r][c] / m[c][c]
      for (let k = c; k < 9; k++) m[r][k] -= f * m[c][k]
    }
  }
  return [...m.map((row, i) => row[8] / row[i]), 1]
}

/** The card cut out along `quad` and straightened to outW × outH (RGBA, bilinear). */
export function warpQuad(src: RgbaImage, quad: Quad, outW: number, outH: number): Uint8ClampedArray<ArrayBuffer> {
  const H = homography(quad, outW, outH)
  const out = new Uint8ClampedArray(outW * outH * 4)
  const { data, width: w, height: h } = src
  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const uc = u + 0.5
      const vc = v + 0.5
      const z = H[6] * uc + H[7] * vc + H[8]
      const sx = Math.min(w - 1, Math.max(0, (H[0] * uc + H[1] * vc + H[2]) / z - 0.5))
      const sy = Math.min(h - 1, Math.max(0, (H[3] * uc + H[4] * vc + H[5]) / z - 0.5))
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
      const fx = sx - x0, fy = sy - y0
      const o = (v * outW + u) * 4
      for (let c = 0; c < 4; c++) {
        const p00 = data[(y0 * w + x0) * 4 + c], p10 = data[(y0 * w + x1) * 4 + c]
        const p01 = data[(y1 * w + x0) * 4 + c], p11 = data[(y1 * w + x1) * 4 + c]
        out[o + c] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy
      }
    }
  }
  return out
}

/** Variance of the Laplacian: high = sharp (text edges crisp), low = blurred or out of focus. */
export function sharpness(img: GrayImage): number {
  const { data: d, width: w, height: h } = img
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap = 4 * d[i] - d[i - 1] - d[i + 1] - d[i - w] - d[i + w]
      sum += lap
      sumSq += lap * lap
      n++
    }
  }
  if (!n) return 0
  const mean = sum / n
  return sumSq / n - mean * mean
}

/** Sharpness of the card inside `quad` once straightened. */
export function cardSharpness(src: RgbaImage, quad: Quad): number {
  const { width, height } = SHARPNESS_SIZE
  return sharpness(toGray(warpQuad(src, quad, width, height), width, height))
}
