import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseLineStore } from '@/lib/line/supabase-store'
import { catalogData } from '@/lib/line/catalog'
import { MockLineProvider } from '@/lib/line/mock-provider'
import { processOutbox } from '@/lib/line/outbox'

// Opt-in integration: credentials are generated for this session's isolated Supabase Local only.
const configPath = process.env.LINE_LOCAL_INTEGRATION_ENV
const suite = configPath ? describe : describe.skip
suite('LINE with real Supabase Local and Mock provider', () => {
  it('measures catalog round trips and bytes, blocks duplicate/suspended accounts, then records a Mock delivery', async () => {
    const env = JSON.parse(readFileSync(configPath!, 'utf8'))
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321')
    expect(env.LINE_DELIVERY_MODE).toBe('mock')
    const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
    const owner = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
    const signIn = await owner.auth.signInWithPassword({ email: 'owner-line-hardening@example.test', password: 'Owner1234!' })
    expect(signIn.error).toBeNull()
    const admin = await owner.rpc('line_catalog_admin')
    expect(admin.error).toBeNull()
    const category = admin.data.categories.find((c: { products: unknown[] }) => c.products.length > 0)
    expect(category).toBeTruthy()
    const listed = await owner.rpc('line_catalog_set', { p_kind: 'CATEGORY', p_id: category.id, p_listed: true })
    expect(listed.error).toBeNull()
    expect((await owner.rpc('line_catalog_set', { p_kind: 'CATEGORY_PRODUCTS', p_id: category.id, p_listed: true })).error).toBeNull()
    const data = catalogData({ a: 'cat', c: category.id, pg: 0 })
    const stats = () => ({ calls: 0, bytes: 0, catalogCalls: 0 })
    const before = stats(), after = stats()
    const counted = (counts: ReturnType<typeof stats>) => ({ rpc: async (fn: string, args: Record<string, unknown>) => {
      const r = await db.rpc(fn, args)
      if (r.error) throw new Error(`Local RPC ${fn}: ${r.error.code}`)
      counts.calls++; counts.bytes += Buffer.byteLength(JSON.stringify(r.data))
      if (fn === 'line_catalog_items') counts.catalogCalls++
      return r
    } }) as unknown as SupabaseClient
    const first = createSupabaseLineStore(counted(before))
    for (let n = 0; n < 12; n++) {
      const uid = 'U' + randomUUID().replaceAll('-', '')
      await first.recordEvent({ eventId: randomUUID(), lineUserId: uid, kind: 'POSTBACK', text: data, lineMessageId: null, eventAt: new Date() })
      await counted(before).rpc('line_catalog_items', { p_category: category.id, p_offset: 0 })
    }
    const uid = 'U' + randomUUID().replaceAll('-', '')
    let contactId = ''
    for (let n = 0; n < 12; n++) {
      const store = createSupabaseLineStore(counted(after))
      const userId = n === 11 ? uid : 'U' + randomUUID().replaceAll('-', '')
      const rec = await store.recordEvent({ eventId: randomUUID(), lineUserId: userId, kind: 'POSTBACK', text: data, lineMessageId: null, eventAt: new Date() })
      if (n === 11) contactId = rec.contactId!
      expect((await store.checkInteraction!(userId, 'CATALOG', data)).allowed).toBe(true)
      const page = await store.catalogItems!(category.id, 0)
      expect(page?.items.length).toBeGreaterThan(0)
      expect(JSON.stringify(page)).not.toMatch(/cost_price|customer_id|stock_state|credit_limit/)
    }
    expect(before.catalogCalls).toBe(12)
    expect(after.catalogCalls).toBe(1)
    expect(before.calls).toBe(24)
    expect(after.calls).toBe(13)
    expect(after.bytes).toBeLessThan(before.bytes)
    writeFileSync(join(dirname(configPath!), 'line-catalog-measurement.json'), JSON.stringify({ requests: 12, before, after, payloadOnly: true }))
    const store = createSupabaseLineStore(counted(after))
    await store.recordEvent({ eventId: randomUUID(), lineUserId: uid, kind: 'POSTBACK', text: data, lineMessageId: null, eventAt: new Date() })
    expect((await store.checkInteraction!(uid, 'CATALOG', data)).result).toBe('DUPLICATE')
    expect((await owner.rpc('line_contact_restriction_set', { p_contact_id: contactId, p_scope: 'CATALOG', p_until: null, p_reason: 'Local integration fixture', p_revoke: false })).error).toBeNull()
    await store.recordEvent({ eventId: randomUUID(), lineUserId: uid, kind: 'POSTBACK', text: data, lineMessageId: null, eventAt: new Date() })
    expect((await store.checkInteraction!(uid, 'CATALOG', data)).result).toBe('SUSPENDED')
    expect(after.catalogCalls).toBe(1)
    expect((await owner.rpc('line_catalog_set', { p_kind: 'CATEGORY', p_id: category.id, p_listed: false })).error).toBeNull()
    const freshUid = 'U' + randomUUID().replaceAll('-', '')
    const fresh = createSupabaseLineStore(counted(after))
    await fresh.recordEvent({ eventId: randomUUID(), lineUserId: freshUid, kind: 'POSTBACK', text: data, lineMessageId: null, eventAt: new Date() })
    expect((await fresh.checkInteraction!(freshUid, 'CATALOG', data)).allowed).toBe(true)
    expect(await fresh.catalogItems!(category.id, 0)).toBeNull()
    expect(after.catalogCalls).toBe(2)
    expect((await owner.rpc('line_catalog_set', { p_kind: 'CATEGORY', p_id: category.id, p_listed: true })).error).toBeNull()
    const service = createSupabaseLineStore(db)
    await service.enqueueRegister({ contactId, templateKey: 'REGISTER_WELCOME', messages: [{ type: 'text', text: 'Local Mock fixture' }], dedupeKey: 'local-mock-' + randomUUID() })
    const provider = new MockLineProvider()
    const sent = await processOutbox({ store: service, provider })
    expect(sent.sent).toBeGreaterThan(0)
    expect(provider.pushed.some((p) => p.to === uid)).toBe(true)
    const outcome = await db.from('line_deliveries').select('status').eq('contact_id', contactId).eq('template_key', 'REGISTER_WELCOME')
    expect(outcome.error).toBeNull()
    expect(outcome.data?.some((d) => d.status === 'SENT')).toBe(true)
    expect((await owner.rpc('line_outbox_claim', { p_limit: 1, p_lease_seconds: 60 })).error?.code).toBe('42501')
  }, 120000)
})