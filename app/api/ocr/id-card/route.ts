import { createClient } from '@/lib/supabase/server'
import { ocrSpaceConfigured, readWithOcrSpace } from '@/lib/ocr/ocr-space'
import type { ParsedThaiIdCard } from '@/lib/ocr/thai-id-parser'

/**
 * ID card photo OCR:
 * 1. Primary: Cloudflare Workers AI (@cf/cloudflare/clairic) via id-card-ocr worker.
 * 2. Fallback: OCR.space (free tier).
 * 3. Client fallback: Tesseract.js (browser-side).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FREE_MONTHLY_REQUESTS = 25_000
/** About 4 MB of base64 — a 1600 px JPEG card photo is far below this. */
const MAX_IMAGE_CHARS = 4_000_000

const usage = { month: '', count: 0 }

function monthlyLimit(): number {
  const set = Number(process.env.OCRSPACE_MONTHLY_LIMIT)
  return Number.isFinite(set) && set >= 0 ? Math.min(set, FREE_MONTHLY_REQUESTS) : FREE_MONTHLY_REQUESTS
}

/** Takes one request of this month's allowance; false once it is used up. */
function takeUnit(): boolean {
  const month = new Date().toISOString().slice(0, 7)
  if (usage.month !== month) {
    usage.month = month
    usage.count = 0
  }
  if (usage.count >= monthlyLimit()) return false
  usage.count += 1
  return true
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return Response.json({ ok: false, reason: 'UNAUTHORIZED' }, { status: 401 })

  let image = ''
  try {
    const body = (await request.json()) as { image?: unknown }
    image = typeof body.image === 'string' ? body.image.replace(/^data:image\/[a-z]+;base64,/, '') : ''
  } catch {
    // falls through to the check below
  }
  if (!image || image.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(image)) {
    return Response.json({ ok: false, reason: 'BAD_IMAGE' }, { status: 400 })
  }

  // 1. Primary: Cloudflare Workers AI service (@cf/cloudflare/clairic)
  const cfOcrUrl = process.env.CLOUDFLARE_ID_CARD_OCR_URL || (process.env.NODE_ENV !== 'test' ? 'https://id-card-ocr.jeerakit-mueangsamnak.workers.dev' : '')
  if (cfOcrUrl) {
    try {
      const cfRes = await fetch(`${cfOcrUrl}/api/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: `data:image/jpeg;base64,${image}` }),
        signal: AbortSignal.timeout(15000),
      })
      if (cfRes && cfRes.ok) {
        const cfData = (await cfRes.json().catch(() => null)) as {
          ok?: boolean
          fields?: {
            id_number?: string | null
            prefix?: string | null
            first_name?: string | null
            last_name?: string | null
            first_name_en?: string | null
            last_name_en?: string | null
            birth_date?: string | null
            gender?: string | null
            religion?: string | null
            address?: string | null
            issue_date?: string | null
            expiry_date?: string | null
          }
        } | null

        if (cfData?.ok && cfData.fields) {
          const { THAI_ADDRESS_DATA } = await import('@/lib/thai-address-data')
          const { extractAddress, formatThaiNationalId, validateThaiNationalId } = await import('@/lib/ocr/thai-id-parser')

          const f = cfData.fields
          const cleanId = (f.id_number || '').replace(/\D/g, '')
          const idCardNumber = cleanId.length === 13 && validateThaiNationalId(cleanId) ? formatThaiNationalId(cleanId) : ''

          let prefix = (f.prefix || '').trim()
          let firstName = (f.first_name || '').trim()
          let lastName = (f.last_name || '').trim()

          // 1. ตัดคำนำหน้าออก หาก AI อ่านติดเข้าไปในช่อง first_name (เช่น "นาย ก.ไก่" -> "ก.ไก่")
          const allPrefixes = ['ว่าที่ร้อยตรี', 'นางสาว', 'เด็กหญิง', 'เด็กชาย', 'น.ส.', 'ด.ญ.', 'ด.ช.', 'นาย', 'นาง']
          if (prefix && firstName.startsWith(prefix)) {
            firstName = firstName.slice(prefix.length).trim()
          } else {
            for (const p of allPrefixes) {
              if (firstName.startsWith(p)) {
                if (!prefix) prefix = p
                firstName = firstName.slice(p.length).trim()
                break
              }
            }
          }

          // 2. ลบ last_name ทิ้ง หาก AI หลอนใส่คำนำหน้าซ้ำลงมาในช่องนามสกุล
          if (allPrefixes.includes(lastName) || lastName === prefix) {
            lastName = ''
          }

          // 3. ลบ last_name ทิ้ง หาก AI ใส่ชื่อตัวซ้ำลงในช่องนามสกุล (เช่น "ก.ไก่" กับ "ก.ไก่")
          if (firstName === lastName) {
            lastName = ''
          }

          // 4. ลบคำนำหน้าที่อาจติดมาในช่อง last_name (เช่น "นาย ข.ไข่" -> "ข.ไข่")
          for (const p of allPrefixes) {
            if (lastName.startsWith(p)) {
              lastName = lastName.slice(p.length).trim()
              break
            }
          }

          const name = [prefix, firstName, lastName]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()

          const addressParsed = extractAddress(f.address || '', THAI_ADDRESS_DATA)

          const parsed: ParsedThaiIdCard = {
            name,
            idCardNumber,
            birthDate: f.birth_date || '',
            idCardExpiry: f.expiry_date || '',
            houseNo: addressParsed.houseNo,
            moo: addressParsed.moo,
            soi: addressParsed.soi,
            road: addressParsed.road,
            subDistrict: addressParsed.subDistrict,
            district: addressParsed.district,
            province: addressParsed.province,
          }

          return Response.json({ ok: true, source: 'cloudflare-ai', parsed })
        }
      }
    } catch (cfErr) {
      console.warn('[ocr/id-card] Cloudflare Workers AI error, trying fallback:', cfErr instanceof Error ? cfErr.message : cfErr)
    }
  }

  // 2. Secondary fallback: OCR.space
  if (!ocrSpaceConfigured()) return Response.json({ ok: false, reason: 'NOT_CONFIGURED' }, { status: 503 })
  if (!takeUnit()) return Response.json({ ok: false, reason: 'QUOTA_REACHED' }, { status: 429 })

  try {
    const lines = await readWithOcrSpace(image)
    return Response.json({ ok: true, source: 'ocr-space', lines })
  } catch (err) {
    console.warn('[ocr/id-card] OCR.space failed:', err instanceof Error ? err.message : err)
    return Response.json({ ok: false, reason: 'OCR_FAILED' }, { status: 502 })
  }
}
