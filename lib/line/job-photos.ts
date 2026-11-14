/** Driver job photos sent by the LIFF job form (owner 2026-11-13): at most 3, each at most 2 MB. */
export const JOB_PHOTO_LIMIT = 3
export const JOB_PHOTO_MAX_BYTES = 2 * 1024 * 1024
const PHOTO = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/

/** data:image/...;base64 → bytes; null when it is not a photo or is too large. */
export function decodeJobPhoto(dataUrl: unknown): { bytes: Uint8Array; ext: 'jpg' | 'png' | 'webp'; type: string } | null {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(JOB_PHOTO_MAX_BYTES / 3) * 4 + 40) return null
  const m = PHOTO.exec(dataUrl)
  if (!m) return null
  const bytes = Uint8Array.from(Buffer.from(m[2], 'base64'))
  if (!bytes.length || bytes.length > JOB_PHOTO_MAX_BYTES) return null
  return { bytes, ext: m[1] === 'jpeg' ? 'jpg' : (m[1] as 'png' | 'webp'), type: `image/${m[1]}` }
}
