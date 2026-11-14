import { createLineProvider } from '@/lib/line/provider'
import { verifyLineSignature } from '@/lib/line/signature'
import { createSupabaseLineStore } from '@/lib/line/supabase-store'
import { handleLineWebhook, MAX_BODY_BYTES } from '@/lib/line/webhook'

/**
 * LINE Messaging API webhook. Public (no session — LINE calls it), so the signature check is the only gate;
 * nothing is written before it passes. Replies go through createLineProvider: the mock unless
 * LINE_DELIVERY_MODE=live.
 *
 * Cheap refusals first (audit 2026-11-12): no signature or a body that is too large is refused before the body is
 * read or the database is asked; the channel keys are kept for a minute (a key changed in Settings is used within
 * a minute), so junk traffic does not read them every time; the shop profile is read only after the signature passes.
 */
export const dynamic = 'force-dynamic'

const CREDENTIALS_TTL_MS = 60_000
let credentialsCache: { at: number; channelSecret: string; accessToken: string } | null = null

async function lineCredentials(store: ReturnType<typeof createSupabaseLineStore>) {
  const now = Date.now()
  if (credentialsCache && now - credentialsCache.at < CREDENTIALS_TTL_MS) return credentialsCache
  const { channelSecret, accessToken } = await store.credentials()
  credentialsCache = { at: now, channelSecret: channelSecret ?? '', accessToken: accessToken ?? '' }
  return credentialsCache
}

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get('x-line-signature')
  if (!signature) return Response.json({ ok: false, error: 'BAD_SIGNATURE' }, { status: 401 })
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: 'BODY_TOO_LARGE' }, { status: 413 })
  }
  const rawBody = await request.text()
  try {
    const store = createSupabaseLineStore()
    const keys = await lineCredentials(store)
    if (!keys.channelSecret) return Response.json({ ok: false, error: 'LINE_NOT_CONFIGURED' }, { status: 503 })
    if (!(await verifyLineSignature(keys.channelSecret, rawBody, signature))) {
      return Response.json({ ok: false, error: 'BAD_SIGNATURE' }, { status: 401 })
    }
    const profile = await store.shopProfile()
    // handleLineWebhook checks the size and the signature again (it is also used on its own).
    const result = await handleLineWebhook({
      rawBody,
      signature,
      channelSecret: keys.channelSecret,
      store,
      provider: createLineProvider(keys.accessToken),
      shopName: profile.shopName,
      templates: profile.templates,
    })
    return Response.json(result.body, { status: result.status })
  } catch {
    // no detail: the error may come from the database or the provider
    return Response.json({ ok: false, error: 'LINE_WEBHOOK_FAILED' }, { status: 500 })
  }
}
