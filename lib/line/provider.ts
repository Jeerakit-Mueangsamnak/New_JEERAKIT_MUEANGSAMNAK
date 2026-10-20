import 'server-only'
import { redactSecrets } from './redact'
import { MockLineProvider } from './mock-provider'
import { type LineMessage, type LineProvider, type ProviderResult } from './types'

const LINE_API = 'https://api.line.me/v2/bot/message'
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
