import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { signLineBody } from '@/lib/line/signature'
import { MockLineProvider } from '@/lib/line/mock-provider'
import { parseRegisterText } from '@/lib/line/register'
import { lineOaAddFriendUrl } from '@/lib/line/oa-link'
import { handleLineWebhook, type SelfRegisterResult, type WebhookStore } from '@/lib/line/webhook'
import { type LineMessage } from '@/lib/line/types'

/** Self-registration in the OA chat (owner rule 2026-10-31). */

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
    expect(lineOaAddFriendUrl('@myshop')).toBe('https://line.me/R/ti/p/%40myshop')
    expect(lineOaAddFriendUrl('')).toBeNull()
    expect(lineOaAddFriendUrl('bad id/../')).toBeNull()
  })
})

function textEvent(id: string, user: string, text: string) {
  return { type: 'message', webhookEventId: id, timestamp: 1791475200000, replyToken: `rt-${id}`, source: { type: 'user', userId: user }, message: { type: 'text', id: `m-${id}`, text } }
}
function followEvent(id: string, user: string) {
  return { type: 'follow', webhookEventId: id, timestamp: 1791475200000, replyToken: `rt-${id}`, source: { type: 'user', userId: user } }
}

function store(register: (name: string, phone: string) => SelfRegisterResult) {
  const s: WebhookStore = {
    recordEvent: vi.fn(async (e) => ({ duplicate: false, contactId: 'c', status: e.lineUserId === LINKED ? ('LINKED' as const) : ('UNLINKED' as const) })),
    consumeLinkCode: vi.fn(async () => ({ result: 'INVALID' as const })),
    taskPostback: vi.fn(async () => ({ result: 'NOT_FOUND' as const })),
    taskStep: vi.fn(async () => ({ result: 'NOT_FOUND' as const })),
    followContact: vi.fn(async (user) => ({ status: user === LINKED ? ('LINKED' as const) : ('UNLINKED' as const), register_status: 'WAITING' })),
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

describe('webhook: follow and self-registration', () => {
  it('follow: keeps the profile name and replies (free reply token) with the welcome asking for name + phone', async () => {
    const provider = new MockLineProvider()
    provider.profile = vi.fn(async () => ({ displayName: 'Ton_rider' }))
    const s = store(() => ({ result: 'INVALID' }))
    await call([followEvent('f1', NEW_FRIEND)], s, provider)
    expect(s.followContact).toHaveBeenCalledWith(NEW_FRIEND, 'Ton_rider')
    expect(provider.pushed).toHaveLength(0)
    expect(replies(provider)).toEqual(['ขอบคุณที่เพิ่มเพื่อนร้านเอ\nพิมพ์ชื่อ-นามสกุลและเบอร์โทร เพื่อรับบิลและแจ้งเตือนวันคืนทาง LINE\nเช่น สมชาย ใจดี 0812345678'])
  })

  it('follow from an already linked LINE gets no welcome', async () => {
    const s = store(() => ({ result: 'INVALID' }))
    const provider = await call([followEvent('f2', LINKED)], s)
    expect(s.followContact).toHaveBeenCalled()
    expect(provider.replied).toHaveLength(0)
  })

  it('name + phone in one message: linked (new or known customer) -> success reply with the name', async () => {
    const s = store((name) => ({ result: 'LINKED_CUSTOMER', name, created: true }))
    const provider = await call([textEvent('t1', NEW_FRIEND, 'สมชาย ใจดี 081-234-5678')], s)
    expect(s.selfRegister).toHaveBeenCalledWith(NEW_FRIEND, 'สมชาย ใจดี', '0812345678')
    expect(replies(provider)).toEqual(['ผูก LINE กับบัญชี สมชาย ใจดี ที่ ร้านเอ เรียบร้อยแล้ว คุณจะได้รับแจ้งเตือนทาง LINE นี้'])
  })

  it('a phone already linked to another LINE is never replaced: reply says the shop will contact them', async () => {
    const provider = await call([textEvent('t2', NEW_FRIEND, 'สมหญิง 0811111111')], store(() => ({ result: 'PHONE_TAKEN' })))
    expect(replies(provider)).toEqual(['เบอร์นี้ผูกกับ LINE อื่นไว้แล้ว ร้านจะติดต่อกลับทาง LINE นี้'])
  })

  it('a phone of several customers stays pending for the shop', async () => {
    const provider = await call([textEvent('t3', NEW_FRIEND, 'มานพ 0822222222')], store(() => ({ result: 'DUPLICATE' })))
    expect(replies(provider)).toEqual(['ได้รับชื่อและเบอร์โทรแล้ว ร้านจะตรวจข้อมูลและติดต่อกลับทาง LINE นี้'])
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

describe('migration 20261031090000 (shape)', () => {
  const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261031090000_line_self_register_v1.sql'), 'utf8')

  it('webhook functions are service_role only, shop functions authenticated only, the rule itself nobody', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\._line_register_apply\(uuid, text, text, uuid\) FROM PUBLIC, anon, authenticated, service_role;/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION\s+public\.line_contact_follow\(text, text\),\s+public\.line_self_register\(text, text, text\)\s+TO service_role;/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION\s+public\.line_contact_register_by_shop\(uuid, text, text\),\s+public\.line_contact_reject\(uuid, text\)\s+TO authenticated;/)
    expect(SQL).toContain('PERFORM public._line_require_server();')
  })

  it('never replaces an existing link and never guesses between duplicate customers', () => {
    expect(SQL).toMatch(/x\.customer_id = v_cust AND x\.status = 'LINKED'\) THEN\s+UPDATE public\.line_contacts SET register_status = 'PHONE_TAKEN'/)
    expect(SQL).toMatch(/cardinality\(v_ids\), 0\) > 1 THEN\s+UPDATE public\.line_contacts SET register_status = 'DUPLICATE'/)
  })

  it('line_user_id stays server-side: only the new state columns are granted', () => {
    expect(SQL).toContain('GRANT SELECT (register_status, register_customer_id, self_registered) ON public.line_contacts TO authenticated;')
    expect(SQL).not.toMatch(/GRANT SELECT[^;]*line_user_id/)
  })
})
