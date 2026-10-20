import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LINE_POLICY_INT_RANGES, validateLinePolicy } from '@/lib/line/policy'
import { LINE_TEMPLATES } from '@/lib/line/templates'
import { handleLineWebhook, type WebhookStore } from '@/lib/line/webhook'
import { MockLineProvider } from '@/lib/line/mock-provider'
import { signLineBody } from '@/lib/line/signature'

/** Phase 03-A regression tests: only the points hardened in that phase. */

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261008160000_line_operations_v1.sql'), 'utf8')
const SECRET = '0123456789abcdef0123456789abcdef'

const db = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: db.rpc,
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { policies: { business_profile: { lineId: '@myshop' } } } }) }
      return q
    },
  }),
}))

/** Body of one CREATE FUNCTION, from its header to the closing $$. */
function fnBody(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  const open = SQL.indexOf('$$', start)
  return SQL.slice(start, SQL.indexOf('$$', open + 2) + 2)
}

describe('migration: server-only and SECURITY DEFINER rules', () => {
  const functions = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1])

  it('every SECURITY DEFINER function pins search_path', () => {
    for (const f of functions) {
      const body = fnBody(f)
      if (/SECURITY DEFINER/.test(body.split('AS $$')[0])) expect(body, f).toMatch(/SET search_path = ''/)
    }
  })

  it('every function is named in a REVOKE (no default PUBLIC/anon EXECUTE survives)', () => {
    const revokes = [...SQL.matchAll(/REVOKE ALL ON FUNCTION([\s\S]*?)FROM/g)].map((m) => m[1]).join('\n')
    for (const f of functions) expect(revokes, f).toContain(`public.${f}(`)
  })

  it('server RPCs go through _line_require_server, which refuses anon / authenticated JWTs', () => {
    const grant = SQL.slice(SQL.lastIndexOf('GRANT EXECUTE ON FUNCTION'))
    expect(grant.trim().endsWith('TO service_role;')).toBe(true)
    const serverFns = [...grant.matchAll(/public\.(\w+)\(/g)].map((m) => m[1])
    expect(serverFns.length).toBe(8)
    for (const f of serverFns) expect(fnBody(f), f).toContain('PERFORM public._line_require_server();')
    const guard = fnBody('_line_require_server')
    expect(guard).toContain('auth.uid() IS NOT NULL')
    expect(guard).toMatch(/request\.jwt\.claims[\s\S]*<> 'service_role'/)
    expect(SQL).not.toMatch(/IF auth\.uid\(\) IS NOT NULL THEN\s+RAISE/)
  })

  it('client enqueue accepts plain text only and buttons allow postback / https only', () => {
    expect(fnBody('line_delivery_enqueue')).toMatch(/m ->> 'type' <> 'text'/)
    const valid = fnBody('_line_messages_valid')
    expect(valid).toMatch(/a ->> 'type' = 'postback'/)
    expect(valid).toMatch(/a ->> 'uri' ~ '\^https:\/\/'/)
    // a missing text field must fail (NULL-safe comparison)
    expect(valid).toContain("jsonb_typeof(v_m -> 'text') IS DISTINCT FROM 'string'")
  })
})

describe('customer linking (OA 1:1 chat code), staff linking hardened', () => {
  it('no phone-digit proof is left anywhere', () => {
    expect(SQL).not.toMatch(/line_customer_verify_phone|_line_customer_link_enabled|PENDING_VERIFY|NEED_PHONE|pending_code_id/)
    expect(Object.keys(LINE_TEMPLATES)).not.toContain('LINK_NEED_PHONE')
  })

  it('customer codes are LINK- + 10 random characters, single use, short-lived, hash only', () => {
    const issue = fnBody('_line_code_issue')
    expect(issue).toMatch(/'LINK-' \|\| string_agg/)
    expect(issue).toContain('gen_random_bytes(10)')
    const consume = fnBody('line_link_code_consume')
    expect(consume).toContain("'^([0-9]{6}|LINK-[A-HJ-NP-Z2-9]{10})$'")
    expect(consume).toMatch(/v_k\.purpose = CASE WHEN p_code LIKE 'LINK-%' THEN 'CUSTOMER' ELSE 'STAFF' END/)
    expect(consume).toContain("'EXPIRED'")
    expect(consume).toMatch(/used_at IS NULL/)
    expect(consume).toMatch(/'LINKED_CUSTOMER'/)
    // the issuer is told, so a wrong link is noticed at once
    expect(consume).toMatch(/_notify\([\s\S]*'LINE_LINKED', 'INFO', v_k\.created_by/)
  })

  it('a customer code needs an active customer that is not linked yet', () => {
    const create = fnBody('line_link_code_create_customer')
    expect(create).toContain('LINE_CUSTOMER_ALREADY_LINKED')
    expect(create).not.toMatch(/phone/i)
  })

  it('staff link: shop-wide throttle before the code lookup, and a notice to the member', () => {
    const consume = fnBody('line_link_code_consume')
    expect(consume.indexOf("linkGlobalMaxFailures")).toBeGreaterThan(-1)
    expect(consume.indexOf("a.action = 'LINE_LINK_ATTEMPT'")).toBeLessThan(consume.indexOf('FROM public.line_link_codes'))
    expect(consume).toMatch(/_notify\([\s\S]*'LINE_LINKED', 'WARNING', v_k\.profile_id/)
  })

  it('server action returns the code with the shop OA link (QR target)', async () => {
    db.rpc.mockReset()
    db.rpc.mockResolvedValueOnce({ data: { code: 'LINK-ABCDEFGHJK', expires_at: '2026-10-08T10:10:00Z' }, error: null })
    const { createCustomerLineLinkCode } = await import('@/app/actions/line')
    const r = await createCustomerLineLinkCode('9d0f2a52-7d1c-4d6e-8f0e-111111111111')
    expect(db.rpc).toHaveBeenCalledWith('line_link_code_create_customer', { p_customer_id: '9d0f2a52-7d1c-4d6e-8f0e-111111111111' })
    expect(r).toEqual({
      success: true,
      data: { code: 'LINK-ABCDEFGHJK', expires_at: '2026-10-08T10:10:00Z', oaUrl: 'https://line.me/R/oaMessage/%40myshop/?LINK-ABCDEFGHJK' },
    })
  })

  it('an already-linked customer gets a Thai refusal', async () => {
    db.rpc.mockReset()
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'LINE_CUSTOMER_ALREADY_LINKED' } })
    const { createCustomerLineLinkCode } = await import('@/app/actions/line')
    expect(await createCustomerLineLinkCode('9d0f2a52-7d1c-4d6e-8f0e-111111111111')).toEqual({ success: false, error: 'ลูกค้ารายนี้ผูก LINE แล้ว' })
  })

  it('an expired customer code typed in LINE gets the expired reply', async () => {
    const store: WebhookStore = {
      recordEvent: vi.fn(async () => ({ duplicate: false, contactId: 'c', status: 'UNLINKED' as const })),
      consumeLinkCode: vi.fn(async () => ({ result: 'EXPIRED' as const })),
      taskPostback: vi.fn(),
      taskStep: vi.fn(),
    }
    const provider = new MockLineProvider()
    const rawBody = JSON.stringify({
      events: [{ type: 'message', webhookEventId: 'e1', timestamp: 1791475200000, replyToken: 'rt', source: { type: 'user', userId: 'U' + '3'.repeat(32) }, message: { type: 'text', id: 'm1', text: 'LINK-ABCDEFGHJK' } }],
    })
    const res = await handleLineWebhook({ rawBody, signature: await signLineBody(SECRET, rawBody), channelSecret: SECRET, store, provider, shopName: 'ร้านเอ' })
    expect(res.status).toBe(200)
    expect(JSON.stringify(provider.replied)).toContain(LINE_TEMPLATES.LINK_EXPIRED.text)
  })
})

describe('bill over LINE: recipient comes from the bill', () => {
  it('line_bill_send resolves the contact from the bill and goes through the normal enqueue', () => {
    const send = fnBody('line_bill_send')
    expect(send).toContain("_require_menu('bills', 'line')")
    expect(send).toMatch(/FROM public\.bills b WHERE b\.id = p_bill_id/)
    expect(send).toMatch(/c\.customer_id = v_customer AND c\.status = 'LINKED'/)
    expect(send).toMatch(/line_delivery_enqueue\(v_contact, 'BILL', p_bill_id, 'BILL_MESSAGE'/)
    expect(fnBody('line_bill_recipient')).not.toContain('line_user_id')
  })

  it('both bill RPCs are granted to signed-in users only', () => {
    const grant = [...SQL.matchAll(/GRANT EXECUTE ON FUNCTION([^;]*?)TO authenticated;/g)].map((m) => m[1]).join('\n')
    expect(grant).toContain('public.line_bill_recipient(uuid)')
    expect(grant).toContain('public.line_bill_send(uuid, text, text)')
  })
})

describe('policies.line validation (TS and SQL agree)', () => {
  it('accepts a valid policy and an absent one', () => {
    expect(validateLinePolicy(undefined)).toEqual({ ok: true })
    expect(
      validateLinePolicy({
        linkCodeTtlMinutes: 10,
        linkMaxFailures: 5,
        linkLockMinutes: 15,
        linkGlobalMaxFailures: 30,
        notify: { PAYMENT_DUE: true, LOW_STOCK: false },
        templates: { TEST: 'ทดสอบจาก {ชื่อร้าน}', TASK_NOT_ALLOWED: 'ไม่ใช่งานของคุณ' },
      }),
    ).toEqual({ ok: true })
  })

  it.each([
    [[], 'line'],
    [{ unknownKey: 1 }, 'line.unknownKey'],
    [{ linkMaxFailures: 2 }, 'line.linkMaxFailures'],
    [{ linkMaxFailures: 5.5 }, 'line.linkMaxFailures'],
    [{ linkLockMinutes: '15' }, 'line.linkLockMinutes'],
    [{ linkCodeTtlMinutes: 61 }, 'line.linkCodeTtlMinutes'],
    [{ notify: [] }, 'line.notify'],
    [{ notify: { PAYMENT_DUE: 'yes' } }, 'line.notify.PAYMENT_DUE'],
    [{ notify: { 'bad-type': true } }, 'line.notify.bad-type'],
    [{ templates: { NOPE: 'x' } }, 'line.templates.NOPE'],
    [{ templates: { TEST: '   ' } }, 'line.templates.TEST'],
    [{ templates: { TEST: 'สวัสดี {ชื่อลูกค้า}' } }, 'line.templates.TEST'],
    [{ templates: { TEST: 'x'.repeat(5001) } }, 'line.templates.TEST'],
  ])('refuses %j at %s', (value, path) => {
    expect(validateLinePolicy(value)).toEqual({ ok: false, path })
  })

  it('SQL template placeholders match LINE_TEMPLATES exactly', () => {
    // the newest definition counts (20261015090000 adds the driver step / withdraw texts)
    const latest = readFileSync(join(process.cwd(), 'supabase/migrations/20261015090000_driver_line_steps_v1.sql'), 'utf8')
    const at = latest.indexOf('CREATE OR REPLACE FUNCTION public._line_template_vars(')
    const body = latest.slice(at, latest.indexOf('$$', latest.indexOf('$$', at) + 2) + 2)
    const sqlMap: Record<string, string[]> = {}
    for (const m of body.matchAll(/WHEN '(\w+)'\s+THEN ARRAY\[(.*?)\]/g)) {
      sqlMap[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
    }
    const tsMap = Object.fromEntries(Object.entries(LINE_TEMPLATES).map(([k, v]) => [k, [...v.vars]]))
    expect(sqlMap).toEqual(tsMap)
  })

  it('SQL integer ranges match LINE_POLICY_INT_RANGES exactly', () => {
    const json = fnBody('_line_policy_check').match(/v_ints\s+jsonb := '([\s\S]*?)';/)![1]
    expect(JSON.parse(json)).toEqual(LINE_POLICY_INT_RANGES)
  })

  it('the trigger checks only policies.line, and only when it changed', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_store_settings_line_policy\s+BEFORE INSERT OR UPDATE OF policies ON public\.store_settings/)
    expect(fnBody('_trg_store_settings_line_policy')).toContain("(NEW.policies -> 'line') IS DISTINCT FROM (OLD.policies -> 'line')")
  })
})

describe('Vault set / change / clear', () => {
  beforeEach(() => db.rpc.mockReset())

  it('SQL: writers serialize, clear deletes the rows, status never decrypts', () => {
    expect(fnBody('line_channel_set')).toContain("pg_advisory_xact_lock(hashtext('public.line_channel_vault'))")
    const clear = fnBody('line_channel_clear')
    expect(clear).toMatch(/DELETE FROM vault\.secrets WHERE name IN \('line_channel_secret', 'line_channel_access_token'\)/)
    expect(clear).not.toMatch(/PERFORM vault\.update_secret/)
    expect(fnBody('line_channel_status')).not.toContain('decrypted_secrets')
    // credentials are readable by the server path only
    expect(fnBody('line_channel_credentials')).toContain('_line_require_server')
  })

  it('a malformed secret or token is refused before the database, without echoing it', async () => {
    const { saveLineSecrets } = await import('@/app/actions/system-secrets')
    const badSecret = 'NOT-A-HEX-SECRET-zzzzzzzzzzzzzzzz'
    await expect(saveLineSecrets({ lineSecret: badSecret })).rejects.toThrow(/Channel Secret ไม่ถูกต้อง/)
    await expect(saveLineSecrets({ lineSecret: badSecret })).rejects.not.toThrow(badSecret)
    await expect(saveLineSecrets({ lineToken: 'has space inside the token value' })).rejects.toThrow(/Access Token ไม่ถูกต้อง/)
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('change sends only the new value; the other stays NULL (kept)', async () => {
    db.rpc.mockResolvedValue({ data: { vault: true, secret_configured: true, token_configured: true }, error: null })
    const { saveLineSecrets } = await import('@/app/actions/system-secrets')
    await saveLineSecrets({ lineSecret: SECRET })
    expect(db.rpc).toHaveBeenCalledWith('line_channel_set', { p_channel_secret: SECRET, p_access_token: null })
  })

  it('clear needs a reason before the database is called', async () => {
    const { clearLineSecrets } = await import('@/app/actions/system-secrets')
    await expect(clearLineSecrets('   ')).rejects.toThrow('กรุณาระบุเหตุผล')
    expect(db.rpc).not.toHaveBeenCalled()
    db.rpc.mockResolvedValue({ data: { vault: true, secret_configured: false, token_configured: false }, error: null })
    expect(await clearLineSecrets('เปลี่ยน OA')).toEqual({ available: true, lineSecretConfigured: false, lineTokenConfigured: false, liveDelivery: false })
    expect(db.rpc).toHaveBeenCalledWith('line_channel_clear', { p_reason: 'เปลี่ยน OA' })
  })
})

describe('delivery mode shown on Settings › LINE', () => {
  it('is live only when the server runs with LINE_DELIVERY_MODE=live', async () => {
    db.rpc.mockReset()
    db.rpc.mockResolvedValue({ data: { vault: true, secret_configured: true, token_configured: true }, error: null })
    const { getLineSecretStatus } = await import('@/app/actions/system-secrets')
    const before = process.env.LINE_DELIVERY_MODE
    try {
      delete process.env.LINE_DELIVERY_MODE
      expect((await getLineSecretStatus()).liveDelivery).toBe(false)
      process.env.LINE_DELIVERY_MODE = 'live'
      expect((await getLineSecretStatus()).liveDelivery).toBe(true)
    } finally {
      if (before === undefined) delete process.env.LINE_DELIVERY_MODE
      else process.env.LINE_DELIVERY_MODE = before
    }
  })
})
