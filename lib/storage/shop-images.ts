/**
 * Shop pictures in Storage (owner 2026-11-20, egress items 7–10): the shop logo, the pictures inside document
 * forms and profile pictures live in the public bucket shop-images (migration 20261120100000); the database keeps
 * only their address. A file is named after the SHA-256 of the picture, so it never changes (browsers and the CDN
 * keep it) and the same picture saved twice is one file.
 */
import { createClient } from '@/lib/supabase/client'
import { getSupabaseUrl } from '@/lib/supabase/env'

export const SHOP_IMAGES_BUCKET = 'shop-images'

export type ShopImageFolder = 'logo' | 'forms' | `avatars/${string}`

const INLINE_IMAGE = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

/** True for a picture kept inside the text itself (data:image/…;base64,…). */
export function isInlineImage(value: string | null | undefined): value is string {
  return typeof value === 'string' && INLINE_IMAGE.test(value)
}

/** Start of every shop-images address of this project (https on Cloud, http on Supabase Local). */
export function shopImagesBaseUrl(): string {
  const base = getSupabaseUrl().replace(/\/+$/, '')
  return base ? `${base}/storage/v1/object/public/${SHOP_IMAGES_BUCKET}/` : ''
}

/** True for an address of a file in this project's shop-images bucket. */
export function isShopImageUrl(value: string | null | undefined): boolean {
  const base = shopImagesBaseUrl()
  return Boolean(base && typeof value === 'string' && value.startsWith(base))
}

/** The bucket path of a shop-images address (null for anything else). */
export function shopImagePath(url: string | null | undefined): string | null {
  return isShopImageUrl(url) ? decodeURIComponent(url!.slice(shopImagesBaseUrl().length).split('?')[0]) : null
}

function inlineToBytes(dataUrl: string): { bytes: Uint8Array; type: string } {
  const m = INLINE_IMAGE.exec(dataUrl)
  if (!m) throw new Error('รูปภาพไม่ถูกต้อง')
  const type = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase()
  const binary = atob(m[2].replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { bytes, type }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Uploads one picture (data URL or Blob) into `folder` and gives its public address. */
export async function uploadShopImage(folder: ShopImageFolder, image: string | Blob): Promise<string> {
  const { bytes, type } =
    typeof image === 'string' ? inlineToBytes(image) : { bytes: new Uint8Array(await image.arrayBuffer()), type: image.type || 'image/jpeg' }
  const ext = EXT[type]
  if (!ext) throw new Error('รองรับเฉพาะรูป PNG, JPG, WEBP หรือ GIF')
  const path = `${folder}/${await sha256Hex(bytes)}.${ext}`
  const supabase = createClient()
  const { error } = await supabase.storage
    .from(SHOP_IMAGES_BUCKET)
    .upload(path, new Blob([bytes as BlobPart], { type }), { contentType: type, cacheControl: '31536000', upsert: false })
  // Same picture already stored (same name = same content): that file is used.
  const duplicate = error && (String((error as { statusCode?: string | number }).statusCode) === '409' || /exists|duplicate/i.test(error.message))
  if (error && !duplicate) throw new Error(`อัปโหลดรูปไม่สำเร็จ: ${error.message}`)
  return supabase.storage.from(SHOP_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl
}

/** The picture as it is kept in the database: inline pictures are uploaded first; anything else stays. */
export async function storedImageUrl(folder: ShopImageFolder, value: string | null | undefined): Promise<string> {
  return isInlineImage(value) ? uploadShopImage(folder, value) : value ?? ''
}

/**
 * Every inline picture in a document form's text (img src="data:…" and url(data:…)) uploaded to forms/ and
 * replaced by its address; the rest of the text stays exactly as it was.
 */
export async function moveInlineImagesToStorage(text: string): Promise<string> {
  const found = [...new Set(text.match(/data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+/gi) ?? [])]
  if (found.length === 0) return text
  const urls = new Map<string, string>()
  for (const dataUrl of found) urls.set(dataUrl, await uploadShopImage('forms', dataUrl))
  return text.replace(/data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+/gi, (m) => urls.get(m) ?? m)
}

/** Takes a user's old profile picture file away (best effort: the profile no longer points at it). */
export async function removeShopImage(url: string | null | undefined): Promise<void> {
  const path = shopImagePath(url)
  if (!path) return
  const { error } = await createClient().storage.from(SHOP_IMAGES_BUCKET).remove([path])
  if (error) console.error('Removing the old picture failed:', error.message)
}
