// One-off move of the shop's pictures out of database rows into Storage (owner 2026-11-20, egress items 7–10).
// Needs migration 20261120100000_shop_images_storage_v1.sql (bucket shop-images) on the target first.
//
//   SUPABASE_URL=…  SUPABASE_SECRET_KEY=…  BACKUP_DIR=…  node scripts/move-images-to-storage.mjs [--apply]
//
// Without --apply it only reports what it would move. With --apply it first writes a backup (JSON) of every value it
// changes into BACKUP_DIR, then:
//   - store_settings.logo_url and every shop profile logo → logo/<sha256>.<ext>; the old duplicate logo the earlier
//     settings screen kept in policies.app_config.business.logoDataUrl is removed (item 10)
//   - profiles.avatar_url → avatars/<user id>/<sha256>.<ext>
//   - every picture inside document_templates.template_schema → forms/<sha256>.<ext> (version + 1, so every device
//     downloads the new, small form once)
// Values that are already addresses are left alone, so running it again changes nothing.
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'shop-images'
const INLINE = /data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+/gi
const EXT = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif' }

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const backupDir = process.env.BACKUP_DIR
const apply = process.argv.includes('--apply')
if (!url || !key || !backupDir) {
  console.error('SUPABASE_URL, SUPABASE_SECRET_KEY and BACKUP_DIR are required')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const isInline = (v) => typeof v === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(v)

async function check(promise, what) {
  const { data, error } = await promise
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

/** Uploads one data URL into `folder` (same picture = same file) and gives its public address. */
async function upload(folder, dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i.exec(dataUrl)
  const kind = m[1].toLowerCase()
  const bytes = Buffer.from(m[2], 'base64')
  const path = `${folder}/${createHash('sha256').update(bytes).digest('hex')}.${EXT[kind]}`
  const type = kind === 'jpg' ? 'image/jpeg' : `image/${kind}`
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: type, cacheControl: '31536000', upsert: false })
  if (error && !(String(error.statusCode) === '409' || /exists|duplicate/i.test(error.message))) {
    throw new Error(`upload ${path}: ${error.message}`)
  }
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

const kb = (s) => `${Math.round((s?.length ?? 0) / 1024)} KB`

const settings = await check(db.from('store_settings').select('id, logo_url, policies, updated_at').maybeSingle(), 'read store_settings')
const avatars = await check(db.from('profiles').select('id, avatar_url').like('avatar_url', 'data:image/%'), 'read profiles')
const templates = await check(
  db.from('document_templates').select('id, name, template_schema, version, updated_at').like('template_schema', '%data:image/%'),
  'read document_templates'
)

const policies = settings?.policies ?? {}
const profiles = Array.isArray(policies.business_profile?.profiles) ? policies.business_profile.profiles : []
const oldLogo = policies.app_config?.business?.logoDataUrl
console.log(`target: ${new URL(url).host}`)
console.log(`logo_url: ${isInline(settings?.logo_url) ? `inline ${kb(settings.logo_url)}` : 'already an address / empty'}`)
console.log(`shop profile logos inline: ${profiles.filter((p) => isInline(p?.logoDataUrl)).length}`)
console.log(`old duplicate logo in app_config: ${oldLogo ? kb(oldLogo) : 'none'}`)
console.log(`profile pictures inline: ${avatars.length}`)
console.log(`forms with pictures inside: ${templates.length} (${templates.map((t) => `${t.name} ${kb(t.template_schema)}`).join(', ')})`)

if (!apply) {
  console.log('report only (add --apply to move)')
} else {
  await move()
}

async function move() {
  // The file name keeps only letters, digits, - and _ (a ':' would hide the data on Windows).
  const target = new URL(url).host.replace(/[^A-Za-z0-9_-]+/g, '_')
  mkdirSync(backupDir, { recursive: true })
  const backupFile = join(backupDir, `shop-images-backup-${target}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(backupFile, JSON.stringify({ settings, avatars, templates }, null, 0))
  console.log(`backup written: ${backupFile}`)

  // Shop logo + shop profile logos; the old duplicate in app_config goes (item 10).
  if (settings && (isInline(settings.logo_url) || profiles.some((p) => isInline(p?.logoDataUrl)) || oldLogo !== undefined)) {
    const nextPolicies = structuredClone(policies)
    if (nextPolicies.app_config?.business) delete nextPolicies.app_config.business.logoDataUrl
    if (Array.isArray(nextPolicies.business_profile?.profiles)) {
      for (const p of nextPolicies.business_profile.profiles) if (isInline(p?.logoDataUrl)) p.logoDataUrl = await upload('logo', p.logoDataUrl)
    }
    const logoUrl = isInline(settings.logo_url) ? await upload('logo', settings.logo_url) : settings.logo_url
    await check(
      db.from('store_settings').update({ logo_url: logoUrl, policies: nextPolicies, updated_at: new Date().toISOString() }).eq('id', settings.id),
      'update store_settings'
    )
    console.log(`logo moved: ${logoUrl}`)
  }

  for (const a of avatars) {
    const avatarUrl = await upload(`avatars/${a.id}`, a.avatar_url)
    await check(db.from('profiles').update({ avatar_url: avatarUrl }).eq('id', a.id), `update profile ${a.id}`)
    console.log(`profile picture moved: ${a.id}`)
  }

  for (const t of templates) {
    const found = [...new Set(t.template_schema.match(INLINE) ?? [])]
    const urls = new Map()
    for (const dataUrl of found) urls.set(dataUrl, await upload('forms', dataUrl))
    const schema = t.template_schema.replace(INLINE, (m) => urls.get(m) ?? m)
    await check(
      db.from('document_templates').update({ template_schema: schema, version: t.version + 1, updated_at: new Date().toISOString() }).eq('id', t.id),
      `update form ${t.id}`
    )
    console.log(`form moved: ${t.name} ${kb(t.template_schema)} → ${kb(schema)} (${found.length} pictures)`)
  }
  console.log('done')
}
