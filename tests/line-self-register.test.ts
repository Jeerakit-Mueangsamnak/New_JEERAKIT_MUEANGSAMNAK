import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { signLineBody } from '@/lib/line/signature'
import { MockLineProvider } from '@/lib/line/mock-provider'
import { parseRegisterText } from '@/lib/line/register'
import { lineOaAddFriendUrl } from '@/lib/line/oa-link'
import { handleLineWebhook, type SelfRegisterResult, type WebhookStore } from '@/lib/line/webhook'
import { type LineMessage } from '@/lib/line/types'

/** Friends and what they type in the OA chat (owner 2026-10-31, changed 2026-11-21: a stranger only files a request). */

const SECRET = '0123456789abcdef0123456789abcdef'
const NEW_FRIEND = 'U' + 'a'.repeat(32)
const LINKED = 'U' + 'b'.repeat(32)

describe('parseRegisterText', () => {
  it('finds a 10-digit Thai mobile (spaces / dashes allowed) and keeps the rest as the name', () => {
    expect(parseRegisterText('สมชาย ใจดี 0812345678')).toEqual({ name: 'สมชาย ใจดี', phone: '0812345678' })
    expect(parseRegisterText('081-234-5678 สมหญิง รักดี')).toEqual({ name: 'สมหญิง รักดี', phone: '0812345678' })
    expect(parseRegisterText('ชื่อ: มานพ  เบอร์ 08 1234 5678')).toEqual({ name: 'มานพ', phone: '0812345678' })
  })

  it('missing name or phone gives null for that part', () => {
    expect(parseRegisterText('สวัสดีค่ะ')).toEqual({ name: 'สวัสดีค่ะ', phone: null })
    expect(parseRegisterText('0812345678')).toEqual({ name: null, phone: '0812345678' })
    // 9 or 11 digits, or a number not starting with 0, is not a phone
    expect(parseRegisterText('สมชาย 081234567').phone).toBeNull()
    expect(parseRegisterText('สมชาย 08123456789').phone).toBeNull()
    expect(parseRegisterText('สมชาย 1812345678').phone).toBeNull()
  })
})

describe('lineOaAddFriendUrl', () => {
  it('builds the add-friend link from the shop LINE ID only', () => {
    expect(lineOaAddFriendUrl('@myshop')).toBe('https://line.me/R/ti/p/@myshop')
    expect(lineOaAddFriendUrl('')).toBeNull()
    expect(lineOaAddFriendUrl('bad id/../')).toBeNull()
  })
})

function textEvent(id: string, user: string, text: string) {
  return { type: 'message', webhookEventId: id, timestamp: 1791475200000, replyToken: `rt-${id}`, source: { type: 'user', userId: user }, message: { type: 'text', id: `m-${id}`, text } }
}
function followEvent(id: string, user: string, isUnblocked?: boolean) {
  return {
    type: 'follow',
    webhookEventId: id,
    timestamp: 1791475200000,
    replyToken: `rt-${id}`,
    source: { type: 'user', userId: user },
    ...(isUnblocked === undefined ? {} : { follow: { isUnblocked } }),
  }
}

function store(register: (name: string, phone: string) => SelfRegisterResult, sendWelcome = true) {
  const s: WebhookStore = {
    recordEvent: vi.fn(async (e) => ({ duplicate: false, contactId: 'c', status: e.lineUserId === LINKED ? ('LINKED' as const) : ('UNLINKED' as const) })),
    consumeLinkCode: vi.fn(async () => ({ result: 'INVALID' as const })),
    taskPostback: vi.fn(async () => ({ result: 'NOT_FOUND' as const })),
    taskStep: vi.fn(async () => ({ result: 'NOT_FOUND' as const })),
    // the database decides the welcome: never for a linked friend, never for an unblock, off when the owner switched it off
    followContact: vi.fn(async (user, _name, _picture, isUnblock) => ({
      status: user === LINKED ? ('LINKED' as const) : ('UNLINKED' as const),
      register_status: 'WAITING',
      send_welcome: sendWelcome && user !== LINKED && !isUnblock,
    })),
    selfRegister: vi.fn(async (_u, name, phone) => register(name, phone)),
  }
  return s
}

async function call(events: unknown[], s: WebhookStore, provider = new MockLineProvider()) {
  const rawBody = JSON.stringify({ destination: 'Uxxx', events })
  await handleLineWebhook({ rawBody, signature: await signLineBody(SECRET, rawBody), channelSecret: SECRET, store: s, provider, shopName: 'ร้านเอ' })
  return provider
}
const replies = (p: MockLineProvider) => p.replied.map((r) => (r.messages[0] as Extract<LineMessage, { type: 'text' }>).text)

describe('webhook: follow and what a stranger types', () => {
  it('follow: keeps the profile name and picture, tells the database it is not an unblock, and sends the welcome (free reply token)', async () => {
    const provider = new MockLineProvider()
    provider.profile = vi.fn(async () => ({ displayName: 'Ton_rider', pictureUrl: 'https://profile.line-scdn.net/abc' }))
    const s = store(() => ({ result: 'INVALID' }))
    await call([followEvent('f1', NEW_FRIEND)], s, provider)
    expect(s.followContact).toHaveBeenCalledWith(NEW_FRIEND, 'Ton_rider', 'https://profile.line-scdn.net/abc', false)
    expect(provider.pushed).toHaveLength(0)
    expect(replies(provider)).toHaveLength(1)
    expect(replies(provider)[0]).toContain('ยินดีต้อนรับสู่ร้านจีรกิตติ์')
    // a stranger is not asked to type name + phone any more: the menu and the registration come later
    expect(replies(provider)[0]).not.toContain('0812345678')
  })

  it('follow without a profile still records the friend and welcomes', async () => {
    const s = store(() => ({ result: 'INVALID' }))
    const provider = await call([followEvent('f1b', NEW_FRIEND)], s)
    expect(s.followContact).toHaveBeenCalledWith(NEW_FRIEND, null, null, false)
    expect(replies(provider)).toHaveLength(1)
  })

  it('follow from an already linked LINE gets no welcome', async () => {
    const s = store(() => ({ result: 'INVALID' }))
    const provider = await call([followEvent('f2', LINKED)], s)
    expect(s.followContact).toHaveBeenCalled()
    expect(provider.replied).toHaveLength(0)
  })

  it('an unblock is passed to the database as an unblock and gets no welcome', async () => {
    const s = store(() => ({ result: 'INVALID' }))
    const provider = await call([followEvent('f3', NEW_FRIEND, true)], s)
    expect(s.followContact).toHaveBeenCalledWith(NEW_FRIEND, null, null, true)
    expect(provider.replied).toHaveLength(0)
  })

  it('welcome switched off by the owner (policies.line.friend.welcome): the friend is kept, nothing is sent', async () => {
    const s = store(() => ({ result: 'INVALID' }), false)
    const provider = await call([followEvent('f4', NEW_FRIEND)], s)
    expect(s.followContact).toHaveBeenCalled()
    expect(provider.replied).toHaveLength(0)
  })

  it('name + phone in one message only files a request: the reply says the shop checks first, never "linked"', async () => {
    const s = store(() => ({ result: 'PENDING' }))
    const provider = await call([textEvent('t1', NEW_FRIEND, 'สมชาย ใจดี 081-234-5678')], s)
    expect(s.selfRegister).toHaveBeenCalledWith(NEW_FRIEND, 'สมชาย ใจดี', '0812345678')
    expect(replies(provider)).toEqual(['ได้รับคำขอลงทะเบียนแล้ว ร้านจะตรวจสอบข้อมูลก่อน และแจ้งผลทาง LINE นี้'])
  })

  it('the answer never tells whether a phone is known: whatever the database holds, the stranger sees the same text or nothing', async () => {
    for (const result of ['PHONE_TAKEN', 'DUPLICATE', 'LINKED_CUSTOMER'] as const) {
      const provider = await call([textEvent(`t2-${result}`, NEW_FRIEND, 'สมหญิง 0811111111')], store(() => ({ result })))
      expect(replies(provider)).toEqual([])
    }
  })

  it('missing name or phone: asks again with the example, nothing sent to the database', async () => {
    const s = store(() => ({ result: 'INVALID' }))
    const provider = await call([textEvent('t4', NEW_FRIEND, 'สวัสดีค่ะ'), textEvent('t5', NEW_FRIEND, '0812345678')], s)
    expect(s.selfRegister).not.toHaveBeenCalled()
    expect(replies(provider)).toEqual([
      'ยังไม่พบชื่อและเบอร์โทรในข้อความ พิมพ์ชื่อ-นามสกุลและเบอร์ 10 หลัก เช่น สมชาย ใจดี 0812345678',
      'ยังไม่พบชื่อและเบอร์โทรในข้อความ พิมพ์ชื่อ-นามสกุลและเบอร์ 10 หลัก เช่น สมชาย ใจดี 0812345678',
    ])
  })

  it('link codes still work first; a linked LINE chatting is never registered again; a rejected one gets no reply', async () => {
    const s = store(() => ({ result: 'REJECTED' }))
    await call([textEvent('t6', NEW_FRIEND, 'LINK-ABCDEFGHJK')], s)
    expect(s.consumeLinkCode).toHaveBeenCalledWith(NEW_FRIEND, 'LINK-ABCDEFGHJK')
    expect(s.selfRegister).not.toHaveBeenCalled()
    await call([textEvent('t7', LINKED, 'สมชาย 0812345678')], s)
    expect(s.selfRegister).not.toHaveBeenCalled()
    const provider = await call([textEvent('t8', NEW_FRIEND, 'สมชาย 0812345678')], s)
    expect(s.selfRegister).toHaveBeenCalledTimes(1)
    expect(provider.replied).toHaveLength(0)
  })
})

describe('migration 20261122125619 (shape): a stranger only files a request', () => {
  const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261122125619_line_register_review_v1.sql'), 'utf8')
  const apply = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION public._line_register_apply'), SQL.indexOf('-- 5. FOLLOW'))

  it('the stranger path (p_actor NULL) never inserts a customer and never sets LINKED', () => {
    expect(apply).not.toMatch(/INSERT INTO public\.customers/)
    expect(apply).not.toMatch(/status = 'LINKED'\s*,/)
    expect(apply).toContain("register_status = 'PENDING'")
    expect(apply).toContain('RETURN public._line_register_link(p_contact_id, p_name, p_phone, p_actor);')
  })

  it('the helper functions and the follow are not open to the app roles', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\._line_register_link\(uuid, text, text, uuid\) FROM PUBLIC, anon, authenticated, service_role;/)
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\._line_register_apply\(uuid, text, text, uuid\) FROM PUBLIC, anon, authenticated, service_role;/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.line_contact_follow\(text, text, text, boolean\) TO service_role;/)
    expect(SQL).toContain('PERFORM public._line_require_server();')
  })

  it('the new columns are readable by the shop but line_user_id is still not granted', () => {
    expect(SQL).toContain('GRANT SELECT (picture_url, followed_at, register_note, register_payload) ON public.line_contacts TO authenticated;')
    expect(SQL).not.toMatch(/GRANT SELECT[^;]*line_user_id/)
  })

  it('the owner switches policies.line.friend are checked in the database like on the screen', () => {
    expect(SQL).toContain("ELSIF v_key = 'friend' THEN")
    expect(SQL).toContain("ARRAY['welcome', 'notifyOwner']")
  })
})

describe('migration 20261031090000 (shape)', () => {
  const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261031090000_line_self_register_v1.sql'), 'utf8')

  it('webhook functions are service_role only, shop functions authenticated only, the rule itself nobody', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\._line_register_apply\(uuid, text, text, uuid\) FROM PUBLIC, anon, authenticated, service_role;/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION\s+public\.line_contact_follow\(text, text\),\s+public\.line_self_register\(text, text, text\)\s+TO service_role;/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION\s+public\.line_contact_register_by_shop\(uuid, text, text\),\s+public\.line_contact_reject\(uuid, text\)\s+TO authenticated;/)
    expect(SQL).toContain('PERFORM public._line_require_server();')
  })

  it('never replaces an existing link and never guesses between duplicate customers (the shop\'s own typing keeps this rule)', () => {
    expect(SQL).toMatch(/x\.customer_id = v_cust AND x\.status = 'LINKED'\) THEN\s+UPDATE public\.line_contacts SET register_status = 'PHONE_TAKEN'/)
    expect(SQL).toMatch(/cardinality\(v_ids\), 0\) > 1 THEN\s+UPDATE public\.line_contacts SET register_status = 'DUPLICATE'/)
  })

  it('line_user_id stays server-side: only the new state columns are granted', () => {
    expect(SQL).toContain('GRANT SELECT (register_status, register_customer_id, self_registered) ON public.line_contacts TO authenticated;')
    expect(SQL).not.toMatch(/GRANT SELECT[^;]*line_user_id/)
  })
})
