import { createLineProvider } from '@/lib/line/provider'
import { createSupabaseLineStore } from '@/lib/line/supabase-store'
import { handleLineWebhook } from '@/lib/line/webhook'

/**
 * LINE Messaging API webhook. Public (no session — LINE calls it), so the signature check in
 * handleLineWebhook is the only gate; nothing is written before it passes. Replies go through
 * createLineProvider: the mock unless LINE_DELIVERY_MODE=live.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text()
  try {
    const store = createSupabaseLineStore()
    const [{ channelSecret, accessToken }, profile] = await Promise.all([store.credentials(), store.shopProfile()])
    const result = await handleLineWebhook({
      rawBody,
      signature: request.headers.get('x-line-signature'),
      channelSecret,
      store,
      provider: createLineProvider(accessToken),
      shopName: profile.shopName,
      templates: profile.templates,
    })
    return Response.json(result.body, { status: result.status })
  } catch {
    // no detail: the error may come from the database or the provider
    return Response.json({ ok: false, error: 'LINE_WEBHOOK_FAILED' }, { status: 500 })
  }
}
