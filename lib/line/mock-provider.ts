import { type LineMessage, type LineProvider, type ProviderResult } from './types'

/**
 * Local stand-in for LINE. Records what would have been sent, answers with scripted results,
 * and behaves like LINE for a repeated X-Line-Retry-Key (409 after the first acceptance).
 */
export class MockLineProvider implements LineProvider {
  readonly kind = 'mock' as const
  readonly pushed: Array<{ to: string; messages: LineMessage[]; retryKey: string }> = []
  readonly replied: Array<{ replyToken: string; messages: LineMessage[] }> = []
  private readonly accepted = new Set<string>()
  private script: Array<ProviderResult | 'throw'> = []

  /** Next push results, in order; when empty every push succeeds. */
  queue(...results: Array<ProviderResult | 'throw'>): this {
    this.script.push(...results)
    return this
  }

  async push(input: { to: string; messages: LineMessage[]; retryKey: string }): Promise<ProviderResult> {
    if (this.accepted.has(input.retryKey)) return { ok: false, status: 409, errorCode: 'RETRY_KEY_ACCEPTED' }
    const next = this.script.shift()
    if (next === 'throw') throw new Error('mock network failure')
    const result = next ?? { ok: true, status: 200, requestId: `mock-${this.pushed.length + 1}` }
    if (result.ok) {
      this.accepted.add(input.retryKey)
      this.pushed.push(input)
    }
    return result
  }

  async reply(input: { replyToken: string; messages: LineMessage[] }): Promise<ProviderResult> {
    this.replied.push(input)
    return { ok: true, status: 200 }
  }

  reset(): void {
    this.pushed.length = 0
    this.replied.length = 0
    this.accepted.clear()
    this.script = []
  }
}
