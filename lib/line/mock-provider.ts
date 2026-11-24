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

  /** No LINE in mock mode: the display name stays unknown. */
  async profile(): Promise<{ displayName: string; pictureUrl?: string | null } | null> {
    return null
  }

  /** Chat menu calls, in order, so a test can see exactly what would have gone to LINE. */
  readonly richMenu: Array<{ call: string; args: unknown[] }> = []
  private menuSeq = 0
  private scriptedMenu: ProviderResult[] = []
  /** Next chat menu results, in order; when empty every call succeeds. */
  queueMenu(...results: ProviderResult[]): this {
    this.scriptedMenu.push(...results)
    return this
  }
  private menu(call: string, args: unknown[]): ProviderResult {
    this.richMenu.push({ call, args })
    return this.scriptedMenu.shift() ?? { ok: true, status: 200, requestId: `mock-menu-${this.richMenu.length}` }
  }
  async createRichMenu(body: unknown): Promise<ProviderResult & { richMenuId?: string }> {
    const r = this.menu('create', [body])
    this.menuSeq++
    return r.ok ? { ...r, richMenuId: `richmenu-${this.menuSeq.toString(16).padStart(32, '0')}` } : r
  }
  async uploadRichMenuImage(richMenuId: string, image: Uint8Array, contentType: string): Promise<ProviderResult> {
    return this.menu('upload', [richMenuId, image.byteLength, contentType])
  }
  async setDefaultRichMenu(richMenuId: string): Promise<ProviderResult> {
    return this.menu('setDefault', [richMenuId])
  }
  async cancelDefaultRichMenu(): Promise<ProviderResult> {
    return this.menu('cancelDefault', [])
  }
  async linkRichMenu(userId: string, richMenuId: string): Promise<ProviderResult> {
    return this.menu('link', [userId, richMenuId])
  }
  async unlinkRichMenu(userId: string): Promise<ProviderResult> {
    return this.menu('unlink', [userId])
  }
  async deleteRichMenu(richMenuId: string): Promise<ProviderResult> {
    return this.menu('delete', [richMenuId])
  }

  reset(): void {
    this.richMenu.length = 0
    this.menuSeq = 0
    this.scriptedMenu = []
    this.pushed.length = 0
    this.replied.length = 0
    this.accepted.clear()
    this.script = []
  }
}
