import { describe, expect, it } from 'vitest'
import { signLineBody, verifyLineSignature } from '@/lib/line/signature'
import { assertValidMessages, LineMessageError } from '@/lib/line/messages'
import { renderTemplate, taskMessages, textMessage } from '@/lib/line/templates'
import { decideAttempt, LINE_RETRY_BACKOFF_SECONDS } from '@/lib/line/retry'
import { redactSecrets } from '@/lib/line/redact'
import { isPublicRoute } from '@/features/auth/services/public-routes'

const SECRET = '0123456789abcdef0123456789abcdef'

describe('webhook signature (HMAC-SHA256, base64)', () => {
  const body = JSON.stringify({ destination: 'U0', events: [] })

  it('accepts the exact body signed with the channel secret', async () => {
    expect(await verifyLineSignature(SECRET, body, await signLineBody(SECRET, body))).toBe(true)
  })

  it('rejects a changed body, another secret, a missing or junk header', async () => {
    const sig = await signLineBody(SECRET, body)
    expect(await verifyLineSignature(SECRET, body + ' ', sig)).toBe(false)
    expect(await verifyLineSignature('ffffffffffffffffffffffffffffffff', body, sig)).toBe(false)
    expect(await verifyLineSignature(SECRET, body, null)).toBe(false)
    expect(await verifyLineSignature(SECRET, body, 'not-base64!!')).toBe(false)
    expect(await verifyLineSignature('', body, sig)).toBe(false)
  })
})

describe('templates (spec sample texts)', () => {
  it('renders the spec texts with variables', () => {
    expect(renderTemplate('TEST', { ชื่อร้าน: 'ร้านเอ' })).toBe('ข้อความทดสอบจาก ร้านเอ ถ้าเห็นข้อความนี้ แปลว่า LINE พร้อมใช้งาน')
    expect(
      renderTemplate('CUSTOMER_RETURN_REMINDER', { ชื่อลูกค้า: 'สมชาย', เลขบิล: 'BL-1', วันคืน: '10/10/2569', ยอดค้าง: '1,500', ชื่อร้าน: 'ร้านเอ' }),
    ).toBe('เรียนคุณสมชาย บิล BL-1 ครบกำหนดคืน 10/10/2569 ยอดค้าง 1,500 บาท ขอบคุณค่ะ ร้านเอ')
  })

  it('refuses to send a message with a missing variable', () => {
    expect(() => renderTemplate('TEST', {})).toThrow(/LINE_TEMPLATE_VAR_MISSING:ชื่อร้าน/)
    expect(() => renderTemplate('TEST', { ชื่อร้าน: '  ' })).toThrow(LineMessageError)
  })

  it('uses an owner override only when it names the key\'s own placeholders', () => {
    expect(renderTemplate('TEST', { ชื่อร้าน: 'ร้านเอ' }, { TEST: 'ทดสอบ {ชื่อร้าน}' })).toBe('ทดสอบ ร้านเอ')
    // {เลขบิล} is not a TEST placeholder -> default text
    expect(renderTemplate('TEST', { ชื่อร้าน: 'ร้านเอ' }, { TEST: 'ทดสอบ {เลขบิล}' })).toContain('ข้อความทดสอบจาก ร้านเอ')
    expect(renderTemplate('TEST', { ชื่อร้าน: 'ร้านเอ' }, { TEST: 42 })).toContain('ข้อความทดสอบจาก')
  })

  it('task message carries both buttons with the task id and stays inside LINE limits', () => {
    const id = '11111111-2222-3333-4444-555555555555'
    const msgs = taskMessages(id, { ผู้สั่ง: 'เจ้าของ', เรื่อง: 'ส่งของ' + 'ก'.repeat(300) })
    expect(() => assertValidMessages(msgs)).not.toThrow()
    const json = JSON.stringify(msgs)
    expect(json).toContain(`task=${id}&action=ACCEPT`)
    expect(json).toContain(`task=${id}&action=DONE`)
  })
})

describe('message validation (mirrors _line_messages_valid)', () => {
  it.each([
    [[], 'LINE_MESSAGE_COUNT'],
    [Array(6).fill({ type: 'text', text: 'a' }), 'LINE_MESSAGE_COUNT'],
    [[{ type: 'text', text: '' }], 'LINE_TEXT_INVALID'],
    [[{ type: 'text', text: 'ก'.repeat(5001) }], 'LINE_TEXT_INVALID'],
    [[{ type: 'image', originalContentUrl: 'https://x' }], 'LINE_MESSAGE_TYPE'],
    [[{ type: 'template', altText: 'a', template: { type: 'buttons', text: 'a', actions: [{ type: 'uri', label: 'x', uri: 'http://insecure' }] } }], 'LINE_ACTION_INVALID'],
    ['text', 'LINE_MESSAGE_COUNT'],
  ])('rejects %#', (input, code) => {
    expect(() => assertValidMessages(input)).toThrow(code)
  })

  it('accepts text', () => {
    expect(() => assertValidMessages([textMessage('LINK_INVALID')])).not.toThrow()
  })
})

describe('retry policy', () => {
  const now = new Date('2026-10-08T00:00:00Z')

  it('200 and 409 (retry key already accepted) count as sent', () => {
    expect(decideAttempt({ ok: true, status: 200 }, 1, 5, now).outcome).toBe('SENT')
    expect(decideAttempt({ ok: false, status: 409 }, 2, 5, now).outcome).toBe('SENT')
  })

  it('network, 429 and 5xx retry with growing backoff; Retry-After wins when longer', () => {
    const a = decideAttempt({ ok: false, status: 0 }, 1, 5, now)
    expect(a).toMatchObject({ outcome: 'RETRY', errorCode: 'NETWORK' })
    expect(a.outcome === 'RETRY' && a.retryAt.getTime() - now.getTime()).toBe(LINE_RETRY_BACKOFF_SECONDS[0] * 1000)
    const b = decideAttempt({ ok: false, status: 500 }, 3, 5, now)
    expect(b.outcome === 'RETRY' && b.retryAt.getTime() - now.getTime()).toBe(LINE_RETRY_BACKOFF_SECONDS[2] * 1000)
    const c = decideAttempt({ ok: false, status: 429, retryAfterSeconds: 7200 }, 1, 5, now)
    expect(c.outcome === 'RETRY' && c.retryAt.getTime() - now.getTime()).toBe(7200 * 1000)
  })

  it('400 / 401 / 403 stop at once; the last allowed attempt stops too', () => {
    expect(decideAttempt({ ok: false, status: 400 }, 1, 5, now)).toMatchObject({ outcome: 'DEAD', errorCode: 'HTTP_400' })
    expect(decideAttempt({ ok: false, status: 401 }, 1, 5, now)).toMatchObject({ outcome: 'DEAD', errorCode: 'TOKEN_INVALID' })
    expect(decideAttempt({ ok: false, status: 503 }, 5, 5, now).outcome).toBe('DEAD')
  })
})

describe('secret redaction and public routes', () => {
  it('removes bearer tokens, known secrets and long opaque strings', () => {
    const token = 'A'.repeat(150)
    const out = redactSecrets(`Authorization: Bearer abc.def secret=${SECRET} raw=${token}`, [SECRET])
    expect(out).not.toContain(SECRET)
    expect(out).not.toContain('abc.def')
    expect(out).not.toContain(token)
  })

  it('only the LINE webhook is public under /api', () => {
    expect(isPublicRoute('/api/line/webhook')).toBe(true)
    expect(isPublicRoute('/api/line/webhook/x')).toBe(false)
    expect(isPublicRoute('/api/line/outbox')).toBe(false)
    expect(isPublicRoute('/api')).toBe(false)
    expect(isPublicRoute('/login')).toBe(true)
  })
})
