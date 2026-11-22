import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCatalogPostback } from '@/lib/line/catalog'
import { HttpLineProvider } from '@/lib/line/provider'
import { MockLineProvider } from '@/lib/line/mock-provider'
import {
  pngSize,
  richMenuBody,
  richMenuCells,
  richMenuItems,
  richMenuKindOf,
  richMenuSize,
  RICH_MENU_CHAT_BAR,
  RICH_MENU_KINDS,
  validateRichMenuImage,
  type RichMenuKind,
} from '@/lib/line/rich-menu'
import { hasRichMenuStore, syncRichMenus, type RichMenuPerson, type RichMenuSyncStore } from '@/lib/line/rich-menu-sync'

/** The four chat menus (owner 2026-11-21): what is on them, what LINE is asked for, who gets which, and the publishing steps. */

const m = vi.hoisted(() => ({ rpc: vi.fn(), save: vi.fn(), clear: vi.fn(), creds: vi.fn(), mode: 'live' as 'live' | 'mock', provider: null as unknown }))
const ctx = { phone: '081-234-5678', registerUrl: null }
const ID = (n: number) => `richmenu-${n.toString(16).padStart(32, '0')}`
const USER = (n: number) => 'U' + String(n).repeat(32)
const png = (kind: RichMenuKind) => new Uint8Array(readFileSync(join(process.cwd(), 'public/line/rich-menu', `${kind}.png`)))

describe('the four menus', () => {
  it('are GENERAL, CUSTOMER, STAFF and DRIVER, and every button has an action the system already answers', () => {
    expect([...RICH_MENU_KINDS]).toEqual(['GENERAL', 'CUSTOMER', 'STAFF', 'DRIVER'])
    for (const kind of RICH_MENU_KINDS) {
      const items = richMenuItems(kind, ctx)
      expect(items.length).toBe(richMenuCells(kind).length)
      for (const it of items) {
        if (it.action.type === 'postback') expect(parseCatalogPostback(it.action.data), `${kind}/${it.id}`).not.toBeNull()
        else expect(it.action.uri).toMatch(/^https:\/\//)
      }
    }
  })

  it('the general menu has the six things of the spec; the registration button is the form when there is one', () => {
    expect(richMenuItems('GENERAL', ctx).map((i) => i.label)).toEqual([
      'ดูรายการสินค้า',
      'สอบถามราคา',
      'สอบถามสั่งสินค้าล่วงหน้า',
      'ลงทะเบียน / ผูกบัญชี',
      'ติดต่อร้าน',
      'ข้อมูลร้านและเวลาทำการ',
    ])
    expect(richMenuItems('GENERAL', ctx).find((i) => i.id === 'register')?.action.type).toBe('postback')
    expect(richMenuItems('GENERAL', { ...ctx, registerUrl: 'https://liff.line.me/1/register' }).find((i) => i.id === 'register')?.action).toEqual({ type: 'uri', uri: 'https://liff.line.me/1/register' })
  })

  it('only buttons whose function exists are on the customer / staff / driver menus (no "my rentals", "my jobs", "report a problem")', () => {
    const all = RICH_MENU_KINDS.flatMap((k) => richMenuItems(k, ctx).map((i) => i.label)).join('|')
    for (const notBuilt of ['ดูรายการเช่าของฉัน', 'เอกสารของฉัน', 'งานของฉัน', 'รายงานปัญหา', 'ประวัติงาน', 'กำหนดคืน']) expect(all).not.toContain(notBuilt)
  })

  it('the body for LINE: sizes, areas inside the picture without overlap, within LINE\'s limits', () => {
    for (const kind of RICH_MENU_KINDS) {
      const body = richMenuBody(kind, ctx)
      const { width, height } = richMenuSize(kind)
      expect(body.size).toEqual({ width: 2500, height })
      expect(width / height).toBeGreaterThanOrEqual(1.45)
      expect(body.areas.length).toBeLessThanOrEqual(20)
      expect([...RICH_MENU_CHAT_BAR].length).toBeLessThanOrEqual(14)
      expect(body.name.length).toBeLessThanOrEqual(300)
      let area = 0
      for (const a of body.areas) {
        const b = a.bounds
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width).toBeLessThanOrEqual(width)
        expect(b.y + b.height).toBeLessThanOrEqual(height)
        expect(a.action.label.length).toBeLessThanOrEqual(20)
        area += b.width * b.height
      }
      expect(area).toBe(width * height) // the cells tile the picture exactly: no dead spot, no overlap
    }
  })

  it('a person gets a menu only from what the shop confirmed', () => {
    expect(richMenuKindOf({ status: 'UNLINKED', customer_id: null })).toBe('GENERAL')
    expect(richMenuKindOf({ status: 'UNLINKED', customer_id: 'c' })).toBe('GENERAL')
    expect(richMenuKindOf({ status: 'LINKED', customer_id: 'c' })).toBe('CUSTOMER')
    expect(richMenuKindOf({ status: 'LINKED', profile_id: 'p' })).toBe('STAFF')
    expect(richMenuKindOf({ status: 'LINKED', driver_code: 'D001' })).toBe('DRIVER')
    expect(richMenuKindOf({ status: 'LINKED' })).toBe('GENERAL')
  })
})

describe('the pictures', () => {
  it('each picture in /public is a PNG of exactly the menu\'s size, accepted by LINE\'s rules', () => {
    for (const kind of RICH_MENU_KINDS) {
      const bytes = png(kind)
      const size = pngSize(bytes)
      expect(size, kind).toEqual(richMenuSize(kind))
      expect(validateRichMenuImage({ ...size!, bytes: bytes.byteLength, type: 'image/png' }), kind).toBeNull()
    }
  })

  it('LINE\'s image rules are checked: type, width, height, shape, size', () => {
    const ok = { width: 2500, height: 1686, bytes: 500_000, type: 'image/png' }
    expect(validateRichMenuImage(ok)).toBeNull()
    expect(validateRichMenuImage({ ...ok, type: 'image/gif' })).toMatch(/PNG หรือ JPEG/)
    expect(validateRichMenuImage({ ...ok, width: 799 })).toMatch(/800–2500/)
    expect(validateRichMenuImage({ ...ok, width: 2501 })).toMatch(/800–2500/)
    expect(validateRichMenuImage({ ...ok, height: 249, width: 2500 })).toMatch(/250/)
    expect(validateRichMenuImage({ ...ok, width: 1000, height: 800 })).toMatch(/1.45/)
    expect(validateRichMenuImage({ ...ok, bytes: 1_000_001 })).toMatch(/1 MB/)
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

describe('syncRichMenus', () => {
  const store = (people: RichMenuPerson[], published: Partial<Record<RichMenuKind, string>> = {}) => {
    const s = {
      richMenuPending: vi.fn(async () => people),
      richMenuPublished: vi.fn(async () => published),
      richMenuMark: vi.fn(async () => undefined),
      richMenuForUser: vi.fn(async (u: string) => people.find((p) => p.line_user_id === u) ?? null),
    }
    return s satisfies RichMenuSyncStore
  }
  const person = (n: number, kind: RichMenuKind, from: RichMenuKind | null = null): RichMenuPerson => ({ id: `c${n}`, line_user_id: USER(n), kind, from_kind: from })

  it('a confirmed customer is linked to the published customer menu and marked; a person back to general only loses the personal menu', async () => {
    const provider = new MockLineProvider()
    const s = store([person(1, 'CUSTOMER'), person(2, 'GENERAL', 'CUSTOMER')], { CUSTOMER: ID(1) })
    const r = await syncRichMenus({ store: s, provider })
    expect(r).toEqual({ linked: 1, unlinked: 1, failed: 0 })
    expect(provider.richMenu).toEqual([
      { call: 'link', args: [USER(1), ID(1)] },
      { call: 'unlink', args: [USER(2)] },
    ])
    expect(s.richMenuMark).toHaveBeenCalledWith('c1', 'CUSTOMER', true)
    expect(s.richMenuMark).toHaveBeenCalledWith('c2', 'GENERAL', true)
  })

  it('a kind with no published menu is skipped and not marked; the published list is read only when needed', async () => {
    const provider = new MockLineProvider()
    const s = store([person(1, 'STAFF')], {})
    expect(await syncRichMenus({ store: s, provider })).toEqual({ linked: 0, unlinked: 0, failed: 0 })
    expect(provider.richMenu).toHaveLength(0)
    expect(s.richMenuMark).not.toHaveBeenCalled()
    const s2 = store([person(2, 'GENERAL', 'CUSTOMER')])
    await syncRichMenus({ store: s2, provider })
    expect(s2.richMenuPublished).not.toHaveBeenCalled()
  })

  it('a failure is remembered as a try (not done) and never stops the others; "no personal menu to take away" (404) counts as done', async () => {
    const provider = new MockLineProvider().queueMenu({ ok: false, status: 500 }, { ok: true, status: 200 }, { ok: false, status: 404 })
    const s = store([person(1, 'CUSTOMER'), person(2, 'CUSTOMER'), person(3, 'GENERAL', 'CUSTOMER')], { CUSTOMER: ID(1) })
    expect(await syncRichMenus({ store: s, provider })).toEqual({ linked: 1, unlinked: 1, failed: 1 })
    expect(s.richMenuMark).toHaveBeenCalledWith('c1', 'CUSTOMER', false)
    expect(s.richMenuMark).toHaveBeenCalledWith('c2', 'CUSTOMER', true)
    expect(s.richMenuMark).toHaveBeenCalledWith('c3', 'GENERAL', true)
  })

  it('one person who just added the OA is applied again even when the database thinks it is right', async () => {
    const provider = new MockLineProvider()
    const s = store([person(7, 'GENERAL', 'GENERAL')])
    await syncRichMenus({ store: s, provider, lineUserId: USER(7) })
    expect(s.richMenuForUser).toHaveBeenCalledWith(USER(7))
    expect(s.richMenuPending).not.toHaveBeenCalled()
    expect(provider.richMenu).toEqual([{ call: 'unlink', args: [USER(7)] }])
  })

  it('does nothing without a provider that has chat menus, and a provider that throws costs one failure', async () => {
    const s = store([person(1, 'CUSTOMER')], { CUSTOMER: ID(1) })
    expect(await syncRichMenus({ store: s, provider: null })).toEqual({ linked: 0, unlinked: 0, failed: 0 })
    const boom = new MockLineProvider()
    boom.linkRichMenu = vi.fn(async () => {
      throw new Error('down')
    })
    expect(await syncRichMenus({ store: s, provider: boom })).toEqual({ linked: 0, unlinked: 0, failed: 1 })
    expect(hasRichMenuStore(s)).toBe(true)
    expect(hasRichMenuStore({})).toBe(false)
  })
})

describe('HttpLineProvider chat menu calls', () => {
  const TOKEN = 'tok-secret-123'
  function make(answer: (url: string, init: RequestInit) => Response) {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = []
    const provider = new HttpLineProvider(TOKEN, async (url, init) => {
      calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body })
      return answer(url, init)
    })
    return { provider, calls }
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'x-line-request-id': 'req-1' } })

  it('create / upload / default / link / unlink / delete go to the right LINE addresses with the token', async () => {
    const { provider, calls } = make((url) => (url.endsWith('/richmenu') ? json({ richMenuId: ID(9) }) : json({})))
    const created = await provider.createRichMenu({ size: { width: 2500, height: 843 } })
    expect(created).toMatchObject({ ok: true, richMenuId: ID(9) })
    await provider.uploadRichMenuImage(ID(9), new Uint8Array([1, 2, 3]), 'image/png')
    await provider.setDefaultRichMenu(ID(9))
    await provider.linkRichMenu(USER(4), ID(9))
    await provider.unlinkRichMenu(USER(4))
    await provider.cancelDefaultRichMenu()
    await provider.deleteRichMenu(ID(9))
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://api.line.me/v2/bot/richmenu',
      `POST https://api-data.line.me/v2/bot/richmenu/${ID(9)}/content`,
      `POST https://api.line.me/v2/bot/user/all/richmenu/${ID(9)}`,
      `POST https://api.line.me/v2/bot/user/${USER(4)}/richmenu/${ID(9)}`,
      `DELETE https://api.line.me/v2/bot/user/${USER(4)}/richmenu`,
      'DELETE https://api.line.me/v2/bot/user/all/richmenu',
      `DELETE https://api.line.me/v2/bot/richmenu/${ID(9)}`,
    ])
    for (const c of calls) expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(calls[1].headers['Content-Type']).toBe('image/png')
  })

  it('an id that is not LINE\'s is refused before any call; a made-up id from LINE is not accepted as a menu', async () => {
    const { provider, calls } = make(() => json({ richMenuId: 'nope' }))
    expect((await provider.linkRichMenu('U1', ID(1))).ok).toBe(false)
    expect((await provider.linkRichMenu(USER(4), 'richmenu-x')).ok).toBe(false)
    expect((await provider.deleteRichMenu('../all')).ok).toBe(false)
    expect((await provider.uploadRichMenuImage('x', new Uint8Array(), 'image/png')).ok).toBe(false)
    expect(calls).toHaveLength(0)
    expect(await provider.createRichMenu({})).toMatchObject({ ok: false, errorCode: 'NO_RICH_MENU_ID' })
  })

  it('a refusal or a network failure is a result, and the token is never in it', async () => {
    const refused = make(() => json({ message: 'bad' }, 400))
    expect(await refused.provider.deleteRichMenu(ID(1))).toMatchObject({ ok: false, status: 400, requestId: 'req-1' })
    const down = make(() => {
      throw Object.assign(new Error(`failed with ${TOKEN}`), { name: 'TypeError' })
    })
    const r = await down.provider.linkRichMenu(USER(4), ID(1))
    expect(r).toMatchObject({ ok: false, status: 0 })
    expect(JSON.stringify(r)).not.toContain(TOKEN)
  })
})

describe('publishing and un-publishing (server actions)', () => {
  beforeEach(() => {
    vi.resetModules()
    m.rpc.mockReset()
    m.save.mockReset()
    m.clear.mockReset()
    m.creds.mockReset()
    m.creds.mockResolvedValue({ channelSecret: null, accessToken: 'tok' })
    m.mode = 'live'
    m.provider = new MockLineProvider()
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.example')
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        rpc: m.rpc,
        auth: { getUser: async () => ({ data: { user: { id: 'owner-id' } } }) },
        from: () => {
          const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { company_name: 'ร้านเอ', phone: '081-234-5678', line_id: '@s', templates: {} } }) }
          return q
        },
      }),
    }))
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
    vi.doMock('@/lib/line/supabase-store', () => ({ createSupabaseLineStore: () => ({ credentials: m.creds, richMenuSave: m.save, richMenuClear: m.clear }) }))
    vi.doMock('@/lib/line/provider', () => ({ createLineProvider: () => m.provider, lineDeliveryMode: () => m.mode }))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    for (const mod of ['@/lib/supabase/server', '@/lib/supabase/admin', '@/lib/line/supabase-store', '@/lib/line/provider']) vi.doUnmock(mod)
  })

  const serve = (kind: RichMenuKind) => vi.stubGlobal('fetch', vi.fn(async () => new Response(png(kind) as unknown as BodyInit, { status: 200 })))
  const actions = () => import('@/app/actions/line')

  it('the status lists the four menus with their buttons and the people on each', async () => {
    m.rpc.mockResolvedValue({ data: [{ kind: 'CUSTOMER', published_at: '2026-11-21T01:00:00Z', people: 3, on_menu: 2 }], error: null })
    const { getRichMenuStatus } = await actions()
    const r = await getRichMenuStatus()
    expect(r.success).toBe(true)
    expect(r.data?.mode).toBe('live')
    expect(r.data?.menus.map((x) => x.kind)).toEqual(['GENERAL', 'CUSTOMER', 'STAFF', 'DRIVER'])
    expect(r.data?.menus[1]).toMatchObject({ people: 3, on_menu: 2, published_at: '2026-11-21T01:00:00Z', image: '/line/rich-menu/CUSTOMER.png' })
    expect(r.data?.menus[0].items).toContain('ดูรายการสินค้า')
  })

  it('the trial mode never touches LINE: publishing and un-publishing are refused before any call', async () => {
    m.mode = 'mock'
    m.rpc.mockResolvedValue({ data: [], error: null })
    const { publishRichMenu, unpublishRichMenu } = await actions()
    expect((await publishRichMenu('GENERAL')).error).toContain('โหมดทดลอง')
    expect((await unpublishRichMenu('GENERAL')).error).toContain('โหมดทดลอง')
    expect((m.provider as MockLineProvider).richMenu).toHaveLength(0)
    expect(m.save).not.toHaveBeenCalled()
  })

  it('only the owner: the database refusal comes back and nothing is created', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN: OWNER only' } })
    const { publishRichMenu } = await actions()
    expect(await publishRichMenu('GENERAL')).toEqual({ success: false, error: 'เฉพาะเจ้าของร้านเท่านั้น' })
    expect((m.provider as MockLineProvider).richMenu).toHaveLength(0)
  })

  it('an unknown kind is refused', async () => {
    const { publishRichMenu } = await actions()
    expect((await publishRichMenu('VIP' as RichMenuKind)).success).toBe(false)
  })

  it('GENERAL: create → upload the picture → make it LINE\'s default → keep the id → delete the old menu', async () => {
    m.rpc.mockResolvedValue({ data: [], error: null })
    m.save.mockResolvedValue(ID(77))
    serve('GENERAL')
    const { publishRichMenu } = await actions()
    expect(await publishRichMenu('GENERAL')).toEqual({ success: true, data: { kind: 'GENERAL' } })
    const calls = (m.provider as MockLineProvider).richMenu
    expect(calls.map((c) => c.call)).toEqual(['create', 'upload', 'setDefault', 'delete'])
    expect((calls[0].args[0] as { areas: unknown[] }).areas).toHaveLength(6)
    expect(calls[1].args[2]).toBe('image/png')
    expect(calls[3].args).toEqual([ID(77)]) // the old one
    expect(m.save).toHaveBeenCalledWith('GENERAL', ID(1), 'owner-id')
  })

  it('CUSTOMER: no default menu is set (those people are linked one by one)', async () => {
    m.rpc.mockResolvedValue({ data: [], error: null })
    m.save.mockResolvedValue(null)
    serve('CUSTOMER')
    const { publishRichMenu } = await actions()
    await publishRichMenu('CUSTOMER')
    expect((m.provider as MockLineProvider).richMenu.map((c) => c.call)).toEqual(['create', 'upload'])
  })

  it('a step that fails undoes the menu LINE already made, and nothing is kept', async () => {
    m.rpc.mockResolvedValue({ data: [], error: null })
    serve('GENERAL')
    ;(m.provider as MockLineProvider).queueMenu({ ok: true, status: 200 }, { ok: false, status: 400 })
    const { publishRichMenu } = await actions()
    const r = await publishRichMenu('GENERAL')
    expect(r.success).toBe(false)
    expect((m.provider as MockLineProvider).richMenu.map((c) => c.call)).toEqual(['create', 'upload', 'delete'])
    expect(m.save).not.toHaveBeenCalled()
  })

  it('a wrong picture is refused before LINE is asked', async () => {
    m.rpc.mockResolvedValue({ data: [], error: null })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]) as unknown as BodyInit, { status: 200 })))
    const { publishRichMenu } = await actions()
    expect((await publishRichMenu('GENERAL')).error).toContain('PNG')
    // the picture of another menu (other size) does not fit this one's buttons
    serve('STAFF')
    expect((await publishRichMenu('GENERAL')).error).toContain('ขนาดรูปไม่ตรง')
    expect((m.provider as MockLineProvider).richMenu).toHaveLength(0)
  })

  it('un-publishing forgets the menu here and deletes it at LINE; GENERAL also gives up the default', async () => {
    m.rpc.mockResolvedValue({ data: [], error: null })
    m.clear.mockResolvedValue(ID(5))
    const { unpublishRichMenu } = await actions()
    expect(await unpublishRichMenu('GENERAL')).toEqual({ success: true, data: { kind: 'GENERAL' } })
    expect((m.provider as MockLineProvider).richMenu).toEqual([
      { call: 'cancelDefault', args: [] },
      { call: 'delete', args: [ID(5)] },
    ])
    expect(m.clear).toHaveBeenCalledWith('GENERAL', 'owner-id')
  })
})
