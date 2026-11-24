import 'server-only'
import { redactSecrets } from './redact'
import { MockLineProvider } from './mock-provider'
import { type LineMessage, type LineProvider, type ProviderResult } from './types'

const LINE_API = 'https://api.line.me/v2/bot/message'
const LINE_PROFILE_API = 'https://api.line.me/v2/bot/profile'
const LINE_API_ROOT = 'https://api.line.me/v2/bot'
const LINE_RICH_MENU_API = `${LINE_API_ROOT}/richmenu`
const LINE_RICH_MENU_DATA_API = 'https://api-data.line.me/v2/bot/richmenu'
const RICH_MENU_ID = /^richmenu-[0-9a-f]{32}$/
const TIMEOUT_MS = 10_000

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/**
 * Real Messaging API sender (push / reply). Used only when LINE_DELIVERY_MODE=live; the
 * default is the mock, so nothing reaches LINE from local or test runs.
 */
export class HttpLineProvider implements LineProvider {
  readonly kind = 'http' as const

  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!accessToken) throw new Error('LINE_TOKEN_MISSING')
  }

  private async call(path: 'push' | 'reply', body: unknown, retryKey?: string): Promise<ProviderResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      }
      if (retryKey) headers['X-Line-Retry-Key'] = retryKey
      const res = await this.fetchImpl(`${LINE_API}/${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const requestId = res.headers.get('x-line-request-id') ?? undefined
      if (res.ok) return { ok: true, status: res.status, requestId }
      const retryAfter = Number(res.headers.get('retry-after'))
      return {
        ok: false,
        status: res.status,
        requestId,
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      }
    } catch (error) {
      // never echo the request (it holds the token) — only a redacted error name
      const name = error instanceof Error ? error.name : 'Error'
      return { ok: false, status: 0, errorCode: redactSecrets(name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', [this.accessToken]) }
    } finally {
      clearTimeout(timer)
    }
  }

  push(input: { to: string; messages: LineMessage[]; retryKey: string }): Promise<ProviderResult> {
    return this.call('push', { to: input.to, messages: input.messages }, input.retryKey)
  }

  reply(input: { replyToken: string; messages: LineMessage[] }): Promise<ProviderResult> {
    return this.call('reply', { replyToken: input.replyToken, messages: input.messages })
  }

  /** One call of the rich menu API. Never carries the token or the body back; a network failure is status 0. */
  private async menuCall(method: 'POST' | 'DELETE', url: string, init: { body?: BodyInit; contentType?: string } = {}): Promise<ProviderResult & { json?: Record<string, unknown> }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS * 3)
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${this.accessToken}` }
      if (init.contentType) headers['Content-Type'] = init.contentType
      const res = await this.fetchImpl(url, { method, headers, ...(init.body !== undefined ? { body: init.body } : {}), signal: controller.signal })
      const requestId = res.headers.get('x-line-request-id') ?? undefined
      if (!res.ok) return { ok: false, status: res.status, requestId }
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { ok: true, status: res.status, requestId, json }
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error'
      return { ok: false, status: 0, errorCode: redactSecrets(name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', [this.accessToken]) }
    } finally {
      clearTimeout(timer)
    }
  }

  async createRichMenu(body: unknown): Promise<ProviderResult & { richMenuId?: string }> {
    const r = await this.menuCall('POST', LINE_RICH_MENU_API, { body: JSON.stringify(body), contentType: 'application/json' })
    const id = typeof r.json?.richMenuId === 'string' && /^richmenu-[0-9a-f]{32}$/.test(r.json.richMenuId) ? r.json.richMenuId : undefined
    const { json: _json, ...result } = r
    return r.ok && !id ? { ...result, ok: false, errorCode: 'NO_RICH_MENU_ID' } : { ...result, richMenuId: id }
  }

  async uploadRichMenuImage(richMenuId: string, image: Uint8Array, contentType: string): Promise<ProviderResult> {
    if (!RICH_MENU_ID.test(richMenuId)) return { ok: false, status: 0, errorCode: 'BAD_RICH_MENU_ID' }
    const { json: _json, ...result } = await this.menuCall('POST', `${LINE_RICH_MENU_DATA_API}/${richMenuId}/content`, { body: image as BodyInit, contentType })
    return result
  }

  async setDefaultRichMenu(richMenuId: string): Promise<ProviderResult> {
    if (!RICH_MENU_ID.test(richMenuId)) return { ok: false, status: 0, errorCode: 'BAD_RICH_MENU_ID' }
    const { json: _json, ...result } = await this.menuCall('POST', `${LINE_API_ROOT}/user/all/richmenu/${richMenuId}`)
    return result
  }

  async cancelDefaultRichMenu(): Promise<ProviderResult> {
    const { json: _json, ...result } = await this.menuCall('DELETE', `${LINE_API_ROOT}/user/all/richmenu`)
    return result
  }

  async linkRichMenu(userId: string, richMenuId: string): Promise<ProviderResult> {
    if (!/^U[0-9a-f]{32}$/.test(userId) || !RICH_MENU_ID.test(richMenuId)) return { ok: false, status: 0, errorCode: 'BAD_ID' }
    const { json: _json, ...result } = await this.menuCall('POST', `${LINE_API_ROOT}/user/${userId}/richmenu/${richMenuId}`)
    return result
  }

  async unlinkRichMenu(userId: string): Promise<ProviderResult> {
    if (!/^U[0-9a-f]{32}$/.test(userId)) return { ok: false, status: 0, errorCode: 'BAD_ID' }
    const { json: _json, ...result } = await this.menuCall('DELETE', `${LINE_API_ROOT}/user/${userId}/richmenu`)
    return result
  }

  async deleteRichMenu(richMenuId: string): Promise<ProviderResult> {
    if (!RICH_MENU_ID.test(richMenuId)) return { ok: false, status: 0, errorCode: 'BAD_RICH_MENU_ID' }
    const { json: _json, ...result } = await this.menuCall('DELETE', `${LINE_RICH_MENU_API}/${richMenuId}`)
    return result
  }

  /** Get profile (free). Any failure = null: the name is only shown to the shop. */
  async profile(userId: string): Promise<{ displayName: string; pictureUrl?: string | null } | null> {
    if (!/^U[0-9a-f]{32}$/.test(userId)) return null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await this.fetchImpl(`${LINE_PROFILE_API}/${userId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: controller.signal,
      })
      if (!res.ok) return null
      const body = (await res.json()) as { displayName?: unknown; pictureUrl?: unknown }
      if (typeof body.displayName !== 'string') return null
      // the picture is kept only when LINE gave a plain https address (the database refuses anything else)
      const pictureUrl = typeof body.pictureUrl === 'string' && /^https:\/\//.test(body.pictureUrl) && body.pictureUrl.length <= 1000 ? body.pictureUrl : null
      return { displayName: body.displayName.slice(0, 200), pictureUrl }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}

export type LineDeliveryMode = 'mock' | 'live'

export function lineDeliveryMode(env: Record<string, string | undefined> = process.env): LineDeliveryMode {
  return env.LINE_DELIVERY_MODE === 'live' ? 'live' : 'mock'
}

let sharedMock: MockLineProvider | null = null

/** Mock unless the server explicitly runs with LINE_DELIVERY_MODE=live and a token exists. */
export function createLineProvider(accessToken: string | null | undefined, env: Record<string, string | undefined> = process.env): LineProvider {
  if (lineDeliveryMode(env) === 'live' && accessToken) return new HttpLineProvider(accessToken)
  sharedMock ??= new MockLineProvider()
  return sharedMock
}
